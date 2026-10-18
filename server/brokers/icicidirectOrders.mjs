/**
 * ICICI Direct (Breeze) orders (real money, gated). Official docs: Order section and Regulatory Changes (checked
 * 2026-10):
 *  - POST /order { stock_code, exchange_code (NSE | NFO), product (futures | options | cash | btst), action
 *    (buy | sell), order_type (limit | stoploss), stoploss, quantity, price, validity (day | ioc),
 *    disclosed_quantity, expiry_date (ISO), right (call | put | others), strike_price, user_remark (no spaces or
 *    special characters) } -> Success { order_id, message }.
 *  - PUT /order { order_id, exchange_code, order_type, stoploss, quantity, price, validity, disclosed_quantity,
 *    expiry_date, right, strike_price } -> Success { order_id, message }.
 *  - DELETE /order { order_id, exchange_code } -> Success { order_id, message }.
 *  - Market orders are not permitted through Breeze, and Margin / Option Plus orders may not be placed, modified
 *    or cancelled. Orders must come from the static IP registered with ICICI Direct; at most 10 a second.
 * Breeze names the instrument by stock_code + expiry + right + strike, so those come from the security master (by
 * token), never from the client. Modify and cancel need the order's exchange, read from today's order book.
 * Every call is wrapped with withOrderGate(); no route mints ICICI Direct gates today.
 */

