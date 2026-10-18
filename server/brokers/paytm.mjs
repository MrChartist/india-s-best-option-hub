/**
 * Paytm Money Open API on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://developer.paytmmoney.com/docs/api/ (slugs cited in each module). Where
 * observed behaviour disagrees with the docs we follow the docs (see paytmOrders.mjs).
 *
 *  - auth: apiKeyToken. The user runs the merchant-login redirect, exchanges the request_token at
 *    /accounts/v2/gettoken and pastes the access_token (valid until midnight). apiKey/apiSecret are kept
 *    as saved fields for that exchange but are not sent by this adapter.
 *  - instruments / expiries: the public security-master CSVs (paytmInstruments.mjs); expiries for NSE
 *    indices come from option-chain/config.
 *  - optionChain: native /fno/v1/option-chain for NSE indices (broker IV and Greeks), option master +
 *    FULL live quotes for SENSEX and BANKEX (paytmChain.mjs).
 *  - ltp / quotes / depth: /data/v1/price/live (LTP, FULL).
 *  - positions, holdings, funds, orderBook, tradeBook: paytmPortfolio.mjs.
 *  - placeOrder, modifyOrder, cancelOrder: paytmOrders.mjs behind withOrderGate.
 *  Not declared: historical (no candle API in the docs), feed (needs the public_access_token, which
 *  the catalogue does not collect), GTT/cover/bracket orders.
 */

import { BrokerError, BrokerInputError, normaliseError as baseNormalise } from "./contract.mjs";
import { paytmGet, requireToken } from "./paytmClient.mjs";
import { INDEX_CONFIG, fetchLive, getMaster, resetPaytmInstrumentCache, toInstrument } from "./paytmInstruments.mjs";
import { NATIVE_CHAIN_SYMBOLS, indexSpot, masterChain, masterExpiries, nativeChain, nativeExpiries } from "./paytmChain.mjs";
import * as portfolio from "./paytmPortfolio.mjs";

export const id = "paytm";
export const credentialFields = ["apiKey", "apiSecret", "accessToken"];

