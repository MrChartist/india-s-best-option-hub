/**
 * Angel One (SmartAPI) adapter (contract v1, server/brokers/contract.mjs).
 *
 * Auth: session login (angeloneAuth.mjs). The PIN and current TOTP code are typed per session and never
 * stored; data calls refuse with SessionRequiredError (422) before any download until the user logs in.
 *
 * Angel has no native option-chain endpoint (official docs https://smartapi.angelone.in/docs), so a chain is:
 *   1. the daily scrip master (angeloneInstruments.mjs) for strike/expiry -> token,
 *   2. batched POST market/v1/quote { mode: "FULL", exchangeTokens } (50 tokens per call, paced at 1 call/s,
 *      the Market Data page's figure) for LTP, OI, volume and best bid/ask,
 *   3. one POST marketData/v1/optionGreek { name, expirydate: "DDMMMYYYY" } per underlying+expiry for
 *      delta/gamma/theta/vega and impliedVolatility (percent; strikePrice in rupees per the docs sample),
 *      with this app's Black-Scholes solver for any strike the call does not cover.
 * The quote API has no previous-day OI, so legs carry no OI change.
 * Also: historical candles (historical/v1/getCandleData), portfolio reads, order book / trade book and gated
 * orders (angeloneOrders.mjs). The SmartWebSocketV2 binary feed is not wired in v1 (`feed` not declared).
 */

import { BrokerInputError } from "./contract.mjs";
import { authFetch, getSession, LOGIN_FIELDS, PROFILE_PATH, SESSION_FIELDS } from "./angeloneAuth.mjs";
import { getInstrumentMaster, listExpiries, optionRowsForExpiry, indexSpotToken, OPTIDX_NAME_ALIASES, isoToDDMMMYYYY, toInstrument } from "./angeloneInstruments.mjs";
import { num, numOrNull } from "./angelonePortfolio.mjs";
import { ORDER_FEATURES } from "./angeloneOrders.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";

export { login } from "./angeloneAuth.mjs";
export { normaliseError } from "./contract.mjs";
export { fetchPositions, fetchHoldings, fetchFunds } from "./angelonePortfolio.mjs";
export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder, fetchOrderBook, fetchTradeBook } from "./angeloneOrders.mjs";

const QUOTE_PATH = "/rest/secure/angelbroking/market/v1/quote/";
const GREEK_PATH = "/rest/secure/angelbroking/marketData/v1/optionGreek";
const CANDLE_PATH = "/rest/secure/angelbroking/historical/v1/getCandleData";
const QUOTE_BATCH_SIZE = 50; // documented cap: 50 tokens per quote call
const QUOTE_BATCH_DELAY_MS = 1000; // Market Data page: 1 request per second for 50-token calls

export const id = "angelone";
export const credentialFields = ["apiKey", "clientId"];

/** Contract declaration. PIN + TOTP code are typed per session, never stored. */
export const capabilities = {
  ...ORDER_FEATURES,
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "3m", "5m", "15m", "30m", "60m", "1d"] },
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

