/**
 * panicLayer — Close All / Cancel All (1CLIQ-TRADE-SPEC.md §5), the single
 * most important safety mechanism in the spec.
 *
 * WHY THREE WAVES, NEVER A FLAT FAN-OUT (spec §5, §13 failure mode #4):
 *   Closing a hedge before the short leg it protects re-classifies the
 *   remaining short as NAKED. Naked SPAN margin is far higher than a hedged
 *   spread's, so the instant the hedge is gone the broker can reject the
 *   short's own close order for insufficient margin — which is exactly the
 *   position a panic button must never create. So:
 *     Wave A — buy-to-close every SHORT option, biggest |unrealised loss|
 *              first (the position bleeding fastest gets closed first).
 *     Wave B — sell-to-close every LONG option (the hedges).
 *     Wave C — futures/equity legs, which carry no spread relationship to
 *              unwind and so go last, once every option-side risk is gone.
 *   Wave A releases margin as it goes; only once every short has had its one
 *   honest attempt (Wave A is fully terminal — see runWave()'s barrier note
 *   below) do the hedges that were protecting them get touched.
 *
 * Per-leg mechanics (retry classification, the concurrency-3 pool, building
 * the close order) live in panicLegExecution.mjs — this file owns the
 * WAVE-level pipeline: ordering, the hard barrier, and the margin-stop /
 * resume decision. Both are pure-function testable: `orderExecutor` /
 * `cancelExecutor` / `fetchOpenPositions` / `fetchOpenOrders` are all
 * injected by the caller (proxy-server.mjs wires them to real Dhan calls),
 * exactly like dhanOrders.test.mjs avoids a live network call.
 *
 * @typedef {Object} OpenPosition
 * @property {string} id             stable id, e.g. `${exchangeSegment}:${securityId}`
 * @property {string} securityId
 * @property {string} exchangeSegment
 * @property {string} [productType]  passed straight through to the close order
 * @property {"OPTION"|"FUTURE"|"EQUITY"} assetClass
 * @property {number} netQty         signed; negative = short, positive = long
 * @property {number} [lotSize]      contract multiplier; defaults to 1 (equities)
 * @property {number} [lots]         whole lots still open; derived from netQty/lotSize if omitted
 * @property {number} unrealisedPnl  signed; negative = a loss
 */

import { classifyRejection, buildCloseIntent, runPool, submitLegWithFreezeSlicing, sleep } from "./panicLegExecution.mjs";

export { classifyRejection } from "./panicLegExecution.mjs";
export { setSleepImplForTests, resetPanicExecutionForTests as resetPanicLayerForTests } from "./panicLegExecution.mjs";

const WAVE_CONCURRENCY = 3;
const CANCEL_SWEEP_GAP_MS = 1500;

function isShortOption(p) {
  return p?.assetClass === "OPTION" && Number(p.netQty) < 0;
}
function isLongOption(p) {
  return p?.assetClass === "OPTION" && Number(p.netQty) > 0;
}
function lossMagnitude(p) {
  const pnl = Number(p.unrealisedPnl);
  return Number.isFinite(pnl) && pnl < 0 ? -pnl : 0;
}

/** Wave A only: biggest |unrealised loss| first. Array.sort is stable, so ties keep input order. */
function sortByAbsLossDesc(positions) {
  return positions.slice().sort((a, b) => lossMagnitude(b) - lossMagnitude(a));
}

/**
 * Run one wave to completion. THE HARD BARRIER between waves (spec §5) is
 * this function's own `await` on runPool(): runPool does not resolve until
 * every dispatched leg — including all of its internal freeze/network
 * retries — has reached a terminal outcome (closed, or failed with no more
 * retries left). closeAll() below only calls the next wave AFTER awaiting
 * this one, so a slow leg here structurally delays the next wave's first
 * dispatch; there is no separate poll loop because there is nothing left to
 * poll for by the time this promise settles.
 *
 * Wave B only: the moment any leg comes back INSUFFICIENT_MARGIN, `shouldStop`
 * flips true and runPool stops pulling NEW items (already-in-flight ones are
 * allowed to finish) — spec: "insufficient margin -> stop Wave B, resume
 * Wave A". closeAll() reads `marginStop`/`notAttempted` off the return value
 * to drive that resume.
 */
