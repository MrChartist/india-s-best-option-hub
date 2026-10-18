/**
 * Server-side order guard — the last gate before real money moves.
 *
 * The app already has a "Live Trading" toggle, but it is enforced in UI
 * components (OptionChain.tsx and friends). That is a convention: any future
 * code path that calls placeOrder() bypasses it, and a client bug becomes a real
 * trade. This module re-runs the whole validation ladder on the server, where
 * the browser cannot skip it.
 *
 * Design rules:
 *  - Ordered ladder, first hard failure wins, and the message says what to do.
 *  - Lot size is resolved here from the exchange master, never trusted from the
 *    client (see instrumentLookup.mjs for why that matters).
 *  - Limits are ceilings the user may lower but not raise.
 */

import { resolveLotSize, lookupInstrument } from "./instrumentLookup.mjs";
import { marketSession, minutesToClose } from "./marketHours.mjs";

/**
 * Fat-finger ceilings. Sized for Indian index options: 10 lots of BANKNIFTY at a
 * ~200 premium is roughly 60k of premium, so a 2 lakh cap allows normal size and
 * blocks a decimal slip. 15 orders/minute is one per four seconds — above any
 * human scalping rate, so it only catches a stuck key or a render loop.
 */
export const DEFAULT_LIMITS = {
  maxLotsPerOrder: 10,
  maxNotionalPerOrder: 200000,
  maxOrdersPerMinute: 15,
  maxOpenOrdersPerDay: 200,
  priceBandPct: 3,      // limit price may not sit >3% from LTP...
  priceBandFloor: 2,    // ...but always allow at least +-Rs2 (3% of a Rs1.50 weekly is noise)
  expiryDayCutoffMinutesToClose: 10,
};

/** Merge user limits, taking the STRICTER of each — limits ratchet down only. */
export function effectiveLimits(userLimits) {
  const out = { ...DEFAULT_LIMITS };
  if (!userLimits) return out;
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    const v = Number(userLimits[key]);
    if (Number.isFinite(v) && v > 0) out[key] = Math.min(DEFAULT_LIMITS[key], v);
  }
  return out;
}

// ── Rate limiting + duplicate detection (per client id) ──

const orderTimestamps = new Map(); // clientId -> number[]
const recentIntents = new Map();   // clientId -> Map<fingerprint, ts>

const DUPLICATE_WINDOW_MS = 2000;

function fingerprintOf(order) {
  return [order.exchangeSegment, order.securityId, order.transactionType, order.lots, order.orderType].join("|");
}

function prune(list, now, windowMs) {
  while (list.length && now - list[0] > windowMs) list.shift();
}

/** Record an accepted order so the rate limiter and dedupe can see it. */
export function recordOrder(clientId, order, now = Date.now()) {
  const stamps = orderTimestamps.get(clientId) || [];
  stamps.push(now);
  prune(stamps, now, 60000);
  orderTimestamps.set(clientId, stamps);

  const seen = recentIntents.get(clientId) || new Map();
  seen.set(fingerprintOf(order), now);
  for (const [fp, ts] of seen) if (now - ts > DUPLICATE_WINDOW_MS) seen.delete(fp);
  recentIntents.set(clientId, seen);
}

/** Test seam — clears rate-limit and duplicate state. */
export function resetGuardState() {
  orderTimestamps.clear();
  recentIntents.clear();
}

function block(code, message) {
  return { ok: false, code, message, warnings: [] };
}

/**
 * Run the full ladder. Resolves the authoritative lot size as part of the check
 * and returns it, so the caller never has to re-derive (or trust) a quantity.
 *
 * @returns {Promise<{ok:boolean, code?:string, message?:string, warnings:string[], lotSize?:number, instrument?:object}>}
 */
