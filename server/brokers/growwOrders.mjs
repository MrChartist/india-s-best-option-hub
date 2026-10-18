/**
 * Groww orders (real money, gated). Official docs: https://groww.in/trade-api/docs/curl/orders and /annexures.
 *
 *  - POST /v1/order/create { trading_symbol, quantity, price, trigger_price, validity, exchange (NSE | BSE),
 *    segment (CASH | FNO), product (CNC | MIS | NRML), order_type (LIMIT | MARKET | SL | SL_M),
 *    transaction_type (BUY | SELL), order_reference_id (required: 8-20 alphanumerics, at most two hyphens) }
 *    -> payload { groww_order_id, order_status, order_reference_id, remark }.
 *  - POST /v1/order/modify { quantity, price, trigger_price, order_type (required), segment (required),
 *    groww_order_id (required) } -> payload { groww_order_id, order_status }.
 *  - POST /v1/order/cancel { segment, groww_order_id } -> payload { groww_order_id, order_status }.
 * Validity: only DAY is documented. Quantity is in units (lots x lot size).
 * Every call is wrapped with withOrderGate(); no route mints Groww gates today.
 */

import { randomBytes } from "node:crypto";
import { BrokerError, BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { growwRequest } from "./growwAuth.mjs";
import { listRawOrders, orderStatusOf } from "./growwPortfolio.mjs";

const PRODUCT = { CNC: "CNC", INTRADAY: "MIS", MARGIN: "NRML" };
const ORDER_TYPE = { LIMIT: "LIMIT", MARKET: "MARKET", SL: "SL", STOPLOSS_LIMIT: "SL", STOP_LOSS: "SL", "SL-M": "SL_M", SL_M: "SL_M", STOPLOSS_MARKET: "SL_M", STOP_LOSS_MARKET: "SL_M" };
const VENUE = { NSE: ["NSE", "CASH"], BSE: ["BSE", "CASH"], NFO: ["NSE", "FNO"], BFO: ["BSE", "FNO"] };
const ORDER_ID_RE = /^[A-Za-z0-9-]{6,40}$/;

export const ORDER_FEATURES = {
  bracket: false, // Groww smart orders (OCO/GTT) are separate endpoints, not used here
  cover: false,
  ioc: false, // only DAY validity is documented
  mtf: false,
  nativeMarketProtection: false,
  maxLegQty: null, // freeze_quantity is per instrument in the master
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const isPositive = (v) => Number.isFinite(v) && v > 0;

function orderTypeOf(t) {
  const out = ORDER_TYPE[String(t ?? "LIMIT").toUpperCase()];
  if (!out) throw bad(`Unsupported Groww order type: ${t} (LIMIT, MARKET, SL or SL-M)`);
  return out;
}

/** 16 random alphanumerics: a fresh order_reference_id (8-20 chars, no hyphens). */
export function newReferenceId() {
  return randomBytes(12).toString("base64").replace(/[^A-Za-z0-9]/g, "").padEnd(16, "0").slice(0, 16);
}

/**
 * Pure body builder. order: { tradingSymbol, exchange (NSE|BSE|NFO|BFO), side, orderType, product, validity,
 * lots, price, triggerPrice?, referenceId? }. `resolvedLotSize` comes from the instrument master, never the client.
 */
export function buildOrderBody(order, resolvedLotSize, referenceId = newReferenceId()) {
  const { tradingSymbol, exchange, side, orderType, product = "INTRADAY", validity = "DAY", lots, price, triggerPrice } = order || {};
  if (typeof tradingSymbol !== "string" || !/^[A-Za-z0-9&_.-]{1,40}$/.test(tradingSymbol)) throw bad(`Invalid Groww trading symbol: ${tradingSymbol}`);
  const venue = VENUE[exchange];
  if (!venue) throw bad(`Invalid exchange: ${exchange} (NSE, BSE, NFO or BFO)`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const type = orderTypeOf(orderType);
  const prod = PRODUCT[product];
  if (!prod) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  if (venue[1] === "FNO" && prod === "CNC") throw bad("CNC is for cash-segment delivery; use MARGIN or INTRADAY for F&O");
  if (validity !== "DAY") throw bad("Groww documents only DAY validity");
  if (!isPositive(resolvedLotSize)) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  const isLimit = type === "LIMIT" || type === "SL";
  const isStop = type === "SL" || type === "SL_M";
  if (isLimit && !isPositive(price)) throw bad(`price required for ${type}`);
  if (isStop && !isPositive(triggerPrice)) throw bad(`triggerPrice required for ${type}`);
  if (!/^[A-Za-z0-9]{8,20}$/.test(referenceId)) throw bad("order reference id must be 8-20 letters/digits");
  return {
    trading_symbol: tradingSymbol,
    quantity: Math.round(lots * resolvedLotSize),
    price: isLimit ? price : 0,
    trigger_price: isStop ? triggerPrice : 0,
    validity: "DAY",
    exchange: venue[0],
    segment: venue[1],
    product: prod,
    order_type: type,
    transaction_type: side,
    order_reference_id: referenceId,
  };
}

/** Pure modify body. `original` is the order-list row; changes: { orderType?, price?, qty? (units), triggerPrice? }. */
export function buildModifyBody(orderId, changes, original) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Groww order id");
  if (!original) throw bad(`Groww order ${id} is not in today's order list`);
  const { orderType, price, qty, triggerPrice } = changes || {};
  const type = orderTypeOf(orderType ?? original.order_type);
  const quantity = qty !== undefined ? qty : Number(original.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) throw bad("qty must be a positive whole number of units");
  const isLimit = type === "LIMIT" || type === "SL";
  const isStop = type === "SL" || type === "SL_M";
  const newPrice = price !== undefined ? price : Number(original.price);
  const newTrigger = triggerPrice !== undefined ? triggerPrice : Number(original.trigger_price);
  if (isLimit && !isPositive(newPrice)) throw bad("price required");
  if (isStop && !isPositive(newTrigger)) throw bad("triggerPrice required");
  return {
    quantity,
    price: isLimit ? newPrice : 0,
    trigger_price: isStop ? newTrigger : 0,
    order_type: type,
    segment: String(original.segment ?? "CASH").toUpperCase() === "FNO" ? "FNO" : "CASH",
    groww_order_id: id,
  };
}

function ackOf(payload, fallbackId, what) {
  const orderId = String(payload?.groww_order_id ?? fallbackId ?? "").trim();
  if (!orderId) throw new BrokerError(`Groww accepted the ${what} request but returned no order id. ${ORDER_BOOK_HINT}`);
  return { orderId, orderStatus: orderStatusOf(payload?.order_status) };
}

async function findOriginal(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Groww order id");
  const row = (await listRawOrders(creds)).find((o) => String(o.groww_order_id) === id);
  if (!row) throw bad(`Groww order ${id} is not in today's order list`);
  return row;
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const payload = await growwRequest(creds, "/v1/order/create", { method: "POST", body: buildOrderBody(order, resolvedLotSize) });
  return ackOf(payload, null, "order");
}

async function modifyOrderImpl(creds, orderId, changes) {
  const original = await findOriginal(creds, orderId);
  const payload = await growwRequest(creds, "/v1/order/modify", { method: "POST", body: buildModifyBody(orderId, changes, original) });
  return ackOf(payload, orderId, "modify");
}

async function cancelOrderImpl(creds, orderId) {
  const original = await findOriginal(creds, orderId);
  const segment = String(original.segment ?? "CASH").toUpperCase() === "FNO" ? "FNO" : "CASH";
  const payload = await growwRequest(creds, "/v1/order/cancel", { method: "POST", body: { segment, groww_order_id: String(orderId).trim() } });
  return ackOf(payload, orderId, "cancel");
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "groww" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "groww" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "groww" });
