/**
 * Rupeezy (Vortex) orders (real money, gated). Official docs: https://vortex.rupeezy.in/docs/latest/regular-order/
 * and /working/ (checked 2026-10):
 *  - POST /trading/orders/regular { exchange, token (or ticker), transaction_type (BUY | SELL), product
 *    (INTRADAY | DELIVERY | BTST | MTF; MTF and BTST only on NSE_EQ), variety (RL | RL-MKT | SL | SL-MKT), quantity,
 *    price (0 for market orders), trigger_price, disclosed_quantity, validity (DAY | IOC), is_amo, order_identifier
 *    (<= 50 chars) } -> { status: "success", data: { order_id } }. 10/s.
 *    quantity: units on NSE_FO ("2 lots of 50 -> 100"); lots on the other exchanges, which for equity is the
 *    same number. BSE_FO is not named; it is sent in units like NSE_FO (needs a live check).
 *    A buy SL needs trigger_price < price, a sell SL trigger_price > price.
 *  - PUT /trading/orders/regular/{order_id} { variety, quantity, traded_quantity, price, trigger_price,
 *    disclosed_quantity, validity }. traded_quantity must be the latest value from the book, or the order grows;
 *    so the order's history (GET /trading/orders/{order_id}, newest row first) is read before every modify.
 *    RL orders cannot become SL orders.
 *  - DELETE /trading/orders/regular/{order_id} -> { status: "success", data: { order_id } }.
 * A success only means Rupeezy accepted the request (it runs its own checks before the exchange), so every ack
 * is OPEN / UNKNOWN until the order book says otherwise.
 * Every call is wrapped with withOrderGate(); no route mints Rupeezy gates today.
 */

