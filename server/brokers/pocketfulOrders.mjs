/**
 * Pocketful orders (real money; every call is behind withOrderGate, no route mints Pocketful gates).
 *
 * Official docs (checked 2026-10, https://api.pocketful.in/docs/curl/place-regular-order, modify-regular-order,
 * cancel-regular-order, annexure):
 *  - POST /api/v1/orders { exchange, instrument_token, client_id, order_type LIMIT|SL, amo false, price, quantity,
 *    disclosed_quantity 0, validity DAY|IOC, product CNC|MIS|NRML, order_side BUY|SELL, device "WEB", user_order_id,
 *    trigger_price, execution_type "REGULAR" } -> data.oms_order_id.
 *  - "Only LIMIT and SL (Stop Loss) orders are allowed for API trading. MARKET and SL-M orders are restricted / not
 *    allowed." (Annexure). OpenAlgo converts MARKET to a protected LIMIT; this adapter refuses MARKET instead.
 *  - PUT /api/v1/orders with the same fields plus oms_order_id. The order's exchange, token, side and product are read
 *    from the pending order book, never taken from the client.
 *  - DELETE /api/v1/orders/<oms_order_id> with body { oms_order_id, client_id, execution_type: "REGULAR" }.
 *  - The annexure lists products as INTRADAY/MARGIN but the order pages (and the SDK) send CNC, MIS and NRML; the
 *    order pages are followed.
 *  - Rate limit: 10 orders a second.
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { pfRequest, resolveClientId } from "./pocketfulAuth.mjs";
import { findByRef } from "./pocketfulInstruments.mjs";
import { rawOrders } from "./pocketfulPortfolio.mjs";

export const ORDER_FEATURES = {
  bracket: false, // documented (conditional orders) but not built here.
  cover: false,
  ioc: true, // validity IOC is documented.
  mtf: false,
  nativeMarketProtection: false, // MARKET orders are not allowed over the API.
  maxLegQty: null,
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const TYPES = new Set(["LIMIT", "SL"]);
const PRODUCTS = { CNC: "CNC", INTRADAY: "MIS", MARGIN: "NRML" };
const VALIDITY = new Set(["DAY", "IOC"]);
const CASH = new Set(["NSE", "BSE"]);
const ORDER_ID = /^\d{4,30}$/;

function prices(orderType, price, triggerPrice) {
  if (!TYPES.has(orderType)) throw bad(`Pocketful API orders must be LIMIT or SL (got ${orderType}); MARKET and SL-M are not allowed`);
  if (!(Number.isFinite(price) && price > 0)) throw bad(`price required for ${orderType}`);
  if (orderType === "SL" && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for SL");
  return { order_type: orderType, price, trigger_price: orderType === "SL" ? triggerPrice : 0 };
}

/**
 * Pure body builder. order: { token, exchange, side, orderType LIMIT|SL, product CNC|INTRADAY|MARGIN, validity DAY|IOC,
 * lots, price, triggerPrice? }. `instrument` is the master row for order.token/exchange; `resolvedLotSize` comes from the
 * master, never from the client. `userOrderId` is any integer the caller picks.
 */
export function buildOrderBody(order, resolvedLotSize, instrument, clientId, userOrderId = 1) {
  const { exchange, side, orderType = "LIMIT", product = "INTRADAY", validity = "DAY", lots, price, triggerPrice } = order || {};
  if (!instrument || instrument.token !== String(order?.token) || instrument.exchange !== exchange) throw bad("Pocketful: order instrument not found in the contract master");
  if (instrument.instrumentType === "INDEX") throw bad("Pocketful: an index cannot be traded");
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (!VALIDITY.has(validity)) throw bad(`Invalid validity: ${validity} (DAY or IOC)`);
  const prod = PRODUCTS[product];
  if (!prod) throw bad(`Unsupported Pocketful product ${product}`);
  if (product === "CNC" && !CASH.has(exchange)) throw bad("CNC is for cash equities only");
  if (product === "MARGIN" && CASH.has(exchange)) throw bad("MARGIN (NRML) is for derivatives only");
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) throw bad("Missing resolved lot size — it must come from the contract master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  if (!String(clientId ?? "").trim()) throw bad("Pocketful: client id missing");
  return {
    exchange,
    instrument_token: instrument.token,
    client_id: String(clientId),
    amo: false,
    quantity: Math.round(lots * resolvedLotSize),
    disclosed_quantity: 0,
    validity,
    product: prod,
    order_side: side,
    device: "WEB",
    user_order_id: userOrderId,
    execution_type: "REGULAR",
    ...prices(orderType, price, triggerPrice),
  };
}

/** Pure modify body from the live pending order row. changes: { orderType LIMIT|SL, qty (units), price, triggerPrice?, validity? }. */
export function buildModifyBody(row, changes, clientId) {
  const { orderType = "LIMIT", qty, price, triggerPrice, validity = "DAY" } = changes || {};
  if (!row) throw bad("Pocketful: the order is not in the pending order book");
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  if (!VALIDITY.has(validity)) throw bad(`Invalid validity: ${validity}`);
  return {
    exchange: String(row.exchange),
    instrument_token: String(row.instrument_token),
    client_id: String(clientId),
    quantity: qty,
    disclosed_quantity: 0,
    validity,
    product: String(row.product),
    order_side: String(row.order_side),
    device: "WEB",
    user_order_id: Number(row.user_order_id) || 1,
    oms_order_id: String(row.oms_order_id),
    execution_type: "REGULAR",
    ...prices(orderType, price, triggerPrice),
  };
}

const userOrderId = () => Date.now() % 1_000_000_000;

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const [instrument, clientId] = await Promise.all([findByRef(order), resolveClientId(creds)]);
  const body = buildOrderBody(order, resolvedLotSize, instrument, clientId, userOrderId());
  const json = await pfRequest(creds, "/api/v1/orders", { method: "POST", body });
  return { orderId: String(json?.data?.oms_order_id ?? ""), orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID.test(id)) throw bad("Invalid Pocketful order id");
  const clientId = await resolveClientId(creds);
  const row = (await rawOrders(creds)).find((o) => String(o.oms_order_id) === id);
  const json = await pfRequest(creds, "/api/v1/orders", { method: "PUT", body: buildModifyBody(row, changes, clientId) });
  return { orderId: String(json?.data?.oms_order_id ?? id), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID.test(id)) throw bad("Invalid Pocketful order id");
  const clientId = await resolveClientId(creds);
  const json = await pfRequest(creds, `/api/v1/orders/${id}`, { method: "DELETE", body: { oms_order_id: id, client_id: clientId, execution_type: "REGULAR" } });
  // An accepted cancel is not proof the order is gone; panic flows re-read the order book.
  return { orderId: String(json?.data?.oms_order_id ?? id), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "pocketful" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "pocketful" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "pocketful" });
