/**
 * Basket / tranche engine — resolves basket legs to tradable contracts, orders
 * legs safely for entry/exit, plans tranched execution, and classifies the risk
 * left behind by a partially-filled basket.
 *
 * WHY specs, not ids — a saved basket stores `strikeSpec`/`expirySpec` (e.g.
 * "ATM+2", "nearest weekly"), never a resolved `securityId`. If it stored ids,
 * a basket saved on Monday and deployed on Friday would point at Monday's
 * (possibly expired) contract, or an ATM+2 struck for a spot that has since
 * moved 300 points. resolveBasket() re-resolves from live chain + spot every
 * time it runs, and it must only ever run at deploy time — see spec section 9.
 *
 * WHY leg ordering is one function, not two — placing a naked short before its
 * hedge arrives means the exchange charges full SPAN on it, and unwinding a
 * hedge before its short re-classifies a spread as naked. Both mistakes come
 * from two order lists drifting apart under independent maintenance.
 * legOrderScore() is the single source of truth; orderLegs() just sorts by
 * it, so entry and exit are provably each other's mirror (see the test file).
 */

// ── Leg resolution (deploy-time only) ──

/**
 * @typedef {{kind:"absolute", strike:number}|{kind:"relative", offset:number}|{kind:"delta", target:number}} StrikeSpec
 * @typedef {{kind:"absolute", date:string}|{kind:"nearest", weeksOut:0|1|2|"monthly"}} ExpirySpec
 * @typedef {Object} BasketLeg
 * @property {string} legId
 * @property {"BUY"|"SELL"} action
 * @property {"CE"|"PE"} optionType
 * @property {number} lots
 * @property {StrikeSpec} strikeSpec
 * @property {ExpirySpec} expirySpec
 * @typedef {Object} ChainOptionRow  - matches src/lib/mockData.ts's OptionData
 * @property {number} strikePrice
 * @property {{securityId?:string, exchangeSegment?:string, delta?:number}} ce
 * @property {{securityId?:string, exchangeSegment?:string, delta?:number}} pe
 * @typedef {Object} Chain
 * @property {string[]} expiries    - ascending ISO dates, already filtered to
 *   unexpired-as-of-now by the caller; this module never reads a clock, so
 *   "nearest" always means "index 0 of whatever list you hand it".
 * @property {Object<string, ChainOptionRow[]>} byExpiry
 * @typedef {Object} ResolvedLeg
 * @property {string} legId
 * @property {"BUY"|"SELL"} action
 * @property {"CE"|"PE"} optionType
 * @property {number} lots
 * @property {string|null} expiry
 * @property {number|null} strike
 * @property {string|null} securityId
 * @property {string|null} exchangeSegment
 * @property {boolean} blocked        - true => cannot deploy live (paper-only)
 * @property {string|null} blockedReason
 */

/** NSE's monthly contract is just the last unexpired weekly falling in that
 * calendar month — no separate flag on the chain needed. */
function isMonthlyExpiry(expiry, ascendingExpiries) {
  const monthPrefix = expiry.slice(0, 7); // "YYYY-MM"
  const sameMonth = ascendingExpiries.filter((e) => e.startsWith(monthPrefix));
  return sameMonth[sameMonth.length - 1] === expiry;
}

function resolveExpiry(expirySpec, expiries) {
  if (!expirySpec) return { expiry: null, reason: "Leg has no expirySpec." };
  if (expirySpec.kind === "absolute") {
    if (!expirySpec.date) return { expiry: null, reason: "Absolute expirySpec is missing a date." };
    return { expiry: expirySpec.date, reason: null };
  }
  if (expirySpec.kind !== "nearest") {
    return { expiry: null, reason: `Unknown expirySpec.kind: ${expirySpec.kind}` };
  }
  if (!Array.isArray(expiries) || expiries.length === 0) {
    return { expiry: null, reason: "No unexpired expiries available in the chain." };
  }
  if (expirySpec.weeksOut === "monthly") {
    const monthly = expiries.filter((e) => isMonthlyExpiry(e, expiries));
    if (monthly.length === 0) return { expiry: null, reason: "No monthly expiry found in the chain." };
    return { expiry: monthly[0], reason: null };
  }
  const idx = expirySpec.weeksOut;
  if (idx !== 0 && idx !== 1 && idx !== 2) {
    return { expiry: null, reason: `Invalid weeksOut: ${expirySpec.weeksOut}` };
  }
  if (idx >= expiries.length) {
    return { expiry: null, reason: `Chain has only ${expiries.length} expiries — weeksOut:${idx} is unavailable.` };
  }
  // Position-in-list resolution IS the roll: a Monday chain's index 0 is this
  // week's contract; once it expires and drops off, the same index 0 on the
  // next call is next week's — no date arithmetic, no memory of "last time".
  return { expiry: expiries[idx], reason: null };
}

