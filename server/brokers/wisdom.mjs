/**
 * Wisdom Capital on the broker contract. Wisdom runs Symphony Fintech's XTS platform at
 * https://trade.wisdomcapital.in; the engine is rmoneyXtsFamily.mjs (shared with rmoney and iifl) and
 * this file holds only what is specific to Wisdom.
 *
 *  - Market data: https://trade.wisdomcapital.in/apimarketdata (JSON market-data API). The Market Data
 *    App Key + Secret Key (apiKey / apiSecret) are swapped server-side for a token.
 *  - Trading (Interactive API): plain XTS key-pair login, POST /interactive/user/session
 *    {appKey, secretKey, source:"WebAPI"} (the official SDK route), so auth kind is apiKeyToken. Read calls
 *    re-create the session once after a token rejection; order calls never retry.
 *
 * Wisdom does not publish reachable API docs (its doc pages did not answer during this audit). The host,
 * paths and key-pair login are not in any official Wisdom docs (observed behaviour; needs live verification) and match the generic XTS docs; the routes,
 * payloads and enums follow the official XTS documents listed in rmoneyXtsFamily.mjs. Confirm on a live
 * account before trading is enabled. Unlike the previous adapter, masters and the index list are fetched
 * with the token (the official docs require it) instead of anonymously first.
 */

import { createXtsFamilyBroker, xtsFamilyCapabilities } from "./rmoneyXtsFamily.mjs";

export const id = "wisdom";
export const credentialFields = ["apiKey", "apiSecret", "interactiveApiKey", "interactiveApiSecret", "clientId"];

const broker = createXtsFamilyBroker({
  id,
  label: "Wisdom Capital",
  host: "https://trade.wisdomcapital.in",
  marketDataPath: "/apimarketdata",
  interactiveMode: "keyPair",
});

export const capabilities = xtsFamilyCapabilities("apiKeyToken");
export const BASE_URLS = broker.urls;

export const {
  testConnection, fetchInstruments, fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical,
  fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook, placeOrder, modifyOrder, cancelOrder,
  normaliseError,
} = broker;

/** Test-only: clear cached sessions and set throttle spacing. */
export const resetForTests = broker.resetForTests;
