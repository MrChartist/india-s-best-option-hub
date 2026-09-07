/**
 * panicLegExecution — the per-leg mechanics panicLayer.mjs's waves are built
 * from (1CLIQ-TRADE-SPEC.md §5): classifying a broker rejection, building
 * the MARKET/IOC close order for one position, running a bounded-concurrency
 * pool of legs, and the exact two retries the spec allows for a single leg.
 * Split out of panicLayer.mjs to keep both files under the 300-line rule —
 * panicLayer.mjs owns the WAVE-level pipeline (ordering, the barrier, the
 * margin-stop/resume decision); this file owns what happens to ONE leg.
 *
 * ORDER EXECUTOR CONTRACT: `orderExecutor(closeIntent) -> Promise<result>`
 * must resolve on a successful placement and THROW on any failure — a
 * validation rejection (freeze qty, insufficient margin, market closed, ...)
 * or a transport/5xx failure alike — with `error.message` carrying the
 * broker's own words. That already matches how dhanFetch() (server/brokers/
 * dhan.mjs) behaves for every other call in this codebase, so the real
 * executor proxy-server.mjs wires up needs no special-casing.
 *
 * @typedef {Object} CloseIntent
 * @property {string} positionId
 * @property {string} securityId
 * @property {string} exchangeSegment
 * @property {string} [productType]
 * @property {"BUY"|"SELL"} transactionType   the direction that CLOSES the position
 * @property {number} lots
 * @property {number} lotSize
 * @property {number} quantity        lots * lotSize
 * @property {"MARKET"} orderType
 * @property {"IOC"} validity
 * @property {1|2|3} wave
 */

const NETWORK_RETRY_DELAYS_MS = [400, 1200];
const NETWORK_RETRY_JITTER_RATIO = 0.2;

// The one piece of module-level mutable state: how this file waits. Real use
// waits on the wall clock; tests swap in an instant no-op so a suite doesn't
// spend real seconds on 400ms/1200ms backoffs (panicLayer.mjs's cancelAll
// reuses this same `sleep()` for its own 1.5s sweep gap).
let sleepImpl = (ms) => new Promise((res) => setTimeout(res, ms));

export function sleep(ms) {
  return sleepImpl(ms);
}

/** Test seam — replace the wait implementation (e.g. instant resolve). */
export function setSleepImplForTests(fn) {
  sleepImpl = typeof fn === "function" ? fn : sleepImpl;
}

/** Test seam — restore the real setTimeout-based wait. */
export function resetPanicExecutionForTests() {
  sleepImpl = (ms) => new Promise((res) => setTimeout(res, ms));
}

function jittered(ms) {
  const delta = ms * NETWORK_RETRY_JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(ms + delta));
}

/**
 * Classify a broker rejection from its own message text, case-insensitively
 * (spec §5). Order matters: checked most-specific first so, e.g., a message
 * that happens to mention both "margin" and a 5xx-looking number still reads
 * as a margin rejection, not a network blip.
 */
export function classifyRejection(message) {
  const text = String(message || "");
  if (/freeze/i.test(text)) return "FREEZE_QTY";
  if (/insufficient|margin/i.test(text)) return "INSUFFICIENT_MARGIN";
  if (/market\s*(is\s*)?closed|circuit/i.test(text)) return "MARKET_CLOSED_OR_CIRCUIT";
  if (/\b5\d{2}\b|network|timeout|econnreset|etimedout|fetch failed|socket hang up|enotfound/i.test(text)) return "NETWORK";
  return "UNKNOWN";
}

/**
 * Build the MARKET/IOC close order for one open position. BUY closes a
 * short; SELL closes a long — inferred only from the position's own signed
 * `netQty`, never from which wave it's in. `lots`/`lotSize` default so a
 * caller that already resolved a whole-lot count can pass it straight
 * through, and one that only has raw signed quantity + a contract
 * multiplier still gets a correct, lot-aligned whole number.
 */
