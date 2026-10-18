/**
 * Alice Blue Open API (V2) adapter (contract v1, server/brokers/contract.mjs).
 *
 * Auth: request-token exchange (aliceblueAuth.mjs): App Code + API secret are saved, the user pastes the
 * single-use authCode from Alice Blue's login redirect, and the server swaps it once for a userSession.
 *
 * Market data (official docs https://ant.aliceblueonline.com/productdocumentation/, checked 2026-10):
 *  - Option chain (native): POST /obrest/optionChain/getUnderlyingExp { underlying, exch } -> expiries "25AUG26";
 *    POST /obrest/optionChain/getOptionChain { underlying, expiry, interval, exch } -> per-strike CE/PE
 *    { ltp, oi, pdc, pdoi, token, tradingsymbol, forInsName }. exch is nse_fo / bse_fo. No bid/ask or greeks
 *    come back, so IV/greeks are computed locally and bid/ask are 0.
 *  - Quotes: POST /open-api/od/ChartAPIService/chart/get/multi/ohlc [{ exchange, token }] -> { ltp, open, high,
 *    low, close, volume, oi }. Documented for NSE, NFO, CDS and MCX only, so it also fills NFO chain volumes and
 *    NSE index spots. BSE indices (SENSEX, BANKEX) have no documented REST quote (multi/ohlc covers NSE, NFO, CDS
 *    and MCX only): their spot is derived from the chain by put-call parity at the strike with the smallest
 *    |CE - PE| gap, discounted to today, S ~ K*e^(-rT) + CE - PE, with the same r the Black-Scholes solver uses.
 *    Such a chain/LTP carries `last_price_source: "parity"` so callers can label the price as derived.
 *  - History: POST /open-api/od/ChartAPIService/api/chart/history { token, resolution "1"|"D", from, to (ms),
 *    exchange } (indices as "NSE::index"); available 5:30 PM-8 AM on weekdays and all day on holidays.
 *  - Rate limits: Quote API 5/s, Data API 20/s. Quote batches are paced at 250 ms.
 * Not declared: depth (no REST depth endpoint) and feed (the NorenWS socket needs createWsSess; not wired in v1).
 */

import { BrokerInputError } from "./contract.mjs";
import { abRequest, getSession } from "./aliceblueAuth.mjs";
import { CHAIN_EXCH, INDEX_SPOT, getDerivativeInstruments, resolveIndexSpotToken } from "./aliceblueInstruments.mjs";
import { num, numOrNull } from "./alicebluePortfolio.mjs";
import { ORDER_FEATURES } from "./aliceblueOrders.mjs";
import { DEFAULT_RATE, computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";

export { normaliseError } from "./contract.mjs";
export { fetchPositions, fetchHoldings, fetchFunds } from "./alicebluePortfolio.mjs";
export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder, fetchOrderBook, fetchTradeBook } from "./aliceblueOrders.mjs";

export const id = "aliceblue";
export const credentialFields = ["userId", "appCode", "apiSecret", "authCode"];