export async function validateOrder(order, context = {}) {
  const {
    clientId = "unknown",
    liveArmed = false,
    ltp = null,
    limits: userLimits = null,
    now = Date.now(),
  } = context;

  const limits = effectiveLimits(userLimits);
  const warnings = [];

  // 1. Live trading armed for this session. Strict === true, not truthiness:
  //    this is the gate between a keypress and real money, so a stray "yes" or
  //    a 1 from some future caller must not open it.
  if (liveArmed !== true) {
    return block("NOT_ARMED", "Live trading is not armed for this session. No real order was sent.");
  }

  // 2. Market session. Pre-open explicitly rejects — orders there behave
  //    differently and one-click has no business in that window.
  const session = marketSession(new Date(now));
  if (session.state === "PRE_OPEN") {
    return block("PRE_OPEN", "Pre-open session (09:00–09:15 IST) — one-click orders are not accepted.");
  }
  if (session.state === "CLOSED") {
    return block("MARKET_CLOSED", `${session.label}. No order was sent.`);
  }

  // 3. Shape of the request.
  if (!order || typeof order !== "object") return block("BAD_REQUEST", "Malformed order.");
  if (!order.securityId) return block("NO_SECURITY_ID", "This instrument has no broker security ID — it can only be paper traded.");
  if (order.transactionType !== "BUY" && order.transactionType !== "SELL") {
    return block("BAD_SIDE", `Invalid transaction type: ${order.transactionType}`);
  }
  const lots = Number(order.lots);
  if (!Number.isFinite(lots) || lots <= 0 || !Number.isInteger(lots)) {
    return block("BAD_LOTS", `Lots must be a whole number greater than zero (got ${order.lots}).`);
  }

  // 4. Authoritative lot size from the exchange master. Throws if unknown, and
  //    that is correct — a guessed lot size is a wrong-sized real trade.
  const segment = order.exchangeSegment || "NSE_FNO";
  let lotSize;
  let instrument;
  try {
    instrument = await lookupInstrument(segment, order.securityId);
    lotSize = await resolveLotSize(segment, order.securityId);
  } catch (e) {
    return block("LOT_SIZE_UNRESOLVED", e.message);
  }

  // 5. Fat-finger ceilings.
  if (lots > limits.maxLotsPerOrder) {
    return block("MAX_LOTS", `${lots} lots exceeds your ${limits.maxLotsPerOrder}-lot per-order cap.`);
  }

  const quantity = lots * lotSize;
  const refPrice = Number.isFinite(ltp) && ltp > 0 ? ltp : Number(order.price);
  if (Number.isFinite(refPrice) && refPrice > 0) {
    const notional = quantity * refPrice;
    if (notional > limits.maxNotionalPerOrder) {
      return block(
        "MAX_NOTIONAL",
        `₹${Math.round(notional).toLocaleString("en-IN")} exceeds your ₹${limits.maxNotionalPerOrder.toLocaleString("en-IN")} per-order cap ` +
        `(${lots} lot${lots > 1 ? "s" : ""} × ${lotSize} × ₹${refPrice}).`,
      );
    }
  } else if (order.orderType !== "MARKET") {
    warnings.push("No reference price available — notional cap could not be checked.");
  }

  // 6. Price sanity band for priced orders. A limit far from LTP is nearly
  //    always a typo, and on an illiquid strike it fills instantly at a bad price.
  if (order.orderType === "LIMIT" && Number.isFinite(ltp) && ltp > 0) {
    const price = Number(order.price);
    const band = Math.max((ltp * limits.priceBandPct) / 100, limits.priceBandFloor);
    if (!Number.isFinite(price) || Math.abs(price - ltp) > band) {
      return block(
        "PRICE_BAND",
        `Limit price ₹${price} is more than ₹${band.toFixed(2)} away from LTP ₹${ltp}. ` +
        `Re-enter the price if this is deliberate.`,
      );
    }
  }

  // 7. Rate limit.
  const stamps = orderTimestamps.get(clientId) || [];
  prune(stamps, now, 60000);
  if (stamps.length >= limits.maxOrdersPerMinute) {
    return block(
      "RATE_LIMIT",
      `${limits.maxOrdersPerMinute} orders in the last minute — rate limit hit. Nothing was sent.`,
    );
  }

  // 8. Duplicate intent (double-tap, key repeat, retry storm).
  const seen = recentIntents.get(clientId);
  const lastSeen = seen?.get(fingerprintOf(order));
  if (lastSeen && now - lastSeen < DUPLICATE_WINDOW_MS) {
    return block(
      "DUPLICATE",
      `Identical order ${((now - lastSeen) / 1000).toFixed(1)}s ago — blocked as a double-tap.`,
    );
  }

  // 9. Expiry-day cutoff — a warning, not a block. Spreads go wild in the last
  //    minutes but a trader may legitimately want out.
  const mins = minutesToClose(new Date(now));
  if (instrument?.expiry && mins <= limits.expiryDayCutoffMinutesToClose && mins > 0) {
    warnings.push(`${mins} minutes to close — spreads and decay are extreme.`);
  }

  return { ok: true, warnings, lotSize, quantity, instrument };
}
