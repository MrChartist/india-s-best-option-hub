/**
 * Shared engine for the three Noren-OMS brokers owned together in this repo: Shoonya (Finvasia),
 * Flattrade (Pi) and TradeSmart (Noren v2). All three run white-label deployments of Kambala's Noren
 * OMS, so their request envelope (`jData=<json>`), `{ stat, emsg }` error shape, field names (tsym, lp,
 * netqty, norenordno, ...), order codes, instrument-master layout and WebSocket protocol are the same.
 * What differs (base URL, how the session token travels, token exchange, master file URLs, order rules)
 * is supplied by each broker module through the `cfg` object passed to createNorenAdapter().
 *
 * Zebu also runs Noren but is owned separately and does not use this file (nor does it use
 * oms-noren.mjs today). Written from the brokers' official API documentation.
 *
 * Facts common to the family (official sources are listed in each broker module's header):
 *  - Every REST call is a POST whose body is `jData=<json>` (plus `&jKey=<token>` on Flattrade).
 *    The body is not URL-decoded by the gateway, so a literal "&" inside the JSON (M&M-EQ) would cut the
 *    payload. encodeJData() writes it as the JSON escape &, which the JSON parser reads back as "&".
 *  - Numbers travel as strings (qty, prc, trgprc).
 *  - A failed call returns HTTP 200 with { stat: "Not_Ok", emsg }. "no data" (empty books) is also
 *    Not_Ok and is read as an empty list. A session failure reads "Session Expired : Invalid Session Key".
 *  - Lists (OrderBook, TradeBook, PositionBook, Holdings, TPSeries) are bare JSON arrays.
 *  - Instrument masters are comma-separated with a header row (Exchange, Token, LotSize/Lotsize, Symbol,
 *    TradingSymbol, Instrument, Expiry "DD-MMM-YYYY", StrikePrice/Strike, OptionType, TickSize).
 *  - Index spot tokens: NSE 26000 (Nifty 50), 26009 (Nifty Bank), 26037 (Nifty Fin Service),
 *    26074 (Nifty Midcap Select); BSE 1 (SENSEX), 12 (BANKEX).
 *  - WebSocket: connect { t:"a", uid, actid, source:"API", accesstoken } -> { t:"ak", s:"Ok" };
 *    touchline { t:"t", k:"NFO|123#NSE|26000" } -> "tk" snapshot then "tf" diffs; unsubscribe t:"u";
 *    heartbeat { t:"h" } (Flattrade docs: every 30 s).
 */

import { createHash } from "node:crypto";
import WebSocket from "ws";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import {
  BrokerError, BrokerInputError, CANONICAL_UNDERLYINGS, SessionRequiredError, normaliseError as baseNormalise,
  redactSecrets, withOrderGate,
} from "./contract.mjs";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const CONTRACT_EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

/** Spot quote refs for the six canonical indices (same exchange tokens on every Noren gateway). */
export const INDEX_SPOT = Object.freeze({
  NIFTY: { exchange: "NSE", token: "26000", tradingSymbol: "Nifty 50" },
  BANKNIFTY: { exchange: "NSE", token: "26009", tradingSymbol: "Nifty Bank" },
  FINNIFTY: { exchange: "NSE", token: "26037", tradingSymbol: "Nifty Fin Service" },
  MIDCPNIFTY: { exchange: "NSE", token: "26074", tradingSymbol: "NIFTY MID SELECT" },
  SENSEX: { exchange: "BSE", token: "1", tradingSymbol: "SENSEX" },
  BANKEX: { exchange: "BSE", token: "12", tradingSymbol: "BANKEX" },
});
const BSE_INDEX_ROOTS = new Set(["SENSEX", "BANKEX"]);

// Noren product codes (official PlaceOrder docs): C = CNC, M = NRML, I = MIS, H = CO, B = BO, F = MTF (Flattrade).
const PRODUCT_OF_CODE = { C: "CNC", I: "INTRADAY", M: "MARGIN", F: "MTF", H: "CO", B: "BO" };
const CODE_OF_PRODUCT = { CNC: "C", INTRADAY: "I", MARGIN: "M", MTF: "F", CO: "H", BO: "B" };
const PRICE_TYPE_OF_ORDER = { LIMIT: "LMT", MARKET: "MKT", STOP_LOSS: "SL-LMT", STOP_LOSS_MARKET: "SL-MKT" };
const ORDER_OF_PRICE_TYPE = { LMT: "LIMIT", MKT: "MARKET", "SL-LMT": "STOP_LOSS", "SL-MKT": "STOP_LOSS_MARKET" };
const ORDER_TYPE_ALIASES = { STOPLOSS_LIMIT: "STOP_LOSS", SL: "STOP_LOSS", STOPLOSS_MARKET: "STOP_LOSS_MARKET", SL_M: "STOP_LOSS_MARKET" };
// App-wide exchangeSegment values -> Noren exch codes.
const EXCH_OF_SEGMENT = { NSE_EQ: "NSE", NSE_FNO: "NFO", BSE_EQ: "BSE", BSE_FNO: "BFO", MCX_COMM: "MCX", NSE_CURRENCY: "CDS" };

// ── small pure helpers ──

export const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === undefined || v === null ? "" : String(v));

/** jData value for a Noren request body. "&" is written as the JSON escape & (see header). */
export function encodeJData(data) {
  return JSON.stringify(data).replace(/&/g, "\\u0026");
}

