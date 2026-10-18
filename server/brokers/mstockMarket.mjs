/**
 * mStock (Mirae Asset) Type B market data: quotes, LTP, option chain and candles.
 *
 * Official docs (checked 2026-10):
 *  - Quote: GET /instruments/quote with a JSON body { mode, exchangeTokens: { NSE: ["3045"], NFO: [...] } }.
 *    The documented modes are "OHLC" and "LTP"; the reply is data.fetched[] { exchange, tradingSymbol,
 *    symbolToken, ltp, open, high, low, close } plus data.unfetched[]. No OI, volume or depth is
 *    documented for the REST quote, so those fields are read only when mStock sends them (this repo's
 *    earlier "FULL" mode was an Angel One mode and is not in mStock's docs).
 *    https://tradingapi.mstock.com/docs/v1/typeB/market-quote-and-instrument/
 *  - Historical: GET /instruments/historical with { exchange, symboltoken, interval, fromdate, todate }
 *    ("YYYY-MM-DD HH:mm"), reply data.candles[[time, o, h, l, c, v]] with time like
 *    "2024-01-01T09:15:00+05" (IST). https://tradingapi.mstock.com/docs/v1/typeB/historical-candle/
 *    Interval names beyond ONE_MINUTE are not listed there; THREE/FIVE/FIFTEEN/THIRTY_MINUTE, ONE_HOUR and
 *    ONE_DAY follow the intraday page's interval list and OpenAlgo's mapping (facts only).
 *  - Rate limits: quotes 20/s; historical ("data APIs") 1/s, 1000/min.
 * There is no REST market-depth endpoint (depth is only in the binary WebSocket "Snap Quote" packet), so
 * the depth capability is not declared. IV and Greeks are solved locally (Black-Scholes).
 */

import { BrokerInputError } from "./contract.mjs";
import { authRequest, getSession } from "./mstockAuth.mjs";
import { INDEX_SPOT, getInstruments, listExpiries, optionContracts, spotRef, canonicalUnderlying } from "./mstockInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const QUOTE_MODE = "OHLC";
const QUOTE_BATCH_SIZE = 100;
const QUOTE_BATCH_DELAY_MS = 120; // ~8 calls/s, well inside the documented 20/s
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

function firstLevelPrice(side) {
  const level = Array.isArray(side) ? side[0] : null;
  return level ? numOrNull(level.price) : null;
}

/** Batched quote call -> Map<"EXCH:token", raw row>. */
export async function quoteMap(creds, refs) {
  const map = new Map();
  if (!refs.length) return map;
  const chunks = await batchWithDelay(refs, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const exchangeTokens = {};
    for (const r of chunk) (exchangeTokens[r.exchange] ||= []).push(String(r.token));
    const json = await authRequest(creds, "/instruments/quote", { method: "GET", body: { mode: QUOTE_MODE, exchangeTokens } });
    return Array.isArray(json?.data?.fetched) ? json.data.fetched : [];
  });
  for (const rows of chunks) {
    for (const q of rows) {
      if (q?.symbolToken == null) continue;
      map.set(`${String(q.exchange ?? "").toUpperCase()}:${String(q.symbolToken)}`, q);
    }
  }
  return map;
}

const lookup = (map, ref) => map.get(`${ref.exchange}:${String(ref.token)}`);

export function mapQuote(ref, q) {
  return {
    token: String(ref.token),
    exchange: ref.exchange,
    ltp: num(q?.ltp),
    open: numOrNull(q?.open),
    high: numOrNull(q?.high),
    low: numOrNull(q?.low),
    close: numOrNull(q?.close),
    volume: numOrNull(q?.volume ?? q?.tradeVolume),
    oi: numOrNull(q?.oi ?? q?.opnInterest),
    bid: firstLevelPrice(q?.depth?.buy),
    ask: firstLevelPrice(q?.depth?.sell),
  };
}

function checkRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) throw new BrokerInputError("mStock quotes: pass at least one { token, exchange }.");
  return refs.map((r) => {
    const exchange = String(r?.exchange ?? "").toUpperCase();
    const token = String(r?.token ?? "").trim();
    if (!EXCHANGES.has(exchange) || !/^\d{1,12}$/.test(token)) throw new BrokerInputError(`mStock quotes: bad instrument ${JSON.stringify(r)}`);
    return { exchange, token };
  });
}

export async function fetchQuotes(creds, refs) {
  getSession(creds);
  const wanted = checkRefs(refs);
  const map = await quoteMap(creds, wanted);
  return { status: "success", data: wanted.filter((r) => lookup(map, r)).map((r) => mapQuote(r, lookup(map, r))) };
}

