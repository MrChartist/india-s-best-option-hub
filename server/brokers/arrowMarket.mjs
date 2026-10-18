/**
 * Arrow market data: instrument master, expiries, option chain, quotes, depth and historical candles.
 *
 * Official docs (checked 2026-10): https://docs.arrow.trade/rest-api/symbol-quotes/ , /rest-api/utility/ ,
 * /rest-api/historical-candle-data/ , /rest-api/symbols/ , /rest-api/rate-limits/ .
 *  - POST /info/quote/{ltp|ohlcv|full} { exchange, symbol } and POST /info/quotes/{mode} [{ exchange, symbol }, ...].
 *    Prices are integers in the exchange's native scale (paise: divide by 100); volume and OI are not scaled.
 *    Rows may come back in any order: match them by `token`.
 *    FULL adds bids/asks (5 levels of { price, quantity, orders }) and `openingOI` (session-open OI).
 *  - POST /info/option-chain { underlying, exchange: "INDEX"|"NSE", count, expiry: "DD-MMM-YYYY" } lists the
 *    contracts around ATM (exchange, symbol, token, optionType, strikePrice in rupees, lotSize). It carries no
 *    prices, so the chain is that list + batched FULL quotes. Arrow publishes no Greeks over REST (the
 *    /info/greeks section of the docs is commented out), so IV and Greeks come from this app's Black-Scholes.
 *  - GET https://historical-api.arrow.trade/candle/{exchange}/{token}/{interval}?from=yyyy-MM-ddTHH:mm:ss&to=...&oi=1
 *    -> a bare array of [isoTime(+0530), open*100, high*100, low*100, close*100, volume, oi?].
 *  - Limits: 10 requests/second for market data and for historical data. /info/quotes takes at most 100
 *    instruments per call (the server has been observed to reject 101; the docs give no number).
 */

import { BrokerError, BrokerInputError, SessionRequiredError } from "./contract.mjs";
import { arrowFetch, HISTORICAL_URL } from "./arrowAuth.mjs";
import {
  expiriesFromSymbols, isoToArrowDate, parseMasterCsv, toArrowExchange, toHistoryExchange, toInstrument, underlyingRef,
} from "./arrowInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

const QUOTE_BATCH_SIZE = 100;
const QUOTE_BATCH_DELAY_MS = 150; // about 6 calls a second, under the documented 10/s
const CHAIN_STRIKE_COUNT = "30";
const SYMBOLS_TTL_MS = 60 * 60 * 1000;

export const scalePrice = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : 0;
};
const scaleOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v) / 100);
const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── instrument master ──

/** Parsed contract instruments from GET /all, cached once a day for every user (the file is the same for all). */
export async function getInstruments(creds) {
  return getCachedOrFetch("arrow:instruments:v2", async () => {
    const { text } = await arrowFetch(creds, "/all", { raw: true, what: "instrument master" });
    const out = [];
    for (const row of parseMasterCsv(text)) {
      const ins = toInstrument(row);
      if (ins) out.push(ins);
    }
    if (!out.length) throw new BrokerError("Arrow instrument master was empty");
    return out;
  }, ONE_DAY_MS);
}

async function findInstrument(creds, ref) {
  const list = await getInstruments(creds);
  return list.find((i) => i.token === String(ref.token) && i.exchange === ref.exchange) || null;
}

/** InstrumentRef -> Arrow quote request item. Accepts an explicit `tradingSymbol` to skip the master lookup. */
async function quoteItemFor(creds, ref) {
  if (!ref || !/^\d{1,12}$/.test(String(ref.token ?? "")) || !ref.exchange) throw new BrokerInputError("Arrow quotes need { token, exchange }");
  if (typeof ref.tradingSymbol === "string" && /^[A-Z0-9&_.-]{1,40}$/.test(ref.tradingSymbol)) {
    return { exchange: toArrowExchange(ref.exchange), symbol: ref.tradingSymbol };
  }
  const ins = await findInstrument(creds, ref);
  if (!ins) throw new BrokerInputError(`Arrow instrument master has no ${ref.exchange} token ${ref.token}`);
  return ins.instrumentType === "INDEX"
    ? { exchange: "INDEX", symbol: underlyingRef(ins.underlying).quoteSymbol }
    : { exchange: toArrowExchange(ins.exchange), symbol: ins.tradingSymbol };
}

// ── quotes ──

/** Map key for a quote: tokens are only unique within one exchange, so the exchange is always part of it. */
export const quoteKey = (exchange, token) => `${String(exchange).toUpperCase()}|${String(token)}`;