export function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** "28-OCT-2026" (or "28-Oct-2026") -> "2026-10-28"; anything else -> null. */
export function parseNorenDate(raw) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(str(raw).trim());
  if (!m) return null;
  const mm = MONTHS[m[2].toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** IST wall-clock parts -> epoch seconds. */
function istEpochSeconds(y, mo, d, h = 0, mi = 0, s = 0) {
  return Math.floor((Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_MS) / 1000);
}

/** "02-06-2020 15:46:23" (DD-MM-YYYY, IST) -> epoch seconds, or null. */
export function parseNorenDateTime(raw) {
  const m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(str(raw).trim());
  if (!m) return null;
  return istEpochSeconds(+m[3], +m[2], +m[1], +m[4], +m[5], +m[6]);
}

/** Noren timestamps ("HH:MM:SS DD-MM-YYYY" or "DD-MM-YYYY HH:MM:SS", IST) -> ISO string with +05:30, or null. */
export function norenTimeToIso(raw) {
  const s = str(raw).trim();
  let m = /^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[6]}-${m[5]}-${m[4]}T${m[1]}:${m[2]}:${m[3]}+05:30`;
  m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  return null;
}

/** Epoch ms of the next 05:00 IST after `now` (Noren gateways clear access tokens between 5 and 6 AM). */
export function nextIstFiveAmMs(now = Date.now()) {
  const shifted = new Date(now + IST_OFFSET_MS);
  const cutoff = new Date(shifted);
  cutoff.setUTCHours(5, 0, 0, 0);
  if (cutoff.getTime() <= shifted.getTime()) cutoff.setUTCDate(cutoff.getUTCDate() + 1);
  return cutoff.getTime() - IST_OFFSET_MS;
}

/** Header-keyed CSV reader for the Noren symbol masters (no quoted fields; header names lower-cased). */
export function parseMasterCsv(text) {
  const lines = str(text).split(/\r?\n/);
  const headerLine = lines.findIndex((l) => l.trim());
  if (headerLine < 0) return [];
  const headers = lines[headerLine].split(",").map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = headerLine + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = lines[i].split(",");
    const row = {};
    headers.forEach((h, c) => { if (h) row[h] = (cols[c] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

/**
 * Underlying root of a BFO contract. Prefers the Symbol column when it already is a canonical root
 * (Flattrade), otherwise the longest known root that prefixes the trading symbol and is followed by a
 * digit. This keeps SENSEX50 options ("SENSEX5026SEP26900PE") out of the SENSEX chain, which a plain
 * "leading letters" rule would get wrong.
 */
export function bfoRoot(symbol, tradingSymbol) {
  const sym = str(symbol).toUpperCase();
  if (BSE_INDEX_ROOTS.has(sym)) return sym;
  const tsym = str(tradingSymbol).toUpperCase();
  for (const root of ["SENSEX50", "SENSEX", "BANKEX"]) {
    if (tsym.startsWith(root) && /\d/.test(tsym.charAt(root.length))) return root;
  }
  const m = /^[A-Z]+/.exec(tsym);
  return m ? m[0] : sym;
}

/**
 * One raw master row (header names lower-cased) -> contract Instrument, or null when the row is outside
 * what this adapter serves (non-canonical index derivatives such as NIFTYNXT50/SENSEX50, BFO stock
 * derivatives, currency/commodity, non-EQ cash series).
 */
export function toInstrument(raw, segment) {
  const exchange = str(raw.exchange || segment).toUpperCase();
  const inst = str(raw.instrument).toUpperCase();
  const token = str(raw.token);
  const tradingSymbol = str(raw.tradingsymbol);
  if (!token || !tradingSymbol || !CONTRACT_EXCHANGES.has(exchange)) return null;
  const lotSize = num(raw.lotsize) || 1;
  const tickSize = num(raw.ticksize) || 0.05; // Flattrade's CSVs carry no tick-size column
  if (inst === "EQ") {
    if (exchange !== "NSE" && exchange !== "BSE") return null;
    return { token, exchange, tradingSymbol, underlying: str(raw.symbol).toUpperCase(), instrumentType: "EQ", expiry: null, strike: null, optionType: null, lotSize, tickSize };
  }
  if (!["OPTIDX", "FUTIDX", "OPTSTK", "FUTSTK"].includes(inst)) return null;
  const isIndex = inst.endsWith("IDX");
  if (exchange === "BFO" && !isIndex) return null;
  const underlying = exchange === "BFO" ? bfoRoot(raw.symbol, tradingSymbol) : str(raw.symbol).toUpperCase();
  if (isIndex && !CANONICAL_UNDERLYINGS.includes(underlying)) return null;
  const expiry = parseNorenDate(raw.expiry);
  if (!expiry) return null;
  const isOption = inst.startsWith("OPT");
  const optionType = isOption ? str(raw.optiontype).toUpperCase() : null;
  const strike = isOption ? num(raw.strikeprice ?? raw.strike) : null;
  if (isOption && ((optionType !== "CE" && optionType !== "PE") || !(strike > 0))) return null;
  return { token, exchange, tradingSymbol, underlying, instrumentType: inst, expiry, strike, optionType, lotSize, tickSize };
}

function indexInstruments() {
  return Object.entries(INDEX_SPOT).map(([underlying, ref]) => ({
    token: ref.token, exchange: ref.exchange, tradingSymbol: ref.tradingSymbol, underlying, instrumentType: "INDEX",
    expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05,
  }));
}

/** Distinct option expiries (ISO, ascending) for an underlying. */
export function listExpiries(instruments, symbol) {
  const sym = str(symbol).toUpperCase();
  const set = new Set();
  for (const r of instruments) if (r.underlying === sym && r.optionType) set.add(r.expiry);
  return [...set].sort();
}

/** The contracts in a strike window of `halfWidth` strikes either side of the strike nearest spot. */
export function selectStrikeWindow(rows, spot, halfWidth) {
  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
  if (!strikes.length) return [];
  let atm = 0;
  strikes.forEach((s, i) => { if (Math.abs(s - spot) < Math.abs(strikes[atm] - spot)) atm = i; });
  const keep = new Set(strikes.slice(Math.max(0, atm - halfWidth), atm + halfWidth + 1));
  return rows.filter((r) => keep.has(r.strike));
}

// ── order mapping (pure) ──

/** Broker order status text -> contract OrderStatus. Noren uses OPEN, TRIGGER_PENDING, COMPLETE, CANCELED, REJECTED, PENDING. */
export function mapOrderStatus(row) {
  const s = str(row?.status).toUpperCase().replace(/\s+/g, "_");
  const filled = num(row?.fillshares);
  const qty = num(row?.qty);
  if (s === "OPEN" || s === "PENDING" || s === "PENDING_VALIDATION" || s === "VALIDATION_PENDING" || s === "NEW" || s === "REPLACED") {
    return filled > 0 && filled < qty ? "PARTIALLY_FILLED" : "OPEN";
  }
  if (s === "TRIGGER_PENDING") return "TRIGGER_PENDING";
  if (s === "COMPLETE" || s === "COMPLETED" || s === "FILLED") return "COMPLETE";
  if (s === "CANCELED" || s === "CANCELLED") return "CANCELLED";
  if (s === "REJECTED" || s === "REJECT") return "REJECTED";
  if (s === "EXPIRED") return "EXPIRED";
  return "UNKNOWN";
}

const productOf = (row) => PRODUCT_OF_CODE[str(row?.prd ?? row?.prarr).toUpperCase()] ?? "MARGIN";
const exchangeOk = (row) => CONTRACT_EXCHANGES.has(str(row?.exch).toUpperCase());

export function mapPosition(r) {
  const realised = num(r.rpnl);
  const unrealised = num(r.urmtom);
  return {
    tradingSymbol: str(r.tsym), exchange: str(r.exch).toUpperCase(), token: str(r.token || r.tsym), product: productOf(r),
    netQty: num(r.netqty), avgPrice: num(r.netavgprc), ltp: numOrNull(r.lp), pnl: realised + unrealised,
    realisedPnl: realised, unrealisedPnl: unrealised,
  };
}

export function mapHolding(r) {
  const pairs = Array.isArray(r.exch_tsym) ? r.exch_tsym : [];
  const ref = pairs.find((p) => p?.exch === "NSE") ?? pairs[0] ?? {};
  // Valuation quantity per the official Holdings notes:
  // btstqty + holdqty + brkcolqty + unplgdqty + benqty + max(npoadqty, dpqty) - usedqty
  const qty = num(r.btstqty) + num(r.holdqty) + num(r.brkcolqty) + num(r.unplgdqty) + num(r.benqty)
    + Math.max(num(r.npoadqty), num(r.dpqty)) - num(r.usedqty);
  return {
    tradingSymbol: str(ref.tsym), exchange: str(ref.exch || "NSE").toUpperCase(), token: str(ref.token || ref.tsym),
    isin: ref.isin ? str(ref.isin) : null, qty, avgPrice: num(r.upldprc), ltp: null, pnl: null,
  };
}

export function mapFunds(r) {
  const cash = num(r.cash);
  const used = num(r.marginused);
  const collateral = num(r.collateral) || num(r.brkcollamt);
  return {
    // Shoonya's official Funds & Limits example computes available margin as cash - marginused.
    availableCash: cash - used,
    usedMargin: used,
    totalBalance: cash + num(r.payin),
    collateral: collateral || null,
    withdrawable: null,
  };
}

export function mapOrder(r) {
  const qty = num(r.qty);
  const filled = num(r.fillshares);
  const status = mapOrderStatus(r);
  const open = status === "OPEN" || status === "TRIGGER_PENDING" || status === "PARTIALLY_FILLED";
  return {
    orderId: str(r.norenordno), tradingSymbol: str(r.tsym), exchange: str(r.exch).toUpperCase(), token: str(r.token || r.tsym),
    side: str(r.trantype).toUpperCase() === "S" ? "SELL" : "BUY", qty, filledQty: filled, pendingQty: open ? Math.max(0, qty - filled) : 0,
    price: num(r.prc), triggerPrice: num(r.trgprc), avgPrice: num(r.avgprc), orderType: ORDER_OF_PRICE_TYPE[str(r.prctyp).toUpperCase()] ?? str(r.prctyp || "UNKNOWN"),
    product: productOf(r), status, statusMessage: r.rejreason ? str(r.rejreason) : null,
    placedAt: norenTimeToIso(r.norentm) ?? norenTimeToIso(r.exch_tm),
  };
}

export function mapTrade(r) {
  return {
    tradeId: str(r.flid || r.exchordid), orderId: str(r.norenordno), tradingSymbol: str(r.tsym), exchange: str(r.exch).toUpperCase(),
    token: str(r.token || r.tsym), side: str(r.trantype).toUpperCase() === "S" ? "SELL" : "BUY", qty: num(r.flqty || r.qty),
    price: num(r.flprc || r.avgprc), tradedAt: norenTimeToIso(r.fltm) ?? norenTimeToIso(r.norentm),
  };
}

export function mapQuote(ref, q) {
  return {
    token: str(ref.token), exchange: ref.exchange, ltp: num(q.lp), open: numOrNull(q.o), high: numOrNull(q.h), low: numOrNull(q.l),
    close: numOrNull(q.c), volume: numOrNull(q.v), oi: numOrNull(q.oi), bid: numOrNull(q.bp1), ask: numOrNull(q.sp1),
  };
}

export function mapDepth(q) {
  const side = (p, qn, o) => [1, 2, 3, 4, 5]
    .map((i) => ({ price: num(q[`${p}${i}`]), qty: num(q[`${qn}${i}`]), orders: numOrNull(q[`${o}${i}`] ?? (o === "so" ? q[`So${i}`] : undefined)) }))
    .filter((l) => l.price > 0 || l.qty > 0);
  return { bids: side("bp", "bq", "bo"), asks: side("sp", "sq", "so") };
}

/** The INDEX_SPOT entry for an { exchange, token } ref, or null. Index spot rows are synthesised, not in the master. */
export function indexSpotFor(ref) {
  return Object.values(INDEX_SPOT).find((r) => r.exchange === ref?.exchange && r.token === str(ref?.token)) ?? null;
}

/**
 * Intraday candles -> one candle per IST calendar day (open of the first bar, close of the last, high/low across
 * the day, volume summed). Used for index daily history, which EODChartData cannot serve without a master row.
 */
export function dailyFromIntraday(candles) {
  const days = new Map();
  for (const c of [...candles].sort((a, b) => a.time - b.time)) {
    const d = new Date((c.time * 1000) + IST_OFFSET_MS);
    const dayStart = istEpochSeconds(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    const day = days.get(dayStart);
    if (!day) days.set(dayStart, { ...c, time: dayStart });
    else {
      day.high = Math.max(day.high, c.high);
      day.low = Math.min(day.low, c.low);
      day.close = c.close;
      day.volume += c.volume;
      if (c.oi) day.oi = c.oi;
    }
  }
  return [...days.values()];
}

/** One TPSeries / EODChartData row -> Candle (epoch seconds), or null when unusable. */
export function mapCandle(raw) {
  let c = raw;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { return null; } }
  if (!c || typeof c !== "object") return null;
  const open = num(c.into);
  const high = num(c.inth);
  const low = num(c.intl);
  const close = num(c.intc);
  if (!open && !high && !low && !close) return null; // an interval with no trades
  let time = numOrNull(c.ssboe);
  if (time === null) time = parseNorenDateTime(c.time);
  if (time === null) {
    const d = parseNorenDate(c.time);
    if (d) { const [y, m, day] = d.split("-").map(Number); time = istEpochSeconds(y, m, day); }
  }
  if (time === null) return null;
  return { time, open, high: Math.max(high, open, close), low: Math.min(low || Math.min(open, close), open, close), close, volume: Math.max(0, num(c.intv ?? c.v)), oi: num(c.oi) };
}

// ── session layer (requestTokenExchange) ──

const SESSION_ERROR = /session expired|invalid session|session key|invalid (access )?token|token (is )?expired|not logged in|unauthori[sz]ed|not authenticated|invalid app ?key/i;
const RATE_LIMIT_ERROR = /rate[_ ]?limit|too many|exceed(ed|s)? .*limit/i;

/**
 * In-process session cache for brokers whose login hands back a single-use code. The user saves the
 * code in Broker Settings; the first data call swaps it for an access token, which is reused until
 * the broker rejects it or it expires. A code the broker has refused (or whose token died) is never
 * sent again: retrying cannot succeed and would just hammer the auth endpoint. A pasted `accessToken`
 * skips the exchange entirely. Cache keys are hashes of the credential values, never the values.
 */
export function createSessionManager({ label, keyFields, exchange }) {
  const sessions = new Map(); // key -> { token, expiresAt }
  const inflight = new Map(); // key -> Promise (one exchange per code even under concurrent calls)
  const deadCodes = new Set();
  const keyOf = (creds) => sha256Hex(JSON.stringify(keyFields.map((f) => str(creds?.[f]))));
  const regenerate = `Generate a fresh code from the ${label} login page and save it in Broker Settings.`;

  async function ensure(creds) {
    if (str(creds?.accessToken)) return { token: str(creds.accessToken), pasted: true };
    const missing = keyFields.filter((f) => !str(creds?.[f]).trim());
    if (missing.length) throw new BrokerInputError(`${label}: missing ${missing.join(", ")}.`);
    const key = keyOf(creds);
    const hit = sessions.get(key);
    if (hit && Date.now() < hit.expiresAt) return { token: hit.token, key };
    if (hit) sessions.delete(key);
    if (deadCodes.has(key)) throw new SessionRequiredError(`${label}: this login code has already been used or has expired. ${regenerate}`);
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        try {
          const s = await exchange(creds);
          sessions.set(key, s);
          return s;
        } catch (e) {
          if (e instanceof SessionRequiredError) deadCodes.add(key);
          throw e;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
    }
    const s = await p;
    return { token: s.token, key };
  }

  function invalidate(handle) {
    if (!handle?.key) return;
    sessions.delete(handle.key);
    deadCodes.add(handle.key);
  }

  return { ensure, invalidate, regenerate, reset: () => { sessions.clear(); inflight.clear(); deadCodes.clear(); } };
}

// ── adapter factory ──

/**
 * @param {object} cfg
 *  id, label                 broker id / display name
 *  uidField                  creds field holding the Noren user id (uid = actid)
 *  session                   createSessionManager(...) instance
 *  send(token, endpoint, data) -> Promise<Response>   the broker's REST transport
 *  wsUrl                     WebSocket URL
 *  loadSegment(segment)      -> Promise<raw master rows> for "NFO" | "BFO" | "NSE" (header names lower-cased)
 *  connectionEndpoint        cheap authenticated endpoint for testConnection
 *  quoteBatch                { size, delayMs } for per-contract GetQuotes fan-out
 *  strikeHalfWidth           strikes either side of ATM in the option chain
 *  orderRules                { products: string[], allowMarket: boolean, noIntradayOn?: string[] }
 */
export function createNorenAdapter(cfg) {
  const { id, label, uidField, session } = cfg;
  const uidOf = (creds) => str(creds?.[uidField]);

  async function call(creds, endpoint, payload = {}, { list = false } = {}) {
    const handle = await session.ensure(creds);
    const uid = uidOf(creds);
    if (!uid) throw new BrokerInputError(`${label}: missing ${uidField}.`);
    const data = { uid, ...payload };
    let res;
    try {
      res = await cfg.send(handle.token, endpoint, data);
    } catch (e) {
      throw new BrokerError(`${label} ${endpoint}: network error (${e?.message || e})`);
    }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = undefined; }
    if (res.status === 401 || res.status === 403) {
      session.invalidate(handle);
      throw new SessionRequiredError(`${label}: the broker rejected the session (HTTP ${res.status}). ${session.regenerate}`);
    }
    if (res.status === 429) throw new BrokerError(`${label} ${endpoint}: rate limited`, { code: "UPSTREAM_RATE_LIMIT" });
    if (json === undefined) throw new BrokerError(`${label} ${endpoint}: non-JSON response (HTTP ${res.status})`);
    if (Array.isArray(json)) return json;
    if (json === null) return list ? [] : {};
    const ok = str(json.stat ?? json.status).toLowerCase() === "ok";
    if (ok) return list ? (Array.isArray(json.values) ? json.values : []) : json;
    const emsg = str(json.emsg) || "request failed";
    if (SESSION_ERROR.test(emsg)) {
      session.invalidate(handle);
      throw new SessionRequiredError(`${label}: session expired or invalid (${emsg}). ${session.regenerate}`);
    }
    if (RATE_LIMIT_ERROR.test(emsg)) throw new BrokerError(`${label} ${endpoint}: ${emsg}`, { code: "UPSTREAM_RATE_LIMIT" });
    if (list && /no data/i.test(emsg)) return [];
    if (res.status >= 400) throw new BrokerError(`${label} ${endpoint}: HTTP ${res.status} ${emsg}`);
    throw new BrokerError(`${label} ${endpoint}: ${emsg}`);
  }

  // ── instruments ──

  async function segment(seg) {
    return getCachedOrFetch(`${id}:master:v2:${seg}`, async () => {
      const raw = await cfg.loadSegment(seg);
      return raw.map((r) => toInstrument(r, seg)).filter(Boolean);
    }, ONE_DAY_MS);
  }

  function segmentsFor(symbol) {
    const sym = str(symbol).toUpperCase();
    return BSE_INDEX_ROOTS.has(sym) ? ["BFO"] : ["NFO"];
  }

  async function optionRows(creds, symbol) {
    await session.ensure(creds); // refuse before any master download when not logged in
    const sym = str(symbol).toUpperCase();
    if (!sym) throw new BrokerInputError(`${label}: symbol is required.`);
    const out = [];
    for (const seg of segmentsFor(sym)) for (const r of await segment(seg)) if (r.underlying === sym && r.optionType) out.push(r);
    return out;
  }

  async function spotRef(symbol) {
    const sym = str(symbol).toUpperCase();
    if (INDEX_SPOT[sym]) return { exchange: INDEX_SPOT[sym].exchange, token: INDEX_SPOT[sym].token };
    const eq = (await segment("NSE")).find((r) => r.instrumentType === "EQ" && r.underlying === sym);
    if (!eq) throw new BrokerInputError(`${label}: no NSE equity found for ${sym}.`);
    return { exchange: "NSE", token: eq.token };
  }

  async function getQuote(creds, ref) {
    return call(creds, "/GetQuotes", { exch: ref.exchange, token: str(ref.token) });
  }

  /** GetQuotes for many refs, `quoteBatch.size` at a time with a pause between batches. */
  async function quoteMany(creds, refs) {
    const { size, delayMs } = cfg.quoteBatch;
    const out = new Map();
    for (let i = 0; i < refs.length; i += size) {
      if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
      const chunk = refs.slice(i, i + size);
      const settled = await Promise.allSettled(chunk.map((ref) => getQuote(creds, ref)));
      settled.forEach((s, j) => {
        if (s.status === "fulfilled") out.set(`${chunk[j].exchange}|${chunk[j].token}`, s.value);
        else if (s.reason instanceof SessionRequiredError || s.reason?.code === "UPSTREAM_RATE_LIMIT") throw s.reason;
      });
    }
    return out;
  }

  async function testConnection(creds = {}) {
    try {
      const json = await call(creds, cfg.connectionEndpoint, cfg.connectionEndpoint === "/Limits" ? { actid: uidOf(creds) } : {});
      return { status: "success", message: `${label} connected (account ${str(json.actid) || uidOf(creds)}).` };
    } catch (e) {
      return { status: "error", message: normaliseError(e).message };
    }
  }

  async function fetchInstruments(creds) {
    await session.ensure(creds);
    const rows = [...indexInstruments()];
    for (const seg of ["NSE", "NFO", "BFO"]) rows.push(...await segment(seg));
    return { status: "success", data: rows };
  }

  async function fetchExpiryList(creds, symbol) {
    return { status: "success", data: listExpiries(await optionRows(creds, symbol), symbol) };
  }

  async function fetchLTP(creds, symbol) {
    await session.ensure(creds);
    const q = await getQuote(creds, await spotRef(symbol));
    const last = num(q.lp);
    if (!(last > 0)) throw new BrokerError(`${label}: no last price for ${symbol}.`);
    return { status: "success", data: { last_price: last } };
  }

  async function fetchOptionChain(creds, symbol, expiry) {
    const all = await optionRows(creds, symbol);
    const target = expiry || listExpiries(all, symbol)[0];
    const rows = all.filter((r) => r.expiry === target);
    if (!rows.length) return { status: "success", data: { oc: {}, last_price: 0 } };
    const spotQuote = await getQuote(creds, await spotRef(symbol));
    const spot = num(spotQuote.lp);
    const windowed = selectStrikeWindow(rows, spot, cfg.strikeHalfWidth);
    const quotes = await quoteMany(creds, windowed.map((r) => ({ exchange: r.exchange, token: r.token })));
    const days = daysBetween(new Date(), target);
    const oc = {};
    for (const r of windowed) {
      const q = quotes.get(`${r.exchange}|${r.token}`);
      if (!q) continue;
      const ltp = num(q.lp);
      const leg = {
        last_price: ltp, oi: num(q.oi), volume: num(q.v), bid_price: num(q.bp1), ask_price: num(q.sp1), security_id: r.token,
        ...computeIVAndGreeks({ ltp, spot, strike: r.strike, daysToExpiry: days, type: r.optionType }),
      };
      if (q.poi !== undefined) leg.previous_oi = num(q.poi);
      const key = String(r.strike);
      oc[key] = oc[key] || {};
      oc[key][r.optionType === "CE" ? "ce" : "pe"] = leg;
    }
    return { status: "success", data: { oc, last_price: spot } };
  }

  async function fetchQuotes(creds, refs = []) {
    await session.ensure(creds);
    const list = (Array.isArray(refs) ? refs : []).filter((r) => r && r.token && CONTRACT_EXCHANGES.has(r.exchange));
    const quotes = await quoteMany(creds, list);
    return { status: "success", data: list.filter((r) => quotes.has(`${r.exchange}|${r.token}`)).map((r) => mapQuote(r, quotes.get(`${r.exchange}|${r.token}`))) };
  }

  async function fetchDepth(creds, ref) {
    if (!ref?.token || !CONTRACT_EXCHANGES.has(ref.exchange)) throw new BrokerInputError(`${label}: depth needs { token, exchange }.`);
    return { status: "success", data: mapDepth(await getQuote(creds, ref)) };
  }

  const TP_INTERVAL = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "60m": "60" };

  function toEpoch(value, endOfDay) {
    const s = str(value).trim();
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (d) return endOfDay ? istEpochSeconds(+d[1], +d[2], +d[3], 23, 59, 59) : istEpochSeconds(+d[1], +d[2], +d[3]);
    const t = Date.parse(s);
    if (!Number.isFinite(t)) throw new BrokerInputError(`${label}: invalid date ${s || "(empty)"}.`);
    return Math.floor(t / 1000);
  }

  async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
    if (!instrument?.token || !CONTRACT_EXCHANGES.has(instrument.exchange)) throw new BrokerInputError(`${label}: historical needs instrument { token, exchange }.`);
    const st = toEpoch(from, false);
    const et = toEpoch(to, true);
    let raw;
    if (interval === "1d" && indexSpotFor(instrument)) {
      // Index spot rows are not in the NSE/BSE masters, so EODChartData has no symbol for them; build daily
      // candles from hourly TPSeries bars instead.
      raw = await call(creds, "/TPSeries", { exch: instrument.exchange, token: str(instrument.token), st: String(st), et: String(et), intrv: TP_INTERVAL["60m"] }, { list: true });
      const hourly = raw.map(mapCandle).filter(Boolean);
      return { status: "success", data: dailyFromIntraday(hourly).sort((a, b) => a.time - b.time) };
    }
    if (interval === "1d") {
      await session.ensure(creds);
      const exch = instrument.exchange;
      const all = exch === "NFO" || exch === "BFO" ? await segment(exch) : exch === "NSE" ? await segment("NSE") : [];
      const hit = all.find((r) => r.token === str(instrument.token));
      if (!hit) throw new BrokerInputError(`${label}: daily candles need a contract from the instrument master (token ${instrument.token} not found).`);
      raw = await call(creds, "/EODChartData", { sym: `${exch}:${hit.tradingSymbol}`, from: String(st), to: String(et) }, { list: true });
    } else {
      const intrv = TP_INTERVAL[interval];
      if (!intrv) throw new BrokerInputError(`${label}: unsupported interval ${interval}.`);
      raw = await call(creds, "/TPSeries", { exch: instrument.exchange, token: str(instrument.token), st: String(st), et: String(et), intrv }, { list: true });
    }
    const byTime = new Map();
    for (const r of raw) { const c = mapCandle(r); if (c) byTime.set(c.time, c); }
    return { status: "success", data: [...byTime.values()].sort((a, b) => a.time - b.time) };
  }

  async function fetchPositions(creds) {
    const rows = await call(creds, "/PositionBook", { actid: uidOf(creds) }, { list: true });
    return { status: "success", data: rows.filter(exchangeOk).map(mapPosition) };
  }

  async function fetchHoldings(creds) {
    // prd is mandatory on Holdings (official docs: "Missing uid or actid or prd"); C = delivery holdings.
    const rows = await call(creds, "/Holdings", { actid: uidOf(creds), prd: "C" }, { list: true });
    return { status: "success", data: rows.map(mapHolding).filter((h) => h.tradingSymbol && CONTRACT_EXCHANGES.has(h.exchange)) };
  }

  async function fetchFunds(creds) {
    return { status: "success", data: mapFunds(await call(creds, "/Limits", { actid: uidOf(creds) })) };
  }

  async function fetchOrderBook(creds) {
    const rows = await call(creds, "/OrderBook", {}, { list: true });
    return { status: "success", data: rows.filter(exchangeOk).map(mapOrder) };
  }

  async function fetchTradeBook(creds) {
    const rows = await call(creds, "/TradeBook", { actid: uidOf(creds) }, { list: true });
    return { status: "success", data: rows.filter(exchangeOk).map(mapTrade) };
  }

  // ── orders (real money; every export below is gated) ──

  const rules = cfg.orderRules;

  function priceTypeFor(orderType) {
    const t = ORDER_TYPE_ALIASES[str(orderType).toUpperCase()] ?? str(orderType).toUpperCase();
    const code = PRICE_TYPE_OF_ORDER[t];
    if (!code) throw new BrokerInputError(`${label}: unsupported order type ${orderType}.`);
    if ((code === "MKT" || code === "SL-MKT") && !rules.allowMarket) {
      throw new BrokerInputError(`${label} accepts limit and stop-loss-limit orders only through its API; market orders are refused.`);
    }
    return code;
  }

  function priceStr(v, what) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new BrokerInputError(`${label}: ${what} must be a positive number.`);
    return String(n);
  }

  /**
   * Pure PlaceOrder body. `resolvedLotSize` must come from the instrument master (never from the
   * client order); quantity = lots x resolvedLotSize. Throws BrokerInputError on anything invalid.
   */
  function buildOrderBody(uid, order, resolvedLotSize) {
    const o = order || {};
    const side = str(o.transactionType ?? o.side).toUpperCase();
    if (side !== "BUY" && side !== "SELL") throw new BrokerInputError(`${label}: transactionType must be BUY or SELL.`);
    const exch = EXCH_OF_SEGMENT[o.exchangeSegment] ?? str(o.exchange ?? o.exchangeSegment ?? "NFO").toUpperCase();
    if (!CONTRACT_EXCHANGES.has(exch)) throw new BrokerInputError(`${label}: unsupported exchange ${exch}.`);
    const tsym = str(o.tradingSymbol ?? o.tradingsymbol ?? o.securityId);
    if (!tsym) throw new BrokerInputError(`${label}: tradingSymbol is required (Noren orders are keyed by trading symbol).`);
    const product = str(o.productType ?? o.product ?? "INTRADAY").toUpperCase();
    if (!rules.products.includes(product)) throw new BrokerInputError(`${label}: product ${product} is not available through the API.`);
    if (product === "INTRADAY" && (rules.noIntradayOn || []).includes(exch)) throw new BrokerInputError(`${label}: intraday (MIS) is not accepted on ${exch}; use MARGIN (NRML).`);
    const lots = Number(o.lots);
    if (!Number.isInteger(lots) || lots <= 0) throw new BrokerInputError(`${label}: lots must be a positive whole number.`);
    if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
      throw new BrokerInputError(`${label}: missing resolved lot size; it must come from the exchange instrument master, not from the client.`);
    }
    const validity = str(o.validity ?? "DAY").toUpperCase();
    if (validity !== "DAY" && validity !== "IOC") throw new BrokerInputError(`${label}: validity must be DAY or IOC.`);
    const prctyp = priceTypeFor(o.orderType ?? "LIMIT");
    const body = {
      uid, actid: uid, exch, tsym, qty: String(Math.round(lots * resolvedLotSize)), dscqty: "0",
      prc: prctyp === "MKT" || prctyp === "SL-MKT" ? "0" : priceStr(o.price, "price"),
      prd: CODE_OF_PRODUCT[product], trantype: side === "BUY" ? "B" : "S", prctyp, ret: validity, ordersource: "API",
    };
    if (prctyp === "SL-LMT" || prctyp === "SL-MKT") body.trgprc = priceStr(o.triggerPrice, "triggerPrice");
    if (o.correlationId) body.remarks = str(o.correlationId).slice(0, 40);
    return body;
  }

  /** Pure ModifyOrder body. `original` supplies exch/tsym when `changes` omits them. qty is the TOTAL order quantity in units. */
  function buildModifyBody(uid, orderId, changes, original = {}) {
    const c = changes || {};
    if (!str(orderId)) throw new BrokerInputError(`${label}: orderId is required.`);
    const exch = str(c.exchange ?? original.exch).toUpperCase();
    const tsym = str(c.tradingSymbol ?? c.tradingsymbol ?? original.tsym);
    if (!exch || !tsym) throw new BrokerInputError(`${label}: modify needs the order's exchange and trading symbol.`);
    const qty = Number(c.quantity ?? c.qty ?? original.qty);
    if (!Number.isInteger(qty) || qty <= 0) throw new BrokerInputError(`${label}: quantity must be a positive whole number of units.`);
    const prctyp = priceTypeFor(c.orderType ?? ORDER_OF_PRICE_TYPE[str(original.prctyp).toUpperCase()] ?? "LIMIT");
    const validity = str(c.validity ?? original.ret ?? "DAY").toUpperCase();
    if (validity !== "DAY" && validity !== "IOC") throw new BrokerInputError(`${label}: validity must be DAY or IOC.`);
    const body = {
      uid, norenordno: str(orderId), exch, tsym, qty: String(qty),
      prc: prctyp === "MKT" || prctyp === "SL-MKT" ? "0" : priceStr(c.price ?? original.prc, "price"), prctyp, ret: validity, ordersource: "API",
    };
    if (prctyp === "SL-LMT" || prctyp === "SL-MKT") body.trgprc = priceStr(c.triggerPrice ?? original.trgprc, "triggerPrice");
    return body;
  }

  async function placeOrderImpl(creds, order, resolvedLotSize) {
    await session.ensure(creds);
    const json = await call(creds, "/PlaceOrder", buildOrderBody(uidOf(creds), order, resolvedLotSize));
    if (!json.norenordno) throw new BrokerError(`${label} PlaceOrder returned no order number.`);
    return { orderId: str(json.norenordno), orderStatus: "UNKNOWN" };
  }

  async function modifyOrderImpl(creds, orderId, changes) {
    await session.ensure(creds);
    let original = {};
    if (!changes?.exchange || !(changes?.tradingSymbol || changes?.tradingsymbol)) {
      const book = await call(creds, "/OrderBook", {}, { list: true });
      original = book.find((r) => str(r.norenordno) === str(orderId)) ?? {};
    }
    const json = await call(creds, "/ModifyOrder", buildModifyBody(uidOf(creds), orderId, changes, original));
    return { orderId: str(json.result || orderId), orderStatus: "UNKNOWN" };
  }

  async function cancelOrderImpl(creds, orderId) {
    if (!str(orderId)) throw new BrokerInputError(`${label}: orderId is required.`);
    const json = await call(creds, "/CancelOrder", { norenordno: str(orderId) });
    return { orderId: str(json.result || orderId), orderStatus: "UNKNOWN" };
  }

  // ── errors ──

  function normaliseError(err, { secrets = [] } = {}) {
    if (!(err instanceof BrokerError) && RATE_LIMIT_ERROR.test(str(err?.message))) {
      return { statusCode: 502, code: "UPSTREAM_RATE_LIMIT", message: redactSecrets(str(err.message), secrets).slice(0, 240) };
    }
    return baseNormalise(err, { secrets });
  }

  // ── WebSocket touchline feed ──

  /**
   * createFeed(creds, { onTick, onStatus }, { WebSocketImpl }) -> { subscribe, unsubscribe, close }.
   * Connects, authenticates with the session token, subscribes touchline for the refs, merges "tf"
   * diffs into the "tk" snapshot per token and emits contract Quotes. Heartbeat every 30 s; reconnects
   * with backoff (1 s doubling to 30 s) and re-subscribes; stops for good when the connect ack is
   * Not_Ok (a dead session cannot be fixed by retrying).
   */
  function createFeed(creds, { onTick = () => {}, onStatus = () => {} } = {}, { WebSocketImpl = WebSocket, heartbeatMs = 30_000 } = {}) {
    const wanted = new Map(); // "EXCH|token" -> ref
    const state = new Map();
    let ws = null;
    let closed = false;
    let ready = false;
    let delay = 1000;
    let retryTimer = null;
    let beat = null;
    const keyOf = (r) => `${r.exchange}|${str(r.token)}`;
    const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
    const subscribeKeys = (keys) => { if (ready && keys.length) send({ t: "t", k: keys.join("#") }); };

    function emit(msg) {
      const key = `${msg.e}|${msg.tk}`;
      const merged = { ...(state.get(key) || {}), ...msg };
      state.set(key, merged);
      const ref = wanted.get(key);
      if (ref) onTick(mapQuote(ref, merged));
    }

    async function connect() {
      if (closed) return;
      let token;
      try {
        token = (await session.ensure(creds)).token;
      } catch (e) {
        closed = true;
        onStatus({ connected: false, reason: normaliseError(e).message });
        return;
      }
      if (closed) return;
      ws = new WebSocketImpl(cfg.wsUrl);
      ws.on("open", () => {
        const uid = uidOf(creds);
        ws.send(JSON.stringify({ t: "a", uid, actid: uid, source: "API", accesstoken: token }));
      });
      ws.on("message", (data) => {
        let msg;
        try { msg = JSON.parse(String(data)); } catch { return; }
        if (msg.t === "ak") {
          if (str(msg.s).toLowerCase() !== "ok") {
            closed = true;
            onStatus({ connected: false, reason: `${label} refused the feed session. ${session.regenerate}` });
            ws.close();
            return;
          }
          ready = true;
          delay = 1000;
          onStatus({ connected: true });
          subscribeKeys([...wanted.keys()]);
          clearInterval(beat);
          beat = setInterval(() => send({ t: "h" }), heartbeatMs);
        } else if (msg.t === "tk" || msg.t === "tf") {
          emit(msg);
        }
      });
      ws.on("close", () => {
        ready = false;
        clearInterval(beat);
        if (closed) return;
        onStatus({ connected: false, reason: "disconnected" });
        retryTimer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      });
      ws.on("error", () => { /* "close" follows and drives the reconnect */ });
    }

    connect();
    return {
      subscribe(refs = []) {
        const fresh = refs.filter((r) => r?.token && CONTRACT_EXCHANGES.has(r.exchange) && !wanted.has(keyOf(r)));
        for (const r of fresh) wanted.set(keyOf(r), r);
        subscribeKeys(fresh.map(keyOf));
      },
      unsubscribe(refs = []) {
        const gone = refs.filter((r) => wanted.has(keyOf(r))).map(keyOf);
        for (const k of gone) { wanted.delete(k); state.delete(k); }
        if (ready && gone.length) send({ t: "u", k: gone.join("#") });
      },
      close() {
        closed = true;
        clearTimeout(retryTimer);
        clearInterval(beat);
        if (ws) ws.close();
      },
    };
  }

  return {
    call, testConnection, fetchInstruments, fetchExpiryList, fetchLTP, fetchOptionChain, fetchQuotes, fetchDepth, fetchHistorical,
    fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook, buildOrderBody, buildModifyBody, normaliseError, createFeed,
    placeOrder: withOrderGate("placeOrder", placeOrderImpl, { brokerId: id }),
    modifyOrder: withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: id }),
    cancelOrder: withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: id }),
  };
}

/** The contract capabilities object shared by the three Noren adapters (legacy order keys added per broker). */
export function norenCapabilities(extra = {}) {
  return {
    auth: { kind: "requestTokenExchange" },
    testConnection: true,
    instruments: true,
    expiries: true,
    optionChain: { greeks: "computed" },
    ltp: true,
    quotes: true,
    depth: true,
    historical: { intervals: ["1m", "3m", "5m", "15m", "30m", "60m", "1d"] },
    feed: true,
    positions: true,
    holdings: true,
    funds: true,
    orderBook: true,
    tradeBook: true,
    placeOrder: true,
    modifyOrder: true,
    cancelOrder: true,
    normaliseError: true,
    bracket: false,
    cover: false,
    ioc: true,
    nativeMarketProtection: false,
    maxLegQty: null,
    ...extra,
  };
}
