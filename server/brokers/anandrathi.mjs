/**
 * Anand Rathi (Algozy) on the broker contract. Algozy is Anand Rathi's deployment of Symphony Fintech's
 * XTS platform at https://algozy.rathi.com, so the engine lives in compositedgeXtsCore.mjs (shared with
 * compositedge, ibulls, jainamxts and fivepaisaxts); this file holds only what is specific to Anand Rathi.
 *
 *  - Market data: https://algozy.rathi.com/apimarketdata (the JSON Market Data API). The broker's own copy
 *    of the official spec, https://algozy.rathi.com/doc/marketdata/ ("ANAND RATHI MARKETDATA API"), lists
 *    this as its live server.
 *  - Trading (Interactive API): https://algozy.rathi.com/interactive, a plain XTS key-pair login,
 *    POST /interactive/user/session {appKey, secretKey, source:"WebAPI"}. Both key pairs come from the Algozy
 *    dashboard (https://algozy.rathi.com/dashboard) and are swapped server-side (auth kind apiKeyToken).
 *
 * Open items (need a live check before trading is enabled):
 *  - The broker's Interactive spec (https://algozy.rathi.com/doc/interactive/) also documents XTS's
 *    HostLookup variant (POST /hostlookup returns a uniqueKey and a connectionString, and its
 *    SessionLoginBody lists uniqueKey). The deployed /interactive/user/session only validates appKey and
 *    secretKey, so the standard route is used. The HostLookup flow is deliberately not followed: the core
 *    never talks to a host returned by the broker.
 *  - No official page says whether retail clients can create API apps without help; confirm onboarding
 *    with Anand Rathi.
 */

import { createXtsBroker, xtsCapabilities } from "./compositedgeXtsCore.mjs";

export const id = "anandrathi";
export const credentialFields = ["marketApiKey", "marketApiSecret", "interactiveApiKey", "interactiveApiSecret", "clientId"];

const broker = createXtsBroker({
  id,
  label: "Anand Rathi (Algozy)",
  host: "https://algozy.rathi.com",
  marketDataPath: "/apimarketdata",
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
