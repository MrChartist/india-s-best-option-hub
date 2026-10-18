/**
 * Groww market data (official docs: https://groww.in/trade-api/docs/curl/live-data and /backtesting).
 *
 *  - Option chain: GET /v1/option-chain/exchange/{NSE|BSE}/underlying/{underlying}?expiry_date=YYYY-MM-DD
 *    -> payload { underlying_ltp, strikes: { "<strike>": { CE: { greeks { delta, gamma, theta, vega, rho, iv },
 *    trading_symbol, ltp, open_interest, volume }, PE: {...} } } }. `iv` is documented "expressed as a
 *    percentage". The chain carries no bid/ask and no OI change, so those stay 0. One call per chain
 *    (the old adapter made one /quote call per leg and back-solved IV that Groww already sends).
 *  - LTP: GET /v1/live-data/ltp?segment=CASH|FNO&exchange_symbols=NSE_NIFTY,BSE_SENSEX (max 50)
 *    -> payload { "NSE_NIFTY": 25641.7 }. Indices use segment CASH.
 *  - Quote: GET /v1/live-data/quote?exchange&segment&trading_symbol (one instrument per call)
 *    -> payload { last_price, ohlc: "{open: 149.50,high: 150.50,low: 148.50,close: 149.50}" (a string),
 *    volume, open_interest, bid_price, offer_price, depth { buy[], sell[] of { price, quantity } }, ... }.
 *  - Historical: GET /v1/historical/candles?exchange&segment&groww_symbol&start_time&end_time&candle_interval
 *    (start/end "yyyy-MM-dd HH:mm:ss" IST) -> payload { candles: [[ "2025-09-24T10:30:00", o, h, l, c, v, oi ]] }.
 *    The older /v1/historical/candle/range is documented as deprecated and is not used.
 */

import { BrokerInputError, SessionRequiredError } from "./contract.mjs";
import { getAccessToken, growwRequest } from "./growwAuth.mjs";
import { findByRef, getMaster, INDEX_EXCHANGE, listExpiries, spotRow } from "./growwInstruments.mjs";

const MAX_QUOTE_REFS = 25; // one /quote call each at the Live Data pace
const INTERVAL = { "1m": "1minute", "3m": "3minute", "5m": "5minute", "15m": "15minute", "30m": "30minute", "60m": "1hour", "1d": "1day" };
const IST_OFFSET_S = 5.5 * 3600;

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const nOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function exchangeFor(symbol, master) {
  const u = String(symbol ?? "").toUpperCase();
  if (INDEX_EXCHANGE[u]) return INDEX_EXCHANGE[u];
  const opt = master.find((m) => m.underlying === u && m.segment === "FNO");
  return opt?.growwExchange ?? "NSE";
}

/**
 * Refuse a logged-out caller before the multi-MB instrument master is downloaded. A pasted token is
 * returned as is; a key pair is exchanged once and cached (the same token every later call uses).
 */
async function requireSession(creds) {
  const pasted = String(creds?.accessToken ?? "").trim();
  const pair = String(creds?.apiKey ?? "").trim() && String(creds?.apiSecret ?? "").trim();
  if (!pasted && !pair) {
    throw new SessionRequiredError("Groww: paste today's Access Token, or save your API Key and API Secret, in Broker Settings.");
  }
  await getAccessToken(creds);
}

export async function fetchExpiryList(creds, symbol) {
  await requireSession(creds);
  const master = await getMaster();
  return { status: "success", data: listExpiries(master, symbol) };
}

/** `ltp` from an LTP payload value, which the docs show as a bare number (schema names it `ltp`). */
function ltpValue(v) {
  if (v && typeof v === "object") return n(v.ltp ?? v.last_price);
  return n(v);
}

export async function fetchLTP(creds, symbol) {
  const master = await getMaster();
  const row = spotRow(master, symbol);
  if (!row) throw new BrokerInputError(`Groww: no index or NSE stock named ${symbol}`);
  const key = `${row.growwExchange}_${row.tradingSymbol}`;
  const payload = await growwRequest(creds, "/v1/live-data/ltp", { params: { segment: "CASH", exchange_symbols: key } });
  return { status: "success", data: { last_price: ltpValue(payload?.[key]) } };
}

function toLeg(raw) {
  if (!raw) return undefined;
  const g = raw.greeks ?? {};
  return {
    last_price: n(raw.ltp),
    oi: n(raw.open_interest),
    volume: n(raw.volume),
    iv: n(g.iv),
    delta: n(g.delta),
    gamma: n(g.gamma),
    theta: n(g.theta),
    vega: n(g.vega),
    bid_price: 0,
    ask_price: 0,
    security_id: raw.trading_symbol ? String(raw.trading_symbol) : undefined,
  };
}

