/**
 * HDFC Sky: order request building and the three real-money calls (module-private; only the
 * withOrderGate-wrapped exports at the bottom reach them, and no route mints a gate for this broker).
 *
 * Official docs (https://developer.hdfcsky.com/sky-docs/docs/orders/regular_order/...):
 *  - placeregularorder: POST /oapi/v1/orders?client_id&api_key, body { exchange (NSE|BSE|NFO|CDS|MCX),
 *    instrument_token, client_id, order_type (LIMIT|MARKET|SL|SLM), amo, price, quantity,
 *    disclosed_quantity, validity (DAY|IOC), product (CNC|MIS|NRML), order_side (BUY|SELL), device,
 *    user_order_id (number), trigger_price, execution_type: "REGULAR" } -> {data:{oms_order_id, user_order_id}}.
 *    The table lists exchanges without BFO; the master and the order book use BFO for BSE F&O, so BFO is
 *    sent for SENSEX/BANKEX options (live verification needed).
 *  - modifyregularorder: PUT /oapi/v1/orders with the same fields plus oms_order_id (product cannot change).
 *  - deleteregularorder: DELETE /oapi/v1/orders/<oms_order_id>?client_id&execution_type=REGULAR.
 *  The table says "price can't be zero"; for MARKET and SL-M orders we send 0 as there is no limit price
 *  (some clients convert market orders to protected limits instead). Flagged for live verification.
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { requireClientId, skyRequest } from "./hdfcskyClient.mjs";
import { fetchRawOrders, orderStatusOf } from "./hdfcskyPortfolio.mjs";

const ORDER_TYPES = { MARKET: "MARKET", LIMIT: "LIMIT", SL: "SL", "SL-M": "SLM", SLM: "SLM" };
const PRODUCTS = { CNC: "CNC", INTRADAY: "MIS", MARGIN: "NRML" };
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO"]);

function positiveInt(v, what) {
  const x = Number(v);
  if (!Number.isInteger(x) || x <= 0) throw new BrokerInputError(`HDFC Sky order: ${what} must be a positive whole number.`);
  return x;
}

function priceOf(v, what, required) {
  const x = Number(v ?? 0);
  if (!Number.isFinite(x) || x < 0) throw new BrokerInputError(`HDFC Sky order: ${what} is not a valid price.`);
  if (required && x <= 0) throw new BrokerInputError(`HDFC Sky order: ${what} is required for this order type.`);
  return x;
}

function orderTypeOf(v) {
  const t = ORDER_TYPES[String(v ?? "").toUpperCase()];
  if (!t) throw new BrokerInputError("HDFC Sky order: orderType must be MARKET, LIMIT, SL or SL-M.");
  return t;
}

function validityOf(v) {
  const s = String(v ?? "DAY").toUpperCase();
  if (s !== "DAY" && s !== "IOC") throw new BrokerInputError("HDFC Sky order: validity must be DAY or IOC.");
  return s;
}

function prices(orderType, price, trigger) {
  return {
    price: orderType === "MARKET" || orderType === "SLM" ? 0 : priceOf(price, "price", true),
    trigger_price: orderType === "SL" || orderType === "SLM" ? priceOf(trigger, "triggerPrice", true) : 0,
  };
}

/**
 * Pure: place-order body. order = { exchange, token, side, product: CNC|INTRADAY|MARGIN, orderType,
 * validity?, lots, price?, triggerPrice?, amo? }. quantity = lots x resolvedLotSize.
 */
