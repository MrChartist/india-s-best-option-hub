/**
 * IIFL Securities on the broker contract. IIFL runs Symphony Fintech's XTS platform ("IIFL Blaze") at
 * https://ttblaze.iifl.com; the engine is rmoneyXtsFamily.mjs (shared with rmoney and wisdom) and this
 * file holds only what is specific to IIFL.
 *
 * Official docs (IIFL's own deployment): https://ttblaze.iifl.com/doc/interactive/ and
 * https://ttblaze.iifl.com/doc/apimarketdata/.
 *
 *  - Market data: https://ttblaze.iifl.com/apibinarymarketdata (Binary Market Data API; its REST routes
 *    answer publishFormat "JSON"). The Market Data App Key + Secret Key (apiKey / apiSecret) are swapped
 *    server-side for a token that lasts 24 hours.
 *  - Trading (Interactive API), official v2 flow: open
 *    https://ttblaze.iifl.com/interactive/thirdparty?appKey=<Interactive App Key>&returnURL=<registered URL>,
 *    sign in (user ID, password, then PIN/OTP on IIFL's own page) and copy the `accessToken` from the return
 *    URL into Broker Settings as `requestToken`. The adapter then calls POST /hostlookup for the UniqueKey
 *    and connectionString and POST {connectionString}/user/session {appKey, secretKey, accessToken, uniqueKey}.
 *    A used or rejected token raises SessionRequiredError; there is no automatic re-login.
 *    With no requestToken saved, the plain key-pair login (POST /interactive/user/session
 *    {appKey, secretKey, source:"WebAPI"}, the official SDK route that OpenAlgo also uses) is tried instead.
 *
 * Where OpenAlgo differs from IIFL's official docs we follow the docs:
 *  - market data path: OpenAlgo uses /apimarketdata, the docs give /apibinarymarketdata;
 *  - trading login: OpenAlgo posts only {appKey, secretKey, source} to /interactive/user/session; the docs
 *    require the OAuth accessToken and the host-lookup uniqueKey (kept as the fallback described above);
 *  - masters and index list: OpenAlgo calls them without a token; the docs require the token.
 * The previous adapter matched NIFTY options on UnderlyingIndexName because it believed the Name column
 * said "INIFTY"; the official master sample shows Name "NIFTY", so Name is used with UnderlyingIndexName
 * as a fallback.
 */

import { createXtsFamilyBroker, xtsFamilyCapabilities } from "./rmoneyXtsFamily.mjs";

export const id = "iifl";
export const credentialFields = ["apiKey", "apiSecret", "interactiveApiKey", "interactiveApiSecret", "requestToken", "clientId"];
export const LOGIN_URL = "https://ttblaze.iifl.com/interactive/thirdparty";

const broker = createXtsFamilyBroker({
  id,
  label: "IIFL Securities",
  host: "https://ttblaze.iifl.com",
  marketDataPath: "/apibinarymarketdata",
  interactiveMode: "oauthHostLookup",
  hostLookupUrl: "https://ttblaze.iifl.com/hostlookup",
  loginHint: `Log in again at ${LOGIN_URL}?appKey=<your Interactive App Key>&returnURL=<your registered URL> and save the new accessToken as the request token in Broker Settings.`,
});

export const capabilities = xtsFamilyCapabilities("requestTokenExchange");
export const BASE_URLS = broker.urls;

export const {
  testConnection, fetchInstruments, fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical,
  fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook, placeOrder, modifyOrder, cancelOrder,
  normaliseError,
} = broker;

/** Test-only: clear cached sessions and set throttle spacing. */
export const resetForTests = broker.resetForTests;