async function runWave(positions, waveNumber, orderExecutor, ctx) {
  ctx.onEvent({ type: "WAVE_OPEN", wave: waveNumber, count: positions.length });
  let marginStop = false;

  const outcomes = await runPool(
    positions,
    ctx.concurrency,
    async (pos) => {
      const outcome = await submitLegWithFreezeSlicing(buildCloseIntent(pos, waveNumber), orderExecutor, ctx.onEvent);
      if (waveNumber === 2 && !outcome.ok && outcome.classification === "INSUFFICIENT_MARGIN") marginStop = true;
      return { position: pos, ...outcome };
    },
    () => marginStop,
  );

  const results = outcomes.filter(Boolean);
  const attemptedIds = new Set(results.map((r) => r.position.id));
  const notAttempted = positions.filter((p) => !attemptedIds.has(p.id));

  ctx.onEvent({
    type: "WAVE_CLOSE",
    wave: waveNumber,
    closed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    notAttempted: notAttempted.length,
    marginStop,
  });

  return { wave: waveNumber, results, notAttempted, marginStop };
}

/**
 * Sweep every open position closed, wave by wave. See the file header for
 * why three waves and never a flat fan-out.
 *
 * Success is NEVER "every order call returned 200" — it is a re-verified
 * empty position book, fetched fresh (not read from `openPositions`) AFTER
 * every wave has run (spec §5 / §13 failure mode #5: "sweep reports done on
 * a partial").
 *
 * @param {OpenPosition[]} openPositions
 * @param {(intent: object) => Promise<object>} orderExecutor    see panicLegExecution.mjs's header for the resolve/throw contract
 * @param {() => Promise<OpenPosition[]>} fetchOpenPositions     re-fetch for the final re-verify (and to find what's still open when resuming Wave A/B)
 * @param {{concurrency?: number, onEvent?: (evt: object) => void}} [options]
 */
export async function closeAll(openPositions, orderExecutor, fetchOpenPositions, options = {}) {
  if (typeof fetchOpenPositions !== "function") {
    // Success here means "re-verified empty book" — with no way to
    // re-verify, the only honest answer is to refuse to run at all, not to
    // guess success:true (or even success:null) and let a caller mistake
    // that for "confirmed flat."
    throw new Error("closeAll() requires fetchOpenPositions to re-verify the position book — refusing to report success without one.");
  }
  const { concurrency = WAVE_CONCURRENCY, onEvent = () => {} } = options;
  const ctx = { concurrency, onEvent };

  const positions = Array.isArray(openPositions) ? openPositions : [];
  const shorts = sortByAbsLossDesc(positions.filter(isShortOption));
  const longs = positions.filter(isLongOption);
  const others = positions.filter((p) => !isShortOption(p) && !isLongOption(p));

  const waveA = await runWave(shorts, 1, orderExecutor, ctx);
  let waveB = await runWave(longs, 2, orderExecutor, ctx);

  if (waveB.marginStop) {
    // Unwinding shorts releases margin — go back and give Wave A's failures
    // another honest attempt before touching any more hedges.
    const unresolvedA = waveA.results.filter((r) => !r.ok).map((r) => r.position);
    onEvent({ type: "WAVE_RESUME", wave: 1, count: unresolvedA.length, reason: "INSUFFICIENT_MARGIN_IN_WAVE_B" });
    const resumedA = await runWave(unresolvedA, 1, orderExecutor, ctx);

    const remainingB = [
      ...waveB.notAttempted,
      ...waveB.results.filter((r) => !r.ok && r.classification === "INSUFFICIENT_MARGIN").map((r) => r.position),
    ];
    onEvent({ type: "WAVE_RESUME", wave: 2, count: remainingB.length, reason: "AFTER_WAVE_A_RESUME" });
    const resumedB = await runWave(remainingB, 2, orderExecutor, ctx);

    waveB = { ...waveB, resumed: resumedB };
    waveA.resumed = resumedA;
  }

  const waveC = await runWave(others, 3, orderExecutor, ctx);

  const remainingPositions = await fetchOpenPositions();
  const success = Array.isArray(remainingPositions) && remainingPositions.length === 0;
  onEvent({ type: success ? "CLOSE_ALL_SUCCESS" : "CLOSE_ALL_INCOMPLETE", remaining: Array.isArray(remainingPositions) ? remainingPositions.length : null });

  return {
    success,
    remainingPositions: Array.isArray(remainingPositions) ? remainingPositions : [],
    waves: { a: waveA, b: waveB, c: waveC },
  };
}

