/**
 * Definedge Securities (Integrate API) adapter (contract v1, server/brokers/contract.mjs).
 *
 * Auth: session login (definedgeAuth.mjs). The user saves the API token and API secret; each session they type
 * the current 6-digit External TOTP code and the proxy runs Definedge's two-step login once. Only the session
 * key (and WebSocket key, uid, actid) is kept. A session key pasted in creds.apiSessionKey also works.
 *
 * Option chain: Definedge has no chain or bulk-quote endpoint, so the chain is the daily public master
 * (definedgeInstruments.mjs) windowed to ±20 strikes around spot, one GET /quotes per leg (paced 10/s),
 * OI backfilled from the last 1-minute candle on the data host, and Black-Scholes IV/Greeks
 * (definedgeQuotes.mjs). Also: instruments, quotes, depth, 1m/1d history, positions, holdings, funds,
 * order book, trade book and gated orders (definedgeOrders.mjs). The Noren-style WebSocket (wss .../NorenWSTRTP)
 * is not wired in v1 (`feed` not declared).
 */

import { getSession, LOGIN_FIELDS, SESSION_FIELDS } from "./definedgeAuth.mjs";
import { getDerivativeRows, indexInstruments, toInstrument } from "./definedgeInstruments.mjs";
import { getLimits } from "./definedgeQuotes.mjs";
import { ORDER_FEATURES } from "./definedgeOrders.mjs";

export { login } from "./definedgeAuth.mjs";
export { normaliseError } from "./contract.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical } from "./definedgeQuotes.mjs";
export {
  buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder, fetchOrderBook, fetchTradeBook, fetchPositions, fetchHoldings, fetchFunds,
} from "./definedgeOrders.mjs";

export const id = "definedge";
export const credentialFields = ["apiToken", "apiSecret"];

export const capabilities = {
  ...ORDER_FEATURES,
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed", strikeWindow: 20 },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "1d"] },
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
    const json = await getLimits(creds);
    if (String(json?.status || "").toUpperCase() !== "SUCCESS" && json?.cash === undefined) {
      return { status: "error", message: json?.message || "Definedge did not return a success status" };
    }
    return { status: "success", message: "Definedge Securities connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchInstruments(creds) {
  getSession(creds); // not logged in -> 422 before the master downloads
  const data = [...indexInstruments()];
  for (const seg of ["NFO", "BFO"]) {
    for (const r of await getDerivativeRows(seg)) {
      const ins = toInstrument(r);
      if (ins) data.push(ins);
    }
  }
  return { status: "success", data };
}
