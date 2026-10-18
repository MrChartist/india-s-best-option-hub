/**
 * IndMoney (INDstocks) on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://api-docs.indstocks.com/getting-started/ and the official Postman collection it links,
 * https://documenter.getpostman.com/view/56363899/2sBY4LShyj (User & Account, Market Data, Orders, Trades &
 * Executions, Portfolio, Streaming, Error Codes), checked 2026-10. OpenAlgo (AGPL) was read for facts only.
 *
 * Auth (sessionLogin): the user types the MPIN and the current 6-digit TOTP code; login() calls
 * POST /generate/token with the Client ID as x-api-key and keeps only { accessToken } (24 hours). A token
 * generated on indstocks.com can also be pasted into `accessToken`; both are sent raw (no "Bearer").
 * Market data (indmoneyMarket.mjs): chain from the fno instrument CSV + batched /market/quotes/full, IV and
 * Greeks back-solved (the Options Toolkit is "coming soon"); LTP, quotes, depth and candles from the
 * documented endpoints. Feed: indmoneyFeed.mjs (JSON WebSocket). Portfolio/books: indmoneyPortfolio.mjs.
 * Orders (gated): indmoneyOrders.mjs.
 *
 * Fixed here (vs the earlier adapter): no option was ever found (it filtered on SYMBOL_NAME, blank on
 * derivatives); EXPIRY_DATE was parsed day-first (it is MM/DD/YYYY); index names did not match the index
 * file ("BANK NIFTY", "Nifty Financial", "Nifty Midcap Sel"); BANKEX was missing; a pasted token was
 * re-validated against /user/profile every 30 minutes; the MPIN + TOTP-secret auto-login (dead since the
 * proxy strips those fields) is replaced by the platform session login, so no TOTP secret is stored.
 *
 * OpenAlgo differences: OpenAlgo reads TICK_SIZE as rupees; the documented sample (5 for a Rs 0.05 option
 * tick) shows paise, which we follow.
 */

import { LOGIN_FIELDS, SESSION_FIELDS, indRequest, sessionToken } from "./indmoneyAuth.mjs";
import { getEquity, getFno, getIndices } from "./indmoneyInstruments.mjs";
import { ORDER_FEATURES } from "./indmoneyOrders.mjs";

export const id = "indmoney";
export const credentialFields = ["clientId", "accessToken"];

export const capabilities = {
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "3m", "5m", "15m", "30m", "60m", "1d"] },
  feed: { transport: "websocket", modes: ["ltp", "quote"] },
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
  ...ORDER_FEATURES,
};

export { login, normaliseError } from "./indmoneyAuth.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical } from "./indmoneyMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./indmoneyPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./indmoneyOrders.mjs";
export { createFeed } from "./indmoneyFeed.mjs";

/** One cheap authenticated call (GET /user/profile). Never throws. */
export async function testConnection(creds = {}) {
  try {
    sessionToken(creds);
    const json = await indRequest(creds, "/user/profile");
    const who = json?.data?.user_id ? ` (user ${json.data.user_id})` : "";
    return { status: "success", message: `IndMoney session is active${who}` };
  } catch (e) {
    return { status: "error", message: e?.message || "IndMoney connection failed" };
  }
}

/** Index, F&O and equity instruments from the three documented CSV sources. */
export async function fetchInstruments(creds) {
  sessionToken(creds);
  const [indices, fno, equity] = [await getIndices(creds), await getFno(creds), await getEquity(creds)];
  const strip = ({ scripCode: _s, ...m }) => m;
  return { status: "success", data: [...indices, ...fno, ...equity].map(strip) };
}
