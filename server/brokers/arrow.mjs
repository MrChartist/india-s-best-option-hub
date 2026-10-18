/**
 * Arrow (arrow.trade, iRage Broking) adapter (contract v1, server/brokers/contract.mjs).
 *
 * Auth: requestTokenExchange (arrowAuth.mjs). The user logs in on Arrow's own page and saves the single-use
 * request-token with the App ID and App Secret; the adapter exchanges it once for a 24-hour access token kept
 * in memory only.
 *
 * Option chain: /info/option-chain lists the contracts around ATM for an underlying + expiry, batched FULL
 * quotes price them (LTP, OI, session-open OI, volume, best bid/ask), and Black-Scholes fills IV and Greeks
 * because Arrow publishes none over REST (arrowMarket.mjs). Expiries come from /info/option-chain-symbols/all.
 * Also: instrument master, quotes, depth, historical candles, positions, holdings, funds, order book,
 * trade book and gated orders (arrowOrders.mjs). The binary WebSocket feed (wss://ds.arrow.trade) is not
 * wired in v1 (`feed` not declared).
 *
 * Official docs: https://docs.arrow.trade/ (REST API section; full export at /llms-full.txt).
 */

import { arrowFetch, getAccessToken } from "./arrowAuth.mjs";
import { getInstruments } from "./arrowMarket.mjs";
import { ORDER_FEATURES } from "./arrowOrders.mjs";

export { normaliseError } from "./contract.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical } from "./arrowMarket.mjs";
export {
  buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder, fetchOrderBook, fetchTradeBook, fetchPositions, fetchHoldings, fetchFunds,
} from "./arrowOrders.mjs";

export const id = "arrow";
export const credentialFields = ["appId", "appSecret", "requestToken"];

export const capabilities = {
  ...ORDER_FEATURES,
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
};

export async function testConnection(creds = {}) {
  try {
    await getAccessToken(creds);
    const json = await arrowFetch(creds, "/user/details", { what: "user details" });
    const user = json?.data?.id ? ` as ${String(json.data.id)}` : "";
    return { status: "success", message: `Arrow connected${user}` };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchInstruments(creds) {
  return { status: "success", data: await getInstruments(creds) };
}
