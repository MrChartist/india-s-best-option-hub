/**
 * Zebu (MYNT) adapter on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://zebumyntapi.web.app/ (OAuth section: Authentication, Masters, Market Quotes,
 * Order, Portfolio, Limits, Users, Web Socket). Zebu runs Kambala's Noren OMS behind an OAuth front door.
 * OpenAlgo (AGPL) was read for facts only; where it differs from the docs the docs are followed and the
 * module concerned says so.
 *
 * Auth (requestTokenExchange): the user saves the trading user ID, OAuth Client ID, Secret Code and the
 * one-time authorisation code; the first call exchanges the code (GenAcsTok) and the session is kept in
 * this process and renewed with the documented refresh token (zebuAuth.mjs).
 * Market data (zebuMarket.mjs): symbol masters (zebuInstruments.mjs) windowed around spot + one GetQuotes
 * call per contract; IV/Greeks solved locally. Candles: TPSeries (intraday) and EODChartData (daily).
 * Portfolio and books: zebuPortfolio.mjs. Orders (gated): zebuOrders.mjs.
 *
 * Fixed here (against the earlier version): parallel chain quotes could each try to exchange the single-use
 * code; masters are now downloaded with the Bearer token the docs require; the 1-hour token is refreshed
 * instead of failing; SENSEX/BANKEX/stock option chains; real-money calls are gated.
 *
 * Not declared: feed. The OAuth WebSocket page documents the message format but not the endpoint or which
 * token goes in `susertoken` for OAuth sessions, so it is not wired without a live check.
 */

import { ensureSession, postJData, expectOk, OAUTH_LOGIN_URL } from "./zebuAuth.mjs";
import { getMaster, MASTER_EXCHANGES } from "./zebuInstruments.mjs";
import { ORDER_FEATURES } from "./zebuOrders.mjs";

export const id = "zebu";
export const credentialFields = ["userId", "clientId", "apiSecret", "authCode"];

export const capabilities = {
  auth: { kind: "requestTokenExchange" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "3m", "5m", "15m", "30m", "60m", "1d"] },
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

export { normaliseError } from "./contract.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical } from "./zebuMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./zebuPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./zebuOrders.mjs";

/** Where the user gets an authorisation code (for Broker Settings help text). */
export const loginUrl = (clientId) => `${OAUTH_LOGIN_URL}?client_id=${encodeURIComponent(clientId || "")}`;

/** One cheap authenticated call (Limits). Never throws. */
export async function testConnection(creds = {}) {
  try {
    await ensureSession(creds);
    expectOk(await postJData(creds, "/Limits", {}), "Limits");
    return { status: "success", message: `Zebu connected (account ${creds.userId})` };
  } catch (e) {
    return { status: "error", message: e?.message || "Zebu connection failed" };
  }
}

/** NSE equities + indices, NFO and BFO derivatives from the daily masters. */
export async function fetchInstruments(creds) {
  const lists = [];
  for (const exchange of MASTER_EXCHANGES) lists.push(await getMaster(creds, exchange));
  return { status: "success", data: lists.flat() };
}
