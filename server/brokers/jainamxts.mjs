/**
 * Jainam (XTS) on the broker contract. Jainam runs Symphony Fintech's XTS platform at
 * https://jtrade.jainam.in:5000, so the engine lives in compositedgeXtsCore.mjs (shared with compositedge
 * and ibulls); this file holds only what is specific to Jainam.
 *
 *  - Market data: https://jtrade.jainam.in:5000/apibinarymarketdata (XTS binary-feed deployment; same REST
 *    routes as the JSON API, publishFormat "JSON").
 *  - Trading (Interactive API): POST /interactive/user/session with the documented body
 *    {appKey, secretKey, source:"WebAPI"}, swapped server-side (auth kind apiKeyToken).
 *
 * Difference from OpenAlgo (official docs followed): OpenAlgo's Jainam login posts
 * {appKey, secretKey, accessToken:"jainamxts"} (a fixed placeholder in the 3-legged field). The official
 * SessionLoginBody is {secretKey, appKey, source}, which is what we send. Needs a live check: if Jainam's
 * deployment insists on the 3-legged field, switch interactiveMode to "requestToken".
 * The old adapter cached sessions under JSON.stringify(creds); sessions are now keyed by a SHA-256 of the
 * key pair only.
 */

import { createXtsBroker, xtsCapabilities } from "./compositedgeXtsCore.mjs";

export const id = "jainamxts";
export const credentialFields = ["apiKey", "apiSecret", "interactiveApiKey", "interactiveApiSecret", "clientId"];

const broker = createXtsBroker({
  id,
  label: "Jainam (XTS)",
  host: "https://jtrade.jainam.in:5000",
  marketDataPath: "/apibinarymarketdata",
  marketFields: { key: "apiKey", secret: "apiSecret" },
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
