/**
 * IndMoney (INDstocks) market data. Official Postman collection (Market Data folder), checked 2026-10:
 *  - GET /market/quotes/full?scrip-codes=NSE_1594,NFO_51011 (up to 1000) -> data { "<scrip>": { live_price,
 *    day_change, day_change_percentage, day_low, day_high, day_open, prev_close, 52week_high, 52week_low,
 *    upper_circuit, lower_circuit, market_depth: { "<scrip>": { aggregate, depth: [ { buy: { quantity, price },
 *    sell: {...} } x5 ] } }, volume } }. Depth values are strings with thousands separators ("1,102.60").
 *    400 { debug_info: "Invalid scrip codes or mode" } fails the whole batch.
 *  - GET /market/quotes/ltp -> data { "<scrip>": { live_price } }.
 *  - GET /market/quotes/mkt -> data { "<scrip>": { market_depth: {...} } }.
 *  - GET /market/historical/{interval}?scrip-codes&start_time&end_time (epoch ms IST; end exclusive)
 *    -> { success: true, data: { "<scrip>": { candles: [ { ts (epoch s), o, h, l, c, v } ] } } }.
 *    Intervals include 1minute, 3minute, 5minute, 15minute, 30minute, 60minute, 1day.
 * The "Options Toolkit" (chain, expiries, Greeks) is marked "coming soon", so the chain is built from the
 * fno master plus batched full quotes, and IV/Greeks are back-solved (Black-Scholes). The documented quote
 * has no open-interest field: OI is read from `oi`/`open_interest` when present, else 0.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { chunkArray } from "../lib/batch.mjs";
import { BrokerInputError } from "./contract.mjs";
import { indRequest, sessionToken } from "./indmoneyAuth.mjs";
import { getEquity, getFno, getIndices, INDEX_NAME, listExpiries, optionRows, scripCodeOf, spotRow } from "./indmoneyInstruments.mjs";

const QUOTE_BATCH = 500; // documented cap is 1000 per call; 500 keeps URLs short
const INTERVAL = { "1m": "1minute", "3m": "3minute", "5m": "5minute", "15m": "15minute", "30m": "30minute", "60m": "60minute", "1d": "1day" };
const IST_OFFSET_MS = 5.5 * 3600_000;

/** "1,102.60" / 1102.6 / "" -> number (0 when not numeric). */
export function clean(v) {
  if (v === null || v === undefined) return 0;
  const x = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
}
const cleanOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(String(v).replace(/,/g, ""))) ? clean(v) : null);

/** The depth ladder of a quote: market_depth.<scrip>.depth (as documented) or market_depth.depth. */
export function depthLevels(quote, scripCode) {
  const md = quote?.market_depth;
  if (!md || typeof md !== "object") return [];
  const node = md[scripCode] && typeof md[scripCode] === "object" ? md[scripCode] : md;
  return Array.isArray(node.depth) ? node.depth : [];
}

function bestBidAsk(quote, scripCode) {
  const top = depthLevels(quote, scripCode)[0];
  return { bid: clean(top?.buy?.price), ask: clean(top?.sell?.price) };
}

/** Batched full quotes; a batch the API rejects is retried code by code so one bad strike does not blank the chain. */
async function fullQuotes(creds, codes) {
  const map = new Map();
  for (const chunk of chunkArray([...new Set(codes)], QUOTE_BATCH)) {
    let data;
    try {
      data = (await indRequest(creds, "/market/quotes/full", { params: { "scrip-codes": chunk.join(",") } }))?.data ?? {};
    } catch (e) {
      if (e?.statusCode === 422 || chunk.length === 1) throw e;
      data = {};
      for (const code of chunk) {
        try {
          Object.assign(data, (await indRequest(creds, "/market/quotes/full", { params: { "scrip-codes": code } }))?.data ?? {});
        } catch (inner) {
          if (inner?.statusCode === 422) throw inner;
        }
      }
    }
    for (const [code, q] of Object.entries(data)) if (q) map.set(code, q);
  }
  return map;
}

export async function fetchExpiryList(creds, symbol) {
  sessionToken(creds);
  const fno = await getFno(creds);
  return { status: "success", data: listExpiries(fno, symbol) };
}

async function spotFor(creds, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  const indices = await getIndices(creds);
  const row = spotRow(indices, INDEX_NAME[u] ? null : await getEquity(creds), u);
  if (!row) throw new BrokerInputError(`IndMoney: no index or NSE stock named ${symbol}`);
  return row;
}

export async function fetchLTP(creds, symbol) {
  sessionToken(creds);
  const row = await spotFor(creds, symbol);
  const json = await indRequest(creds, "/market/quotes/ltp", { params: { "scrip-codes": row.scripCode } });
  return { status: "success", data: { last_price: clean(json?.data?.[row.scripCode]?.live_price) } };
}