/**
 * Which exchange a returned quote belongs to. Uses the exchange the response echoes when it has one; otherwise the
 * exchange of the requested item with the same symbol. If two requested items share that symbol the quote is
 * ambiguous and is dropped (null) rather than risk giving one leg another exchange's price.
 */
function exchangeOfQuote(q, chunk) {
  if (q.exchange) return String(q.exchange);
  const matches = chunk.filter((it) => String(it.symbol) === String(q.symbol ?? ""));
  return matches.length === 1 ? String(matches[0].exchange) : null;
}

/**
 * Batched POST /info/quotes/full. Returns Map<quoteKey(arrowExchange, token), raw quote>, keyed by the Arrow
 * exchange code of the request item (INDEX, NSE, NFO, MCXFO ...). A session error stops the batch.
 */
export async function fetchFullQuoteMap(creds, items) {
  const map = new Map();
  for (let i = 0; i < items.length; i += QUOTE_BATCH_SIZE) {
    if (i > 0) await sleep(QUOTE_BATCH_DELAY_MS);
    const chunk = items.slice(i, i + QUOTE_BATCH_SIZE);
    let json;
    try {
      json = await arrowFetch(creds, "/info/quotes/full", { method: "POST", body: chunk, what: "quotes" });
    } catch (e) {
      if (e instanceof SessionRequiredError || e instanceof BrokerInputError || items.length <= QUOTE_BATCH_SIZE) throw e;
      console.warn(`[arrow] quote batch ${i / QUOTE_BATCH_SIZE + 1} failed: ${e.message}`);
      continue;
    }
    for (const q of Array.isArray(json?.data) ? json.data : []) {
      if (!q || q.token === undefined) continue;
      const exchange = exchangeOfQuote(q, chunk);
      if (exchange) map.set(quoteKey(exchange, q.token), q);
    }
  }
  return map;
}

/** POST /info/quote/{mode} for one instrument. */
export async function fetchSingleQuote(creds, mode, exchange, symbol) {
  const json = await arrowFetch(creds, `/info/quote/${mode}`, { method: "POST", body: { exchange, symbol }, what: "quote" });
  return json?.data || {};
}

const toQuote = (ref, q) => ({
  token: String(ref.token),
  exchange: ref.exchange,
  ltp: scalePrice(q.ltp),
  open: scaleOrNull(q.open),
  high: scaleOrNull(q.high),
  low: scaleOrNull(q.low),
  close: scaleOrNull(q.close),
  volume: numOrNull(q.volume),
  oi: numOrNull(q.oi),
  bid: scaleOrNull(q.bids?.[0]?.price),
  ask: scaleOrNull(q.asks?.[0]?.price),
});

export async function fetchQuotes(creds, refs = []) {
  const list = Array.isArray(refs) ? refs : [];
  if (!list.length) return { status: "success", data: [] };
  const items = [];
  for (const ref of list) items.push(await quoteItemFor(creds, ref));
  const map = await fetchFullQuoteMap(creds, items);
  const data = [];
  for (const [i, ref] of list.entries()) {
    const q = map.get(quoteKey(items[i].exchange, ref.token));
    if (q) data.push(toQuote(ref, q));
  }
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  const item = await quoteItemFor(creds, ref);
  const q = await fetchSingleQuote(creds, "full", item.exchange, item.symbol);
  const level = (l) => ({ price: scalePrice(l?.price), qty: Number(l?.quantity) || 0, orders: numOrNull(l?.orders) });
  return { status: "success", data: { bids: (q.bids || []).map(level), asks: (q.asks || []).map(level) } };
}

// ── LTP, expiries, option chain ──

export async function fetchLTP(creds, symbol) {
  const ref = underlyingRef(symbol);
  if (!ref) throw new BrokerInputError(`Arrow: unknown symbol ${symbol}`);
  const q = await fetchSingleQuote(creds, "ltp", ref.quoteExchange, ref.quoteSymbol);
  const last = scalePrice(q.ltp);
  if (!(last > 0)) throw new BrokerError(`Arrow returned no LTP for ${ref.quoteSymbol}`);
  return { status: "success", data: { last_price: last } };
}

async function getOptionChainSymbols(creds) {
  return getCachedOrFetch("arrow:option-chain-symbols", () => arrowFetch(creds, "/info/option-chain-symbols/all", { what: "option-chain symbols" }), SYMBOLS_TTL_MS);
}

export async function fetchExpiryList(creds, symbol) {
  if (!underlyingRef(symbol)) throw new BrokerInputError(`Arrow: unknown symbol ${symbol}`);
  const json = await getOptionChainSymbols(creds);
  return { status: "success", data: expiriesFromSymbols(json, symbol) };
}

