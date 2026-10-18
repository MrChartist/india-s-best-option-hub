/**
 * Paytm Money: order request building and the three real-money calls (module-private; only the
 * withOrderGate-wrapped exports at the bottom reach them, and no route mints a gate for this broker).
 *
 * Official docs (https://developer.paytmmoney.com/docs/api/<slug>/):
 *  - place-regular-order: POST /orders/v1/place/regular {txn_type B|S, exchange NSE|BSE, segment E|D,
 *    product C|I|M (B bracket, V cover), security_id, quantity, validity DAY|IOC|GTC|GTD, order_type,
 *    price, trigger_price, off_mkt_flag, source, order_ltp} -> {status, message, data:[{order_no}]}.
 *    order_type: "MKT - Market order ... Market orders are not supported as an explicit order type.
 *    Use LIMIT orders (LMT)." plus SL and SLM. We therefore refuse MARKET (some clients still send
 *    MKT; we follow the docs). order_ltp "should be populated with the last traded price" for market
 *    protection; we send the caller's ltp when given, else the limit price.
 *    source: one of W, M, N, I, R, O; "M" is used (the docs do not say which applies; flagged for live check).
 *  - modify-regular-order / cancel-regular-order: POST /orders/v1/modify/regular and /cancel/regular,
 *    which need order_no, serial_no, group_id and the order's ext_info "passed back unchanged" from the
 *    order book, so both read the order book first (authoritative state, never client input).
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { paytmRequest } from "./paytmClient.mjs";
import { fetchRawOrders, orderStatusOf } from "./paytmPortfolio.mjs";

const ORDER_TYPES = { LIMIT: "LMT", SL: "SL", "SL-M": "SLM", SLM: "SLM" };
const CASH_PRODUCTS = { CNC: "C", INTRADAY: "I" };
const DERIV_PRODUCTS = { INTRADAY: "I", MARGIN: "M" };
const SOURCE = "M";

function positiveInt(v, what) {
  const x = Number(v);
  if (!Number.isInteger(x) || x <= 0) throw new BrokerInputError(`Paytm Money order: ${what} must be a positive whole number.`);
  return x;
}

function priceOf(v, what, required) {
  const x = Number(v ?? 0);
  if (!Number.isFinite(x) || x < 0) throw new BrokerInputError(`Paytm Money order: ${what} is not a valid price.`);
  if (required && x <= 0) throw new BrokerInputError(`Paytm Money order: ${what} is required for this order type.`);
  return x;
}

function orderTypeOf(v) {
  const s = String(v ?? "").toUpperCase();
  if (s === "MARKET" || s === "MKT") throw new BrokerInputError("Paytm Money does not accept market orders through its API. Use a limit order.");
  const t = ORDER_TYPES[s] ?? (s === "LMT" ? "LMT" : null);
  if (!t) throw new BrokerInputError("Paytm Money order: orderType must be LIMIT, SL or SL-M.");
  return t;
}

function validityOf(v) {
  const s = String(v ?? "DAY").toUpperCase();
  if (s !== "DAY" && s !== "IOC") throw new BrokerInputError("Paytm Money order: validity must be DAY or IOC.");
  return s;
}

function pricing(orderType, price, trigger) {
  return {
    price: orderType === "SLM" ? 0 : priceOf(price, "price", true),
    trigger_price: orderType === "SL" || orderType === "SLM" ? priceOf(trigger, "triggerPrice", true) : 0,
  };
}

/**
 * Pure: place body. order = { exchange: NSE|BSE|NFO|BFO, token (security_id), side, product:
 * CNC|INTRADAY|MARGIN, orderType: LIMIT|SL|SL-M, validity?, lots, price, triggerPrice?, ltp?, amo? }.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const ex = String(order?.exchange ?? "").toUpperCase();
  const isDeriv = ex === "NFO" || ex === "BFO";
  if (!["NSE", "BSE", "NFO", "BFO"].includes(ex)) throw new BrokerInputError("Paytm Money order: exchange must be NSE, BSE, NFO or BFO.");
  if (!/^\d+$/.test(String(order?.token ?? ""))) throw new BrokerInputError("Paytm Money order: token must be a numeric security_id.");
  const side = String(order.side ?? "").toUpperCase();
  if (side !== "BUY" && side !== "SELL") throw new BrokerInputError("Paytm Money order: side must be BUY or SELL.");
  const product = (isDeriv ? DERIV_PRODUCTS : CASH_PRODUCTS)[String(order.product ?? "").toUpperCase()];
  if (!product) throw new BrokerInputError(`Paytm Money order: product ${order.product} is not allowed on ${ex}.`);
  const orderType = orderTypeOf(order.orderType);
  const quantity = positiveInt(order.lots, "lots") * positiveInt(resolvedLotSize, "resolvedLotSize");
  const p = pricing(orderType, order.price, order.triggerPrice);
  return {
    txn_type: side === "BUY" ? "B" : "S",
    exchange: ex === "NFO" ? "NSE" : ex === "BFO" ? "BSE" : ex,
    segment: isDeriv ? "D" : "E",
    product,
    security_id: String(order.token),
    quantity,
    validity: validityOf(order.validity),
    order_type: orderType,
    ...p,
    source: SOURCE,
    off_mkt_flag: order.amo === true ? "true" : "false",
    order_ltp: Number(order.ltp) > 0 ? Number(order.ltp) : p.price || p.trigger_price,
  };
}

/** Pure: modify/cancel body from an order-book row (+ changes for modify). */
export function buildFollowUpBody(existing, changes = null) {
  const base = {
    source: SOURCE,
    txn_type: existing.txn_type,
    exchange: existing.exchange,
    segment: existing.segment,
    product: existing.product,
    security_id: String(existing.security_id),
    quantity: Number(existing.quantity),
    validity: existing.validity,
    order_type: existing.order_type,
    price: Number(existing.price) || 0,
    trigger_price: Number(existing.trigger_price) || 0,
    off_mkt_flag: String(existing.off_mkt_flag ?? "false"),
    mkt_type: existing.mkt_type ?? "NL",
    order_no: String(existing.order_no),
    serial_no: existing.serial_no,
    group_id: existing.group_id,
  };
  if (existing.ext_info !== undefined) base.ext_info = existing.ext_info;
  if (!changes) return base;
  const orderType = orderTypeOf(changes.orderType ?? existing.order_type);
  const p = pricing(orderType, changes.price ?? existing.price, changes.triggerPrice ?? existing.trigger_price);
  return {
    ...base,
    order_type: orderType,
    ...p,
    quantity: positiveInt(changes.quantity ?? existing.quantity, "quantity"),
    validity: validityOf(changes.validity ?? existing.validity),
    order_ltp: Number(changes.ltp) > 0 ? Number(changes.ltp) : p.price || p.trigger_price,
  };
}