function roundToStep(spot, stepSize) {
  if (!Number.isFinite(spot) || !Number.isFinite(stepSize) || stepSize <= 0) return null;
  return Math.round(spot / stepSize) * stepSize;
}

function resolveStrike(strikeSpec, rows, spot, stepSize, optionType) {
  if (!strikeSpec) return { strike: null, reason: "Leg has no strikeSpec." };
  if (strikeSpec.kind === "absolute") {
    if (!Number.isFinite(strikeSpec.strike)) return { strike: null, reason: "Absolute strikeSpec is missing a numeric strike." };
    return { strike: strikeSpec.strike, reason: null };
  }
  if (strikeSpec.kind === "relative") {
    if (!Number.isFinite(strikeSpec.offset)) return { strike: null, reason: "Relative strikeSpec is missing a numeric offset." };
    const atm = roundToStep(spot, stepSize);
    if (atm == null) return { strike: null, reason: `Cannot compute ATM from spot=${spot}, stepSize=${stepSize}.` };
    return { strike: atm + strikeSpec.offset * stepSize, reason: null };
  }
  if (strikeSpec.kind === "delta") {
    if (!Number.isFinite(strikeSpec.target)) return { strike: null, reason: "Delta strikeSpec is missing a numeric target." };
    if (!Array.isArray(rows) || rows.length === 0) return { strike: null, reason: "No chain rows available to match a delta target." };
    const side = optionType === "PE" ? "pe" : "ce";
    let best = null;
    let bestDiff = Infinity;
    for (const row of rows) {
      const leg = row[side];
      if (!leg || !Number.isFinite(leg.delta)) continue;
      const diff = Math.abs(Math.abs(leg.delta) - strikeSpec.target);
      const better = diff < bestDiff - 1e-9;
      const tie = !better && Math.abs(diff - bestDiff) <= 1e-9 &&
        (!best || Math.abs(row.strikePrice - spot) < Math.abs(best.strikePrice - spot));
      if (better || tie) { best = row; bestDiff = diff; }
    }
    if (!best) return { strike: null, reason: `No strike in the chain has a usable ${side.toUpperCase()} delta near target ${strikeSpec.target}.` };
    return { strike: best.strikePrice, reason: null };
  }
  return { strike: null, reason: `Unknown strikeSpec.kind: ${strikeSpec.kind}` };
}

/** @returns {ResolvedLeg} */
function resolveLeg(leg, chain, spot, stepSize) {
  const base = { legId: leg.legId, action: leg.action, optionType: leg.optionType, lots: leg.lots };
  const blockedLeg = (expiry, strike, reason, exchangeSegment = null) =>
    ({ ...base, expiry, strike, securityId: null, exchangeSegment, blocked: true, blockedReason: reason });

  const { expiry, reason: expiryReason } = resolveExpiry(leg.expirySpec, chain?.expiries || []);
  if (!expiry) return blockedLeg(null, null, expiryReason);

  const rows = chain?.byExpiry?.[expiry] || [];
  const { strike, reason: strikeReason } = resolveStrike(leg.strikeSpec, rows, spot, stepSize, leg.optionType);
  if (strike == null) return blockedLeg(expiry, null, strikeReason);

  const row = rows.find((r) => r.strikePrice === strike);
  if (!row) return blockedLeg(expiry, strike, `Strike ${strike} not found in the ${expiry} chain — paper-only, cannot deploy live.`);

  const side = leg.optionType === "PE" ? row.pe : row.ce;
  const securityId = side?.securityId || null;
  if (!securityId) {
    // Never fall back to a previously-seen id here — a leg with no id today is
    // paper-only today. A stale id would look valid and point at an expired
    // contract, which is the exact failure mode this function exists to prevent.
    return blockedLeg(expiry, strike, `No broker security ID for ${expiry} ${strike} ${leg.optionType} — this leg is paper-only and blocks live deploy.`, side?.exchangeSegment || null);
  }
  return { ...base, expiry, strike, securityId, exchangeSegment: side.exchangeSegment || null, blocked: false, blockedReason: null };
}