function buildLeg(q, { spot, strike, daysToExpiry, type, token }) {
  const ltp = scalePrice(q.ltp);
  const oi = Number(q.oi) || 0;
  const leg = {
    last_price: ltp,
    oi,
    volume: Number(q.volume) || 0,
    ...computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type }),
    bid_price: scalePrice(q.bids?.[0]?.price),
    ask_price: scalePrice(q.asks?.[0]?.price),
    security_id: token,
  };
  const opening = Number(q.openingOI);
  if (Number.isFinite(opening) && opening > 0) leg.previous_oi = opening;
  return leg;
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const ref = underlyingRef(symbol);
  if (!ref) throw new BrokerInputError(`Arrow: unknown symbol ${symbol}`);
  const expiryIso = expiry || (await fetchExpiryList(creds, symbol)).data[0];
  const arrowExpiry = isoToArrowDate(expiryIso);
  if (!arrowExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  const chainJson = await arrowFetch(creds, "/info/option-chain", {
    method: "POST",
    body: { underlying: ref.chainUnderlying, exchange: ref.chainExchange, count: CHAIN_STRIKE_COUNT, expiry: arrowExpiry },
    what: "option chain",
  });
  const contracts = (Array.isArray(chainJson?.data) ? chainJson.data : []).filter(
    (c) => c && c.token !== undefined && (c.optionType === "CE" || c.optionType === "PE") && Number(c.strikePrice) > 0,
  );
  const spotQuote = await fetchSingleQuote(creds, "ltp", ref.quoteExchange, ref.quoteSymbol);
  const spot = scalePrice(spotQuote.ltp);
  if (!contracts.length) return { status: "success", data: { oc: {}, last_price: spot } };

  const quotes = await fetchFullQuoteMap(creds, contracts.map((c) => ({ exchange: String(c.exchange), symbol: String(c.symbol) })));
  const daysToExpiry = daysBetween(new Date(), expiryIso);
  const oc = {};
  for (const c of contracts) {
    const q = quotes.get(quoteKey(c.exchange, c.token));
    if (!q) continue;
    const strike = Number(c.strikePrice);
    (oc[String(strike)] ||= {})[c.optionType.toLowerCase()] = buildLeg(q, { spot, strike, daysToExpiry, type: c.optionType, token: String(c.token) });
  }
  return { status: "success", data: { oc, last_price: spot } };
}

// ── historical ──

const INTERVALS = { "1m": "min", "3m": "3min", "5m": "5min", "15m": "15min", "30m": "30min", "60m": "hour", "1d": "day" };

/** "2026-10-01" or an ISO date-time -> "yyyy-MM-ddTHH:mm:ss" in IST. */
function toArrowDateTime(v, endOfDay) {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T${endOfDay ? "23:59:59" : "00:00:00"}`;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 19);
}

/** "2023-05-02T00:00:00+0530" -> epoch seconds. */
export function parseArrowTime(s) {
  const fixed = String(s ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(fixed);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const arrowInterval = INTERVALS[interval];
  if (!arrowInterval) throw new BrokerInputError(`Arrow history does not support interval ${interval}`);
  if (!instrument || !/^\d{1,12}$/.test(String(instrument.token ?? "")) || !instrument.exchange) throw new BrokerInputError("Arrow history needs { token, exchange }");
  const fromStr = toArrowDateTime(from, false);
  const toStr = toArrowDateTime(to, true);
  if (!fromStr || !toStr) throw new BrokerInputError("Arrow history needs a valid from/to range");
  const params = new URLSearchParams({ from: fromStr, to: toStr });
  const wantOi = instrument.exchange === "NFO" || instrument.exchange === "BFO";
  if (wantOi) params.set("oi", "1");
  const path = `/candle/${toHistoryExchange(instrument.exchange)}/${String(instrument.token)}/${arrowInterval}?${params.toString()}`;
  const json = await arrowFetch(creds, path, { base: HISTORICAL_URL, what: "historical candles" });
  if (!Array.isArray(json)) throw new BrokerError(`Arrow historical candles: ${json?.message || "unexpected response"}`);
  const seen = new Set();
  const data = [];
  for (const c of json) {
    if (!Array.isArray(c)) continue;
    const time = parseArrowTime(c[0]);
    if (!Number.isFinite(time) || seen.has(time)) continue;
    seen.add(time);
    const candle = { time, open: scalePrice(c[1]), high: scalePrice(c[2]), low: scalePrice(c[3]), close: scalePrice(c[4]), volume: Number(c[5]) || 0 };
    if (wantOi && c.length > 6) candle.oi = Number(c[6]) || 0;
    data.push(candle);
  }
  data.sort((a, b) => a.time - b.time);
  return { status: "success", data };
}