function firstOrderNo(json) {
  const d = Array.isArray(json?.data) ? json.data[0] : json?.data;
  return String(d?.order_no ?? "");
}

async function findOrder(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) throw new BrokerInputError("Paytm Money: orderId is not valid.");
  const existing = (await fetchRawOrders(creds)).find((o) => String(o.order_no) === id);
  if (!existing) throw new BrokerInputError(`Paytm Money: order ${id} is not in today's order book.`);
  return existing;
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const json = await paytmRequest(creds, "POST", "/orders/v1/place/regular", buildOrderBody(order, resolvedLotSize));
  const orderId = firstOrderNo(json);
  if (!orderId) throw new BrokerInputError("Paytm Money did not return an order number.");
  return { orderId, orderStatus: "OPEN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const existing = await findOrder(creds, orderId);
  const json = await paytmRequest(creds, "POST", "/orders/v1/modify/regular", buildFollowUpBody(existing, changes || {}));
  const s = orderStatusOf(existing.display_status);
  return { orderId: firstOrderNo(json) || String(existing.order_no), orderStatus: s === "TRIGGER_PENDING" ? s : "OPEN" };
}

async function cancelOrderImpl(creds, orderId) {
  const existing = await findOrder(creds, orderId);
  const json = await paytmRequest(creds, "POST", "/orders/v1/cancel/regular", buildFollowUpBody(existing));
  // Only the request is acknowledged; callers re-read the order book for the final state.
  return { orderId: firstOrderNo(json) || String(existing.order_no), orderStatus: "UNKNOWN" };
}

// The raw calls above stay module-private: only these gated wrappers can reach the broker.
export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "paytm" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "paytm" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "paytm" });
