/**
 * Shape checks for the normalised results defined in contract.mjs. Each `check*` takes an adapter's
 * return value (plus optional fixture expectations) and returns a list of human-readable problems;
 * an empty list means the shape is right. Pure functions, no I/O — used by contractHarness.mjs and
 * directly by adapter tests.
 */

import { CANONICAL_UNDERLYINGS, FORBIDDEN_SECRET_KEY } from "./contract.mjs";

const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
const INSTRUMENT_TYPES = new Set(["INDEX", "EQ", "FUTIDX", "FUTSTK", "OPTIDX", "OPTSTK"]);
const PRODUCTS = new Set(["CNC", "INTRADAY", "MARGIN", "MTF", "CO", "BO"]);
export const ORDER_STATUSES = Object.freeze(["OPEN", "TRIGGER_PENDING", "PARTIALLY_FILLED", "COMPLETE", "CANCELLED", "REJECTED", "EXPIRED", "UNKNOWN"]);
const STATUS_SET = new Set(ORDER_STATUSES);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v) => v === null || isNum(v);
const isStr = (v) => typeof v === "string" && v.length > 0;

function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function envelope(result, problems) {
  if (!result || typeof result !== "object") {
    problems.push("result is not an object");
    return undefined;
  }
  if (result.status !== "success") problems.push(`status should be "success" (got ${JSON.stringify(result.status)})`);
  return result.data;
}

/** Run `fn(row, i)` over at most the first 200 rows and collect problems with a row prefix. */
function eachRow(rows, label, fn, problems) {
  if (!Array.isArray(rows)) return problems.push(`${label}: data should be an array`);
  rows.slice(0, 200).forEach((row, i) => {
    for (const p of fn(row || {})) problems.push(`${label}[${i}]: ${p}`);
  });
}

function fields(row, spec) {
  const out = [];
  for (const [k, test] of Object.entries(spec)) if (!test(row[k])) out.push(`bad ${k}=${JSON.stringify(row[k])}`);
  return out;
}

function minRows(rows, expect, problems, label) {
  const min = expect?.minRows ?? 0;
  if (Array.isArray(rows) && rows.length < min) problems.push(`${label}: expected at least ${min} rows, got ${rows.length}`);
}

// ── option chain → the app's OptionData (mirror of src/lib/marketApi.ts parseDhanLeg; keep in step) ──

