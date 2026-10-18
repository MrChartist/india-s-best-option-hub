/**
 * HDFC Securities (InvestRight Open API) on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://developer.hdfcsec.com/ir-docs/docs/intro (every page under /ir-docs/docs/).
 * OpenAlgo was read for facts only (endpoint paths, master columns, feed auth); where it and the docs
 * disagree we follow the docs and say so in the module that makes the call.
 *
 * What InvestRight offers and how each capability is built:
 *  - auth: apiKeyToken. The user completes the InvestRight login (browser redirect + 2FA) once a day
 *    and pastes the access token (hdfcsecuritiesAuth.mjs explains why the headless flow is not used).
 *  - instruments / expiries: the public Security Master CSV (hdfcsecuritiesInstruments.mjs).
 *  - ltp / quotes: PUT /oapi/v1/fetch-ltp, the only REST market-data call (ltp + prev_close).
 *  - optionChain: master + fetch-ltp for each leg; OI, volume and best bid/ask come from a short
 *    WebSocket snapshot (the docs: OHLC, volume, depth and OI are WebSocket-only). IV and Greeks are
 *    computed with Black-Scholes from the traded LTP (greeks: "computed").
 *  - depth / feed: the protobuf market-data WebSocket (hdfcsecuritiesFeed.mjs).
 *  - historical: NOT declared. InvestRight publishes no candle API.
 *  - positions, holdings, funds, orderBook, tradeBook: hdfcsecuritiesPortfolio.mjs.
 *  - placeOrder, modifyOrder, cancelOrder: hdfcsecuritiesOrders.mjs, wrapped with withOrderGate.
 *    No route mints a gate for this broker, so live orders stay blocked.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { sleep } from "../lib/batch.mjs";
import { BrokerError, BrokerInputError, SessionRequiredError, normaliseError as baseNormalise } from "./contract.mjs";
import { LTP_BATCH_DELAY_MS, LTP_BATCH_SIZE, fetchLtpBatch, testConnection as authTestConnection, wsUrl, requireCreds } from "./hdfcsecuritiesAuth.mjs";
import {
  SYMBOL_CONFIG,
  distinctExpiriesAscending,
  getOptionRows,
  getSecurityMaster,
  resolveIndexSpotRow,
  toInstrument,
  resetHdfcSecuritiesInstrumentCache,
} from "./hdfcsecuritiesInstruments.mjs";
import { createSnapshotPool, openStreamingFeed, scripIdFor, tickToDepth } from "./hdfcsecuritiesFeed.mjs";
import * as portfolio from "./hdfcsecuritiesPortfolio.mjs";

export const id = "hdfcsecurities";
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
  // Legacy order-feature descriptor, kept conservative: the docs list IOC validity; cover and bracket
  // orders are not part of the regular-order API.
  ioc: true,
  bracket: false,
  cover: false,
  products: ["CNC", "INTRADAY", "MARGIN", "MTF"],
};

const LABEL = "HDFC Securities";
const CHAIN_STRIKES_AROUND_SPOT = 40;

const pool = createSnapshotPool({ label: LABEL, wsUrlFor: wsUrl });
let snapshot = (creds, scripIds, windowMs) => pool.subscribeAndCollect(creds, scripIds, windowMs);

/** Tests: replace the WebSocket snapshot (no sockets in unit tests) and reset the master cache. */
export function setHdfcSecuritiesSnapshotForTests(fn) {
  snapshot = fn ?? ((creds, scripIds, windowMs) => pool.subscribeAndCollect(creds, scripIds, windowMs));
}
export { resetHdfcSecuritiesInstrumentCache };

async function safeSnapshot(creds, scripIds, windowMs) {
  try {
    return await snapshot(creds, scripIds, windowMs);
  } catch {
    return new Map(); // the REST fields still flow; OI/volume/depth stay 0
  }
}

/** InstrumentRef { exchange, token } -> the code fetch-ltp and the feed use. */
export function feedExchangeForRef(ref) {
  const ex = String(ref?.exchange ?? "").toUpperCase();
  const t = Number(ref?.token);
  if (ex === "NSE" && t >= 26000 && t <= 26999) return "NSE_INDEX";
  if (ex === "BSE" && t > 0 && t < 1000) return "BSE_INDEX";
  return ex;
}

/**
 * fetch-ltp in chunks of LTP_BATCH_SIZE with a pause between chunks. A rejected token stops at once
 * (SessionRequiredError); other chunk failures are skipped, unless every chunk failed.
 */
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

export async function testConnection(creds = {}) {
  return authTestConnection(creds);
}

export async function fetchInstruments() {
  const rows = await getSecurityMaster();
  const data = [];
  for (const r of rows) {
    const inst = toInstrument(r);
    if (inst) data.push(inst);
  }
  return { status: "success", data };
}

export async function fetchExpiryList(creds, symbol) {
  return { status: "success", data: distinctExpiriesAscending(await getOptionRows(symbol)) };
}

