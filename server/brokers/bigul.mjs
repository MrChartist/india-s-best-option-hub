/**
 * Bigul (Bigul Connect APIs, Bonanza Portfolio) adapter (contract v1, server/brokers/contract.mjs).
 *
 * Official docs: https://connect.bigul.co/docs (checked 2026-10) and Bigul's official Python SDK linked there.
 * Auth (bigulAuth.mjs): session login. The app key, app secret and client code are saved; the user types the current
 * TOTP code and only the day's access token (valid until 00:30 IST) is kept. A static IP must be whitelisted for the app.
 * Market data: no REST quote endpoint exists, so LTP, quotes, depth and chain prices come from the market-data
 * WebSocket (bigulFeed.mjs) over the public daily master (bigulInstruments.mjs); IV and greeks are computed locally.
 * Portfolio (bigulPortfolio.mjs) and gated LIMIT/SL orders (bigulOrders.mjs) are REST.
 * Not declared: historical (no candle endpoint is documented). GTT/OCO/advance orders are out of scope.
 *
 * Needs a live check before it leaves beta: the feed's connect "source" value, the funds field mapping, and the
 * modify-order sr/au values.
 */

import { BrokerError, normaliseError as baseNormalise } from "./contract.mjs";
import { bgRequest, LOGIN_FIELDS, SESSION_FIELDS } from "./bigulAuth.mjs";
import { ORDER_FEATURES } from "./bigulOrders.mjs";

export { login } from "./bigulAuth.mjs";
export { fetchInstruments, fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, createFeed } from "./bigulMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./bigulPortfolio.mjs";
export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder } from "./bigulOrders.mjs";

export const id = "bigul";
export const credentialFields = ["apiKey", "apiSecret", "clientCode"];

/** Contract declaration. The TOTP code is typed per session, never stored. */
export const capabilities = {
  ...ORDER_FEATURES,
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  depth: true,
  feed: true,
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
};

/** One cheap authenticated call: POST /order/index-list { exch: "NSE" } (read-only reference data). Never throws. */
export async function testConnection(creds = {}) {
  try {
    await bgRequest(creds, "/order/index-list", { body: { exch: "NSE" }, kind: "read" });
    return { status: "success", message: "Bigul session is active" };
  } catch (e) {
    return { status: "error", message: normaliseError(e, { secrets: [creds.apiSecret, creds.sessionToken] }).message };
  }
}

/**
 * Error codes: our refusals (SessionRequiredError on a 401 or a feed rejection, BrokerInputError, OrderGateError) keep
 * 422. Upstream "Bigul error [<http>]: <message>" stays 502: 403 (bad key/secret or IP not whitelisted) is
 * UPSTREAM_AUTH and 429 UPSTREAM_RATE_LIMIT (both tagged where thrown); 400 is UPSTREAM_INPUT.
 */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError && (err.statusCode === 422 || err.code !== "UPSTREAM_ERROR")) return base;
  if (/\[400\]/.test(base.message)) return { ...base, code: "UPSTREAM_INPUT" };
  if (/\[429\]|rate limit/i.test(base.message)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  return base;
}