/** Pure: Groww option-chain payload -> contract { oc, last_price }. */
export function mapOptionChain(payload) {
  const oc = {};
  for (const [strikeKey, sides] of Object.entries(payload?.strikes ?? {})) {
    const strike = parseFloat(strikeKey);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    const ce = toLeg(sides?.CE);
    const pe = toLeg(sides?.PE);
    if (!ce && !pe) continue;
    oc[String(strike)] = { ...(ce ? { ce } : {}), ...(pe ? { pe } : {}) };
  }
  return { oc, last_price: n(payload?.underlying_ltp) };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  await requireSession(creds);
  const master = await getMaster();
  const u = String(symbol ?? "").toUpperCase();
  const expiries = listExpiries(master, u);
  if (!expiries.length) throw new BrokerInputError(`Groww: no options listed for ${symbol}`);
  const target = expiry || expiries[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new BrokerInputError(`Groww: expiry must be YYYY-MM-DD (got ${expiry})`);
  const exchange = exchangeFor(u, master);
  const payload = await growwRequest(creds, `/v1/option-chain/exchange/${exchange}/underlying/${encodeURIComponent(u)}`, { params: { expiry_date: target } });
  return { status: "success", data: mapOptionChain(payload) };
}

/** "{open: 149.50,high: 150.50,low: 148.50,close: 149.50}" (or an object) -> numbers. */
export function parseOhlc(v) {
  if (v && typeof v === "object") return { open: nOrNull(v.open), high: nOrNull(v.high), low: nOrNull(v.low), close: nOrNull(v.close) };
  const out = { open: null, high: null, low: null, close: null };
  for (const k of Object.keys(out)) {
    const m = new RegExp(`${k}\\s*:\\s*(-?[\\d.]+)`).exec(String(v ?? ""));
    if (m) out[k] = Number(m[1]);
  }
  return out;
}

function quoteParams(m) {
  return { exchange: m.growwExchange, segment: m.segment, trading_symbol: m.tradingSymbol };
}

/** Pure: a /quote payload -> contract Quote. */
export function mapQuote(ref, p) {
  const ohlc = parseOhlc(p?.ohlc);
  return {
    token: String(ref.token), exchange: ref.exchange, ltp: n(p?.last_price),
    open: ohlc.open, high: ohlc.high, low: ohlc.low, close: ohlc.close,
    volume: nOrNull(p?.volume), oi: nOrNull(p?.open_interest),
    bid: nOrNull(p?.bid_price ?? p?.depth?.buy?.[0]?.price), ask: nOrNull(p?.offer_price ?? p?.depth?.sell?.[0]?.price),
  };
}

export async function fetchQuotes(creds, refs = []) {
  if (!Array.isArray(refs) || !refs.length) return { status: "success", data: [] };
  if (refs.length > MAX_QUOTE_REFS) throw new BrokerInputError(`Groww quotes: at most ${MAX_QUOTE_REFS} instruments per request (one API call each)`);
  const master = await getMaster();
  const out = [];
  for (const ref of refs) {
    const m = findByRef(master, ref);
    if (!m) throw new BrokerInputError(`Groww: unknown instrument ${ref?.exchange}:${ref?.token}`);
    const p = await growwRequest(creds, "/v1/live-data/quote", { params: quoteParams(m) });
    out.push(mapQuote(ref, p));
  }
  return { status: "success", data: out };
}

export async function fetchDepth(creds, ref) {
  const master = await getMaster();
  const m = findByRef(master, ref);
  if (!m) throw new BrokerInputError(`Groww: unknown instrument ${ref?.exchange}:${ref?.token}`);
  const p = await growwRequest(creds, "/v1/live-data/quote", { params: quoteParams(m) });
  const level = (l) => ({ price: n(l?.price), qty: n(l?.quantity), orders: null });
  const keep = (l) => l.price > 0 || l.qty > 0;
  return { status: "success", data: { bids: (p?.depth?.buy ?? []).map(level).filter(keep), asks: (p?.depth?.sell ?? []).map(level).filter(keep) } };
}

/** "2025-09-24T10:30:00" (IST wall clock), "2025-09-24 10:30:00" or epoch seconds/ms -> epoch seconds. */
export function candleTime(v) {
  if (typeof v === "number") return v > 1e11 ? Math.floor(v / 1000) : Math.floor(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v ?? ""));
  if (!m) return NaN;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(v))) return Math.floor(Date.parse(String(v)) / 1000);
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000) - IST_OFFSET_S;
}

export function mapCandles(payload) {
  const rows = (payload?.candles ?? [])
    .map((c) => (Array.isArray(c) ? { time: candleTime(c[0]), open: n(c[1]), high: n(c[2]), low: n(c[3]), close: n(c[4]), volume: n(c[5]), ...(c[6] != null ? { oi: n(c[6]) } : {}) } : null))
    .filter((c) => c && Number.isInteger(c.time));
  rows.sort((a, b) => a.time - b.time);
  return rows.filter((c, i) => i === 0 || c.time > rows[i - 1].time);
}

export async function fetchHistorical(creds, { instrument, interval = "1d", from, to } = {}) {
  const candle = INTERVAL[interval];
  if (!candle) throw new BrokerInputError(`Groww historical: unsupported interval ${interval}`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}/.test(String(to))) throw new BrokerInputError("Groww historical: from/to must be YYYY-MM-DD");
  const master = await getMaster();
  const m = findByRef(master, instrument);
  if (!m?.growwSymbol) throw new BrokerInputError(`Groww: unknown instrument ${instrument?.exchange}:${instrument?.token}`);
  const payload = await growwRequest(creds, "/v1/historical/candles", {
    params: {
      exchange: m.growwExchange, segment: m.segment, groww_symbol: m.growwSymbol,
      start_time: `${String(from).slice(0, 10)} 09:15:00`, end_time: `${String(to).slice(0, 10)} 15:30:00`, candle_interval: candle,
    },
  });
  return { status: "success", data: mapCandles(payload) };
}
