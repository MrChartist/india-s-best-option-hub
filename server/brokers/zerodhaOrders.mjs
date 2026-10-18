/**
 * Zerodha (Kite Connect v3) orders: gated place/modify/cancel, order book and trade book.
 *
 * Official source: https://kite.trade/docs/connect/v3/orders/ (October 2026)
 *  - POST /orders/:variety, PUT /orders/:variety/:order_id, DELETE /orders/:variety/:order_id, all
 *    form-encoded; each answers { order_id } only. "The status of the order is not known at the moment
 *    of placing", so every ack here reports orderStatus "UNKNOWN" and callers must re-read the book.
 *  - GET /orders (the day's order book), GET /orders/:order_id (status history, last entry current),
 *    GET /trades (the day's fills).
 *  - Enums: variety regular|amo|co|iceberg|auction; order_type MARKET|LIMIT|SL|SL-M;
 *    product CNC|NRML|MIS|MTF; validity DAY|IOC|TTL; tag alphanumeric, max 20 chars.
 *  - market_protection: >0..100 (custom %) or -1 (automatic) for MARKET and SL-M orders. Kite's own
 *    examples now always send -1, and exchanges reject unprotected API market orders, so MARKET and
 *    SL-M orders carry market_protection=-1 unless the caller passes its own value.
 *  - Order statuses: OPEN, COMPLETE, CANCELLED, REJECTED plus transient PUT ORDER REQ RECEIVED,
 *    VALIDATION PENDING, OPEN PENDING, MODIFY VALIDATION PENDING, MODIFY PENDING, TRIGGER PENDING,
 *    CANCEL PENDING, AMO REQ RECEIVED.
 *  - Limits: 10 orders/second, 400/minute, 5000/day per user; at most 25 modifications per order.
 *
 * Only the "regular" variety is wired. Real-money calls are wrapped with withOrderGate: without a gate
 * minted by the proxy's trade route they refuse before any network call. No route mints gates for
 * Zerodha today (browser order path blocked pending owner review).
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { kiteFetch } from "./zerodhaClient.mjs";
import { kiteExchange, kiteProduct } from "./zerodhaData.mjs";

const VALID_TRANSACTION_TYPES = new Set(["BUY", "SELL"]);
const VALID_ORDER_TYPES = new Set(["MARKET", "LIMIT", "SL", "SL-M"]);
const VALID_PRODUCTS = new Set(["MIS", "NRML", "CNC", "MTF"]);
/** App vocabulary -> Kite product. Kite-native names pass through. */
const PRODUCT_ALIAS = { INTRADAY: "MIS", MARGIN: "NRML" };
// TTL excluded: it needs validity_ttl, which nothing in the app sends.
const VALID_VALIDITY = new Set(["DAY", "IOC"]);
const VALID_EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "CDS", "BCD", "MCX"]);
const VARIETY = "regular";

/**
 * Order-feature descriptor (legacy keys, merged into zerodha.mjs `capabilities`). Every value is
 * backed by Kite's documented enums.
 */
export const orderFeatures = {
  bracket: false, // "bo" is not in Kite's documented variety enum.
  cover: true, // "co" is a documented variety (not wired here).
  ioc: true, // validity IOC.
  mtf: true, // product MTF.
  nativeMarketProtection: true, // market_protection field.
  maxLegQty: null, // no documented per-order cap beyond the exchange freeze quantity.
  products: ["CNC", "NRML", "MIS", "MTF"],
};
/** Back-compat name for the descriptor (older imports). */
export const capabilities = orderFeatures;

function marketProtectionFor(orderType, value) {
  if (orderType !== "MARKET" && orderType !== "SL-M") return undefined;
  if (value === undefined || value === null) return -1;
  const v = Number(value);
  if (v === -1 || (v > 0 && v <= 100)) return v;
  throw new Error("Invalid marketProtection (use -1 for automatic, or 0 < value <= 100)");
}