import { BrokerError, BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { vortexRequest } from "./rupeezyAuth.mjs";
import { VORTEX_EXCHANGE } from "./rupeezyInstruments.mjs";

const PRODUCTS_CASH = { CNC: "DELIVERY", INTRADAY: "INTRADAY", MTF: "MTF" };
const PRODUCTS_FNO = { MARGIN: "DELIVERY", INTRADAY: "INTRADAY" };
const VARIETY = { LIMIT: "RL", MARKET: "RL-MKT", SL: "SL", STOP_LOSS: "SL", STOPLOSS_LIMIT: "SL", "SL-M": "SL-MKT", SLM: "SL-MKT", STOP_LOSS_MARKET: "SL-MKT", STOPLOSS_MARKET: "SL-MKT" };
const ORDER_ID_RE = /^[A-Za-z0-9@]{6,30}$/;

export const ORDER_FEATURES = {
  bracket: false,
  cover: false,
  ioc: true, // validity IOC is documented
  mtf: true, // MTF product on NSE_EQ is documented
  nativeMarketProtection: false,
  maxLegQty: null,
  products: ["CNC", "INTRADAY", "MARGIN", "MTF"],
};

const bad = (m) => new BrokerInputError(m);
const isPositive = (v) => Number.isFinite(v) && v > 0;

function varietyOf(t) {
  const v = VARIETY[String(t ?? "LIMIT").toUpperCase()];
  if (!v) throw bad(`Unsupported Rupeezy order type: ${t} (LIMIT, MARKET, SL or SL-M)`);
  return v;
}

function checkPrices(variety, side, price, triggerPrice) {
  const isLimit = variety === "RL" || variety === "SL";
  const isStop = variety === "SL" || variety === "SL-MKT";
  if (isLimit && !isPositive(price)) throw bad(`price required for ${variety}`);
  if (isStop && !isPositive(triggerPrice)) throw bad(`triggerPrice required for ${variety}`);
  if (variety === "SL" && side === "BUY" && !(triggerPrice < price)) throw bad("Buy SL: the trigger must be below the limit price");
  if (variety === "SL" && side === "SELL" && !(triggerPrice > price)) throw bad("Sell SL: the trigger must be above the limit price");
}

/**
 * Pure body builder. order: { token, exchange (NSE|BSE|NFO|BFO), side, orderType, product, validity, lots, price?,
 * triggerPrice?, tag? }. `resolvedLotSize` comes from the instrument master, never from the client.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { exchange, side, orderType, product = "INTRADAY", validity = "DAY", lots, price, triggerPrice, tag } = order || {};
  const token = String(order?.token ?? "");
  if (!/^\d{1,10}$/.test(token)) throw bad("Rupeezy orders need the numeric token from the instrument master");
  const vexch = VORTEX_EXCHANGE[exchange];
  if (!vexch) throw bad(`Invalid exchange: ${exchange} (NSE, BSE, NFO or BFO)`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const variety = varietyOf(orderType);
  const cash = vexch.endsWith("_EQ");
  const prod = (cash ? PRODUCTS_CASH : PRODUCTS_FNO)[product];
  if (!prod) throw bad(cash ? `Unsupported product on equity: ${product} (CNC, INTRADAY or MTF)` : `Unsupported product on F&O: ${product} (MARGIN or INTRADAY)`);
  if (prod === "MTF" && vexch !== "NSE_EQ") throw bad("MTF is only allowed on NSE equity");
  if (validity !== "DAY" && validity !== "IOC") throw bad(`Unsupported validity: ${validity} (DAY or IOC)`);
  if (!isPositive(resolvedLotSize)) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  checkPrices(variety, side, price, triggerPrice);
  const body = {
    exchange: vexch,
    token: Number(token),
    transaction_type: side,
    product: prod,
    variety,
    quantity: Math.round(lots * resolvedLotSize),
    price: variety === "RL" || variety === "SL" ? price : 0,
    trigger_price: variety === "SL" || variety === "SL-MKT" ? triggerPrice : 0,
    disclosed_quantity: 0,
    validity,
    is_amo: false,
  };
  if (tag !== undefined) body.order_identifier = String(tag).slice(0, 50);
  return body;
}

/** Pure modify body from the order's current state (latest history row) and the changes. qty is in units. */
export function buildModifyBody(current, changes) {
  if (!current || typeof current !== "object") throw bad("Rupeezy: the order to modify was not found");
  const { qty, orderType, price, triggerPrice, validity } = changes || {};
  if ([qty, orderType, price, triggerPrice, validity].every((v) => v === undefined)) throw bad("Nothing to modify");
  const variety = orderType !== undefined ? varietyOf(orderType) : String(current.variety || "RL").toUpperCase();
  const was = String(current.variety || "").toUpperCase();
  if ((was === "RL" || was === "RL-MKT") && (variety === "SL" || variety === "SL-MKT")) throw bad("Rupeezy: a regular order cannot become a stop-loss order; cancel it and place a new one");
  if (qty !== undefined && (!Number.isInteger(qty) || qty <= 0)) throw bad("qty must be a positive whole number of units");
  if (validity !== undefined && validity !== "DAY" && validity !== "IOC") throw bad(`Unsupported validity: ${validity}`);
  const side = String(current.transaction_type ?? "").toUpperCase();
  const newPrice = variety === "RL" || variety === "SL" ? (price ?? Number(current.order_price)) : 0;
  const newTrigger = variety === "SL" || variety === "SL-MKT" ? (triggerPrice ?? Number(current.trigger_price)) : 0;
  checkPrices(variety, side, newPrice, newTrigger);
  return {
    variety,
    quantity: qty ?? Number(current.total_quantity),
    traded_quantity: Number(current.traded_quantity) || 0,
    price: newPrice,
    trigger_price: newTrigger,
    disclosed_quantity: Number(current.disclosed_quantity) || 0,
    validity: validity ?? (String(current.validity || "DAY").toUpperCase() === "IOC" ? "IOC" : "DAY"),
  };
}

function checkOrderId(orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Rupeezy order id");
  return id;
}

function ackOf(json, fallbackId, what) {
  const orderId = String(json?.data?.order_id ?? fallbackId ?? "").trim();
  if (!orderId) throw new BrokerError(`Rupeezy accepted the ${what} request but returned no order id. ${ORDER_BOOK_HINT}`);
  return { orderId, orderStatus: what === "order" ? "OPEN" : "UNKNOWN" };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const body = buildOrderBody(order, resolvedLotSize);
  return ackOf(await vortexRequest(creds, "/trading/orders/regular", { method: "POST", body }), null, "order");
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = checkOrderId(orderId);
  if ([changes?.qty, changes?.orderType, changes?.price, changes?.triggerPrice, changes?.validity].every((v) => v === undefined)) throw bad("Nothing to modify");
  const history = await vortexRequest(creds, `/trading/orders/${encodeURIComponent(id)}`);
  const current = Array.isArray(history?.data) ? history.data[0] : null;
  const body = buildModifyBody(current, changes);
  return ackOf(await vortexRequest(creds, `/trading/orders/regular/${encodeURIComponent(id)}`, { method: "PUT", body }), id, "modify");
}

async function cancelOrderImpl(creds, orderId) {
  const id = checkOrderId(orderId);
  return ackOf(await vortexRequest(creds, `/trading/orders/regular/${encodeURIComponent(id)}`, { method: "DELETE" }), id, "cancel");
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "rupeezy" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "rupeezy" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "rupeezy" });