export const capabilities = {
  ...ORDER_FEATURES,
  auth: { kind: "requestTokenExchange" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  historical: { intervals: ["1m", "1d"] },
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const OHLC_EXCHANGES = new Set(["NSE", "NFO", "CDS", "MCX"]);
const CHAIN_INTERVAL = 25; // largest documented value (5, 10, 15, 20, 25)

/** "25AUG26" -> "2026-08-25". */
export function abExpiryToIso(s) {
  const m = /^(\d{2})([A-Z]{3})(\d{2})$/.exec(String(s ?? "").trim().toUpperCase());
  const mi = m ? MONTHS.indexOf(m[2]) : -1;
  return mi < 0 ? null : `20${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1]}`;
}

/** "2026-08-25" -> "25AUG26". */
export function isoToAbExpiry(iso) {
  const [y, mo, d] = String(iso).split("-").map(Number);
  return `${String(d).padStart(2, "0")}${MONTHS[mo - 1]}${String(y).slice(2)}`;
}

/** Underlying -> { underlying, exch } for the option-chain API (indices + NSE stocks). */
export function chainTarget(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (CHAIN_EXCH[s]) return { underlying: s, exch: CHAIN_EXCH[s] };
  if (/^[A-Z0-9&-]{1,20}$/.test(s)) return { underlying: s, exch: "nse_fo" };
  throw new BrokerInputError(`Alice Blue: unknown symbol ${symbol}`);
}

/** Strike of a chain leg: from forInsName ("NIFTY 25th AUG 23600 CE"), else the NFO trading symbol (…C23600). */
export function legStrike(leg) {
  const a = /\s(\d+(?:\.\d+)?)\s+(CE|PE)$/.exec(String(leg?.forInsName ?? "").trim());
  if (a) return Number(a[1]);
  const b = /\d{2}[A-Z]{3}\d{2}[CP](\d+(?:\.\d+)?)$/.exec(String(leg?.tradingsymbol ?? ""));
  return b ? Number(b[1]) : NaN;
}

/** True when an upstream numeric field was actually sent (not missing, null, blank or non-numeric). */
const isKnownNumber = (v) => v !== undefined && v !== null && String(v).trim() !== "" && Number.isFinite(Number(v));

/**
 * Put-call parity spot from built legs, at the strike with the smallest |CE - PE|. C - P = S - K*e^(-rT), so
 * S = K*e^(-rT) + C - P. With years = 0 this is the undiscounted K + C - P (the forward).
 */
export function paritySpot(oc, { rate = 0, years = 0 } = {}) {
  const discount = Math.exp(-rate * Math.max(0, years));
  let best = null;
  for (const [k, legs] of Object.entries(oc)) {
    const ce = legs.ce?.last_price;
    const pe = legs.pe?.last_price;
    if (!(ce > 0) || !(pe > 0)) continue;
    const gap = Math.abs(ce - pe);
    if (!best || gap < best.gap) best = { gap, spot: Number(k) * discount + ce - pe };
  }
  return best ? Math.round(best.spot * 100) / 100 : 0;
}

export async function testConnection(creds = {}) {
  try {
    await abRequest(creds, "/open-api/od/v1/profile");
    return { status: "success", message: "Alice Blue API connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchInstruments(creds) {
  // Session first: a logged-out caller must not trigger the contract-master downloads.
  await getSession(creds);
  return { status: "success", data: await getDerivativeInstruments() };
}

export async function fetchExpiryList(creds, symbol) {
  const target = chainTarget(symbol);
  const json = await abRequest(creds, "/obrest/optionChain/getUnderlyingExp", { method: "POST", body: target });
  const list = (json.result || []).flatMap((r) => r?.underlying_expiry || []).map(abExpiryToIso).filter(Boolean);
  return { status: "success", data: [...new Set(list)].sort() };
}

/** multi/ohlc for [{exchange, token}] on the documented exchanges. Map<"EXCH|token", row>. */
async function ohlcMap(creds, refs) {
  const list = refs.filter((r) => OHLC_EXCHANGES.has(r.exchange));
  const map = new Map();
  if (!list.length) return map;
  const chunks = await batchWithDelay(list, 50, 250, async (chunk) => {
    const json = await abRequest(creds, "/open-api/od/ChartAPIService/chart/get/multi/ohlc", { method: "POST", body: chunk.map((r) => ({ exchange: r.exchange, token: String(r.token) })) });
    return json.result || [];
  });
  for (const rows of chunks) for (const r of rows) if (r?.tk != null) map.set(`${String(r.e).toUpperCase()}|${r.tk}`, r);
  return map;
}

async function nseIndexSpot(creds, symbol) {
  const spot = INDEX_SPOT[symbol];
  if (!spot || spot.exch !== "NSE") return 0;
  const ref = await resolveIndexSpotToken(symbol);
  if (!ref) return 0;
  const map = await ohlcMap(creds, [{ exchange: "NSE", token: ref.token }]);
  return num(map.get(`NSE|${ref.token}`)?.ltp);
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const target = chainTarget(symbol);
  const expiryIso = expiry || (await fetchExpiryList(creds, symbol)).data[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };
  const json = await abRequest(creds, "/obrest/optionChain/getOptionChain", {
    method: "POST",
    body: { underlying: target.underlying, expiry: isoToAbExpiry(expiryIso), interval: CHAIN_INTERVAL, exch: target.exch },
  });
  const rows = (json.result || []).flatMap((r) => r?.data || []);
  const legs = [];
  for (const row of rows) {
    for (const [side, key] of [["CE", "ce"], ["PE", "pe"]]) {
      const leg = row?.[side];
      const strike = legStrike(leg);
      if (leg && strike > 0) legs.push({ key, strike, leg });
    }
  }
  if (!legs.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  // Volumes for NFO legs (and the NSE index spot) from the documented multi-OHLC quote API; best effort.
  const isNfo = target.exch === "nse_fo";
  const quoteRefs = isNfo ? legs.map((l) => ({ exchange: "NFO", token: String(l.leg.token) })) : [];
  const vols = await ohlcMap(creds, quoteRefs).catch(() => new Map());
  let spot = isNfo && INDEX_SPOT[target.underlying] ? await nseIndexSpot(creds, target.underlying).catch(() => 0) : 0;

  const oc = {};
  for (const { key, strike, leg } of legs) {
    (oc[String(strike)] ||= {})[key] = {
      last_price: num(leg.ltp),
      oi: num(leg.oi),
      // Only when Alice Blue sent it: a missing/blank pdoi as 0 would show the whole OI as today's change.
      ...(isKnownNumber(leg.pdoi) ? { previous_oi: num(leg.pdoi) } : {}),
      volume: num(vols.get(`NFO|${leg.token}`)?.volume),
      bid_price: 0,
      ask_price: 0,
      security_id: String(leg.token ?? ""),
    };
  }
  const daysToExpiry = daysBetween(new Date(), expiryIso);
  let derived = false;
  if (!(spot > 0)) {
    spot = paritySpot(oc, { rate: DEFAULT_RATE, years: daysToExpiry / 365 });
    derived = spot > 0;
  }
  for (const [k, sides] of Object.entries(oc)) {
    for (const [key, leg] of Object.entries(sides)) {
      Object.assign(leg, computeIVAndGreeks({ ltp: leg.last_price, spot, strike: Number(k), daysToExpiry, type: key.toUpperCase() }));
    }
  }
  return { status: "success", data: { oc, last_price: spot, ...(derived ? { last_price_source: "parity" } : {}) } };
}

export async function fetchLTP(creds, symbol) {
  const s = String(symbol ?? "").toUpperCase();
  const ltp = INDEX_SPOT[s]?.exch === "NSE" ? await nseIndexSpot(creds, s) : 0;
  if (ltp > 0) return { status: "success", data: { last_price: ltp } };
  if (CHAIN_EXCH[s]) {
    // BSE indices have no documented quote; the only source is the nearest-expiry chain (one getOptionChain call).
    const chain = (await fetchOptionChain(creds, s)).data;
    if (num(chain.last_price) > 0) return { status: "success", data: { last_price: num(chain.last_price), last_price_source: chain.last_price_source || "parity" } };
  }
  throw new Error(`Alice Blue returned no LTP for ${symbol}`);
}

/** refs: [{ token, exchange }] — NSE, NFO, CDS and MCX only (documented scope of multi/ohlc). */
export async function fetchQuotes(creds, refs = []) {
  const list = (Array.isArray(refs) ? refs : []).filter((r) => r && /^\d{1,12}$/.test(String(r.token)) && OHLC_EXCHANGES.has(r.exchange));
  const map = await ohlcMap(creds, list);
  const data = [];
  for (const ref of list) {
    const q = map.get(`${ref.exchange}|${ref.token}`);
    if (!q) continue;
    data.push({ token: String(ref.token), exchange: ref.exchange, ltp: num(q.ltp), open: numOrNull(q.open), high: numOrNull(q.high), low: numOrNull(q.low),
      close: numOrNull(q.close), volume: numOrNull(q.volume), oi: numOrNull(q.oi), bid: null, ask: null });
  }
  return { status: "success", data };
}

const RESOLUTION = { "1m": "1", "1d": "D" };
const NSE_INDEX_TOKENS = new Set(["26000", "26009", "26037", "26074"]);

/** "2026-05-19 09:15:59" (IST) -> epoch seconds at the start of that minute (or day for daily bars). */
function abCandleTime(s, daily) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(s ?? ""));
  if (!m) return NaN;
  return Math.floor(Date.parse(`${m[1]}T${daily ? "00:00" : `${m[2]}:${m[3]}`}:00+05:30`) / 1000);
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const resolution = RESOLUTION[interval];
  if (!resolution) throw new BrokerInputError(`Alice Blue history offers only 1-minute and daily candles (got ${interval})`);
  const token = String(instrument?.token ?? "");
  if (!/^\d{1,12}$/.test(token) || !OHLC_EXCHANGES.has(instrument?.exchange)) throw new BrokerInputError("Alice Blue history needs { token, exchange } on NSE, NFO, CDS or MCX");
  const fromMs = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? Date.parse(`${from}T00:00:00+05:30`) : Date.parse(from);
  const toMs = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? Date.parse(`${to}T23:59:59+05:30`) : Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) throw new BrokerInputError("Alice Blue history needs a valid from/to range");
  const exchange = instrument.exchange === "NSE" && (instrument.isIndex === true || NSE_INDEX_TOKENS.has(token)) ? "NSE::index" : instrument.exchange;
  const json = await abRequest(creds, "/open-api/od/ChartAPIService/api/chart/history", { method: "POST", body: { token, resolution, from: String(fromMs), to: String(toMs), exchange } });
  const seen = new Set();
  const data = [];
  for (const c of json.result || []) {
    const time = abCandleTime(c?.time, resolution === "D");
    if (!Number.isFinite(time) || seen.has(time)) continue;
    seen.add(time);
    data.push({ time, open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: num(c.volume) });
  }
  data.sort((a, b) => a.time - b.time);
  return { status: "success", data };
}