/**
 * Resolve every leg of a basket against a live chain. Call this at deploy
 * time ONLY — never cache the result and reuse it on a later deploy.
 * @returns {{legs:ResolvedLeg[], blockedForLive:boolean, blockedLegIds:string[]}}
 */
export function resolveBasket(basket, chain, spot, stepSize) {
  const legs = Array.isArray(basket?.legs) ? basket.legs : [];
  const resolvedLegs = legs.map((leg) => resolveLeg(leg, chain, spot, stepSize));
  const blockedLegIds = resolvedLegs.filter((l) => l.blocked).map((l) => l.legId);
  return { legs: resolvedLegs, blockedForLive: blockedLegIds.length > 0, blockedLegIds };
}

// ── Leg ordering (entry vs exit are provably mirrors of one score) ──

/**
 * BUY legs reduce risk (they are long premium — never naked); SELL legs add
 * it until something offsets them. Entry places risk-reducing legs first;
 * exit reverses that. Negating the score, rather than writing a second
 * lookup table, is what keeps the two from ever drifting apart.
 */
export function legOrderScore(leg, direction) {
  const riskRank = leg?.action === "BUY" ? 0 : 1;
  if (direction === "entry") return riskRank;
  if (direction === "exit") return -riskRank;
  throw new Error(`Invalid direction: ${direction} (expected "entry" or "exit")`);
}

/**
 * Thin wrapper around legOrderScore(). The index tie-break (ascending on
 * entry, descending on exit) is what makes orderLegs(l,"exit") equal
 * orderLegs(l,"entry").reverse() EXACTLY, including when several legs share a
 * score (e.g. a basket with two hedges and two shorts) — negating the score
 * alone only gets the group order right, not the order within a group.
 */
export function orderLegs(legs, direction) {
  if (!Array.isArray(legs)) return [];
  return legs
    .map((leg, index) => ({ leg, index, score: legOrderScore(leg, direction) }))
    .sort((a, b) => (a.score !== b.score ? a.score - b.score : (direction === "exit" ? b.index - a.index : a.index - b.index)))
    .map((s) => s.leg);
}

// ── Tranche planner ──

/** Front-loaded so the first tranches trade before the basket's own orders
 * move the market against the later ones. Sums to 20 by construction. */
export const TRANCHE_WEIGHTS = [6, 6, 4, 4];
export const TRANCHE_BASE_INTERVAL_MS = 1500;
export const TRANCHE_JITTER_MS = 300;

/** Split totalLots across 4 tranches in the 6/6/4/4 ratio. Largest-remainder
 * apportionment keeps every tranche a whole number of lots and sums exactly
 * to totalLots; remainder ties go to the earliest tranche, consistent with
 * the front-load this scheme exists for. */
export function planTranches(totalLots) {
  if (!Number.isFinite(totalLots) || !Number.isInteger(totalLots) || totalLots <= 0) {
    throw new Error(`planTranches requires a positive integer lot count (got ${totalLots}).`);
  }
  const weightSum = TRANCHE_WEIGHTS.reduce((a, b) => a + b, 0);
  const raw = TRANCHE_WEIGHTS.map((w) => (totalLots * w) / weightSum);
  const floors = raw.map(Math.floor);
  const remainder = totalLots - floors.reduce((a, b) => a + b, 0);
  const byRemainingFrac = raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  const result = [...floors];
  for (let k = 0; k < remainder; k++) result[byRemainingFrac[k].i] += 1;
  return result;
}