/**
 * Pure request-body builder for POST /orders/regular. `resolvedLotSize` is a separate, required
 * argument from the exchange instrument master; a lotSize on `order` is ignored.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const {
    tradingsymbol, exchange = "NFO", transactionType, orderType,
    product: rawProduct = "MIS", validity = "DAY", lots, price, triggerPrice, tag, marketProtection,
  } = order || {};
  const product = PRODUCT_ALIAS[rawProduct] ?? rawProduct;

  if (!tradingsymbol) throw new Error("Missing tradingsymbol");
  if (!VALID_EXCHANGES.has(exchange)) throw new Error(`Invalid exchange: ${exchange}`);
  if (!VALID_TRANSACTION_TYPES.has(transactionType)) throw new Error(`Invalid transactionType: ${transactionType}`);
  if (!VALID_ORDER_TYPES.has(orderType)) throw new Error(`Invalid orderType: ${orderType}`);
  if (!VALID_PRODUCTS.has(product)) throw new Error(`Invalid product: ${rawProduct}`);
  if (!VALID_VALIDITY.has(validity)) throw new Error(`Invalid validity: ${validity}`);
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw new Error("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  }
  // Whole lots only: a fractional value would send a quantity that is not a lot multiple (or be silently rounded).
  if (!Number.isInteger(lots) || lots <= 0) throw new Error("Invalid lots: must be a positive whole number");

  const needsTrigger = orderType === "SL" || orderType === "SL-M";
  if (needsTrigger && !Number.isFinite(triggerPrice)) throw new Error(`trigger_price required for ${orderType}`);
  const needsPrice = orderType === "LIMIT" || orderType === "SL";
  if (needsPrice && !Number.isFinite(price)) throw new Error(`price required for ${orderType}`);

  const body = {
    tradingsymbol,
    exchange,
    transaction_type: transactionType,
    order_type: orderType,
    quantity: Math.round(lots * resolvedLotSize),
    product,
    validity,
    price: needsPrice ? price : 0,
  };
  if (needsTrigger) body.trigger_price = triggerPrice;
  const mp = marketProtectionFor(orderType, marketProtection);
  if (mp !== undefined) body.market_protection = mp;
  if (tag) body.tag = String(tag).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
  return body;
}

/** Pure body builder for PUT /orders/regular/:order_id (order_type, quantity, price, trigger_price, validity). */
export function buildModifyBody(changes) {
  const { orderType, quantity, price, triggerPrice, validity = "DAY", marketProtection } = changes || {};
  if (!VALID_ORDER_TYPES.has(orderType)) throw new Error(`Invalid orderType: ${orderType}`);
  if (!VALID_VALIDITY.has(validity)) throw new Error(`Invalid validity: ${validity}`);
  const needsTrigger = orderType === "SL" || orderType === "SL-M";
  if (needsTrigger && !Number.isFinite(triggerPrice)) throw new Error(`trigger_price required for ${orderType}`);
  const needsPrice = orderType === "LIMIT" || orderType === "SL";
  if (needsPrice && !Number.isFinite(price)) throw new Error(`price required for ${orderType}`);
  if (quantity !== undefined && !(Number.isInteger(quantity) && quantity > 0)) throw new Error("Invalid quantity");
  const body = { order_type: orderType, validity };
  if (quantity !== undefined) body.quantity = quantity;
  if (needsPrice) body.price = price;
  if (needsTrigger) body.trigger_price = triggerPrice;
  const mp = marketProtectionFor(orderType, marketProtection);
  if (mp !== undefined) body.market_protection = mp;
  return body;
}

const orderPath = (orderId) => {
  if (!orderId || !/^[A-Za-z0-9-]{1,40}$/.test(String(orderId))) throw new BrokerInputError("Zerodha: invalid order id.");
  return `/orders/${VARIETY}/${encodeURIComponent(orderId)}`;
};
const ack = (data) => ({ orderId: String(data?.order_id ?? ""), orderStatus: "UNKNOWN" });

