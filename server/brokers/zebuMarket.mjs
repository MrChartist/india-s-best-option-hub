/**
 * Zebu (MYNT) market data: quotes, depth, LTP, option chain and candles.
 *
 * Official docs (https://zebumyntapi.web.app/OAuth/Market%20Quotes/, checked 2026-10):
 *  - GetQuotes { uid, exch, token } -> { stat, exch, tsym, token, lp, o, h, l, c?, v, ap, ls, ti,
 *    bp1..5, sp1..5, bq1..5, sq1..5, bo1..5, so1..5 }. One contract per call (no bulk quote), so the chain
 *    is the symbol master windowed around spot plus batched GetQuotes at the 10 req/s budget. `oi` is not in
 *    the documented field list (the WebSocket touchline has it); it is read when Zebu sends it.
 *    No IV/Greeks are provided, so they are solved locally (Black-Scholes).
 *  - TPSeries { uid, exch, token, st, et (epoch seconds), intrv "1"|"3"|"5"|"10"|"15"|"30"|"60"|"120"|"240" }
 *    -> array of { stat, time "DD-MM-YYYY hh:mm:ss", into, inth, intl, intc, intv, intoi, oi } (newest first).
 *  - EODChartData { sym: "NSE:RELIANCE-EQ", from, to } -> array (of JSON strings in the sample) with
 *    { time, into, inth, intl, intc, ssboe, intv }.
 *  - GetOptionChain returns contract tokens only (no prices), so the master is used instead.
 */

import { BrokerInputError } from "./contract.mjs";
import { ensureSession, postJData, expectOk } from "./zebuAuth.mjs";
import { derivativesFor, getMaster, listExpiries, optionContracts, spotRef, nearestFuture, isIndex } from "./zebuInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

const QUOTE_BATCH_SIZE = 10;
const QUOTE_BATCH_DELAY_MS = 1100; // 10 quotes per ~1.1 s keeps under 10 req/s with other calls in flight
const STRIKE_HALF_WIDTH = 20;
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
const IST_MS = 5.5 * 3600 * 1000;

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function mapQuote(ref, q) {
  return {
    token: String(ref.token),
    exchange: ref.exchange,
    ltp: num(q?.lp),
    open: numOrNull(q?.o),
    high: numOrNull(q?.h),
    low: numOrNull(q?.l),
    close: numOrNull(q?.c),
    volume: numOrNull(q?.v),
    oi: numOrNull(q?.oi),
    bid: numOrNull(q?.bp1),
    ask: numOrNull(q?.sp1),
  };
}

export function mapDepth(q) {
  const side = (p, qk, ok) => [1, 2, 3, 4, 5]
    .map((n) => ({ price: num(q?.[`${p}${n}`]), qty: num(q?.[`${qk}${n}`]), orders: numOrNull(q?.[`${ok}${n}`] ?? (ok === "so" && n === 5 ? q?.So5 : undefined)) }))
    .filter((l) => l.price > 0 || l.qty > 0);
  return { bids: side("bp", "bq", "bo"), asks: side("sp", "sq", "so") };
}

async function getQuote(creds, ref) {
  const json = await postJData(creds, "/GetQuotes", { exch: ref.exchange, token: String(ref.token) }, { actid: false });
  return json?.stat === "Ok" ? json : null;
}

/** Batched GetQuotes (one contract per call) -> Map<"EXCH:token", quote>. A failed contract is skipped. */
export async function quoteMap(creds, refs) {
  const map = new Map();
  let sessionError = null;
  await batchWithDelay(refs, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    if (sessionError) return [];
    const rows = await Promise.all(chunk.map(async (r) => {
      try {
        return [r, await getQuote(creds, r)];
      } catch (e) {
        if (e?.code === "SESSION_LOGIN_REQUIRED") sessionError = e;
        return [r, null];
      }
    }));
    for (const [r, q] of rows) if (q) map.set(`${r.exchange}:${r.token}`, q);
    return [];
  });
  if (sessionError) throw sessionError; // a dead session must surface, not read as an empty chain
  return map;
}

function checkRef(r) {
  const exchange = String(r?.exchange ?? "").toUpperCase();
  const token = String(r?.token ?? "").trim();
  if (!EXCHANGES.has(exchange) || !/^\d{1,12}$/.test(token)) throw new BrokerInputError(`Zebu: bad instrument ${JSON.stringify(r)}`);
  return { exchange, token };
}

export async function fetchQuotes(creds, refs) {
  if (!Array.isArray(refs) || !refs.length) throw new BrokerInputError("Zebu quotes: pass at least one { token, exchange }.");
  const wanted = refs.map(checkRef);
  await ensureSession(creds);
  const map = await quoteMap(creds, wanted);
  return { status: "success", data: wanted.filter((r) => map.has(`${r.exchange}:${r.token}`)).map((r) => mapQuote(r, map.get(`${r.exchange}:${r.token}`))) };
}

export async function fetchDepth(creds, ref) {
  const r = checkRef(ref);
  const q = expectOk(await postJData(creds, "/GetQuotes", { exch: r.exchange, token: r.token }, { actid: false }), "GetQuotes");
  return { status: "success", data: mapDepth(q) };
}

/** Spot price for an index (falling back to the nearest future) or a stock. */
async function spotPrice(creds, symbol) {
  const ref = await spotRef(creds, symbol);
  if (ref) {
    const q = await getQuote(creds, ref);
    if (num(q?.lp) > 0) return num(q.lp);
  }
  if (isIndex(symbol)) {
    const fut = nearestFuture(await derivativesFor(creds, symbol), symbol);
    if (fut) {
      const q = await getQuote(creds, fut);
      if (num(q?.lp) > 0) return num(q.lp);
    }
  }
  return 0;
}

