/**
 * TradeSmart (Noren v2) adapter on the broker contract (server/brokers/contract.mjs).
 *
 * TradeSmart runs Kambala's Noren OMS on its own v2 host with OAuth (Bearer) auth; the shared engine is
 * shoonyaNorenCore.mjs, the host-specific parts are tradesmartAuth.mjs and tradesmartInstruments.mjs.
 * The official docs (https://apidocs.tradesmartonline.in/v2/) could not be fetched (Cloudflare 403), so
 * field names follow the Noren family's documented contract (Shoonya/Flattrade official pages and
 * Kambala's SDK) and everything here needs live verification on a TradeSmart account.
 *
 * Auth (requestTokenExchange): Client ID, app key, secret key and the one-time OAuth code; the first call
 * runs GenAcsTok and the token is kept in this process until its expiry. A pasted `accessToken` works too.
 *
 * Index spot tokens are the exchange tokens used on every Noren gateway (NSE 26000/26009/26037/26074,
 * BSE 1/12). The previous module found no MIDCPNIFTY INDEX row in TradeSmart's NSE master; the quote
 * call with NSE|26074 needs live confirmation.
 *
 * Orders (gated; nothing mints gates for this broker today): with the official order page unreadable,
 * the conservative Noren rule applies: LMT and SL-LMT only (MARKET / SL-M refused locally), products
 * C / M / I, validity DAY / IOC.
 */

import { createNorenAdapter, norenCapabilities } from "./shoonyaNorenCore.mjs";
import { OAUTH_LOGIN_URL, WS_URL, send, session } from "./tradesmartAuth.mjs";
import { loadSegment } from "./tradesmartInstruments.mjs";

export const id = "tradesmart";
export const credentialFields = ["clientId", "apiKey", "apiSecret", "requestCode", "accessToken"];

// No published limit could be read; use the Shoonya/Noren ~10 requests/second budget.
const QUOTE_BATCH = { size: 10, delayMs: 1000 };
const STRIKE_HALF_WIDTH = 20;

const core = createNorenAdapter({
  id,
  label: "TradeSmart",
  uidField: "clientId",
  session,
  send,
  wsUrl: WS_URL,
  loadSegment,
  connectionEndpoint: "/Limits",
  quoteBatch: QUOTE_BATCH,
  strikeHalfWidth: STRIKE_HALF_WIDTH,
  orderRules: { products: ["CNC", "INTRADAY", "MARGIN"], allowMarket: false },
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
