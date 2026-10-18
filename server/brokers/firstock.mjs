/**
 * Firstock adapter on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://firstock.in/api/docs/ (login, downloaders, request-responses, exception-errors,
 * index-list, get-expiry, option-chain-with-greeks, get-multi-quote, time-price-regular-interval,
 * time-price-day-interval, place-order, modify-order, cancel-order, order-book, trade-book, position-book,
 * holding-details, limits).
 *
 * Auth (sessionLogin): password (sent as SHA-256) + current TOTP code -> susertoken, used as jKey
 * (firstockAuth.mjs). Market data (firstockMarket.mjs): the chain comes from /optionChainGreeks (broker
 * IV in percent, Greeks and OI) plus one /getMultiQuotes call for spot and near-the-money bid/ask;
 * expiries and instruments come from the public symbol files (firstockInstruments.mjs). Portfolio and
 * books: firstockPortfolio.mjs. Orders (gated): firstockOrders.mjs.
 *
 * Fixed here: the old chain made one quote call per 50 legs at the (since reduced) 1 req/s quote limit and
 * back-solved IV that Firstock now sends; error classification no longer treats any message containing
 * "token" as an expired session; BANKEX and stock options are supported.
 *
 * Not declared: feed. Firstock's V2 WebSocket pages render client-side and could not be read for the
 * handshake; wiring it needs a live check.
 */

import { LOGIN_FIELDS, SESSION_FIELDS, callApi, ensureSession } from "./firstockAuth.mjs";
import { getFile } from "./firstockInstruments.mjs";
import { ORDER_FEATURES } from "./firstockOrders.mjs";

export const id = "firstock";
export const credentialFields = ["userId", "vendorCode", "apiKey"];

export const capabilities = {
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
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

export { login } from "./firstockAuth.mjs";
export { normaliseError } from "./contract.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical } from "./firstockMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./firstockPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./firstockOrders.mjs";

/** One cheap authenticated call (/limit). Never throws. */
export async function testConnection(creds = {}) {
  try {
    ensureSession(creds);
    await callApi(creds, "/limit");
    return { status: "success", message: "Firstock session is active" };
  } catch (e) {
    return { status: "error", message: e?.message || "Firstock connection failed" };
  }
}

/** Index derivatives (Indices file) + stock F&O (NFO, BFO) + NSE equities from the public symbol files. */
export async function fetchInstruments() {
  const files = await Promise.all(["Indices", "NFO", "BFO", "NSE"].map((f) => getFile(f)));
  return { status: "success", data: files.flat() };
}
