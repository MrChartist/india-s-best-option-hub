/**
 * Rupeezy (Vortex) market data. Official docs (checked 2026-10):
 *  - https://vortex.rupeezy.in/docs/latest/option_chain/ : POST /strategies/option_chain
 *    { symbol, token, exchange (underlying's exchange, e.g. NSE_EQ), expiry_date: "YYYYMMDD", greeks: true }, 1/s
 *    -> { status, message, response: { symbol, expiry_date, expiry_dates: [...], options: { exchange, list: [
 *    { strike_price, iv, theta, vega, gamma, CE: { token, lot_size, security_description, ltp, open_interest,
 *    day_first_tick_oi, volume, delta }, PE: {...} } ] }, parent: { symbol, exchange, token, ltp } } }.
 *    Rupeezy computes Greeks with Black-76 and returns ONE IV per strike (the OTM leg's), used for both legs;
 *    delta is per leg, gamma/theta/vega per strike. IV is already in percent (15.04).
 *  - https://vortex.rupeezy.in/docs/latest/historical/ :
 *    GET /data/quotes?q=<EXCHANGE-TOKEN>&q=...&mode=ltp|ohlc|full (up to 1000, 1/s) -> { status, data: { "<q>": {
 *    exchange, token, last_trade_price, volume, open_price, high_price, low_price, close_price, open_interest,
 *    depth: { buy: [{ price, quantity, orders }] x5, sell: [...] } } } }. Keys echo the q form sent; missing
 *    quotes are simply absent.
 *    GET /data/history?exchange=&token=&from=<epoch s>&to=<epoch s>&resolution=1|3|5|15|30|60|1D (1/s)
 *    -> { s: "ok", t: [...], o, h, l, c, v } (the sample is newest-first; candles are sorted here).
 * The docs list exchange values NSE_EQ, NSE_FO, NSE_CUR, MCX_FO for these calls, while the instrument master
 * also carries BSE_EQ / BSE_FO. SENSEX and BANKEX are requested with BSE_EQ / BSE_FO exactly like the NSE pair;
 * this needs a live check.
 */

import { BrokerInputError } from "./contract.mjs";
import { vortexRequest } from "./rupeezyAuth.mjs";
import { getMaster, listExpiries, spotOf, vortexRef } from "./rupeezyInstruments.mjs";

const QUOTE_LIMIT = 1000;
const RESOLUTION = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "60m": "60", "1d": "1D" };
const IST_OFFSET_S = 19800;

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const nOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export const qKey = (r) => `${r.exchange}-${r.token}`;

/** One quotes call per 1000 instruments. Returns Map "EXCHANGE-TOKEN" -> quote. */
export async function quoteMap(creds, refs, mode = "full") {
  const out = new Map();
  for (let i = 0; i < refs.length; i += QUOTE_LIMIT) {
    const chunk = refs.slice(i, i + QUOTE_LIMIT);
    const qs = chunk.map((r) => `q=${encodeURIComponent(qKey(r))}`).join("&");
    const json = await vortexRequest(creds, `/data/quotes?${qs}&mode=${mode}`);
    const data = json?.data && typeof json.data === "object" ? json.data : {};
    for (const [k, q] of Object.entries(data)) {
      out.set(k, q);
      if (q?.exchange && q?.token != null) out.set(`${q.exchange}-${q.token}`, q);
    }
  }
  return out;
}

export async function fetchExpiryList(creds, symbol) {
  return { status: "success", data: listExpiries(await getMaster(), symbol) };
}

export async function fetchLTP(creds, symbol) {
  const spot = spotOf(await getMaster(), symbol);
  const q = (await quoteMap(creds, [spot], "ltp")).get(qKey(spot));
  const ltp = n(q?.last_trade_price);
  if (!(ltp > 0)) throw new BrokerInputError(`Rupeezy returned no price for ${symbol}`);
  return { status: "success", data: { last_price: ltp } };
}

/** One chain row's leg -> Dhan-shaped ChainLeg. */
export function buildLeg(leg, row) {
  if (!leg || typeof leg !== "object") return undefined;
  const oi = n(leg.open_interest);
  const first = n(leg.day_first_tick_oi);
  return {
    last_price: n(leg.ltp), oi, oi_chg: first > 0 ? oi - first : 0, volume: n(leg.volume),
    iv: n(row.iv), delta: n(leg.delta), gamma: n(row.gamma), theta: n(row.theta), vega: n(row.vega),
    security_id: String(leg.token ?? ""),
  };
}

