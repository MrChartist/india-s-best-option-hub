/**
 * Upstox orders: gated place/modify/cancel (v3, api-hft.upstox.com), order book and trade book (v2).
 *
 * Official sources (October 2026), https://upstox.com/developer/api-documentation/:
 *  - v3/place-order: POST https://api-hft.upstox.com/v3/order/place, JSON { quantity, product (I, D, MTF),
 *    validity (DAY, IOC), price, tag (max 40 chars), instrument_token, order_type (MARKET, LIMIT, SL, SL-M),
 *    transaction_type, disclosed_quantity, trigger_price, is_amo, slice, market_protection }.
 *    market_protection applies to MARKET and SL-M: -1 automatic (default), 1-25 custom %, 0 none
 *    ("Order will be rejected due to exchange restrictions on MARKET orders from API").
 *    Quantity is in units for equity and F&O, in LOTS for commodity; MCX API orders are currently
 *    disabled by Upstox (UDAPI1161), so MCX is refused here. Response { data: { order_ids: [...] } }.
 *  - v3/modify-order: PUT .../v3/order/modify, JSON { order_id, order_type, validity, price,
 *    trigger_price, quantity?, disclosed_quantity?, market_protection? }.
 *  - v3/cancel-order: DELETE .../v3/order/cancel?order_id=...
 *  - get-order-book: GET /v2/order/retrieve-all; get-trade-history: GET /v2/order/trades/get-trades-for-day.
 *  - appendix/order-status: open, complete, rejected, cancelled, trigger pending, validation pending,
 *    put order req received, open pending, modify pending, modify validation pending, cancel pending,
 *    modified, not modified, not cancelled, after market order req received, modify after market order
 *    req received, cancelled after market order.
 *
 * Acks report orderStatus "UNKNOWN": the place/modify/cancel responses carry ids only.
 * Real-money calls are wrapped with withOrderGate; no route mints gates for Upstox today.
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { UPSTOX_HFT, upstoxFetch } from "./upstoxClient.mjs";
import { upstoxExchange, upstoxProduct } from "./upstoxData.mjs";

const ORDER_TYPES = new Set(["MARKET", "LIMIT", "SL", "SL-M"]);
const VALIDITY = new Set(["DAY", "IOC"]);
const SIDES = new Set(["BUY", "SELL"]);
/** App vocabulary -> Upstox product. CNC and MARGIN both map to D (delivery / carry-forward). */
const PRODUCT = { INTRADAY: "I", I: "I", CNC: "D", MARGIN: "D", D: "D", MTF: "MTF" };

export const orderFeatures = {
  bracket: false, // not offered by the v3 order API
  cover: false, // CO appears on old orders but v3 place-order products are I, D, MTF only
  ioc: true,
  mtf: true,
  nativeMarketProtection: true,
  maxLegQty: null, // freeze quantity per instrument (BOD file freeze_quantity); `slice` not used here
  products: ["I", "D", "MTF"],
};

function marketProtection(orderType, value) {
  if (orderType !== "MARKET" && orderType !== "SL-M") return undefined;
  if (value === undefined || value === null) return -1;
  const v = Number(value);
  if (v === -1 || (Number.isInteger(v) && v >= 1 && v <= 25)) return v;
  throw new Error("Invalid marketProtection (use -1 for automatic, or 1-25)");
}

/** Pure body builder for POST /v3/order/place. resolvedLotSize comes from the instrument master only. */
export function buildOrderBody(order, resolvedLotSize) {
  const { instrumentKey, transactionType, orderType, product = "INTRADAY", validity = "DAY", lots, price, triggerPrice, tag, marketProtection: mp } = order || {};
  const key = String(instrumentKey ?? "");
  if (!/^[A-Z_]+\|[A-Za-z0-9 &.\-_]+$/.test(key)) throw new Error("Missing or invalid instrumentKey");
  if (key.startsWith("MCX_")) throw new Error("MCX orders are not supported through the Upstox API");
  if (!SIDES.has(transactionType)) throw new Error(`Invalid transactionType: ${transactionType}`);
  if (!ORDER_TYPES.has(orderType)) throw new Error(`Invalid orderType: ${orderType}`);
  if (!PRODUCT[product]) throw new Error(`Invalid product: ${product}`);
  if (!VALIDITY.has(validity)) throw new Error(`Invalid validity: ${validity}`);
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
    quantity: Math.round(lots * resolvedLotSize),
    product: PRODUCT[product],
    validity,
    price: needsPrice ? price : 0,
    instrument_token: key,
    order_type: orderType,
    transaction_type: transactionType,
    disclosed_quantity: 0,
    trigger_price: needsTrigger ? triggerPrice : 0,
    is_amo: false,
    slice: false,
  };
  const protection = marketProtection(orderType, mp);
  if (protection !== undefined) body.market_protection = protection;
  if (tag) body.tag = String(tag).slice(0, 40);
  return body;
}

