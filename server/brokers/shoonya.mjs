/**
 * Shoonya (Finvasia) adapter on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://shoonya.com/api-documentation (pages cited in shoonyaAuth.mjs and
 * shoonyaInstruments.mjs, plus place-order, modify-order, cancel-order, order-book, trade-book, positions,
 * holdings, funds-limits, market-quotes, time-price-series, historical-data, websocket-overview,
 * subscribe-market-feed, exchange-segment-codes, product-type-codes). Shoonya runs Kambala's Noren OMS;
 * the shared engine is shoonyaNorenCore.mjs.
 *
 * Auth (requestTokenExchange): the user saves user ID, API client ID, secret and the one-time OAuth
 * `code`; the first call runs GenAcsTok and the token is kept in this process. A pasted `accessToken`
 * is also accepted.
 *
 * Market data: one contract per GetQuotes call (no bulk quotes, no IV/Greeks), so the option chain is
 * the symbol master windowed to STRIKE_HALF_WIDTH strikes around spot plus per-contract quotes, with
 * IV/Greeks solved locally. Candles: TPSeries (1/3/5/10/15/30/60/120/240 min) and EODChartData (daily).
 * Feed: wss://api.shoonya.com/NorenWSAPI/ touchline.
 *
 * Orders (gated; nothing mints gates for this broker today), per the official Place Order page:
 * prctyp LMT and SL-LMT only ("MKT orders are rejected"), so MARKET / SL-M are refused locally;
 * prd C / M / I only (CO and BO not accepted); ret DAY / IOC; MIS ("I") is not accepted on BFO.
 */

import { createNorenAdapter, norenCapabilities } from "./shoonyaNorenCore.mjs";
import { OAUTH_LOGIN_BASE, OAUTH_LOGIN_URL, WS_URL, send, session } from "./shoonyaAuth.mjs";
import { loadSegment } from "./shoonyaInstruments.mjs";

export const id = "shoonya";
export const credentialFields = ["userId", "apiKey", "apiSecret", "requestCode", "accessToken"];

// The docs give ~10 orders/s and "~1 req/sec per instrument" for REST quotes (each chain leg is a
// different instrument). Ten quotes a second keeps a chain refresh to a few seconds with headroom.
const QUOTE_BATCH = { size: 10, delayMs: 1000 };
const STRIKE_HALF_WIDTH = 20;

const core = createNorenAdapter({
  id,
  label: "Shoonya",
  uidField: "userId",
  session,
  send,
  wsUrl: WS_URL,
  loadSegment,
  connectionEndpoint: "/Limits",
  quoteBatch: QUOTE_BATCH,
  strikeHalfWidth: STRIKE_HALF_WIDTH,
  orderRules: { products: ["CNC", "INTRADAY", "MARGIN"], allowMarket: false, noIntradayOn: ["BFO"] },
});

export const capabilities = norenCapabilities({ mtf: false, products: ["CNC", "INTRADAY", "MARGIN"] });

export const {
  testConnection, fetchInstruments, fetchExpiryList, fetchLTP, fetchOptionChain, fetchQuotes, fetchDepth, fetchHistorical,
  fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook, normaliseError, createFeed,
  placeOrder, modifyOrder, cancelOrder,
} = core;

export const buildOrderBody = (uid, order, resolvedLotSize) => core.buildOrderBody(uid, order, resolvedLotSize);
export const buildModifyBody = (uid, orderId, changes, original) => core.buildModifyBody(uid, orderId, changes, original);

/** Where the user gets an authorisation code (for the Broker Settings help text). */
export const loginUrl = (apiKey) => `${OAUTH_LOGIN_URL}?client_id=${encodeURIComponent(apiKey || "")}`;
export { OAUTH_LOGIN_BASE };