export function buildOrderBody(clientId, order, resolvedLotSize, { userOrderId = Date.now() % 1_000_000_000 } = {}) {
  const exchange = String(order?.exchange ?? "").toUpperCase();
  if (!EXCHANGES.has(exchange)) throw new BrokerInputError("HDFC Sky order: exchange must be NSE, BSE, NFO or BFO.");
  if (!/^\d+$/.test(String(order?.token ?? ""))) throw new BrokerInputError("HDFC Sky order: token must be the security master's exchange_token.");
  const side = String(order.side ?? "").toUpperCase();
  if (side !== "BUY" && side !== "SELL") throw new BrokerInputError("HDFC Sky order: side must be BUY or SELL.");
  const product = PRODUCTS[String(order.product ?? "").toUpperCase()];
  const isDeriv = exchange === "NFO" || exchange === "BFO";
  if (!product || (isDeriv && product === "CNC") || (!isDeriv && product === "NRML")) throw new BrokerInputError(`HDFC Sky order: product ${order.product} is not allowed on ${exchange}.`);
  const orderType = orderTypeOf(order.orderType);
  const quantity = positiveInt(order.lots, "lots") * positiveInt(resolvedLotSize, "resolvedLotSize");
  return {
    exchange,
    instrument_token: String(order.token),
    client_id: clientId,
    order_type: orderType,
    amo: order.amo === true,
    ...prices(orderType, order.price, order.triggerPrice),
    quantity,
    disclosed_quantity: 0,
    validity: validityOf(order.validity),
    product,
    order_side: side,
    device: "WEB",
    user_order_id: Number(userOrderId),
    execution_type: "REGULAR",
  };
}

/** Pure: modify body from the pending-book row plus the requested changes. */
export function buildModifyBody(clientId, existing, changes = {}) {
  const orderType = orderTypeOf(changes.orderType ?? existing?.order_type);
  return {
    exchange: String(existing?.exchange ?? "").toUpperCase(),
    instrument_token: String(existing?.instrument_token ?? ""),
    client_id: clientId,
    order_type: orderType,
    ...prices(orderType, changes.price ?? existing?.price, changes.triggerPrice ?? existing?.trigger_price),
    quantity: positiveInt(changes.quantity ?? existing?.quantity, "quantity"),
    disclosed_quantity: 0,
    validity: validityOf(changes.validity ?? existing?.validity),
    product: String(existing?.product ?? "").toUpperCase(),
    oms_order_id: String(existing?.oms_order_id ?? ""),
    execution_type: "REGULAR",
  };
}

function idOf(orderId) {
  const id = String(orderId ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) throw new BrokerInputError("HDFC Sky: orderId is not valid.");
  return id;
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const clientId = requireClientId(creds);
  const json = await skyRequest(creds, "POST", "/oapi/v1/orders", { params: { client_id: clientId }, body: buildOrderBody(clientId, order, resolvedLotSize) });
  const orderId = String(json?.data?.oms_order_id ?? "");
  if (!orderId) throw new BrokerInputError("HDFC Sky did not return an order id.");
  return { orderId, orderStatus: "OPEN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const clientId = requireClientId(creds);
  const id = idOf(orderId);
  const existing = (await fetchRawOrders(creds, ["pending"])).find((o) => String(o.oms_order_id) === id);
  if (!existing) throw new BrokerInputError(`HDFC Sky: order ${id} is not pending, so it cannot be modified.`);
  const json = await skyRequest(creds, "PUT", "/oapi/v1/orders", { body: buildModifyBody(clientId, existing, changes) });
  const status = orderStatusOf(existing.order_status);
  return { orderId: String(json?.data?.oms_order_id ?? id), orderStatus: status === "TRIGGER_PENDING" ? status : "OPEN" };
}

async function cancelOrderImpl(creds, orderId) {
  const clientId = requireClientId(creds);
  const id = idOf(orderId);
  const json = await skyRequest(creds, "DELETE", `/oapi/v1/orders/${encodeURIComponent(id)}`, { params: { client_id: clientId, execution_type: "REGULAR" } });
  // Only the cancel request is acknowledged; callers re-read the order book for the final state.
  return { orderId: String(json?.data?.oms_order_id ?? id), orderStatus: "UNKNOWN" };
}

// The raw calls above stay module-private: only these gated wrappers can reach the broker.
export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "hdfcsky" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "hdfcsky" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "hdfcsky" });
