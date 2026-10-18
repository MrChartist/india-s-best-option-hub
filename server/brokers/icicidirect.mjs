/**
 * ICICI Direct (Breeze API) on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://api.icicidirect.com/breezeapi/documents/index.html (Introduction, Regulatory Changes,
 * Checksum Computation & Login, Request Headers, Instruments, CustomerDetails, DematHoldings, Funds, Order,
 * PortfolioPositions, Quotes, Trades, OptionChain, HistoricalChartsv2), checked 2026-10. OpenAlgo has no ICICI
 * Direct adapter; nothing was taken from it.
 *
 * Auth (requestTokenExchange): the user logs in on ICICI Direct's page each day and pastes the API_Session value;
 * icicidirectAuth.mjs swaps it once (CustomerDetails) for the session token and signs every call with
 * SHA-256(timestamp + body + secret_key). No password or OTP reaches this app.
 * Market data (icicidirectMarket.mjs): Breeze's native option chain (two calls: calls and puts, with OI, OI change
 * and best bid/offer; IV/Greeks back-solved), per-instrument quotes and v2 candles. Breeze covers NSE cash and NSE
 * F&O only, so SENSEX/BANKEX are not served. Books: icicidirectPortfolio.mjs. Orders (gated, limit/stop-loss only,
 * as Breeze forbids market orders): icicidirectOrders.mjs.
 * Rate limit: 100 calls a minute and 5000 a day; icicidirectAuth.mjs paces every call under it.
 * Not declared: depth (no endpoint; quotes carry only the best bid/offer) and feed (Breeze streams over Socket.IO,
 * which needs a client library this project does not ship).
 */

import { breezeRequest } from "./icicidirectAuth.mjs";
import { getMaster, indexInstruments } from "./icicidirectInstruments.mjs";
import { ORDER_FEATURES } from "./icicidirectOrders.mjs";

export const id = "icicidirect";
export const credentialFields = ["appKey", "secretKey", "apiSession", "accessToken"];

export const capabilities = {
  auth: { kind: "requestTokenExchange", loginUrl: "https://api.icicidirect.com/apiuser/login?api_key={appKey}" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  historical: { intervals: ["1m", "5m", "30m", "1d"] },
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

export { normaliseError } from "./icicidirectAuth.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchHistorical } from "./icicidirectMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./icicidirectPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./icicidirectOrders.mjs";

/** One cheap signed call (GET /funds), after the API_Session exchange. Never throws. */
export async function testConnection(creds = {}) {
  try {
    await breezeRequest(creds, "funds");
    return { status: "success", message: "ICICI Direct connected" };
  } catch (e) {
    return { status: "error", message: e?.message || "ICICI Direct connection failed" };
  }
}

/** The four NSE indices, NSE equities and NSE F&O from the daily security master. */
export async function fetchInstruments() {
  const strip = ({ breezeCode: _b, ...m }) => m;
  const master = await getMaster();
  return { status: "success", data: [...indexInstruments(), ...master.nse, ...master.fno].map(strip) };
}
