/**
 * 5paisa (XTS) on the broker contract. Besides its own Xstream OpenAPI (the "fivepaisa" adapter), 5paisa
 * runs a Symphony Fintech XTS deployment at https://xtsmum.5paisa.com. The engine lives in
 * compositedgeXtsCore.mjs (shared with compositedge, ibulls, jainamxts and anandrathi); this file holds
 * only what is specific to this deployment.
 *
 *  - Market data: https://xtsmum.5paisa.com/apimarketdata (the JSON Market Data API).
 *  - Trading (Interactive API): https://xtsmum.5paisa.com/interactive, a plain XTS key-pair login,
 *    POST /interactive/user/session {appKey, secretKey, source:"WebAPI"}. Both apps are created on
 *    https://xtsmum.5paisa.com/dashboard (5paisa approves them) and the keys are swapped server-side
 *    (auth kind apiKeyToken).
 *
 * 5paisa publishes no XTS documents of its own, so this rests on Symphony's official XTS specs
 * (https://symphonyfintech.com/xts-trading-front-end-api/) plus the host, whose login routes answer the
 * standard XTS validation envelope. Needs a live check with approved keys before trading is enabled.
 */

import { createXtsBroker, xtsCapabilities } from "./compositedgeXtsCore.mjs";

export const id = "fivepaisaxts";
export const credentialFields = ["marketApiKey", "marketApiSecret", "interactiveApiKey", "interactiveApiSecret", "clientId"];

const broker = createXtsBroker({
  id,
  label: "5paisa (XTS)",
  host: "https://xtsmum.5paisa.com",
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
