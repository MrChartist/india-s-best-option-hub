/**
 * IIFL Capital (IIFL Markets Open API) on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://developers.iiflcapital.com/apidocs/ (introduction, user, ordermanagement, portfolio,
 * marketdataapis, marketdatastream, annexure) and the official Postman collection
 * (github.com/IIFLCapital/IIFL-Markets-Open-API-Postman-Collection-Official-), checked 2026-10.
 *
 * Auth (requestTokenExchange): the user logs in on IIFL's page each day and pastes the returned authCode;
 * iiflcapitalAuth.mjs swaps it (SHA-256 checksum with the app secret) for a userSession JWT valid until midnight.
 * Market data (iiflcapitalMarket.mjs): chain = daily contract file + bulk market quotes, OI per leg near the
 * money, IV/Greeks back-solved; LTP/quotes/depth/candles from the documented endpoints. Portfolio and books:
 * iiflcapitalPortfolio.mjs. Orders (gated): iiflcapitalOrders.mjs.
 *
 * Fixed here (vs the earlier adapter): BANKEX and stock options were missing; one OI call was made for every
 * leg of the chain (hundreds at 10/s); "empty book" errors (EC916/EC920/EC922/EC926) were not read as empty;
 * any message containing "session" or "token" (e.g. EC908 "'token' cannot be empty") dropped the session; the
 * session cache key held the raw secret; BSEFO's "OTPSTK" rows were ignored; the LTP for an unknown symbol
 * came back as 0 instead of an error.
 *
 * Not declared: feed. IIFL's stream is MQTT over WebSocket with its own binary packets and SDK; it needs a live
 * account to verify.
 */

import { iiflRequest, rowsOf } from "./iiflcapitalAuth.mjs";
import { getSegment } from "./iiflcapitalInstruments.mjs";
import { ORDER_FEATURES } from "./iiflcapitalOrders.mjs";

export const id = "iiflcapital";
export const credentialFields = ["clientId", "appSecret", "authCode", "userSession"];

export const capabilities = {
  auth: { kind: "requestTokenExchange" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed", oiStrikesEachSide: 12 },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "5m", "15m", "30m", "60m", "1d"] },
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

export { normaliseError } from "./iiflcapitalAuth.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical } from "./iiflcapitalMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./iiflcapitalPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./iiflcapitalOrders.mjs";

/** One cheap authenticated call (GET /profile), after the authCode exchange. Never throws. */
export async function testConnection(creds = {}) {
  try {
    const r = rowsOf(await iiflRequest(creds, "/profile"))[0] ?? {};
    return { status: "success", message: r.clientName ? `IIFL Capital connected (${String(r.clientName).split(" ")[0]})` : "IIFL Capital connected" };
  } catch (e) {
    return { status: "error", message: e?.message || "IIFL Capital connection failed" };
  }
}

/** Indices, NSE/BSE F&O and NSE equities from the daily contract files. */
export async function fetchInstruments() {
  const files = [];
  for (const seg of ["INDICES", "NSEFO", "BSEFO", "NSEEQ"]) files.push(await getSegment(seg));
  const strip = ({ iiflExchange: _x, ...m }) => m;
  return { status: "success", data: files.flat().map(strip) };
}
