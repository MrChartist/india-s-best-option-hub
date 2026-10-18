/**
 * HDFC Sky Open API on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://developer.hdfcsky.com/sky-docs/docs/intro (every page under /sky-docs/docs/).
 * Where observed behaviour disagrees with the docs, it is noted in the module that makes the call (hdfcskyClient, hdfcskyPortfolio, hdfcskyOrders, hdfcskyHistory).
 *
 *  - auth: apiKeyToken (paste today's access token; the OTP step rules out a one-shot login).
 *  - instruments / expiries: the public Security Master ZIP (hdfcskyInstruments.mjs).
 *  - ltp / quotes: PUT /oapi/v1/fetch-ltp (ltp + prev_close only).
 *  - optionChain: master + fetch-ltp per leg; OI, volume and best bid/ask from a short WebSocket
 *    snapshot (the feed is the only source of them); IV and Greeks by Black-Scholes (greeks: computed).
 *    The previous version returned 0 for OI/volume/bid/ask; they now come from the feed.
 *  - depth / feed: the protobuf WebSocket shared with InvestRight (hdfcsecuritiesFeed.mjs).
 *  - historical: chart-data candles (hdfcskyHistory.mjs).
 *  - positions, holdings, funds, orderBook, tradeBook: hdfcskyPortfolio.mjs.
 *  - placeOrder, modifyOrder, cancelOrder: hdfcskyOrders.mjs behind withOrderGate.
 *  Not declared: GTT, basket, cover/bracket orders, margin calculator (out of scope for v1).
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { sleep } from "../lib/batch.mjs";
import { BrokerError, BrokerInputError, SessionRequiredError, normaliseError as baseNormalise } from "./contract.mjs";
import { LTP_BATCH_DELAY_MS, LTP_BATCH_SIZE, fetchLtpBatch, requireClientId, requireCreds, skyRequest, wsUrl } from "./hdfcskyClient.mjs";
import { SYMBOL_CONFIG, getInstrumentMaster, indexSpotRow, listExpiries, optionRowsForExpiry, resetHdfcSkyInstrumentCache, toInstrument } from "./hdfcskyInstruments.mjs";
import { createSnapshotPool, openStreamingFeed, scripIdFor, tickToDepth } from "./hdfcsecuritiesFeed.mjs";
import * as portfolio from "./hdfcskyPortfolio.mjs";
import { fetchHistorical as historyImpl } from "./hdfcskyHistory.mjs";

export const id = "hdfcsky";
export const credentialFields = ["apiKey", "accessToken"];

export const capabilities = {
  auth: { kind: "apiKeyToken" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "3m", "5m", "15m", "30m", "60m", "1d"] },
  feed: true,
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
  ioc: true,
  bracket: false,
  cover: false,
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const LABEL = "HDFC Sky";
const CHAIN_STRIKES_AROUND_SPOT = 40;

const pool = createSnapshotPool({ label: LABEL, wsUrlFor: wsUrl });
const defaultSnapshot = (creds, scripIds, windowMs) => pool.subscribeAndCollect(creds, scripIds, windowMs);
let snapshot = defaultSnapshot;

/** Tests: replace the WebSocket snapshot (no sockets in unit tests). */
export function setHdfcSkySnapshotForTests(fn) {
  snapshot = fn ?? defaultSnapshot;
}
export { resetHdfcSkyInstrumentCache };

async function safeSnapshot(creds, scripIds, windowMs) {
  try {
    return await snapshot(creds, scripIds, windowMs);
  } catch {
    return new Map();
  }
}

/** InstrumentRef -> fetch-ltp / feed exchange (indices: NSE_INDEX / BSE_INDEX). */
export function feedExchangeForRef(ref) {
  const ex = String(ref?.exchange ?? "").toUpperCase();
  const t = Number(ref?.token);
  if (ex === "NSE" && t >= 26000 && t <= 26999) return "NSE_INDEX";
  if (ex === "BSE" && t > 0 && t < 1000) return "BSE_INDEX";
  return ex;
}

async function ltpMap(creds, instruments) {
  const merged = new Map();
  let failures = 0;
  let lastError = null;
  const chunks = [];
  for (let i = 0; i < instruments.length; i += LTP_BATCH_SIZE) chunks.push(instruments.slice(i, i + LTP_BATCH_SIZE));
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(LTP_BATCH_DELAY_MS);
    try {
      for (const [k, v] of await fetchLtpBatch(creds, chunks[i])) merged.set(k, v);
    } catch (e) {
      if (e instanceof SessionRequiredError) throw e;
      failures += 1;
      lastError = e;
      if (e?.code === "UPSTREAM_RATE_LIMIT") await sleep(LTP_BATCH_DELAY_MS * 2);
    }
  }
  if (chunks.length && failures === chunks.length) throw lastError;
  return merged;
}

/** One cheap authenticated call: GET /oapi/v1/user/trading_info (profile). */
export async function testConnection(creds = {}) {
  try {
    const client_id = requireClientId(creds);
    const json = await skyRequest(creds, "GET", "/oapi/v1/user/trading_info", { params: { client_id } });
    if (json?.status && json.status !== "success") return { status: "error", message: "HDFC Sky did not return a success status" };
    return { status: "success", message: "HDFC Sky connected" };
  } catch (e) {
    return { status: "error", message: e?.message || String(e) };
  }
}

