/**
 * Definedge Securities (Integrate API) market data: quotes, depth, OI backfill, historical candles and the
 * option chain built from them.
 *
 * Official sources (checked 2026-10): pyintegrate 3.0.0 (Definedge, MIT) integrate/data.py and
 * tests/mock_responses/quotes.json + historical.csv.
 *  - GET https://integrate.definedgesecurities.com/dart/v1/quotes/{exchange}/{token}
 *    -> { status: "SUCCESS", ltp, day_open, day_high, day_low, volume, best_bid_price1..5, best_ask_price1..5,
 *    best_bid_qty1..5, best_ask_qty1..5, best_bid_orders1..5, best_ask_orders1..5, lotsize, ticksize, ... }
 *    Prices are rupee strings. One instrument per call (no bulk quote), and the payload has no open interest
 *    and no previous close.
 *  - GET https://data.definedgesecurities.com/sds/history/{exchange}/{token}/{minute|day|tick}/{DDMMYYYYHHMM}/{DDMMYYYYHHMM}
 *    -> text/csv rows "DDMMYYYYHHMM,open,high,low,close,volume[,oi]" (IST wall clock).
 *  - Rate limits are not published. Calls are paced at 10 a second per host,
 *    with 429 backoff in definedgeFetch.
 * OI for the chain comes from the last 1-minute candle's OI column; IV and Greeks from this app's
 * Black-Scholes (Definedge publishes no Greeks over REST).
 */

import { BrokerError, BrokerInputError, SessionRequiredError } from "./contract.mjs";
import { DATA_BASE, definedgeFetch, getSession } from "./definedgeAuth.mjs";
import { distinctExpiriesAscending, getOptionRows, spotRef } from "./definedgeInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;
const STRIKE_HALF_WIDTH = 20; // ~41 strikes / 82 legs: every leg is its own quote call
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "CDS", "MCX"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function checkRef(ref, what) {
  if (!ref || !/^\d{1,12}$/.test(String(ref.token ?? "")) || !EXCHANGES.has(ref.exchange)) throw new BrokerInputError(`Definedge ${what} needs { token, exchange }`);
}

/** Run `fn` over items, BATCH_SIZE at a time in parallel with BATCH_DELAY_MS between batches. A session error stops everything. */
async function paced(items, fn) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(BATCH_DELAY_MS);
    const chunk = items.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(chunk.map((it) => fn(it)));
    settled.forEach((s, j) => {
      if (s.status === "rejected" && s.reason instanceof SessionRequiredError) throw s.reason;
      out[i + j] = s.status === "fulfilled" ? s.value : undefined;
    });
  }
  return out;
}

/** GET /quotes/{exchange}/{token}. */
export async function fetchQuoteRaw(creds, exchange, token) {
  return definedgeFetch(creds, `/quotes/${exchange}/${token}`, { what: "quote" });
}

/** GET /limits (cheap authenticated ping and the funds call). */
export async function getLimits(creds) {
  return definedgeFetch(creds, "/limits", { what: "limits" });
}

// ── dates ──

