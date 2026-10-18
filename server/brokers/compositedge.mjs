/**
 * CompositEdge on the broker contract. CompositEdge runs Symphony Fintech's XTS platform at
 * https://xts.compositedge.com, so the engine lives in compositedgeXtsCore.mjs (shared with ibulls and
 * jainamxts); this file holds only what is specific to CompositEdge.
 *
 *  - Market data: https://xts.compositedge.com/apimarketdata (the JSON market-data API). The Market Data
 *    App Key + Secret Key (apiKey / apiSecret) are swapped server-side for a token; nothing else is needed
 *    for expiries, option chains, quotes, depth and candles.
 *  - Trading (Interactive API): CompositEdge uses XTS's 3-legged login. The user opens
 *    https://xts.compositedge.com/interactive/thirdparty?appKey=<Interactive App Key>&returnURL=<registered URL>,
 *    signs in, and the broker posts a session object whose `accessToken` is a one-time request token.
 *    That token goes in Broker Settings as `requestToken`; the adapter exchanges it once via
 *    POST /interactive/user/session {appKey, secretKey, accessToken}. The official XTS docs describe the
 *    same step ("once the request_token is obtained from the login flow, it should be POSTed to
 *    /user/session"). A used or expired token raises SessionRequiredError; there is no automatic re-login.
 *
 * Differences from OpenAlgo (official docs followed): see the header of compositedgeXtsCore.mjs. In
 * addition, OpenAlgo's CompositEdge modify-order reader looks for {status:"true", data:{orderid}}, which is
 * not the documented XTS envelope ({type:"success", result:{AppOrderID}}); we read the documented one.
 */

import { createXtsBroker, xtsCapabilities } from "./compositedgeXtsCore.mjs";

export const id = "compositedge";
export const credentialFields = ["apiKey", "apiSecret", "interactiveApiKey", "interactiveApiSecret", "requestToken", "clientId"];
export const LOGIN_URL = "https://xts.compositedge.com/interactive/thirdparty";

const broker = createXtsBroker({
  id,
  label: "CompositEdge",
  host: "https://xts.compositedge.com",
  marketDataPath: "/apimarketdata",
  marketFields: { key: "apiKey", secret: "apiSecret" },
  interactiveMode: "requestToken",
  requestTokenField: "requestToken",
  loginHint: `Log in again at ${LOGIN_URL}?appKey=<your Interactive App Key>&returnURL=<your registered URL> and save the new accessToken as the request token in Broker Settings.`,
});

export const capabilities = xtsCapabilities("requestTokenExchange");
export const BASE_URLS = broker.urls;

export const {
  testConnection, fetchInstruments, fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical,
  fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook, placeOrder, modifyOrder, cancelOrder,
  normaliseError,
} = broker;

/** Test-only: clear cached sessions and set throttle spacing. */
export const resetForTests = broker.resetForTests;
