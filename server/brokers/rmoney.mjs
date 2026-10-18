/**
 * RMoney on the broker contract. RMoney runs Symphony Fintech's XTS platform at
 * https://xts.rmoneyindia.co.in:3000; the engine is rmoneyXtsFamily.mjs (shared with wisdom and iifl) and
 * this file holds only what is specific to RMoney.
 *
 *  - Market data: https://xts.rmoneyindia.co.in:3000/apibinarymarketdata (Binary Market Data API; its
 *    REST routes answer publishFormat "JSON"). The Market Data App Key + Secret Key (apiKey / apiSecret)
 *    are swapped server-side for a token.
 *  - Trading (Interactive API): RMoney's apps use XTS's third-party login. The user opens
 *    https://xts.rmoneyindia.co.in:3000/interactive/thirdparty?appKey=<Interactive App Key>&returnURL=<URL>,
 *    signs in on RMoney's page, and the broker posts back a session object whose `token` is already the
 *    trading session token (no exchange step). That token is pasted into Broker Settings as
 *    `interactiveSessionToken` and used as-is until it is rejected or the IST day ends; then the user
 *    logs in again (SessionRequiredError, no automatic re-login). Auth kind apiKeyToken: the user pastes a
 *    token; nothing is exchanged server-side.
 *
 * RMoney publishes no reachable API docs (its /doc pages reset the connection during this audit). Host,
 * port, the /apibinarymarketdata path and the "session already holds the token" behaviour come from
 * OpenAlgo (facts only) and differ from the generic XTS v2 docs, where the third-party login returns an
 * accessToken that is exchanged via /hostlookup + /user/session. We follow OpenAlgo here because it is the
 * only RMoney-specific source; confirm on a live account. Fixes over the previous adapter: the option
 * chain no longer reads UnderlyingInstrumentId as the index token (the official master sample has -1
 * there for index options), quotes accept listQuotes as an object as well as an array, and masters are
 * fetched with the token.
 */

import { createXtsFamilyBroker, xtsFamilyCapabilities } from "./rmoneyXtsFamily.mjs";

export const id = "rmoney";
export const credentialFields = ["apiKey", "apiSecret", "interactiveSessionToken", "clientId"];
export const LOGIN_URL = "https://xts.rmoneyindia.co.in:3000/interactive/thirdparty";

const broker = createXtsFamilyBroker({
  id,
  label: "RMoney",
  host: "https://xts.rmoneyindia.co.in:3000",
  marketDataPath: "/apibinarymarketdata",
  interactiveMode: "pastedSession",
  loginHint: `Log in again at ${LOGIN_URL}?appKey=<your Interactive App Key>&returnURL=<your URL> and paste the new session token in Broker Settings.`,
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