async function cancelSweep(orders, cancelExecutor, ctx, passNumber) {
  const queue = Array.isArray(orders) ? orders : [];
  ctx.onEvent({ type: "CANCEL_SWEEP_START", pass: passNumber, count: queue.length });

  const outcomes = await runPool(queue, ctx.concurrency, async (order) => {
    const orderId = order?.orderId ?? order?.id;
    try {
      const result = await cancelExecutor(order);
      ctx.onEvent({ type: "ORDER_CANCELLED", pass: passNumber, orderId });
      return { ok: true, order, result };
    } catch (err) {
      ctx.onEvent({ type: "CANCEL_FAILED", pass: passNumber, orderId, message: err?.message });
      return { ok: false, order, message: err?.message };
    }
  });

  ctx.onEvent({
    type: "CANCEL_SWEEP_END",
    pass: passNumber,
    ok: outcomes.filter((r) => r?.ok).length,
    failed: outcomes.filter((r) => r && !r.ok).length,
  });
  return { results: outcomes };
}

/**
 * Cancel every resting order, TWICE, 1.5s apart, re-fetching the open-order
 * book in between (spec §5) — a first pass can race a fill/partial-fill that
 * only settles a moment later, so a single pass is not enough to trust.
 *
 * @param {object[]} openOrders
 * @param {(order: object) => Promise<object>} cancelExecutor
 * @param {() => Promise<object[]>} fetchOpenOrders   re-fetch between passes and for the final check
 * @param {{concurrency?: number, onEvent?: (evt: object) => void, gapMs?: number}} [options]
 */
export async function cancelAll(openOrders, cancelExecutor, fetchOpenOrders, options = {}) {
  if (typeof fetchOpenOrders !== "function") {
    // Same reasoning as closeAll(): success is a re-verified empty order
    // book, not an assumption — with nothing to re-verify against, refuse
    // to run rather than report an unearned success (or a silent null).
    throw new Error("cancelAll() requires fetchOpenOrders to re-verify the order book — refusing to report success without one.");
  }
  const { concurrency = WAVE_CONCURRENCY, onEvent = () => {}, gapMs = CANCEL_SWEEP_GAP_MS } = options;
  const ctx = { concurrency, onEvent };

  const firstPass = await cancelSweep(openOrders, cancelExecutor, ctx, 1);
  await sleep(gapMs);

  const refetched = await fetchOpenOrders();
  const secondPass = await cancelSweep(Array.isArray(refetched) ? refetched : [], cancelExecutor, ctx, 2);

  const stillOpen = await fetchOpenOrders();
  const success = Array.isArray(stillOpen) ? stillOpen.length === 0 : null;
  onEvent({ type: success ? "CANCEL_ALL_SUCCESS" : "CANCEL_ALL_INCOMPLETE", remaining: Array.isArray(stillOpen) ? stillOpen.length : null });

  return { success, passes: [firstPass, secondPass], remainingOrders: Array.isArray(stillOpen) ? stillOpen : [] };
}