import { BrokerError, BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { breezeRequest } from "./icicidirectAuth.mjs";
import { breezeParams, expiryIso, getMaster, rowOf } from "./icicidirectInstruments.mjs";
import { listRawOrders } from "./icicidirectPortfolio.mjs";

const ORDER_TYPE = { LIMIT: "limit", SL: "stoploss", STOP_LOSS: "stoploss", STOPLOSS_LIMIT: "stoploss" };
const ORDER_ID_RE = /^[A-Za-z0-9]{8,30}$/;

export const ORDER_FEATURES = {
  bracket: false,
  cover: false,
  ioc: true,
  mtf: false,
  nativeMarketProtection: false,
  maxLegQty: null,
  products: ["CNC", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const isPositive = (v) => Number.isFinite(v) && v > 0;

function orderTypeOf(t) {
  const key = String(t ?? "LIMIT").toUpperCase();
  if (key === "MARKET" || key === "SL-M" || key === "SLM" || key.endsWith("_MARKET")) throw bad("ICICI Direct does not allow market orders through Breeze (SEBI retail algo rules). Use a limit or stop-loss limit order.");
  const v = ORDER_TYPE[key];
  if (!v) throw bad(`Unsupported ICICI Direct order type: ${t} (LIMIT or SL)`);
  return v;
}

function checkPrices(type, side, price, trigger) {
  if (!isPositive(price)) throw bad("price is required (Breeze takes limit prices only)");
  if (type === "stoploss") {
    if (!isPositive(trigger)) throw bad("triggerPrice required for a stop-loss order");
    if (side === "buy" && !(trigger <= price)) throw bad("Buy SL: the trigger must not be above the limit price");
    if (side === "sell" && !(trigger >= price)) throw bad("Sell SL: the trigger must not be below the limit price");
  }
}

/**
 * Pure body builder from a security-master row. order: { exchange (NSE|NFO), side, orderType, product, validity,
 * lots, price, triggerPrice?, tag? }. `resolvedLotSize` comes from the master, never from the client.
 */
export function buildOrderBody(row, order, resolvedLotSize) {
  if (!row || !row.breezeCode) throw bad("ICICI Direct orders need an instrument from the security master");
  if (row.instrumentType === "INDEX") throw bad("An index cannot be traded");
  const { side, orderType, product = row.exchange === "NFO" ? "MARGIN" : "CNC", validity = "DAY", lots, price, triggerPrice, tag } = order || {};
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const type = orderTypeOf(orderType);
  if (row.exchange === "NFO" && product !== "MARGIN") throw bad(`Unsupported product on F&O: ${product} (MARGIN only; Breeze does not allow margin/intraday orders)`);
  if (row.exchange === "NSE" && product !== "CNC") throw bad(`Unsupported product on equity: ${product} (CNC only; Breeze does not allow margin/intraday orders)`);
  if (validity !== "DAY" && validity !== "IOC") throw bad(`Unsupported validity: ${validity} (DAY or IOC)`);
  if (!isPositive(resolvedLotSize)) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  const action = side === "BUY" ? "buy" : "sell";
  checkPrices(type, action, price, triggerPrice);
  const p = breezeParams(row);
  const body = {
    stock_code: p.stock_code,
    exchange_code: p.exchange_code,
    product: row.exchange === "NFO" ? p.product_type : "cash",
    action,
    order_type: type,
    stoploss: type === "stoploss" ? String(triggerPrice) : "",
    quantity: String(Math.round(lots * resolvedLotSize)),
    price: String(price),
    validity: validity.toLowerCase(),
    disclosed_quantity: "0",
    expiry_date: p.expiry_date,
    right: p.right || "others",
    strike_price: p.strike_price || "0",
  };
  if (tag !== undefined) {
    const remark = String(tag).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
    if (remark) body.user_remark = remark;
  }
  return body;
}

/** Pure modify body from the current order-book row and the changes. qty is in units. */
export function buildModifyBody(current, changes) {
  if (!current || typeof current !== "object") throw bad("ICICI Direct: the order to modify is not in today's order book");
  const { qty, orderType, price, triggerPrice, validity } = changes || {};
  if ([qty, orderType, price, triggerPrice, validity].every((v) => v === undefined)) throw bad("Nothing to modify");
  if (qty !== undefined && (!Number.isInteger(qty) || qty <= 0)) throw bad("qty must be a positive whole number of units");
  if (validity !== undefined && validity !== "DAY" && validity !== "IOC") throw bad(`Unsupported validity: ${validity}`);
  const type = orderType !== undefined ? orderTypeOf(orderType) : /stop/i.test(String(current.order_type)) ? "stoploss" : "limit";
  const action = String(current.action ?? "").toLowerCase().startsWith("s") ? "sell" : "buy";
  const newPrice = price ?? Number(current.price);
  const newTrigger = type === "stoploss" ? (triggerPrice ?? Number(current.stoploss)) : 0;
  checkPrices(type, action, newPrice, newTrigger);
  const fno = String(current.exchange_code).toUpperCase() === "NFO";
  const expiry = fno ? expiryIso(current.expiry_date) : null;
  const right = String(current.right ?? "").toLowerCase();
  return {
    order_id: String(current.order_id),
    exchange_code: fno ? "NFO" : "NSE",
    order_type: type,
    stoploss: type === "stoploss" ? String(newTrigger) : "",
    quantity: String(qty ?? current.quantity),
    price: String(newPrice),
    validity: validity ? validity.toLowerCase() : String(current.validity || "day").toLowerCase() === "ioc" ? "ioc" : "day",
    disclosed_quantity: String(current.disclosed_quantity ?? "0") || "0",
    expiry_date: expiry ? `${expiry}T06:00:00.000Z` : "",
    right: fno ? (right.startsWith("c") ? "call" : right.startsWith("p") ? "put" : "others") : "",
    strike_price: fno ? String(Number(current.strike_price) || 0) : "",
  };
}

function checkOrderId(orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid ICICI Direct order id");
  return id;
}

function ackOf(data, fallbackId, what) {
  const orderId = String(data?.order_id ?? fallbackId ?? "").trim();
  if (!orderId) throw new BrokerError(`ICICI Direct accepted the ${what} request but returned no order id. ${ORDER_BOOK_HINT}`);
  return { orderId, orderStatus: what === "order" ? "OPEN" : "UNKNOWN" };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  orderTypeOf(order?.orderType); // refuse market orders before any download
  if (order?.exchange !== "NSE" && order?.exchange !== "NFO") throw bad(`Invalid exchange: ${order?.exchange} (NSE or NFO; BSE is not on Breeze)`);
  if (!isPositive(resolvedLotSize) || !Number.isInteger(order?.lots) || order.lots <= 0) throw bad("Invalid lots or missing resolved lot size");
  const row = rowOf(await getMaster(), { exchange: order.exchange, token: order.token });
  if (!row) throw bad(`ICICI Direct: ${order.exchange}:${order.token} is not in the security master`);
  const body = buildOrderBody(row, order, resolvedLotSize);
  return ackOf(await breezeRequest(creds, "order", { method: "POST", params: body }), null, "order");
}

async function findOrder(creds, id) {
  const current = (await listRawOrders(creds)).find((o) => String(o.order_id) === id);
  if (!current) throw bad("ICICI Direct: the order is not in today's order book");
  return current;
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = checkOrderId(orderId);
  if ([changes?.qty, changes?.orderType, changes?.price, changes?.triggerPrice, changes?.validity].every((v) => v === undefined)) throw bad("Nothing to modify");
  if (changes?.orderType !== undefined) orderTypeOf(changes.orderType);
  const body = buildModifyBody(await findOrder(creds, id), changes);
  return ackOf(await breezeRequest(creds, "order", { method: "PUT", params: body }), id, "modify");
}

async function cancelOrderImpl(creds, orderId) {
  const id = checkOrderId(orderId);
  const current = await findOrder(creds, id);
  const exchange_code = String(current.exchange_code).toUpperCase() === "NFO" ? "NFO" : "NSE";
  return ackOf(await breezeRequest(creds, "order", { method: "DELETE", params: { order_id: id, exchange_code } }), id, "cancel");
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "icicidirect" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "icicidirect" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "icicidirect" });
