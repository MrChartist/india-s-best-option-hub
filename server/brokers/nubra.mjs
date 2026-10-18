/**
 * Nubra (Zanskar Securities) REST API V3 adapter (contract v1, server/brokers/contract.mjs).
 *
 * Auth: session login (nubraAuth.mjs). The user types the MPIN and the current TOTP code once per session;
 * only the returned session_token is kept, with an expiry from the JWT's own `exp` claim.
 *
 * Option chain: Nubra's native snapshot GET /optionchains/{asset}?exchange=&expiry= returns every CE/PE strike
 * for one expiry with LTP, OI, volume and usually delta/gamma/theta/vega; `all_expiries` gives the expiry list.
 * IV is solved locally when the snapshot leaves it null (as in the docs' sample), and the snapshot carries no
 * bid/ask. Spot comes from GET /optionchains/{asset}/price. Also: refdata instruments, order-book quotes and
 * depth, chart history, positions, holdings, funds, order book and gated orders (nubraMarket.mjs,
 * nubraOrders.mjs). The protobuf WebSocket and a trade book (not documented for V3) are not declared.
 *
 * Official docs: https://nubra.io/products/api/docs/rest-api-v3/index.html
 */

import { LOGIN_FIELDS, SESSION_FIELDS } from "./nubraAuth.mjs";
import { fetchLTP } from "./nubraMarket.mjs";
import { ORDER_FEATURES } from "./nubraOrders.mjs";

export { login, NUBRA_BASE } from "./nubraAuth.mjs";
export { normaliseError } from "./contract.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical, fetchInstruments } from "./nubraMarket.mjs";
export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder, fetchOrderBook, fetchPositions, fetchHoldings, fetchFunds } from "./nubraOrders.mjs";

export const id = "nubra";
export const credentialFields = ["phone"];

/** Contract declaration. MPIN + TOTP code are typed per session, never stored. */
export const capabilities = {
  ...ORDER_FEATURES,
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
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
};

export async function testConnection(creds = {}) {
  try {
    await fetchLTP(creds, "NIFTY"); // one cheap authenticated call proves the session is alive
    return { status: "success", message: "Nubra API connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}
