/**
 * Zerodha (Kite Connect v3) quotes, depth, candles and read-only portfolio, normalised to the
 * contract shapes. Re-exported from zerodha.mjs.
 *
 * Official sources (October 2026):
 *  - market-quotes/: GET /quote (full snapshot incl. 5-level depth, up to 500 instruments), keyed by
 *    "EXCHANGE:TRADINGSYMBOL"; absent keys mean no data. Quote endpoints: 1 request per second.
 *  - historical/: GET /instruments/historical/:instrument_token/:interval?from&to&oi=1, intervals
 *    minute, 3minute, 5minute, 10minute, 15minute, 30minute, 60minute, day; candles
 *    [timestamp "yyyy-mm-ddThh:mm:ss+0530", open, high, low, close, volume, (oi)].
 *  - portfolio/: GET /portfolio/positions ({ net, day }) and GET /portfolio/holdings.
 *  - user/: GET /user/margins ({ equity, commodity }: net, available.{cash, opening_balance,
 *    live_balance, collateral, intraday_payin}, utilised.{debits, ...}).
 */

import { BrokerInputError } from "./contract.mjs";
import { sleep } from "../lib/batch.mjs";
import { kiteFetch } from "./zerodhaClient.mjs";
import { quoteKeysFor } from "./zerodhaInstruments.mjs";

const QUOTE_BATCH = 500;
const QUOTE_GAP_MS = 1000;
const EXCHANGE = { NSE: "NSE", BSE: "BSE", NFO: "NFO", BFO: "BFO", MCX: "MCX", CDS: "CDS", BCD: "CDS" };
/** Kite product -> contract product (glossary: CNC, NRML, MIS, MTF; CO/BO appear on older orders). */
export const PRODUCT_OF = { CNC: "CNC", MIS: "INTRADAY", NRML: "MARGIN", MTF: "MTF", CO: "CO", BO: "BO" };

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v) => (Number(v) > 0 ? Number(v) : null);
export const kiteExchange = (e) => EXCHANGE[e] ?? "NSE";
export const kiteProduct = (p) => PRODUCT_OF[p] ?? "INTRADAY";

/** Raw /quote for already-built "EX:SYM" keys, batched (500 per call, one call per second). */
export async function quoteByKeys(creds, keys) {
  const out = {};
  for (let i = 0; i < keys.length; i += QUOTE_BATCH) {
    if (i > 0) await sleep(QUOTE_GAP_MS);
    const data = await kiteFetch("/quote", creds, { query: keys.slice(i, i + QUOTE_BATCH).map((k) => ["i", k]) });
    Object.assign(out, data || {});
  }
  return out;
}

function toQuote(ref, q) {
  return {
    token: String(ref.token),
    exchange: ref.exchange,
    ltp: n(q.last_price),
    open: numOrNull(q.ohlc?.open),
    high: numOrNull(q.ohlc?.high),
    low: numOrNull(q.ohlc?.low),
    close: numOrNull(q.ohlc?.close),
    volume: numOrNull(q.volume),
    oi: numOrNull(q.oi),
    bid: positive(q.depth?.buy?.[0]?.price),
    ask: positive(q.depth?.sell?.[0]?.price),
  };
}

/** Quote[] for refs ({ token: instrument_token or "EX:SYM", exchange }). Instruments without data are skipped. */
export async function fetchQuotes(creds, refs = []) {
  if (!Array.isArray(refs) || refs.length === 0) return { status: "success", data: [] };
  const keyed = await quoteKeysFor(creds, refs);
  const raw = await quoteByKeys(creds, [...keyed.keys()]);
  const data = [];
  for (const [key, ref] of keyed) if (raw[key]) data.push(toQuote(ref, raw[key]));
  return { status: "success", data };
}

const level = (l) => ({ price: n(l?.price), qty: n(l?.quantity), orders: numOrNull(l?.orders) });

export async function fetchDepth(creds, ref) {
  const keyed = await quoteKeysFor(creds, [ref]);
  const [key] = keyed.keys();
  if (!key) throw new BrokerInputError(`Zerodha: ${ref?.exchange}:${ref?.token} is not in today's instrument dump.`);
  const q = (await quoteByKeys(creds, [key]))[key];
  return { status: "success", data: { bids: (q?.depth?.buy ?? []).map(level), asks: (q?.depth?.sell ?? []).map(level) } };
}