/** Pure body builder for PUT /v3/order/modify. */
export function buildModifyBody(orderId, changes) {
  const { orderType, validity = "DAY", price, triggerPrice, quantity, marketProtection: mp } = changes || {};
  if (!ORDER_TYPES.has(orderType)) throw new Error(`Invalid orderType: ${orderType}`);
  if (!VALIDITY.has(validity)) throw new Error(`Invalid validity: ${validity}`);
  const needsTrigger = orderType === "SL" || orderType === "SL-M";
  if (needsTrigger && !Number.isFinite(triggerPrice)) throw new Error(`trigger_price required for ${orderType}`);
  const needsPrice = orderType === "LIMIT" || orderType === "SL";
  if (needsPrice && !Number.isFinite(price)) throw new Error(`price required for ${orderType}`);
  if (quantity !== undefined && !(Number.isInteger(quantity) && quantity > 0)) throw new Error("Invalid quantity");
  const body = { order_id: String(orderId), order_type: orderType, validity, price: needsPrice ? price : 0, trigger_price: needsTrigger ? triggerPrice : 0 };
  if (quantity !== undefined) body.quantity = quantity;
  const protection = marketProtection(orderType, mp);
  if (protection !== undefined) body.market_protection = protection;
  return body;
}

const checkOrderId = (orderId) => {
  if (!/^[A-Za-z0-9-]{1,40}$/.test(String(orderId ?? ""))) throw new BrokerInputError("Upstox: invalid order id.");
  return String(orderId);
};

export const placeOrder = withOrderGate("placeOrder", async (creds, order, resolvedLotSize) => {
  const body = buildOrderBody(order, resolvedLotSize);
  const res = await upstoxFetch("/v3/order/place", creds, { method: "POST", json: body, base: UPSTOX_HFT });
  const ids = res.data?.order_ids ?? (res.data?.order_id ? [res.data.order_id] : []);
  return { orderId: String(ids[0] ?? ""), orderStatus: "UNKNOWN", ...(ids.length > 1 ? { orderIds: ids.map(String) } : {}) };
}, { brokerId: "upstox" });

export const modifyOrder = withOrderGate("modifyOrder", async (creds, orderId, changes) => {
  const body = buildModifyBody(checkOrderId(orderId), changes);
  const res = await upstoxFetch("/v3/order/modify", creds, { method: "PUT", json: body, base: UPSTOX_HFT });
  return { orderId: String(res.data?.order_id ?? orderId), orderStatus: "UNKNOWN" };
}, { brokerId: "upstox" });

export const cancelOrder = withOrderGate("cancelOrder", async (creds, orderId) => {
  const res = await upstoxFetch("/v3/order/cancel", creds, { method: "DELETE", query: { order_id: checkOrderId(orderId) }, base: UPSTOX_HFT });
  return { orderId: String(res.data?.order_id ?? orderId), orderStatus: "UNKNOWN" };
}, { brokerId: "upstox" });

// ── read-only books ──

const OPENISH = new Set(["open", "validation pending", "put order req received", "open pending", "modify pending", "modify validation pending", "cancel pending", "modified", "not modified", "not cancelled", "after market order req received", "modify after market order req received"]);

export function upstoxOrderStatus(status, filled = 0) {
  const s = String(status ?? "").toLowerCase();
  if (s === "complete") return "COMPLETE";
  if (s === "rejected") return "REJECTED";
  if (s === "cancelled" || s === "cancelled after market order") return "CANCELLED";
  if (s === "trigger pending") return "TRIGGER_PENDING";
  if (OPENISH.has(s)) return filled > 0 ? "PARTIALLY_FILLED" : "OPEN";
  return "UNKNOWN";
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (body) => (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []);

export function mapUpstoxOrder(o) {
  const exchange = upstoxExchange(o.exchange, o.instrument_token);
  const filled = n(o.filled_quantity);
  return {
    orderId: String(o.order_id ?? ""),
    tradingSymbol: String(o.trading_symbol ?? o.tradingsymbol ?? ""),
    exchange,
    token: String(o.instrument_token ?? ""),
    side: o.transaction_type === "SELL" ? "SELL" : "BUY",
    qty: n(o.quantity),
    filledQty: filled,
    pendingQty: n(o.pending_quantity),
    price: n(o.price),
    triggerPrice: n(o.trigger_price),
    avgPrice: n(o.average_price),
    orderType: String(o.order_type ?? "UNKNOWN"),
    product: upstoxProduct(o.product, exchange),
    status: upstoxOrderStatus(o.status, filled),
    statusMessage: o.status_message ? String(o.status_message) : null,
    placedAt: o.order_timestamp ? String(o.order_timestamp) : null,
  };
}

export function mapUpstoxTrade(t) {
  return {
    tradeId: String(t.trade_id ?? ""),
    orderId: String(t.order_id ?? ""),
    tradingSymbol: String(t.trading_symbol ?? t.tradingsymbol ?? ""),
    exchange: upstoxExchange(t.exchange, t.instrument_token),
    token: String(t.instrument_token ?? ""),
    side: t.transaction_type === "SELL" ? "SELL" : "BUY",
    qty: n(t.quantity),
    price: n(t.average_price),
    tradedAt: t.exchange_timestamp ? String(t.exchange_timestamp) : null,
  };
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: list(await upstoxFetch("/v2/order/retrieve-all", creds)).map(mapUpstoxOrder) };
}

export async function fetchTradeBook(creds) {
  return { status: "success", data: list(await upstoxFetch("/v2/order/trades/get-trades-for-day", creds)).map(mapUpstoxTrade) };
}