async function spotFor(creds, symbol) {
  const want = canonicalUnderlying(symbol);
  // Indices use Annexure tokens, so the (large) master is only needed for stock underlyings.
  const ref = INDEX_SPOT[want] || spotRef(await getInstruments(creds), want);
  if (!ref) throw new BrokerInputError(`mStock: no spot instrument for ${symbol}`);
  return ref;
}

export async function fetchLTP(creds, symbol) {
  getSession(creds);
  const ref = await spotFor(creds, symbol);
  const map = await quoteMap(creds, [ref]);
  const q = lookup(map, ref);
  const ltp = num(q?.ltp);
  if (!(ltp > 0)) throw new Error(`mStock returned no last price for ${symbol}`);
  return { status: "success", data: { last_price: ltp } };
}

export async function fetchExpiryList(creds, symbol) {
  const instruments = await getInstruments(creds);
  return { status: "success", data: listExpiries(instruments, symbol) };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  getSession(creds);
  const instruments = await getInstruments(creds);
  const expiryIso = expiry || listExpiries(instruments, symbol)[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };
  const contracts = optionContracts(instruments, symbol, expiryIso);
  if (!contracts.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = spotRef(instruments, symbol);
  const refs = contracts.map((c) => ({ exchange: c.exchange, token: c.token }));
  if (spot) refs.unshift(spot);
  const map = await quoteMap(creds, refs);
  const lastPrice = spot ? num(lookup(map, spot)?.ltp) : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const c of contracts) {
    const q = lookup(map, c);
    if (!q) continue;
    const quote = mapQuote(c, q);
    const greeks = computeIVAndGreeks({ ltp: quote.ltp, spot: lastPrice, strike: c.strike, daysToExpiry, type: c.optionType });
    const key = String(c.strike);
    (oc[key] ||= {})[c.optionType === "CE" ? "ce" : "pe"] = {
      last_price: quote.ltp,
      oi: quote.oi ?? 0,
      volume: quote.volume ?? 0,
      bid_price: quote.bid ?? 0,
      ask_price: quote.ask ?? 0,
      security_id: c.token,
      ...greeks,
    };
  }
  return { status: "success", data: { oc, last_price: lastPrice } };
}

// ── candles ──

const INTERVALS = { "1m": "ONE_MINUTE", "3m": "THREE_MINUTE", "5m": "FIVE_MINUTE", "15m": "FIFTEEN_MINUTE", "30m": "THIRTY_MINUTE", "60m": "ONE_HOUR", "1d": "ONE_DAY" };

/** "2024-08-02" | "2024-08-02T09:15" | "2024-08-02 09:15" -> "2024-08-02 09:15" (IST wall time). */
export function toMstockDateTime(value, fallbackTime) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value ?? "").trim());
  if (!m) throw new BrokerInputError(`mStock historical: bad date ${value}`);
  return `${m[1]} ${m[2] ? `${m[2]}:${m[3]}` : fallbackTime}`;
}

/** Candle time ("2024-01-01T09:15:00+05", "2025-04-04 15:27") read as IST -> epoch seconds. */
export function candleTime(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - 5.5 * 3600 * 1000;
  return Math.floor(ms / 1000);
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  getSession(creds);
  const exchange = String(instrument?.exchange ?? "").toUpperCase();
  const token = String(instrument?.token ?? "").trim();
  if (!EXCHANGES.has(exchange) || !/^\d{1,12}$/.test(token)) throw new BrokerInputError("mStock historical: bad instrument");
  const iv = INTERVALS[interval];
  if (!iv) throw new BrokerInputError(`mStock historical: unsupported interval ${interval}`);
  const body = { exchange, symboltoken: token, interval: iv, fromdate: toMstockDateTime(from, "09:15"), todate: toMstockDateTime(to, "15:30") };
  const json = await authRequest(creds, "/instruments/historical", { method: "GET", body });
  const rows = Array.isArray(json?.data?.candles) ? json.data.candles : [];
  const byTime = new Map();
  for (const c of rows) {
    if (!Array.isArray(c)) continue;
    const time = candleTime(c[0]);
    if (time === null) continue;
    byTime.set(time, { time, open: num(c[1]), high: num(c[2]), low: num(c[3]), close: num(c[4]), volume: num(c[5]) });
  }
  return { status: "success", data: [...byTime.values()].sort((a, b) => a.time - b.time) };
}
