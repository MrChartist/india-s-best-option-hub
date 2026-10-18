/**
 * IndiaBulls Securities (Dhani Stocks) on the broker contract. IndiaBulls runs Symphony Fintech's XTS
 * platform at https://xts.ibullssecurities.com, so the engine lives in compositedgeXtsCore.mjs (shared
 * with compositedge and jainamxts); this file holds only what is specific to IndiaBulls.
 *
 *  - Market data: https://xts.ibullssecurities.com/apibinarymarketdata. This is XTS's binary-feed
 *    market-data deployment; its REST routes (auth/login, instruments/master, indexlist, quotes, ohlc)
 *    are the same as the JSON API and still answer publishFormat "JSON" (route list confirmed in Symphony's
 *    official xts-pythonsdk-binarymarketdata SDK).
 *  - Trading (Interactive API): a plain XTS key-pair login, POST /interactive/user/session
 *    {appKey, secretKey, source:"WebAPI"}, so both the Market Data pair and the Interactive pair are
 *    swapped server-side (auth kind apiKeyToken). Tokens are cached until the next IST midnight and
 *    re-created once on a token rejection for read calls; order calls never retry.
 *
 * Note: OpenAlgo turns IndiaBulls MARKET orders into LIMIT orders priced off the touchline, which hints
 * that the broker may reject market orders through the API. Nothing in the official docs says so, so
 * orders are sent as requested; this needs a live check before trading is enabled.
 */

import { createXtsBroker, xtsCapabilities } from "./compositedgeXtsCore.mjs";

export const id = "ibulls";
export const credentialFields = ["marketApiKey", "marketApiSecret", "interactiveApiKey", "interactiveApiSecret", "clientId"];

const broker = createXtsBroker({
  id,
  label: "IndiaBulls Securities",
  host: "https://xts.ibullssecurities.com",
  marketDataPath: "/apibinarymarketdata",
  marketFields: { key: "marketApiKey", secret: "marketApiSecret" },
  interactiveMode: "keyPair",
});

export const capabilities = xtsCapabilities("apiKeyToken");
export const BASE_URLS = broker.urls;

export const {
  testConnection, fetchInstruments, fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical,
  fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook, placeOrder, modifyOrder, cancelOrder,
  normaliseError,
} = broker;

/** Test-only: clear cached sessions and set throttle spacing. */
export const resetForTests = broker.resetForTests;