function toLeg(leg) {
  if (!leg) return { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
  const g = leg.greeks ?? {};
  const oi = num(leg.oi);
  return {
    ltp: num(leg.last_price ?? leg.ltp),
    oi,
    oiChange: leg.oi_chg !== undefined ? num(leg.oi_chg) : leg.previous_oi !== undefined ? oi - num(leg.previous_oi) : 0,
    volume: num(leg.volume),
    iv: num(leg.implied_volatility ?? leg.iv),
    delta: num(g.delta ?? leg.delta),
    gamma: num(g.gamma ?? leg.gamma),
    theta: num(g.theta ?? leg.theta),
    vega: num(g.vega ?? leg.vega),
    bidPrice: num(leg.top_bid_price ?? leg.best_bid_price ?? leg.bid_price),
    askPrice: num(leg.top_ask_price ?? leg.best_ask_price ?? leg.ask_price),
  };
}

/** Convert an OptionChainResult into the app's OptionData[] (sorted by strike) plus spot. */
export function toOptionData(result) {
  const oc = result?.data?.oc ?? {};
  const chain = [];
  for (const key of Object.keys(oc)) {
    const strikePrice = parseFloat(key);
    if (!Number.isFinite(strikePrice) || strikePrice <= 0) continue;
    chain.push({ strikePrice, ce: toLeg(oc[key]?.ce), pe: toLeg(oc[key]?.pe) });
  }
  chain.sort((a, b) => a.strikePrice - b.strikePrice);
  return { spotPrice: num(result?.data?.last_price), chain };
}

// ── checks ──

export function checkConnection(result, expect = {}) {
  const p = [];
  if (!result || (result.status !== "success" && result.status !== "error")) p.push('status must be "success" or "error"');
  if (typeof result?.message !== "string") p.push("message must be a string");
  if (expect.status && result?.status !== expect.status) p.push(`expected status ${expect.status}, got ${result?.status}`);
  return p;
}

export function checkExpiries(result, expect = {}) {
  const p = [];
  const data = envelope(result, p);
  if (!Array.isArray(data)) return [...p, "data should be an array of ISO dates"];
  data.forEach((d, i) => { if (!ISO_DATE.test(String(d))) p.push(`data[${i}] is not YYYY-MM-DD: ${d}`); });
  if ([...data].sort().join() !== data.join()) p.push("expiries must be ascending");
  minRows(data, expect, p, "expiries");
  return p;
}

export function checkOptionChain(result, expect = {}) {
  const p = [];
  const data = envelope(result, p);
  if (!data || typeof data.oc !== "object" || data.oc === null) return [...p, "data.oc must be an object keyed by strike"];
  if (!isNum(Number(data.last_price))) p.push("data.last_price must be a number (underlying spot)");
  const { chain } = toOptionData(result);
  if (chain.length < (expect.minStrikes ?? 1)) p.push(`expected at least ${expect.minStrikes ?? 1} strikes, got ${chain.length}`);
  for (const row of chain) {
    for (const side of ["ce", "pe"]) {
      for (const [k, v] of Object.entries(row[side])) if (!isNum(v)) p.push(`${row.strikePrice} ${side}.${k} not numeric`);
    }
    if (row.ce.iv > 0 && row.ce.iv < 1 && row.pe.iv < 1) p.push(`${row.strikePrice}: iv looks like a fraction; send percent (14.2, not 0.142)`);
  }
  if (expect.someLtp !== false && chain.length && !chain.some((r) => r.ce.ltp > 0 || r.pe.ltp > 0)) p.push("no strike has a positive ltp");
  return p;
}

export function checkLtp(result) {
  const p = [];
  const data = envelope(result, p);
  if (!data || !isNum(data.last_price) || data.last_price <= 0) p.push("data.last_price must be a positive number");
  return p;
}

const INSTRUMENT_SPEC = {
  token: isStr, tradingSymbol: isStr, underlying: isStr, lotSize: (v) => isNum(v) && v > 0, tickSize: (v) => isNum(v) && v > 0,
  exchange: (v) => EXCHANGES.has(v), instrumentType: (v) => INSTRUMENT_TYPES.has(v),
};

export function checkInstruments(result, expect = {}) {
  const p = [];
  const rows = envelope(result, p);
  eachRow(rows, "instruments", (r) => {
    const out = fields(r, INSTRUMENT_SPEC);
    const isOpt = r.instrumentType === "OPTIDX" || r.instrumentType === "OPTSTK";
    const isDeriv = isOpt || r.instrumentType === "FUTIDX" || r.instrumentType === "FUTSTK";
    if (isDeriv && !ISO_DATE.test(String(r.expiry))) out.push("derivative needs an ISO expiry");
    if (!isDeriv && r.expiry !== null) out.push("non-derivative expiry must be null");
    if (isOpt && !(isNum(r.strike) && r.strike > 0)) out.push("option needs a positive strike");
    if (isOpt && r.optionType !== "CE" && r.optionType !== "PE") out.push("option needs optionType CE/PE");
    if (!isOpt && (r.strike !== null || r.optionType !== null)) out.push("non-option strike/optionType must be null");
    if ((r.instrumentType === "OPTIDX" || r.instrumentType === "FUTIDX") && !CANONICAL_UNDERLYINGS.includes(r.underlying)) {
      out.push(`index derivative underlying must be one of ${CANONICAL_UNDERLYINGS.join("/")}`);
    }
    return out;
  }, p);
  minRows(rows, expect, p, "instruments");
  for (const u of expect.underlyings ?? []) {
    if (Array.isArray(rows) && !rows.some((r) => r.underlying === u && r.instrumentType?.startsWith("OPT"))) p.push(`no options mapped for ${u}`);
  }
  return p;
}

const QUOTE_SPEC = { token: isStr, exchange: (v) => EXCHANGES.has(v), ltp: isNum, open: isNumOrNull, high: isNumOrNull, low: isNumOrNull,
  close: isNumOrNull, volume: isNumOrNull, oi: isNumOrNull, bid: isNumOrNull, ask: isNumOrNull };

export function checkQuotes(result, expect = {}) {
  const p = [];
  const rows = envelope(result, p);
  eachRow(rows, "quotes", (r) => fields(r, QUOTE_SPEC), p);
  minRows(rows, expect, p, "quotes");
  return p;
}

export function checkDepth(result) {
  const p = [];
  const d = envelope(result, p);
  for (const side of ["bids", "asks"]) {
    eachRow(d?.[side], side, (l) => fields(l, { price: isNum, qty: isNum, orders: isNumOrNull }), p);
  }
  return p;
}

export function checkCandles(result, expect = {}) {
  const p = [];
  const rows = envelope(result, p);
  eachRow(rows, "candles", (c) => {
    const out = fields(c, { time: (v) => Number.isInteger(v) && v > 1e9 && v < 1e11, open: isNum, high: isNum, low: isNum, close: isNum, volume: isNum });
    if (isNum(c.high) && isNum(c.low) && c.high < c.low) out.push("high < low");
    return out;
  }, p);
  if (Array.isArray(rows) && rows.some((c, i) => i > 0 && c.time <= rows[i - 1].time)) p.push("candles must be strictly ascending by time");
  minRows(rows, expect, p, "candles");
  return p;
}

const SIDE = (v) => v === "BUY" || v === "SELL";
const EXCH = (v) => EXCHANGES.has(v);
const PROD = (v) => PRODUCTS.has(v);
const STR_OR_NULL = (v) => v === null || typeof v === "string";

export function checkPositions(result, expect = {}) {
  const p = [];
  const rows = envelope(result, p);
  eachRow(rows, "positions", (r) => fields(r, { tradingSymbol: isStr, exchange: EXCH, token: isStr, product: PROD, netQty: isNum,
    avgPrice: isNum, ltp: isNumOrNull, pnl: isNum, realisedPnl: isNumOrNull, unrealisedPnl: isNumOrNull }), p);
  minRows(rows, expect, p, "positions");
  return p;
}

export function checkHoldings(result, expect = {}) {
  const p = [];
  const rows = envelope(result, p);
  eachRow(rows, "holdings", (r) => fields(r, { tradingSymbol: isStr, exchange: EXCH, token: isStr, isin: STR_OR_NULL, qty: isNum,
    avgPrice: isNum, ltp: isNumOrNull, pnl: isNumOrNull }), p);
  minRows(rows, expect, p, "holdings");
  return p;
}

export function checkFunds(result) {
  const p = [];
  const f = envelope(result, p);
  if (!f || typeof f !== "object" || Array.isArray(f)) return [...p, "data must be a Funds object"];
  p.push(...fields(f, { availableCash: isNum, usedMargin: isNum, totalBalance: isNumOrNull, collateral: isNumOrNull, withdrawable: isNumOrNull }));
  return p;
}

export function checkOrderBook(result, expect = {}) {
  const p = [];
  const rows = envelope(result, p);
  eachRow(rows, "orders", (r) => fields(r, { orderId: isStr, tradingSymbol: (v) => typeof v === "string", exchange: EXCH, token: isStr, side: SIDE,
    qty: isNum, filledQty: isNum, pendingQty: isNum, price: isNum, triggerPrice: isNum, avgPrice: isNum, orderType: isStr, product: PROD,
    status: (v) => STATUS_SET.has(v), statusMessage: STR_OR_NULL, placedAt: STR_OR_NULL }), p);
  minRows(rows, expect, p, "orders");
  return p;
}

export function checkTradeBook(result, expect = {}) {
  const p = [];
  const rows = envelope(result, p);
  eachRow(rows, "trades", (r) => fields(r, { tradeId: isStr, orderId: isStr, tradingSymbol: (v) => typeof v === "string", exchange: EXCH,
    token: isStr, side: SIDE, qty: isNum, price: isNum, tradedAt: STR_OR_NULL }), p);
  minRows(rows, expect, p, "trades");
  return p;
}

export function checkOrderAck(result) {
  return fields(result || {}, { orderId: isStr, orderStatus: (v) => STATUS_SET.has(v) });
}

export function checkNormalisedError(result) {
  const p = fields(result || {}, { code: isStr, message: (v) => typeof v === "string" });
  if (result?.statusCode !== 422 && result?.statusCode !== 502) p.push("statusCode must be 422 or 502");
  return p;
}

/** login() result: only declared session fields, string values, nothing that looks like a secret. */
export function checkLoginResult(result, { sessionFields = [], secrets = [] } = {}) {
  const p = [];
  if (!result || typeof result.session !== "object" || result.session === null) return ["login() must return { session, expiresAt }"];
  if (!isNum(result.expiresAt) || result.expiresAt <= Date.now() - 60_000) p.push("expiresAt must be a future epoch-ms number");
  const keys = Object.keys(result.session);
  if (!keys.length) p.push("session is empty");
  for (const k of keys) {
    if (!sessionFields.includes(k)) p.push(`session key ${k} is not in auth.sessionFields`);
    if (FORBIDDEN_SECRET_KEY.test(k)) p.push(`session key ${k} looks like a secret`);
    if (typeof result.session[k] !== "string") p.push(`session.${k} must be a string`);
  }
  // Look only at the session's string values, never at the whole result: expiresAt is an epoch-ms number
  // whose digits can contain a 4-digit PIN by chance, and a false alarm here throws away a session the
  // broker has already opened. A short secret (PIN/MPIN) must not BE a value; a longer one (password,
  // TOTP seed) must not appear inside one either.
  const values = Object.values(result.session).filter((v) => typeof v === "string");
  const leaks = (secret) => values.some((v) => v === secret || (secret.length >= 6 && v.includes(secret)));
  if (secrets.some((s) => typeof s === "string" && s.length >= 4 && leaks(s))) p.push("login() result contains a secret value");
  return p;
}