const pad2 = (n) => String(n).padStart(2, "0");
/** epoch ms -> "DDMMYYYYHHMM" in IST. */
export function toDefinedgeDateTime(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${pad2(d.getUTCDate())}${pad2(d.getUTCMonth() + 1)}${d.getUTCFullYear()}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
}
/** "DDMMYYYYHHMM" (IST) -> epoch seconds. */
export function parseDefinedgeDateTime(s) {
  const m = /^(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return NaN;
  return Math.floor((Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) - IST_OFFSET_MS) / 1000);
}
function rangeMs(v, endOfDay) {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T${endOfDay ? "15:30" : "09:15"}:00+05:30`);
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : NaN;
}

/** CSV history -> candles (ascending, de-duplicated). */
export function parseHistoryCsv(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const f = line.trim().split(",");
    if (f.length < 6) continue;
    const time = parseDefinedgeDateTime(f[0]);
    if (!Number.isFinite(time) || seen.has(time)) continue;
    seen.add(time);
    const c = { time, open: num(f[1]), high: num(f[2]), low: num(f[3]), close: num(f[4]), volume: num(f[5]) };
    if (f.length >= 7) c.oi = num(f[6]);
    out.push(c);
  }
  return out.sort((a, b) => a.time - b.time);
}

// ── capabilities ──

const toQuote = (ref, q) => ({
  token: String(ref.token),
  exchange: ref.exchange,
  ltp: num(q.ltp),
  open: numOrNull(q.day_open),
  high: numOrNull(q.day_high),
  low: numOrNull(q.day_low),
  close: null, // not in the quote payload
  volume: numOrNull(q.volume),
  oi: null, // not in the quote payload
  bid: numOrNull(q.best_bid_price1),
  ask: numOrNull(q.best_ask_price1),
});

export async function fetchQuotes(creds, refs = []) {
  const list = Array.isArray(refs) ? refs : [];
  list.forEach((r) => checkRef(r, "quotes"));
  const raw = await paced(list, (r) => fetchQuoteRaw(creds, r.exchange, String(r.token)));
  const data = [];
  list.forEach((ref, i) => { if (raw[i]) data.push(toQuote(ref, raw[i])); });
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  checkRef(ref, "depth");
  const q = await fetchQuoteRaw(creds, ref.exchange, String(ref.token));
  const side = (s) => [1, 2, 3, 4, 5]
    .filter((i) => q[`best_${s}_price${i}`] !== undefined)
    .map((i) => ({ price: num(q[`best_${s}_price${i}`]), qty: num(q[`best_${s}_qty${i}`]), orders: numOrNull(q[`best_${s}_orders${i}`]) }));
  return { status: "success", data: { bids: side("bid"), asks: side("ask") } };
}

const INTERVALS = { "1m": "minute", "1d": "day" };

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const tf = INTERVALS[interval];
  if (!tf) throw new BrokerInputError(`Definedge history supports 1m and 1d only (got ${interval})`);
  checkRef(instrument, "history");
  const fromMs = rangeMs(from, false);
  const toMs = rangeMs(to, true);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) throw new BrokerInputError("Definedge history needs a valid from/to range");
  const path = `/history/${instrument.exchange}/${String(instrument.token)}/${tf}/${toDefinedgeDateTime(fromMs)}/${toDefinedgeDateTime(toMs)}`;
  const text = await definedgeFetch(creds, path, { base: DATA_BASE, text: true, what: "history" });
  return { status: "success", data: parseHistoryCsv(text) };
}

/** Latest OI from the last 1-minute candle over the past 4 days (survives weekends). 0 when unavailable. */
async function fetchLatestOI(creds, exchange, token) {
  const now = Date.now();
  const path = `/history/${exchange}/${token}/minute/${toDefinedgeDateTime(now - 4 * 86_400_000)}/${toDefinedgeDateTime(now)}`;
  const candles = parseHistoryCsv(await definedgeFetch(creds, path, { base: DATA_BASE, text: true, what: "OI history" }));
  return candles.length ? num(candles[candles.length - 1].oi) : 0;
}

export async function fetchLTP(creds, symbol) {
  getSession(creds); // not logged in -> 422 before any master download
  const ref = await spotRef(symbol);
  if (!ref) throw new BrokerInputError(`Definedge: no spot instrument for ${symbol}`);
  const q = await fetchQuoteRaw(creds, ref.exchange, ref.token);
  const last = num(q?.ltp);
  if (!(last > 0)) throw new BrokerError(`Definedge returned no LTP for ${symbol}`);
  return { status: "success", data: { last_price: last } };
}

export async function fetchExpiryList(creds, symbol) {
  getSession(creds);
  return { status: "success", data: distinctExpiriesAscending(await getOptionRows(symbol)) };
}

function strikeWindow(rows, spot) {
  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
  if (!strikes.length) return [];
  let atm = 0;
  strikes.forEach((s, i) => { if (Math.abs(s - spot) < Math.abs(strikes[atm] - spot)) atm = i; });
  const keep = new Set(strikes.slice(Math.max(0, atm - STRIKE_HALF_WIDTH), atm + STRIKE_HALF_WIDTH + 1));
  return rows.filter((r) => keep.has(r.strike));
}

export async function fetchOptionChain(creds, symbol, expiry) {
  getSession(creds);
  const all = await getOptionRows(symbol);
  const expiryIso = expiry || distinctExpiriesAscending(all)[0];
  const rows = all.filter((r) => r.expiry === expiryIso);
  if (!rows.length) return { status: "success", data: { oc: {}, last_price: 0 } };
  const spot = (await fetchLTP(creds, symbol)).data.last_price;
  const legs = strikeWindow(rows, spot);
  // Quotes (integrate host) and OI backfill (data host) are separate hosts: run both paced pipelines together.
  const [quotes, ois] = await Promise.all([
    paced(legs, (r) => fetchQuoteRaw(creds, r.exchange, r.token)),
    paced(legs, (r) => fetchLatestOI(creds, r.exchange, r.token)),
  ]);
  const daysToExpiry = daysBetween(new Date(), expiryIso);
  const oc = {};
  legs.forEach((r, i) => {
    const q = quotes[i];
    if (!q) return;
    const ltp = num(q.ltp);
    (oc[String(r.strike)] ||= {})[r.optionType.toLowerCase()] = {
      last_price: ltp,
      oi: num(ois[i]),
      volume: num(q.volume),
      ...computeIVAndGreeks({ ltp, spot, strike: r.strike, daysToExpiry, type: r.optionType }),
      bid_price: num(q.best_bid_price1),
      ask_price: num(q.best_ask_price1),
      security_id: r.token,
    };
  });
  return { status: "success", data: { oc, last_price: spot } };
}