export const capabilities = {
  auth: { kind: "apiKeyToken" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
  ltp: true,
  quotes: true,
  depth: true,
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

const LABEL = "Paytm Money";
export { resetPaytmInstrumentCache };

function knownSymbol(symbol) {
  if (!INDEX_CONFIG[symbol]) throw new BrokerInputError(`${LABEL}: unknown symbol ${symbol}`);
}

/** One cheap authenticated call: GET /accounts/v1/user/details (docs: user-details). */
export async function testConnection(creds = {}) {
  try {
    await paytmGet("/accounts/v1/user/details", creds);
    return { status: "success", message: "Paytm Money connected" };
  } catch (e) {
    return { status: "error", message: e?.message || String(e) };
  }
}

export async function fetchInstruments() {
  const data = [];
  for (const row of await getMaster("all")) {
    const inst = toInstrument(row);
    if (inst) data.push(inst);
  }
  return { status: "success", data };
}

export async function fetchExpiryList(creds, symbol) {
  knownSymbol(symbol);
  requireToken(creds);
  const data = NATIVE_CHAIN_SYMBOLS.has(symbol) ? await nativeExpiries(creds, symbol) : await masterExpiries(symbol);
  return { status: "success", data };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  knownSymbol(symbol);
  requireToken(creds);
  const data = NATIVE_CHAIN_SYMBOLS.has(symbol) ? await nativeChain(creds, symbol, expiry) : await masterChain(creds, symbol, expiry);
  return { status: "success", data };
}

export async function fetchLTP(creds, symbol) {
  knownSymbol(symbol);
  requireToken(creds);
  let price = await indexSpot(creds, symbol);
  // Fallback for NSE indices: the native chain's spot_price (also live broker data).
  if (!(price > 0) && NATIVE_CHAIN_SYMBOLS.has(symbol)) price = (await nativeChain(creds, symbol)).last_price;
  if (!(price > 0)) throw new BrokerError(`${LABEL} returned no price for ${symbol}`);
  return { status: "success", data: { last_price: price } };
}

/** InstrumentRef -> live-quote preference. Index tokens are "IDX-<id>"; derivative scrip types come from the master. */
async function prefsFor(refs) {
  const needMaster = refs.some((r) => !String(r.token).startsWith("IDX-"));
  const byKey = new Map();
  if (needMaster) {
    for (const row of await getMaster("all")) byKey.set(`${String(row.exchange).toUpperCase()}:${String(row.segment).toUpperCase()}:${row.security_id}`, row);
  }
  return refs.map((ref) => {
    const ex = String(ref.exchange).toUpperCase();
    const token = String(ref.token);
    if (token.startsWith("IDX-")) return { ref, exchange: ex, id: token.slice(4), scripType: "INDEX" };
    const isDeriv = ex === "NFO" || ex === "BFO";
    const exchange = ex === "NFO" ? "NSE" : ex === "BFO" ? "BSE" : ex;
    const row = byKey.get(`${exchange}:${isDeriv ? "D" : "E"}:${token}`);
    const t = String(row?.instrument_type ?? "").toUpperCase();
    const scripType = isDeriv ? (t.startsWith("FUT") ? "FUTURE" : "OPTION") : t === "ETF" ? "ETF" : "EQUITY";
    return { ref, exchange, id: token, scripType };
  });
}

const numOrNull = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);

export async function fetchQuotes(creds, refs = []) {
  requireToken(creds);
  const prefs = await prefsFor(refs);
  const rows = await fetchLive(creds, "FULL", prefs);
  const data = [];
  for (const p of prefs) {
    const q = rows.get(`${p.exchange}:${p.id}:${p.scripType}`);
    if (!q || !(Number(q.last_price) > 0)) continue;
    data.push({
      token: String(p.ref.token), exchange: p.ref.exchange, ltp: Number(q.last_price),
      open: numOrNull(q.ohlc?.open), high: numOrNull(q.ohlc?.high), low: numOrNull(q.ohlc?.low), close: numOrNull(q.ohlc?.close),
      volume: numOrNull(q.volume_traded), oi: numOrNull(q.oi), bid: numOrNull(q.depth?.buy?.[0]?.price), ask: numOrNull(q.depth?.sell?.[0]?.price),
    });
  }
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  requireToken(creds);
  const [p] = await prefsFor([ref]);
  const q = (await fetchLive(creds, "FULL", [p])).get(`${p.exchange}:${p.id}:${p.scripType}`);
  if (!q) throw new BrokerError(`${LABEL}: no quote found for ${ref.exchange}:${ref.token}`);
  const side = (levels) => (Array.isArray(levels) ? levels : []).map((l) => ({ price: Number(l.price) || 0, qty: Number(l.quantity) || 0, orders: numOrNull(l.orders) }));
  return { status: "success", data: { bids: side(q.depth?.buy), asks: side(q.depth?.sell) } };
}

export const fetchPositions = portfolio.fetchPositions;
export const fetchHoldings = portfolio.fetchHoldings;
export const fetchFunds = portfolio.fetchFunds;
export const fetchOrderBook = portfolio.fetchOrderBook;
export const fetchTradeBook = portfolio.fetchTradeBook;

export { placeOrder, modifyOrder, cancelOrder } from "./paytmOrders.mjs";

/** 422 for our refusals; 502 upstream with UPSTREAM_AUTH / UPSTREAM_RATE_LIMIT / UPSTREAM_INPUT where known. */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError && err.statusCode === 422) return base;
  if (base.code !== "UPSTREAM_ERROR") return base;
  const m = base.message;
  if (/\[(401|403)\]|PM_OPEN_API_0001|PM_OPEN_API_403/.test(m)) return { ...base, code: "UPSTREAM_AUTH" };
  if (/\[429\]/.test(m)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  if (/\[400\]|PM_OPEN_API_400/.test(m)) return { ...base, code: "UPSTREAM_INPUT" };
  return base;
}
