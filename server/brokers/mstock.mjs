/**
 * mStock (Mirae Asset) Type B adapter on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://tradingapi.mstock.com/docs/v1/Introduction/ and the Type B pages
 * (User, Orders, Portfolio, Position, market-quote-and-instrument, historical-candle, intraday-chart-data,
 * option-chain-apis, market-data, error-codes) plus https://tradingapi.mstock.com/docs/v1/Annexure/.
 * Where observed behaviour differs from the docs the docs are followed and the module that makes the call says so.
 *
 * Auth (sessionLogin): the user types the password and the current TOTP code; login() returns only the JWT
 * and feed token (mstockAuth.mjs). Market data (mstockMarket.mjs): scrip master + batched REST quotes,
 * IV/Greeks solved locally; OI, volume and bid/ask are not part of the documented REST quote. Portfolio and
 * books: mstockPortfolio.mjs. Orders (gated): mstockOrders.mjs.
 *
 * Not declared: depth (WebSocket Snap Quote only) and feed (binary WebSocket; the docs give the packet
 * layout but not byte order or price units, so it is not wired without a live check).
 */

import { LOGIN_FIELDS, SESSION_FIELDS, getSession, authRequest } from "./mstockAuth.mjs";
import { getInstruments } from "./mstockInstruments.mjs";
import { ORDER_FEATURES } from "./mstockOrders.mjs";

export const id = "mstock";
export const credentialFields = ["clientId", "apiKey"];

export const capabilities = {
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
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

export { login } from "./mstockAuth.mjs";
export { normaliseError } from "./contract.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchHistorical } from "./mstockMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./mstockPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./mstockOrders.mjs";

/** One cheap authenticated call (fund summary). Never throws. */
export async function testConnection(creds = {}) {
  try {
    getSession(creds);
    await authRequest(creds, "/user/fundsummary");
    return { status: "success", message: "mStock (Mirae Asset) session is active" };
  } catch (e) {
    return { status: "error", message: e?.message || "mStock connection failed" };
  }
}

export async function fetchInstruments(creds) {
  return { status: "success", data: await getInstruments(creds) };
}