export function buildCloseIntent(position, wave) {
  const lotSize = Number.isFinite(position.lotSize) && position.lotSize > 0 ? position.lotSize : 1;
  const lots = Number.isFinite(position.lots) && position.lots > 0
    ? position.lots
    : Math.max(1, Math.round(Math.abs(Number(position.netQty) || 0) / lotSize));
  return {
    positionId: position.id,
    securityId: position.securityId,
    exchangeSegment: position.exchangeSegment,
    productType: position.productType,
    transactionType: Number(position.netQty) < 0 ? "BUY" : "SELL",
    lots,
    lotSize,
    quantity: lots * lotSize,
    orderType: "MARKET",
    validity: "IOC", // spec §5: MARKET/IOC for panic exits, unlike the DAY-validity default in §8
    wave,
  };
}

/**
 * Bounded-concurrency pool that preserves input order in its results array
 * (a `undefined` hole means that item was never dispatched — used by a
 * caller to detect items abandoned mid-flight). `shouldStop()` is polled
 * before each new item is pulled, not mid-item — an in-flight item is always
 * allowed to finish.
 */
export async function runPool(items, concurrency, handler, shouldStop = () => false) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      if (shouldStop()) return;
      const i = cursor++;
      results[i] = await handler(items[i], i);
    }
  }
  const workerCount = Math.max(0, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Submit one leg, honouring the two retries the spec allows and no others:
 *  - FREEZE_QTY: halve the slice and retry the SAME remaining lots at the
 *    smaller size — the ONLY retry that changes the payload (spec §5). The
 *    loop naturally terminates: each halving strictly shrinks an integer lot
 *    count towards 1, so it cannot spin forever.
 *  - NETWORK: retry the SAME slice unchanged, waiting 400ms then 1200ms
 *    (jittered) — spec's two-retry backoff ladder.
 *  MARKET_CLOSED_OR_CIRCUIT and INSUFFICIENT_MARGIN get zero retries here;
 *  the margin case is a WAVE-level decision ("stop Wave B, resume Wave A"),
 *  handled by panicLayer.mjs's runWave(), not retried per-leg.
 */
export async function submitLegWithFreezeSlicing(closeIntent, orderExecutor, onEvent) {
  let remainingLots = closeIntent.lots;
  let sliceLots = remainingLots;
  let networkRetries = 0;
  const sliceOutcomes = [];

  while (remainingLots > 0) {
    const intent = { ...closeIntent, lots: sliceLots, quantity: sliceLots * closeIntent.lotSize };
    onEvent({ type: "ORDER_SUBMIT", wave: intent.wave, positionId: intent.positionId, lots: intent.lots });

    try {
      const result = await orderExecutor(intent);
      sliceOutcomes.push({ ok: true, lots: sliceLots, result });
      onEvent({ type: "ORDER_TERMINAL", wave: intent.wave, positionId: intent.positionId, lots: intent.lots, status: result?.status ?? "TRADED" });
      remainingLots -= sliceLots;
      networkRetries = 0;
      sliceLots = Math.min(sliceLots, remainingLots) || remainingLots;
      continue;
    } catch (err) {
      const classification = classifyRejection(err?.message);
      onEvent({ type: "ORDER_REJECTED", wave: intent.wave, positionId: intent.positionId, lots: intent.lots, classification, message: err?.message });

      if (classification === "FREEZE_QTY" && sliceLots > 1) {
        sliceLots = Math.max(1, Math.floor(sliceLots / 2));
        continue;
      }
      if (classification === "NETWORK" && networkRetries < NETWORK_RETRY_DELAYS_MS.length) {
        await sleep(jittered(NETWORK_RETRY_DELAYS_MS[networkRetries]));
        networkRetries += 1;
        continue;
      }

      sliceOutcomes.push({ ok: false, lots: sliceLots, classification, message: err?.message });
      return {
        ok: false,
        positionId: closeIntent.positionId,
        filledLots: closeIntent.lots - remainingLots,
        remainingLots,
        classification,
        message: err?.message,
        sliceOutcomes,
      };
    }
  }

  return { ok: true, positionId: closeIntent.positionId, filledLots: closeIntent.lots, remainingLots: 0, sliceOutcomes };
}