export const placeOrder = withOrderGate("placeOrder", async (creds, order, resolvedLotSize) => {
  const body = buildOrderBody(order, resolvedLotSize);
  return ack(await kiteFetch(`/orders/${VARIETY}`, creds, { method: "POST", form: body }));
}, { brokerId: "zerodha" });

export const modifyOrder = withOrderGate("modifyOrder", async (creds, orderId, changes) => {
  const path = orderPath(orderId);
  return ack(await kiteFetch(path, creds, { method: "PUT", form: buildModifyBody(changes) }));
}, { brokerId: "zerodha" });

export const cancelOrder = withOrderGate("cancelOrder", async (creds, orderId) => {
  return ack(await kiteFetch(orderPath(orderId), creds, { method: "DELETE" }));
}, { brokerId: "zerodha" });

// ── read-only books ──

const PENDING = new Set(["PUT ORDER REQ RECEIVED", "VALIDATION PENDING", "OPEN PENDING", "MODIFY VALIDATION PENDING", "MODIFY PENDING", "CANCEL PENDING", "AMO REQ RECEIVED", "MODIFIED"]);

/** Kite status (+ fill progress) -> contract OrderStatus. */
export function kiteOrderStatus(status, filled = 0) {
  const s = String(status ?? "").toUpperCase();
  if (s === "COMPLETE") return "COMPLETE";
  if (s === "REJECTED") return "REJECTED";
  if (s === "CANCELLED" || s === "CANCELLED AMO") return "CANCELLED";
  if (s === "TRIGGER PENDING") return "TRIGGER_PENDING";
  if (s === "OPEN" || PENDING.has(s)) return filled > 0 ? "PARTIALLY_FILLED" : "OPEN";
  return "UNKNOWN";
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function mapKiteOrder(o) {
  const filled = n(o.filled_quantity);
  return {
    orderId: String(o.order_id ?? ""),
    tradingSymbol: String(o.tradingsymbol ?? ""),
    exchange: kiteExchange(o.exchange),
    token: String(o.instrument_token ?? ""),
    side: o.transaction_type === "SELL" ? "SELL" : "BUY",
    qty: n(o.quantity),
    filledQty: filled,
    pendingQty: n(o.pending_quantity),
    price: n(o.price),
    triggerPrice: n(o.trigger_price),
    avgPrice: n(o.average_price),
    orderType: String(o.order_type ?? "UNKNOWN"),
    product: kiteProduct(o.product),
    status: kiteOrderStatus(o.status, filled),
    statusMessage: o.status_message ? String(o.status_message) : null,
    placedAt: o.order_timestamp ? String(o.order_timestamp) : null,
  };
}

export function mapKiteTrade(t) {
  return {
    tradeId: String(t.trade_id ?? ""),
    orderId: String(t.order_id ?? ""),
    tradingSymbol: String(t.tradingsymbol ?? ""),
    exchange: kiteExchange(t.exchange),
    token: String(t.instrument_token ?? ""),
    side: t.transaction_type === "SELL" ? "SELL" : "BUY",
    qty: n(t.quantity),
    price: n(t.average_price),
    tradedAt: t.fill_timestamp ? String(t.fill_timestamp) : t.exchange_timestamp ? String(t.exchange_timestamp) : null,
  };
}

/** Raw day order book (kept for older callers). */
export async function getOrders(creds) {
  return kiteFetch("/orders", creds);
}

/** Current state of one order (last entry of GET /orders/:order_id). */
export async function getOrderStatus(creds, orderId) {
  if (!orderId) throw new BrokerInputError("Zerodha: missing order id.");
  const history = await kiteFetch(`/orders/${encodeURIComponent(orderId)}`, creds);
  return Array.isArray(history) ? history[history.length - 1] : history;
}

export async function fetchOrderBook(creds) {
  const data = await kiteFetch("/orders", creds);
  return { status: "success", data: (Array.isArray(data) ? data : []).map(mapKiteOrder) };
}

export async function fetchTradeBook(creds) {
  const data = await kiteFetch("/trades", creds);
  return { status: "success", data: (Array.isArray(data) ? data : []).map(mapKiteTrade) };
}
