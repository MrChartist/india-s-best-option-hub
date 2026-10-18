/**
 * Goodwill Wealth Management (Goodwill API v1) on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://developer.gwcindia.in/api/ (introduction, login, profile, balance, positions, holdings,
 * orderBook, tradeBook, placeOrder, modifyOrder, cancelOrder, getQuote, instruments, webSocket, appendix) and the
 * official Postman collection, checked 2026-10.
 *
 * Goodwill wraps a Noren OMS behind its own REST API: request and response field names are Goodwill's own, but
 * the symbol masters and the WebSocket are standard Noren, so the shared Noren parsers in shoonyaNorenCore.mjs
 * are imported (not changed) for the masters, status words and touchline fields.
 *
 * Auth (requestTokenExchange): the user signs in on Goodwill's page each day and pastes the request_token;
 * goodwillAuth.mjs swaps it once (SHA-256 signature with the API secret). No password or TOTP reaches this app.
 * Market data (goodwillMarket.mjs): NSE/NFO masters plus one quote per contract near the money; IV/Greeks are
 * back-solved. There is no historical, depth or option-chain endpoint, and no BFO master, so SENSEX/BANKEX
 * options are not served. Live touchline (with OI and best bid/ask): goodwillFeed.mjs. Books: goodwillPortfolio.mjs.
 * Orders (gated): goodwillOrders.mjs.
 */

import { gwRequest } from "./goodwillAuth.mjs";
import { getSegment, indexInstruments } from "./goodwillInstruments.mjs";
import { ORDER_FEATURES } from "./goodwillOrders.mjs";

export const id = "goodwill";
export const credentialFields = ["clientId", "apiKey", "apiSecret", "requestToken", "accessToken", "userSessionId"];

export const capabilities = {
  auth: { kind: "requestTokenExchange", loginUrl: "https://api.gwcindia.in/v1/login?api_key={apiKey}" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed", oi: false, strikesEachSide: 10 },
  ltp: true,
  quotes: true,
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

export { normaliseError } from "./goodwillAuth.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes } from "./goodwillMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./goodwillPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./goodwillOrders.mjs";
export { createFeed } from "./goodwillFeed.mjs";

/** One cheap authenticated call (GET /profile), after the request-token exchange. Never throws. */
export async function testConnection(creds = {}) {
  try {
    const p = await gwRequest(creds, "profile");
    const first = String(p?.name ?? "").split(" ")[0];
    return { status: "success", message: first ? `Goodwill connected (${first})` : "Goodwill connected" };
  } catch (e) {
    return { status: "error", message: e?.message || "Goodwill connection failed" };
  }
}

/** The six indices, NSE equities and NFO index/stock derivatives from the daily masters. */
export async function fetchInstruments() {
  return { status: "success", data: [...indexInstruments(), ...(await getSegment("NSE")), ...(await getSegment("NFO"))] };
}