export async function fetchInstruments() {
  const data = [];
  for (const r of await getInstrumentMaster()) {
    const inst = toInstrument(r);
    if (inst) data.push(inst);
  }
  return { status: "success", data };
}

export async function fetchExpiryList(creds, symbol) {
  if (!SYMBOL_CONFIG[symbol]) throw new BrokerInputError(`${LABEL}: unknown symbol ${symbol}`);
  return { status: "success", data: listExpiries(await getInstrumentMaster(), symbol) };
}

async function spotFor(creds, master, symbol) {
  const spot = indexSpotRow(master, symbol);
  if (!spot) return 0;
  const prices = await ltpMap(creds, [{ exchange: spot.ltpExchange, token: spot.token }]);
  let price = prices.get(`${spot.ltpExchange}:${spot.token}`)?.ltp || 0;
  if (!(price > 0)) price = (await safeSnapshot(creds, [`${spot.ltpExchange}_${spot.token}`], 2500)).get(spot.token)?.ltp || 0;
  return price;
}

export async function fetchLTP(creds, symbol) {
  if (!SYMBOL_CONFIG[symbol]) throw new BrokerInputError(`${LABEL}: unknown symbol ${symbol}`);
  requireCreds(creds);
  const price = await spotFor(creds, await getInstrumentMaster(), symbol);
  if (!(price > 0)) throw new BrokerError(`${LABEL} returned no price for ${symbol}`);
  return { status: "success", data: { last_price: price } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  if (!SYMBOL_CONFIG[symbol]) throw new BrokerInputError(`${LABEL}: unknown symbol ${symbol}`);
  requireCreds(creds);
  const master = await getInstrumentMaster();
  const expiryIso = expiry || listExpiries(master, symbol)[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };
  let rows = optionRowsForExpiry(master, symbol, expiryIso);
  if (!rows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await spotFor(creds, master, symbol);
  if (spot > 0) {
    const keep = new Set([...new Set(rows.map((r) => r.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, CHAIN_STRIKES_AROUND_SPOT));
    rows = rows.filter((r) => keep.has(r.strike));
  }
  const ticks = await safeSnapshot(creds, rows.map((r) => scripIdFor(r.exchange, r.token)));
  const prices = await ltpMap(creds, rows.map((r) => ({ exchange: r.exchange, token: r.token })));
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const row of rows) {
    const tick = ticks.get(row.token);
    const ltp = prices.get(`${row.exchange}:${row.token}`)?.ltp || tick?.ltp || 0;
    const type = row.type === "pe" ? "PE" : "CE";
    const key = String(row.strike);
    oc[key] = oc[key] || {};
    oc[key][row.type] = {
      last_price: ltp,
      oi: tick?.oi || 0,
      volume: tick?.volume || 0,
      ...computeIVAndGreeks({ ltp, spot, strike: row.strike, daysToExpiry, type }),
      bid_price: tick?.depth?.buy?.[0]?.price || 0,
      ask_price: tick?.depth?.sell?.[0]?.price || 0,
    };
  }
  return { status: "success", data: { oc, last_price: spot } };
}

export async function fetchQuotes(creds, refs = []) {
  const wanted = refs.map((r) => ({ ref: r, exchange: feedExchangeForRef(r), token: String(r.token) }));
  const prices = await ltpMap(creds, wanted.map((w) => ({ exchange: w.exchange, token: w.token })));
  const data = [];
  for (const w of wanted) {
    const p = prices.get(`${w.exchange}:${w.token}`);
    if (!p || !(p.ltp > 0)) continue;
    data.push({ token: w.token, exchange: w.ref.exchange, ltp: p.ltp, open: null, high: null, low: null, close: p.prevClose || null, volume: null, oi: null, bid: null, ask: null });
  }
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  requireCreds(creds);
  const ticks = await safeSnapshot(creds, [scripIdFor(feedExchangeForRef(ref), ref.token)], 3000);
  const tick = ticks.get(String(ref.token));
  if (!tick) throw new BrokerError(`${LABEL}: no market depth received for ${ref.exchange}:${ref.token}`);
  return { status: "success", data: tickToDepth(tick) };
}

export async function fetchHistorical(creds, request) {
  requireCreds(creds);
  return historyImpl(creds, request);
}

export function createFeed(creds, { onTick, onStatus } = {}) {
  return openStreamingFeed({ label: LABEL, url: wsUrl(creds), refToScripId: (r) => scripIdFor(feedExchangeForRef(r), r.token), onTick, onStatus });
}

export const fetchPositions = portfolio.fetchPositions;
export const fetchHoldings = portfolio.fetchHoldings;
export const fetchFunds = portfolio.fetchFunds;
export const fetchOrderBook = portfolio.fetchOrderBook;
export const fetchTradeBook = portfolio.fetchTradeBook;

export { placeOrder, modifyOrder, cancelOrder } from "./hdfcskyOrders.mjs";

/** 422 for our refusals; 502 upstream with UPSTREAM_AUTH / UPSTREAM_RATE_LIMIT / UPSTREAM_INPUT where known. */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError && err.statusCode === 422) return base;
  if (base.code !== "UPSTREAM_ERROR") return base;
  const m = base.message;
  if (/\[(401|403)\]|\(40000\)/.test(m)) return { ...base, code: "UPSTREAM_AUTH" };
  if (/\[429\]/.test(m)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  if (/\[(400|422)\]|\(44000\)/.test(m)) return { ...base, code: "UPSTREAM_INPUT" };
  return base;
}