export function mapChain(json) {
  const resp = json?.response ?? json?.data ?? {};
  const list = Array.isArray(resp?.options?.list) ? resp.options.list : [];
  const oc = {};
  for (const row of list) {
    const strike = n(row?.strike_price);
    if (!(strike > 0)) continue;
    const ce = buildLeg(row.CE, row);
    const pe = buildLeg(row.PE, row);
    if (!ce && !pe) continue;
    oc[String(strike)] = { ...(ce ? { ce } : {}), ...(pe ? { pe } : {}) };
  }
  return { oc, last_price: n(resp?.parent?.ltp) };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const master = await getMaster();
  const expiries = listExpiries(master, symbol);
  if (!expiries.length) throw new BrokerInputError(`Rupeezy: no options listed for ${symbol}`);
  const target = expiry || expiries[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new BrokerInputError("Rupeezy option chain: expiry must be YYYY-MM-DD");
  const spot = spotOf(master, symbol);
  const json = await vortexRequest(creds, "/strategies/option_chain", {
    method: "POST",
    body: { symbol: String(symbol).toUpperCase(), token: Number(spot.token), exchange: spot.exchange, expiry_date: target.replace(/-/g, ""), greeks: true },
  });
  const data = mapChain(json);
  if (!(data.last_price > 0)) {
    const q = (await quoteMap(creds, [spot], "ltp")).get(qKey(spot));
    data.last_price = n(q?.last_trade_price);
  }
  return { status: "success", data };
}

export function mapQuote(ref, q) {
  const bid = Array.isArray(q?.depth?.buy) ? q.depth.buy[0] : null;
  const ask = Array.isArray(q?.depth?.sell) ? q.depth.sell[0] : null;
  return {
    token: String(ref.token), exchange: ref.exchange, ltp: n(q?.last_trade_price), open: nOrNull(q?.open_price), high: nOrNull(q?.high_price),
    low: nOrNull(q?.low_price), close: nOrNull(q?.close_price), volume: nOrNull(q?.volume), oi: nOrNull(q?.open_interest),
    bid: nOrNull(bid?.price), ask: nOrNull(ask?.price),
  };
}

export async function fetchQuotes(creds, refs = []) {
  if (!Array.isArray(refs) || !refs.length) return { status: "success", data: [] };
  const vrefs = refs.map(vortexRef);
  const quotes = await quoteMap(creds, vrefs, "full");
  const data = [];
  refs.forEach((r, i) => {
    const q = quotes.get(qKey(vrefs[i]));
    if (q) data.push(mapQuote(r, q));
  });
  return { status: "success", data };
}

export function mapDepth(q) {
  const side = (list) => (Array.isArray(list) ? list : [])
    .filter((l) => l && typeof l === "object" && (n(l.price) > 0 || n(l.quantity) > 0))
    .map((l) => ({ price: n(l.price), qty: n(l.quantity), orders: nOrNull(l.orders) }));
  return { bids: side(q?.depth?.buy), asks: side(q?.depth?.sell) };
}

export async function fetchDepth(creds, ref) {
  const v = vortexRef(ref);
  const q = (await quoteMap(creds, [v], "full")).get(qKey(v));
  return { status: "success", data: mapDepth(q) };
}

/** "YYYY-MM-DD" (IST calendar day) -> epoch seconds at 00:00 IST, or the end of that day. */
export function istDayEpoch(iso, endOfDay = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return null;
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 - IST_OFFSET_S;
  return endOfDay ? start + 86_399 : start;
}

export function mapCandles(json) {
  const t = Array.isArray(json?.t) ? json.t : [];
  const out = t.map((time, i) => ({ time: Math.floor(n(time)), open: n(json.o?.[i]), high: n(json.h?.[i]), low: n(json.l?.[i]), close: n(json.c?.[i]), volume: n(json.v?.[i]) }))
    .filter((c) => c.time > 0);
  out.sort((a, b) => a.time - b.time);
  return out.filter((c, i) => i === 0 || c.time > out[i - 1].time);
}

export async function fetchHistorical(creds, { instrument, interval = "1d", from, to } = {}) {
  const resolution = RESOLUTION[interval];
  if (!resolution) throw new BrokerInputError(`Rupeezy historical: unsupported interval ${interval} (1m, 3m, 5m, 15m, 30m, 60m, 1d)`);
  const v = vortexRef(instrument);
  const fromS = istDayEpoch(from);
  const toS = istDayEpoch(to, true);
  if (fromS === null || toS === null || toS < fromS) throw new BrokerInputError("Rupeezy historical: from/to must be YYYY-MM-DD with from on or before to");
  const qs = new URLSearchParams({ exchange: v.exchange, token: v.token, from: String(fromS), to: String(toS), resolution });
  const json = await vortexRequest(creds, `/data/history?${qs}`);
  if (String(json?.s ?? "ok").toLowerCase() === "no_data") return { status: "success", data: [] };
  return { status: "success", data: mapCandles(json) };
}