// ── historical ──

const INTERVAL = { "1m": "minute", "3m": "3minute", "5m": "5minute", "15m": "15minute", "30m": "30minute", "60m": "60minute", "1d": "day" };

function kiteWhen(v, endOfDay, label) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?)?/.exec(String(v ?? "").trim());
  if (!m) throw new BrokerInputError(`Zerodha historical: ${label} must be YYYY-MM-DD or YYYY-MM-DD HH:MM`);
  return `${m[1]} ${m[2] ? `${m[2]}:${m[3] ?? "00"}` : endOfDay ? "23:59:59" : "00:00:00"}`;
}

/** "2017-12-15T09:15:00+0530" -> epoch seconds (the offset is written without a colon). */
export function kiteTimeToEpoch(ts) {
  const s = String(ts).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const kiteInterval = INTERVAL[interval];
  if (!kiteInterval) throw new BrokerInputError(`Zerodha historical: unsupported interval ${interval}.`);
  const token = String(instrument?.token ?? "");
  if (!/^\d+$/.test(token)) throw new BrokerInputError("Zerodha historical needs the numeric instrument_token.");
  const data = await kiteFetch(`/instruments/historical/${token}/${kiteInterval}`, creds, {
    query: [["from", kiteWhen(from, false, "from")], ["to", kiteWhen(to, true, "to")], ["oi", "1"]],
  });
  const byTime = new Map();
  for (const c of data?.candles ?? []) {
    const time = kiteTimeToEpoch(c[0]);
    if (!Number.isFinite(time)) continue;
    const candle = { time, open: n(c[1]), high: n(c[2]), low: n(c[3]), close: n(c[4]), volume: n(c[5]) };
    if (c.length > 6 && Number.isFinite(Number(c[6]))) candle.oi = Number(c[6]);
    byTime.set(time, candle);
  }
  return { status: "success", data: [...byTime.values()].sort((a, b) => a.time - b.time) };
}

// ── portfolio (read-only) ──

export function mapKitePosition(p) {
  return {
    tradingSymbol: String(p.tradingsymbol ?? ""),
    exchange: kiteExchange(p.exchange),
    token: String(p.instrument_token ?? ""),
    product: kiteProduct(p.product),
    netQty: n(p.quantity),
    avgPrice: n(p.average_price),
    ltp: numOrNull(p.last_price),
    pnl: n(p.pnl),
    realisedPnl: numOrNull(p.realised),
    unrealisedPnl: numOrNull(p.unrealised),
  };
}

export function mapKiteHolding(h) {
  return {
    tradingSymbol: String(h.tradingsymbol ?? ""),
    exchange: kiteExchange(h.exchange),
    token: String(h.instrument_token ?? ""),
    isin: h.isin ? String(h.isin) : null,
    // quantity is the settled (T+2) holding; t1_quantity is bought but not yet delivered.
    qty: n(h.quantity) + n(h.t1_quantity),
    avgPrice: n(h.average_price),
    ltp: numOrNull(h.last_price),
    pnl: numOrNull(h.pnl),
  };
}

/** Net positions (the `net` book; `day` is the same trades viewed for intraday P&L). */
export async function fetchPositions(creds) {
  const data = await kiteFetch("/portfolio/positions", creds);
  return { status: "success", data: (data?.net ?? []).map(mapKitePosition) };
}

export async function fetchHoldings(creds) {
  const data = await kiteFetch("/portfolio/holdings", creds);
  return { status: "success", data: (Array.isArray(data) ? data : []).map(mapKiteHolding) };
}

/** Equity segment funds: net = live available margin, utilised.debits = margin in use. */
export function mapKiteFunds(margins) {
  const eq = margins?.equity ?? {};
  const avail = eq.available ?? {};
  return {
    availableCash: n(eq.net),
    usedMargin: n(eq.utilised?.debits),
    totalBalance: avail.opening_balance != null ? n(avail.opening_balance) + n(avail.intraday_payin) : null,
    collateral: avail.collateral != null ? n(avail.collateral) : null,
    withdrawable: null,
  };
}

export async function fetchFunds(creds) {
  return { status: "success", data: mapKiteFunds(await kiteFetch("/user/margins", creds)) };
}
