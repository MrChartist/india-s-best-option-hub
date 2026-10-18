/**
 * Rupeezy (Vortex API, Astha Credit & Securities) on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://vortex.rupeezy.in/docs/latest/ (authentication, usage, instrument-list, option_chain,
 * historical, feed, regular-order, positions, holdings, trades, user), checked 2026-10.
 *
 * Auth (requestTokenExchange): the user signs in on Rupeezy's own page (https://flow.rupeezy.in?applicationId=...)
 * each day and pastes the `auth` value from the callback URL; rupeezyAuth.mjs swaps it once for an access token
 * (SHA-256 checksum with the x-api-key). No password, PIN or TOTP reaches this app.
 * Market data (rupeezyMarket.mjs): Rupeezy's native option chain with broker Greeks and IV, bulk quotes (up to
 * 1000 per call) for LTP / quotes / depth, and minute or daily candles. Live prices: rupeezyFeed.mjs (binary
 * WebSocket). Portfolio and books: rupeezyPortfolio.mjs. Orders (gated): rupeezyOrders.mjs.
 * Rate limits are 1 request/s for session, funds, quotes, history and option chain, 10/s for trading calls, and
 * 50,000 a day; rupeezyAuth.mjs paces every call under them.
 */

import { vortexRequest } from "./rupeezyAuth.mjs";
import { getMaster } from "./rupeezyInstruments.mjs";
import { ORDER_FEATURES } from "./rupeezyOrders.mjs";

export const id = "rupeezy";
export const credentialFields = ["applicationId", "apiKey", "authToken", "accessToken"];

export const capabilities = {
  auth: { kind: "requestTokenExchange", loginUrl: "https://flow.rupeezy.in?applicationId={applicationId}" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "3m", "5m", "15m", "30m", "60m", "1d"] },
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
  ...ORDER_FEATURES,
};

export { normaliseError } from "./rupeezyAuth.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical } from "./rupeezyMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./rupeezyPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./rupeezyOrders.mjs";
export { createFeed } from "./rupeezyFeed.mjs";

/** One cheap authenticated call (GET /user/funds), after the auth exchange. Never throws. */
export async function testConnection(creds = {}) {
  try {
    await vortexRequest(creds, "/user/funds");
    return { status: "success", message: "Rupeezy connected" };
  } catch (e) {
    return { status: "error", message: e?.message || "Rupeezy connection failed" };
  }
}

/** The six indices, NSE/BSE index derivatives, NSE stock derivatives and NSE equities from the daily master. */
export async function fetchInstruments() {
  const strip = ({ vortexExchange: _v, ...m }) => m;
  return { status: "success", data: (await getMaster()).map(strip) };
}
