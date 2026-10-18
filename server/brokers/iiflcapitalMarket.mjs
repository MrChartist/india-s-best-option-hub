/**
 * IIFL Capital market data. Official docs: https://developers.iiflcapital.com/apidocs/marketdataapis (checked
 * 2026-10):
 *  - POST /marketdata/marketquotes [{ exchange, instrumentId }, ...] (Single/Bulk) -> { status: "Ok", result: [
 *    { exchange, instrumentId (number), ltp, lastTradedQuantity, averageTradedPrice, tradedVolume, open, high,
 *    low, close (previous session), bestBidPrice, bestBidQuantity, bestAskPrice, bestAskQuantity,
 *    totalBidQuantity, totalAskQuantity, tickTimestamp } ] }. (One doc sample spells "besAskPrice"; both read.)
 *  - POST /marketdata/marketdepth { exchange, instrumentId } -> result { marketDepth: { bids: [ { price,
 *    quantity, orders } ], asks: [...] } }.
 *  - POST /marketdata/openinterest { exchange, instrumentId } (Single only) -> { openInterest, dayHighOi,
 *    dayLowOi } (the sample has no envelope; a `result` wrapper is accepted too).
 *  - POST /marketdata/historicaldata { exchange, instrumentId, interval ("1 minute", "5 minutes", "10 minutes",
 *    "15 minutes", "30 minutes", "60 minutes", "1 day"), fromDate / toDate ("19-Sep-2024") } -> candles with
 *    initialTimestamp ("19-Sep-2024 09:17:00"), open, high, low, close, volume. The docs give the fields but no
 *    full sample, so object rows and [ts, o, h, l, c, v] arrays are both read.
 * No option-chain endpoint and no IV/Greeks: the chain is the contract file + bulk quotes, with OI fetched one
 * leg at a time for the strikes nearest the spot only (OI is single-instrument at 10/s; a full NIFTY expiry
 * would take ~40 s), and IV/Greeks back-solved (Black-Scholes).
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { chunkArray } from "../lib/batch.mjs";
import { BrokerInputError } from "./contract.mjs";
import { iiflRequest, rowsOf } from "./iiflcapitalAuth.mjs";
import { fnoFor, iiflInstrument, listExpiries, optionRows, spotInstrument } from "./iiflcapitalInstruments.mjs";

const QUOTE_BATCH = 50;
export const OI_STRIKES_EACH_SIDE = 12;
const INTERVAL = { "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "30m": "30 minutes", "60m": "60 minutes", "1d": "1 day" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const nOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const keyOf = (exchange, id) => `${String(exchange).toUpperCase()}:${String(id)}`;

async function quoteMap(creds, instruments) {
  const map = new Map();
  for (const chunk of chunkArray(instruments, QUOTE_BATCH)) {
    const json = await iiflRequest(creds, "/marketdata/marketquotes", { method: "POST", body: chunk });
    for (const row of rowsOf(json)) {
      if (row?.exchange != null && row?.instrumentId != null) map.set(keyOf(row.exchange, row.instrumentId), row);
    }
  }
  return map;
}

async function openInterest(creds, inst) {
  try {
    const json = await iiflRequest(creds, "/marketdata/openinterest", { method: "POST", body: inst });
    const r = json?.result && !Array.isArray(json.result) ? json.result : Array.isArray(json?.result) ? json.result[0] : json;
    return n(r?.openInterest);
  } catch (e) {
    if (e?.code === "UPSTREAM_AUTH") throw e;
    return 0; // one leg's OI failing should not blank the chain
  }
}

export async function fetchExpiryList(creds, symbol) {
  const fno = await fnoFor(symbol);
  return { status: "success", data: listExpiries(fno, symbol) };
}

export async function fetchLTP(creds, symbol) {
  const spot = await spotInstrument(symbol);
  if (!spot) throw new BrokerInputError(`IIFL Capital: no index or NSE stock named ${symbol}`);
  const quotes = await quoteMap(creds, [spot]);
  return { status: "success", data: { last_price: n(quotes.get(keyOf(spot.exchange, spot.instrumentId))?.ltp) } };
}

/** Strikes whose OI is fetched: the `each` strikes either side of the spot. */
export function oiStrikes(strikes, spot, each = OI_STRIKES_EACH_SIDE) {
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  if (!sorted.length) return new Set();
  let atm = 0;
  for (let i = 1; i < sorted.length; i++) if (Math.abs(sorted[i] - spot) < Math.abs(sorted[atm] - spot)) atm = i;
  return new Set(sorted.slice(Math.max(0, atm - each), atm + each + 1));
}