export async function fetchLTP(creds, symbol) {
  const lp = await spotPrice(creds, symbol);
  if (!(lp > 0)) throw new Error(`Zebu returned no last price for ${symbol}`);
  return { status: "success", data: { last_price: lp } };
}

export async function fetchExpiryList(creds, symbol) {
  return { status: "success", data: listExpiries(await derivativesFor(creds, symbol), symbol) };
}

export function selectStrikeWindow(contracts, spot, halfWidth = STRIKE_HALF_WIDTH) {
  const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);
  if (!strikes.length) return [];
  let atm = 0;
  strikes.forEach((s, i) => { if (Math.abs(s - spot) < Math.abs(strikes[atm] - spot)) atm = i; });
  const keep = new Set(strikes.slice(Math.max(0, atm - halfWidth), atm + halfWidth + 1));
  return contracts.filter((c) => keep.has(c.strike));
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const instruments = await derivativesFor(creds, symbol);
  const expiryIso = expiry || listExpiries(instruments, symbol)[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };
  const contracts = optionContracts(instruments, symbol, expiryIso);
  if (!contracts.length) return { status: "success", data: { oc: {}, last_price: 0 } };
  const spot = await spotPrice(creds, symbol);
  const legs = spot > 0 ? selectStrikeWindow(contracts, spot) : contracts.slice(0, STRIKE_HALF_WIDTH * 4);
  const quotes = await quoteMap(creds, legs);
  const daysToExpiry = daysBetween(new Date(), expiryIso);
  const oc = {};
  for (const c of legs) {
    const q = quotes.get(`${c.exchange}:${c.token}`);
    if (!q) continue;
    const quote = mapQuote(c, q);
    const greeks = computeIVAndGreeks({ ltp: quote.ltp, spot, strike: c.strike, daysToExpiry, type: c.optionType });
    const leg = {
      last_price: quote.ltp,
      oi: quote.oi ?? 0,
      volume: quote.volume ?? 0,
      bid_price: quote.bid ?? 0,
      ask_price: quote.ask ?? 0,
      security_id: c.token,
      ...greeks,
    };
    // GetQuotes "poi" is the previous day's OI; with it the app can show OI change (as on the other Noren brokers).
    const prevOi = numOrNull(q.poi);
    if (prevOi !== null) leg.previous_oi = prevOi;
    (oc[String(c.strike)] ||= {})[c.optionType === "CE" ? "ce" : "pe"] = leg;
  }
  return { status: "success", data: { oc, last_price: spot } };
}

// ── candles ──

const INTRADAY = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "60m": "60" };
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** "2026-10-16" | "2026-10-16T11:05" (IST wall time) -> epoch seconds. */
export function istEpoch(value, fallbackTime) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(value ?? "").trim());
  if (!m) throw new BrokerInputError(`Zebu historical: bad date ${value}`);
  const [hh, mm] = m[4] ? [m[4], m[5]] : fallbackTime.split(":");
  return Math.floor((Date.UTC(+m[1], +m[2] - 1, +m[3], +hh, +mm) - IST_MS) / 1000);
}

/** Noren candle time "16-10-2026 09:15:00" or "21-SEP-2022" (IST) -> epoch seconds. */
export function norenTime(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  let m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return Math.floor((Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) - IST_MS) / 1000);
  m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(s);
  if (m && MONTHS[m[2]] !== undefined) return Math.floor((Date.UTC(+m[3], MONTHS[m[2]], +m[1]) - IST_MS) / 1000);
  return null;
}

function candleOf(row) {
  const r = typeof row === "string" ? (() => { try { return JSON.parse(row); } catch { return null; } })() : row;
  if (!r || r.stat === "Not_Ok") return null;
  const time = num(r.ssboe) > 1e9 ? Math.floor(num(r.ssboe)) : norenTime(r.time);
  if (!time) return null;
  const c = { time, open: num(r.into), high: num(r.inth), low: num(r.intl), close: num(r.intc), volume: num(r.intv) };
  if (r.oi !== undefined) c.oi = num(r.oi);
  return c;
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const ref = checkRef(instrument);
  let json;
  if (INTRADAY[interval]) {
    json = await postJData(creds, "/TPSeries", { exch: ref.exchange, token: ref.token, st: String(istEpoch(from, "09:15")), et: String(istEpoch(to, "15:30")), intrv: INTRADAY[interval] }, { actid: false });
  } else if (interval === "1d") {
    const master = ["NSE", "NFO", "BFO"].includes(ref.exchange) ? await getMaster(creds, ref.exchange) : [];
    const inst = master.find((i) => i.token === ref.token);
    if (!inst) throw new BrokerInputError(`Zebu daily candles need a symbol from the ${ref.exchange} master (token ${ref.token} not found)`);
    json = await postJData(creds, "/EODChartData", { sym: `${ref.exchange}:${inst.tradingSymbol}`, from: String(istEpoch(from, "00:00")), to: String(istEpoch(to, "23:59")) }, { actid: false });
  } else {
    throw new BrokerInputError(`Zebu historical: unsupported interval ${interval}`);
  }
  if (!Array.isArray(json)) {
    if (json?.stat === "Not_Ok" && /no data/i.test(String(json.emsg))) return { status: "success", data: [] };
    expectOk(json, interval === "1d" ? "EODChartData" : "TPSeries");
    return { status: "success", data: [] };
  }
  const byTime = new Map();
  for (const row of json) {
    const c = candleOf(row);
    if (c) byTime.set(c.time, c);
  }
  return { status: "success", data: [...byTime.values()].sort((a, b) => a.time - b.time) };
}