async function spotFor(creds, symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  const exchange = `${cfg.csvExchange}_INDEX`;
  const map = await ltpMap(creds, [{ exchange, token: cfg.indexToken }]);
  let price = map.get(`${exchange}|${cfg.indexToken}`)?.ltp || 0;
  if (!(price > 0)) {
    const ticks = await safeSnapshot(creds, [`${exchange}_${cfg.indexToken}`], 2500);
    price = ticks.get(cfg.indexToken)?.ltp || 0;
  }
  return price;
}

export async function fetchLTP(creds, symbol) {
  if (!SYMBOL_CONFIG[symbol]) throw new BrokerInputError(`${LABEL}: unknown symbol ${symbol}`);
  requireCreds(creds);
  const price = await spotFor(creds, symbol);
  if (!(price > 0)) throw new BrokerError(`${LABEL} returned no price for ${symbol}`);
  return { status: "success", data: { last_price: price } };
}

function buildLeg({ ltp, tick, spot, strike, daysToExpiry, type }) {
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return {
    last_price: ltp,
    oi: tick?.oi || 0,
    volume: tick?.volume || 0,
    ...greeks,
    bid_price: tick?.depth?.buy?.[0]?.price || 0,
    ask_price: tick?.depth?.sell?.[0]?.price || 0,
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) throw new BrokerInputError(`${LABEL}: unknown symbol ${symbol}`);
  requireCreds(creds);
  const all = await getOptionRows(symbol);
  const target = expiry || distinctExpiriesAscending(all)[0];
  let rows = all.filter((r) => r.expiry_date === target);
  if (!rows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await spotFor(creds, symbol);
  if (spot > 0) {
    const strikes = [...new Set(rows.map((r) => Number(r.strike_price)))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, CHAIN_STRIKES_AROUND_SPOT);
    const keep = new Set(strikes);
    rows = rows.filter((r) => keep.has(Number(r.strike_price)));
  }

  const legExchange = cfg.derivExchange;
  const ticks = await safeSnapshot(creds, rows.map((r) => `${legExchange}_${r.exch_security_id}`));
  const prices = await ltpMap(creds, rows.map((r) => ({ exchange: legExchange, token: String(r.exch_security_id) })));
  const daysToExpiry = daysBetween(new Date(), target);

  const oc = {};
  for (const r of rows) {
    const token = String(r.exch_security_id);
    const tick = ticks.get(token);
    const ltp = prices.get(`${legExchange}|${token}`)?.ltp || tick?.ltp || 0;
    const type = String(r.option_type).toUpperCase() === "PE" ? "PE" : "CE";
    const strike = Number(r.strike_price) || 0;
    if (!(strike > 0)) continue;
    const key = String(strike);
    oc[key] = oc[key] || {};
    oc[key][type.toLowerCase()] = buildLeg({ ltp, tick, spot, strike, daysToExpiry, type });
  }
  return { status: "success", data: { oc, last_price: spot } };
}

export async function fetchQuotes(creds, refs = []) {
  const wanted = refs.map((r) => ({ ref: r, exchange: feedExchangeForRef(r), token: String(r.token) }));
  const prices = await ltpMap(creds, wanted.map((w) => ({ exchange: w.exchange, token: w.token })));
  const data = [];
  for (const w of wanted) {
    const p = prices.get(`${w.exchange}|${w.token}`);
    if (!p || !(p.ltp > 0)) continue;
    // fetch-ltp carries only ltp and the previous close; the rest is WebSocket-only.
    data.push({ token: w.token, exchange: w.ref.exchange, ltp: p.ltp, open: null, high: null, low: null, close: p.prevClose || null, volume: null, oi: null, bid: null, ask: null });
  }
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  requireCreds(creds);
  const exchange = feedExchangeForRef(ref);
  const ticks = await safeSnapshot(creds, [scripIdFor(exchange, ref.token)], 3000);
  const tick = ticks.get(String(ref.token));
  if (!tick) throw new BrokerError(`${LABEL}: no market depth received for ${ref.exchange}:${ref.token}`);
  return { status: "success", data: tickToDepth(tick) };
}

export function createFeed(creds, { onTick, onStatus } = {}) {
  return openStreamingFeed({ label: LABEL, url: wsUrl(creds), refToScripId: (r) => scripIdFor(feedExchangeForRef(r), r.token), onTick, onStatus });
}

export const fetchPositions = portfolio.fetchPositions;
export const fetchHoldings = portfolio.fetchHoldings;
export const fetchFunds = portfolio.fetchFunds;
export const fetchOrderBook = portfolio.fetchOrderBook;
export const fetchTradeBook = portfolio.fetchTradeBook;

export { placeOrder, modifyOrder, cancelOrder } from "./hdfcsecuritiesOrders.mjs";

/** 422 for our refusals; 502 upstream with UPSTREAM_AUTH / UPSTREAM_RATE_LIMIT / UPSTREAM_INPUT where known. */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError && err.statusCode === 422) return base;
  if (base.code !== "UPSTREAM_ERROR") return base;
  const m = base.message;
  if (/\[(401|403)\]/.test(m)) return { ...base, code: "UPSTREAM_AUTH" };
  if (/\[429\]/.test(m)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  if (/\[(400|422)\]/.test(m)) return { ...base, code: "UPSTREAM_INPUT" };
  return base;
}