export async function testConnection(creds = {}) {
  try {
    // One cheap authenticated call (GET getProfile) proves the stored session is still alive.
    await authFetch(creds, PROFILE_PATH);
    return { status: "success", message: "Angel One SmartAPI connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchInstruments(creds) {
  getSession(creds); // not logged in -> 422 before the 35 MB download
  const master = await getInstrumentMaster();
  const data = [];
  for (const row of master) {
    const ins = toInstrument(row);
    if (ins) data.push(ins);
  }
  return { status: "success", data };
}

export async function fetchExpiryList(creds, symbol) {
  getSession(creds);
  const master = await getInstrumentMaster();
  return { status: "success", data: listExpiries(master, symbol) };
}

export async function fetchLTP(creds, symbol) {
  getSession(creds);
  const master = await getInstrumentMaster();
  const spot = indexSpotToken(master, symbol);
  if (!spot) throw new BrokerInputError(`Angel One instrument master has no spot token for ${symbol}`);
  const quoteMap = await fetchQuoteMap(creds, [{ exch: spot.exch_seg, token: spot.token }]);
  const q = quoteMap.get(`${spot.exch_seg}:${spot.token}`);
  const ltp = num(q?.ltp);
  if (!(ltp > 0)) throw new Error(`Angel One quote returned no LTP for ${symbol}`);
  return { status: "success", data: { last_price: ltp } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  getSession(creds);
  const master = await getInstrumentMaster();

  const expiryIso = expiry || listExpiries(master, symbol)[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };
  const optionRows = optionRowsForExpiry(master, symbol, expiryIso);
  if (!optionRows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = indexSpotToken(master, symbol);
  const quoteTargets = optionRows.map((r) => ({ exch: r.exch_seg, token: r.token }));
  if (spot) quoteTargets.push({ exch: spot.exch_seg, token: spot.token });

  const quoteMap = await fetchQuoteMap(creds, quoteTargets);
  const lastPrice = spot ? num(quoteMap.get(`${spot.exch_seg}:${spot.token}`)?.ltp) : 0;

  const greeksMap = await fetchGreeksMap(creds, symbol, expiryIso).catch((e) => {
    console.warn(`[angelone] optionGreek unavailable for ${symbol} ${expiryIso}, using Black-Scholes: ${e.message}`);
    return new Map();
  });

  const daysToExpiry = daysBetween(new Date(), expiryIso);
  const oc = {};
  for (const row of optionRows) {
    const q = quoteMap.get(`${row.exch_seg}:${row.token}`);
    if (!q) continue; // token not returned by the quote call — skip this leg rather than fake zeros
    const ltp = num(q.ltp);
    const g = greeksMap.get(`${Math.round(row.strike * 100)}_${row.type.toUpperCase()}`);
    const legGreeks = g
      ? { iv: num(g.impliedVolatility), delta: num(g.delta), gamma: num(g.gamma), theta: num(g.theta), vega: num(g.vega) }
      : computeIVAndGreeks({ ltp, spot: lastPrice, strike: row.strike, daysToExpiry, type: row.type === "ce" ? "CE" : "PE" });
    (oc[String(row.strike)] ||= {})[row.type] = {
      last_price: ltp,
      oi: num(q.opnInterest),
      volume: num(q.tradeVolume),
      ...legGreeks,
      bid_price: num(q.depth?.buy?.[0]?.price),
      ask_price: num(q.depth?.sell?.[0]?.price),
      security_id: row.token,
    };
  }
  return { status: "success", data: { oc, last_price: lastPrice } };
}

/** refs: [{ token, exchange }] with Angel symbol tokens. */
export async function fetchQuotes(creds, refs = []) {
  const list = (Array.isArray(refs) ? refs : []).filter((r) => r && /^\d{1,12}$/.test(String(r.token)) && r.exchange);
  if (!list.length) return { status: "success", data: [] };
  const map = await fetchQuoteMap(creds, list.map((r) => ({ exch: r.exchange, token: String(r.token) })));
  const data = [];
  for (const ref of list) {
    const q = map.get(`${ref.exchange}:${ref.token}`);
    if (!q) continue;
    data.push({
      token: String(ref.token),
      exchange: ref.exchange,
      ltp: num(q.ltp),
      open: numOrNull(q.open),
      high: numOrNull(q.high),
      low: numOrNull(q.low),
      close: numOrNull(q.close),
      volume: numOrNull(q.tradeVolume),
      oi: numOrNull(q.opnInterest),
      bid: numOrNull(q.depth?.buy?.[0]?.price),
      ask: numOrNull(q.depth?.sell?.[0]?.price),
    });
  }
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  if (!ref || !/^\d{1,12}$/.test(String(ref.token)) || !ref.exchange) throw new BrokerInputError("Angel One depth needs { token, exchange }");
  const map = await fetchQuoteMap(creds, [{ exch: ref.exchange, token: String(ref.token) }]);
  const depth = map.get(`${ref.exchange}:${ref.token}`)?.depth || {};
  const level = (l) => ({ price: num(l?.price), qty: num(l?.quantity), orders: numOrNull(l?.orders) });
  return { status: "success", data: { bids: (depth.buy || []).map(level), asks: (depth.sell || []).map(level) } };
}

const INTERVAL = { "1m": "ONE_MINUTE", "3m": "THREE_MINUTE", "5m": "FIVE_MINUTE", "15m": "FIFTEEN_MINUTE", "30m": "THIRTY_MINUTE", "60m": "ONE_HOUR", "1d": "ONE_DAY" };

/** "2023-09-06" or an ISO date-time -> "yyyy-MM-dd HH:mm" in IST (the documented request format). */
function toAngelDateTime(v, endOfDay) {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} ${endOfDay ? "15:30" : "09:15"}`;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const angelInterval = INTERVAL[interval];
  if (!angelInterval) throw new BrokerInputError(`Angel One history does not support interval ${interval}`);
  if (!instrument || !/^\d{1,12}$/.test(String(instrument.token)) || !instrument.exchange) throw new BrokerInputError("Angel One history needs { token, exchange }");
  const fromdate = toAngelDateTime(from, false);
  const todate = toAngelDateTime(to, true);
  if (!fromdate || !todate) throw new BrokerInputError("Angel One history needs a valid from/to range");
  const json = await authFetch(creds, CANDLE_PATH, { exchange: instrument.exchange, symboltoken: String(instrument.token), interval: angelInterval, fromdate, todate });
  const seen = new Set();
  const data = [];
  for (const c of Array.isArray(json?.data) ? json.data : []) {
    const time = Math.floor(Date.parse(c?.[0]) / 1000);
    if (!Number.isFinite(time) || seen.has(time)) continue;
    seen.add(time);
    data.push({ time, open: num(c[1]), high: num(c[2]), low: num(c[3]), close: num(c[4]), volume: num(c[5]) });
  }
  data.sort((a, b) => a.time - b.time);
  return { status: "success", data };
}

// ── internals ──

/** Batched market/v1/quote fetch (FULL mode). Returns Map<"exch:token", quote>. */
async function fetchQuoteMap(creds, targets) {
  const map = new Map();
  if (!targets.length) return map;
  const chunkResults = await batchWithDelay(targets, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const exchangeTokens = {};
    for (const t of chunk) (exchangeTokens[t.exch] ||= []).push(String(t.token));
    const json = await authFetch(creds, QUOTE_PATH, { mode: "FULL", exchangeTokens });
    return json?.data?.fetched || [];
  });
  for (const fetched of chunkResults) {
    for (const q of fetched) if (q?.exchange && q?.symbolToken) map.set(`${q.exchange}:${q.symbolToken}`, q);
  }
  return map;
}

/** One optionGreek call per underlying+expiry. Map key: strike in paise (exact) + "_" + CE/PE. */
async function fetchGreeksMap(creds, symbol, expiryIso) {
  const s = String(symbol).toUpperCase();
  const name = (OPTIDX_NAME_ALIASES[s] || [s])[0];
  const json = await authFetch(creds, GREEK_PATH, { name, expirydate: isoToDDMMMYYYY(expiryIso) });
  const map = new Map();
  for (const g of Array.isArray(json?.data) ? json.data : []) {
    map.set(`${Math.round(num(g.strikePrice) * 100)}_${String(g.optionType || "").toUpperCase()}`, g);
  }
  return map;
}