/** Pure: master option rows + quote map -> contract chain (IV/Greeks back-solved). */
export function buildChain(rows, quotes, spot, expiry, now = new Date()) {
  const days = daysBetween(now, expiry);
  const oc = {};
  for (const r of rows) {
    const q = quotes.get(r.scripCode);
    if (!q) continue;
    const ltp = clean(q.live_price);
    const { bid, ask } = bestBidAsk(q, r.scripCode);
    const greeks = computeIVAndGreeks({ ltp, spot, strike: r.strike, daysToExpiry: days, type: r.optionType });
    const key = String(r.strike);
    oc[key] = oc[key] || {};
    oc[key][r.optionType.toLowerCase()] = {
      last_price: ltp, oi: clean(q.oi ?? q.open_interest), volume: clean(q.volume), bid_price: bid, ask_price: ask,
      iv: greeks.iv, delta: greeks.delta, gamma: greeks.gamma, theta: greeks.theta, vega: greeks.vega, security_id: r.token,
    };
  }
  return oc;
}

export async function fetchOptionChain(creds, symbol, expiry) {
  sessionToken(creds);
  const fno = await getFno(creds);
  const expiries = listExpiries(fno, symbol);
  if (!expiries.length) throw new BrokerInputError(`IndMoney: no options listed for ${symbol}`);
  const target = expiry || expiries[0];
  const rows = optionRows(fno, symbol).filter((r) => r.expiry === target);
  const spot = await spotFor(creds, symbol);
  const quotes = await fullQuotes(creds, [spot.scripCode, ...rows.map((r) => r.scripCode)]);
  const lastPrice = clean(quotes.get(spot.scripCode)?.live_price);
  return { status: "success", data: { oc: buildChain(rows, quotes, lastPrice, target), last_price: lastPrice } };
}

export function mapQuote(ref, q, code) {
  const { bid, ask } = bestBidAsk(q, code);
  return {
    token: String(ref.token), exchange: ref.exchange, ltp: clean(q?.live_price),
    open: cleanOrNull(q?.day_open), high: cleanOrNull(q?.day_high), low: cleanOrNull(q?.day_low), close: cleanOrNull(q?.prev_close),
    volume: cleanOrNull(q?.volume), oi: cleanOrNull(q?.oi ?? q?.open_interest), bid: q?.market_depth ? bid : null, ask: q?.market_depth ? ask : null,
  };
}

export async function fetchQuotes(creds, refs = []) {
  sessionToken(creds);
  if (!Array.isArray(refs) || !refs.length) return { status: "success", data: [] };
  const indices = await getIndices(creds);
  const codes = refs.map((r) => {
    const code = scripCodeOf(r, indices);
    if (!code) throw new BrokerInputError(`IndMoney: unsupported instrument ${r?.exchange}:${r?.token}`);
    return code;
  });
  const quotes = await fullQuotes(creds, codes);
  const data = refs.map((r, i) => (quotes.has(codes[i]) ? mapQuote(r, quotes.get(codes[i]), codes[i]) : null)).filter(Boolean);
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  sessionToken(creds);
  const code = scripCodeOf(ref, await getIndices(creds));
  if (!code) throw new BrokerInputError(`IndMoney: unsupported instrument ${ref?.exchange}:${ref?.token}`);
  const json = await indRequest(creds, "/market/quotes/mkt", { params: { "scrip-codes": code } });
  const levels = depthLevels(json?.data?.[code], code);
  const side = (k) => levels.map((l) => ({ price: clean(l?.[k]?.price), qty: clean(l?.[k]?.quantity), orders: null })).filter((l) => l.price > 0 || l.qty > 0);
  return { status: "success", data: { bids: side("buy"), asks: side("sell") } };
}

/** "YYYY-MM-DD" as an IST calendar day -> epoch ms of its IST midnight. */
export function istMidnightMs(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day ?? ""));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - IST_OFFSET_MS;
}

export function mapCandles(json, code) {
  const node = json?.data?.[code] ?? Object.values(json?.data ?? {})[0];
  const rows = (node?.candles ?? []).map((c) => ({
    time: Math.floor(Number(c.ts) > 1e11 ? Number(c.ts) / 1000 : Number(c.ts)),
    open: clean(c.o), high: clean(c.h), low: clean(c.l), close: clean(c.c), volume: clean(c.v),
  })).filter((c) => Number.isInteger(c.time) && c.time > 0);
  rows.sort((a, b) => a.time - b.time);
  return rows.filter((c, i) => i === 0 || c.time > rows[i - 1].time);
}

export async function fetchHistorical(creds, { instrument, interval = "1d", from, to } = {}) {
  sessionToken(creds);
  const iv = INTERVAL[interval];
  if (!iv) throw new BrokerInputError(`IndMoney historical: unsupported interval ${interval}`);
  const start = istMidnightMs(from);
  const end = istMidnightMs(to) + 24 * 3600_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new BrokerInputError("IndMoney historical: from/to must be YYYY-MM-DD");
  const code = scripCodeOf(instrument, await getIndices(creds));
  if (!code) throw new BrokerInputError(`IndMoney: unsupported instrument ${instrument?.exchange}:${instrument?.token}`);
  const json = await indRequest(creds, `/market/historical/${iv}`, { params: { "scrip-codes": code, start_time: start, end_time: end } });
  return { status: "success", data: mapCandles(json, code) };
}