/** Delay before the next tranche fires: 1500ms +/-300ms jitter. `rng()` must
 * return a value in [0,1) — inject a fixed source for reproducible tests
 * (Math.random by default, same convention the paper fill model uses). */
export function trancheIntervalMs(rng = Math.random) {
  return TRANCHE_BASE_INTERVAL_MS + (rng() * 2 - 1) * TRANCHE_JITTER_MS;
}

// ── Abort predicate (pure — the caller wires the actual polling/timers) ──

export const ABORT_THRESHOLDS = {
  underlyingDriftPct: 0.4,
  netCostDriftPct: 1.5,
  spreadWidenMultiple: 2,
  staleLtpMs: 5000,
};

/**
 * @param {Object} metrics
 * @param {number} [metrics.underlyingDriftPct] - abs % move in the underlying since the basket armed
 * @param {number} [metrics.netCostDriftPct] - abs % change in the basket's net debit/credit since arming
 * @param {number} [metrics.spreadWidenMultiple] - current spread / spread-at-arm-time
 * @param {boolean} [metrics.anyLegRejected]
 * @param {number} [metrics.ltpAgeMs] - age of the most recent LTP behind any leg in the basket
 */
export function isAbortConditionMet(metrics = {}) {
  const {
    underlyingDriftPct = 0, netCostDriftPct = 0, spreadWidenMultiple = 1,
    anyLegRejected = false, ltpAgeMs = 0,
  } = metrics;
  const reasons = [];
  if (Math.abs(underlyingDriftPct) > ABORT_THRESHOLDS.underlyingDriftPct) {
    reasons.push(`Underlying drifted ${underlyingDriftPct.toFixed(2)}% (limit ${ABORT_THRESHOLDS.underlyingDriftPct}%).`);
  }
  if (Math.abs(netCostDriftPct) > ABORT_THRESHOLDS.netCostDriftPct) {
    reasons.push(`Net cost drifted ${netCostDriftPct.toFixed(2)}% (limit ${ABORT_THRESHOLDS.netCostDriftPct}%).`);
  }
  if (spreadWidenMultiple > ABORT_THRESHOLDS.spreadWidenMultiple) {
    reasons.push(`Spread widened ${spreadWidenMultiple.toFixed(2)}x (limit ${ABORT_THRESHOLDS.spreadWidenMultiple}x).`);
  }
  if (anyLegRejected) reasons.push("A leg was rejected by the broker.");
  if (ltpAgeMs > ABORT_THRESHOLDS.staleLtpMs) {
    reasons.push(`LTP is ${ltpAgeMs}ms stale (limit ${ABORT_THRESHOLDS.staleLtpMs}ms).`);
  }
  return { abort: reasons.length > 0, reasons };
}

// ── Residual-risk classification after a partial-basket failure ──

/**
 * A short option with no offsetting long of the SAME optionType is unbounded
 * (undefined) risk — a long put doesn't cap a naked call's upside, so the
 * grouping is per CE/PE, not a basket-wide lots total. Undefined risk gets a
 * cancellable countdown that defaults to firing; the caller wires the timer.
 * @param {{action:"BUY"|"SELL", optionType:"CE"|"PE", lots:number}[]} remainingLegs
 */
export function classifyResidualRisk(remainingLegs) {
  const legs = Array.isArray(remainingLegs) ? remainingLegs : [];
  const byType = new Map();
  for (const leg of legs) {
    const type = leg?.optionType || "UNKNOWN";
    const bucket = byType.get(type) || { short: 0, long: 0 };
    const lots = Number(leg?.lots) || 0;
    if (leg?.action === "SELL") bucket.short += lots;
    else if (leg?.action === "BUY") bucket.long += lots;
    byType.set(type, bucket);
  }
  const nakedTypes = [...byType.entries()].filter(([, b]) => b.short > b.long).map(([type]) => type);
  if (nakedTypes.length === 0) return { risk: "defined" };
  return { risk: "undefined", autoUnwindMs: 10000, defaultAction: "unwind", nakedTypes };
}