export function buildLeg(q, oi, ctx) {
  const ltp = n(q?.ltp);
  const g = computeIVAndGreeks({ ltp, spot: ctx.spot, strike: ctx.strike, daysToExpiry: ctx.days, type: ctx.type });
  return {
    last_price: ltp, oi, volume: n(q?.tradedVolume), bid_price: n(q?.bestBidPrice), ask_price: n(q?.bestAskPrice ?? q?.besAskPrice),
    iv: g.iv, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega, security_id: ctx.token,
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const fno = await fnoFor(symbol);
  const expiries = listExpiries(fno, symbol);
  if (!expiries.length) throw new BrokerInputError(`IIFL Capital: no options listed for ${symbol}`);
  const target = expiry || expiries[0];
  const rows = optionRows(fno, symbol).filter((r) => r.expiry === target);
  const spotInst = await spotInstrument(symbol);
  const legs = rows.map((r) => ({ exchange: r.iiflExchange, instrumentId: r.token }));
  const quotes = await quoteMap(creds, spotInst ? [spotInst, ...legs] : legs);
  const spot = spotInst ? n(quotes.get(keyOf(spotInst.exchange, spotInst.instrumentId))?.ltp) : 0;
  const near = oiStrikes(rows.map((r) => r.strike), spot);
  const oi = new Map();
  for (const r of rows) {
    if (near.has(r.strike) && quotes.has(keyOf(r.iiflExchange, r.token))) oi.set(r.token, await openInterest(creds, { exchange: r.iiflExchange, instrumentId: r.token }));
  }
  const days = daysBetween(new Date(), target);
  const oc = {};
  for (const r of rows) {
    const q = quotes.get(keyOf(r.iiflExchange, r.token));
    if (!q) continue;
    const key = String(r.strike);
    oc[key] = oc[key] || {};
    oc[key][r.optionType.toLowerCase()] = buildLeg(q, oi.get(r.token) ?? 0, { spot, strike: r.strike, days, type: r.optionType, token: r.token });
  }
  return { status: "success", data: { oc, last_price: spot } };
}

export function mapQuote(ref, q) {
  return {
    token: String(ref.token), exchange: ref.exchange, ltp: n(q?.ltp), open: nOrNull(q?.open), high: nOrNull(q?.high), low: nOrNull(q?.low),
    close: nOrNull(q?.close), volume: nOrNull(q?.tradedVolume), oi: null, bid: nOrNull(q?.bestBidPrice), ask: nOrNull(q?.bestAskPrice ?? q?.besAskPrice),
  };
}

export async function fetchQuotes(creds, refs = []) {
  if (!Array.isArray(refs) || !refs.length) return { status: "success", data: [] };
  const insts = refs.map((r) => {
    const i = iiflInstrument(r);
    if (!i) throw new BrokerInputError(`IIFL Capital: unsupported instrument ${r?.exchange}:${r?.token}`);
    return i;
  });
  const quotes = await quoteMap(creds, insts);
  const data = refs.map((r, i) => quotes.get(keyOf(insts[i].exchange, insts[i].instrumentId)) && mapQuote(r, quotes.get(keyOf(insts[i].exchange, insts[i].instrumentId)))).filter(Boolean);
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  const inst = iiflInstrument(ref);
  if (!inst) throw new BrokerInputError(`IIFL Capital: unsupported instrument ${ref?.exchange}:${ref?.token}`);
  const json = await iiflRequest(creds, "/marketdata/marketdepth", { method: "POST", body: inst });
  const r = rowsOf(json)[0] ?? {};
  const md = r.marketDepth ?? r.depth ?? {};
  const side = (list) => (Array.isArray(list) ? list : []).map((l) => ({ price: n(l?.price), qty: n(l?.quantity), orders: nOrNull(l?.orders) })).filter((l) => l.price > 0 || l.qty > 0);
  return { status: "success", data: { bids: side(md.bids ?? md.buy), asks: side(md.asks ?? md.sell) } };
}

/** "YYYY-MM-DD" -> "19-Sep-2024". */
export function iiflDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  return `${m[3]}-${MON[Number(m[2]) - 1]}-${m[1]}`;
}

/** "19-Sep-2024 09:17:00" (IST), ISO strings, or epoch s/ms -> epoch seconds. */
export function candleTime(v) {
  if (typeof v === "number") return v > 1e11 ? Math.floor(v / 1000) : Math.floor(v);
  const s = String(v ?? "").trim();
  const a = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (a && MONTHS[a[2].toUpperCase()] !== undefined) {
    return Math.floor(Date.UTC(+a[3], MONTHS[a[2].toUpperCase()], +a[1], +(a[4] ?? 0), +(a[5] ?? 0), +(a[6] ?? 0)) / 1000) - 19800;
  }
  const b = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (b) return Math.floor(Date.UTC(+b[1], +b[2] - 1, +b[3], +b[4], +b[5], +(b[6] ?? 0)) / 1000) - 19800;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : NaN;
}

export function mapCandles(json) {
  let rows = rowsOf(json);
  if (rows.length === 1 && Array.isArray(rows[0]?.candles)) rows = rows[0].candles;
  const out = rows.map((c) => (Array.isArray(c)
    ? { time: candleTime(c[0]), open: n(c[1]), high: n(c[2]), low: n(c[3]), close: n(c[4]), volume: n(c[5]) }
    : { time: candleTime(c?.initialTimestamp ?? c?.timestamp ?? c?.time), open: n(c?.open), high: n(c?.high), low: n(c?.low), close: n(c?.close), volume: n(c?.volume) }))
    .filter((c) => Number.isInteger(c.time) && c.time > 0);
  out.sort((a, b) => a.time - b.time);
  return out.filter((c, i) => i === 0 || c.time > out[i - 1].time);
}

export async function fetchHistorical(creds, { instrument, interval = "1d", from, to } = {}) {
  const iv = INTERVAL[interval];
  if (!iv) throw new BrokerInputError(`IIFL Capital historical: unsupported interval ${interval} (1m, 5m, 15m, 30m, 60m, 1d)`);
  const inst = iiflInstrument(instrument);
  const fromDate = iiflDate(from);
  const toDate = iiflDate(to);
  if (!inst || !fromDate || !toDate) throw new BrokerInputError("IIFL Capital historical: needs a known instrument and from/to as YYYY-MM-DD");
  const json = await iiflRequest(creds, "/marketdata/historicaldata", { method: "POST", body: { ...inst, interval: iv, fromDate, toDate } });
  return { status: "success", data: mapCandles(json) };
}
