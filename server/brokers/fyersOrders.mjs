/**
 * Fyers API v3 orders (real money) + order book / trade book (read-only).
 *
 * Every field and enum below is from Fyers' official v3 docs (checked 2026-10):
 *  - Place:  POST   /api/v3/orders/sync  { symbol, qty, type, side, productType, limitPrice, stopPrice,
 *            disclosedQty, validity, offlineOrder, stopLoss?, takeProfit?, orderTag?, isSliceOrder? } -> { s, code, message, id }
 *            https://fyers.in/api-docs/v3/api/trading/order-placement/sync/single-order/
 *  - Modify: PATCH  /api/v3/orders/sync  { id, type, limitPrice?, stopPrice?, qty?, disclosedQty? }
 *  - Cancel: DELETE /api/v3/orders/sync  { id }   (code 1103 "Successfully cancelled order")
 *  - Orders: GET /api/v3/orders -> orderBook[];  Trades: GET /api/v3/tradebook -> tradeBook[]
 *  - Appendix: type 1 Limit, 2 Market, 3 Stop (SL-M), 4 Stoplimit (SL-L); side 1 Buy, -1 Sell;
 *    productType CNC (equity only), INTRADAY, MARGIN (derivatives), MTF; validity DAY or IOC;
 *    order status 1 Cancelled, 2 Traded/Filled, 4 Transit, 5 Rejected, 6 Pending, 7 Expired (3 unused).
 *  - A response code of 201 means "request made but not acknowledged": check the order book before retrying.
 *  - Placing + modifying + cancelling together: at most 10 orders per second.
 *
 * Real-money calls are wrapped with withOrderGate(): without a fresh gate minted by the proxy's trade route
 * after validateOrder() and live arming, they throw OrderGateError before any network call. No route mints
 * Fyers gates today, so live Fyers orders stay blocked pending owner review.
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { contractExchange, contractProduct, fyersRequest, fyersTimeToIso, num, tradingSymbolOf } from "./fyersClient.mjs";

const ORDER_TYPE_CODE = { LIMIT: 1, MARKET: 2, STOP: 3, STOPLIMIT: 4 };
const ORDER_TYPE_NAME = { 1: "LIMIT", 2: "MARKET", 3: "SL-M", 4: "SL" };
const ORDER_SIDE_CODE = { BUY: 1, SELL: -1 };
// MTF is a documented productType but it is an equity-delivery facility; this terminal trades F&O, so it
// stays out until there is an equity order flow. BO/CO are not in the v3 product table.
const VALID_PRODUCT_TYPES = new Set(["CNC", "INTRADAY", "MARGIN"]);
const VALID_VALIDITY = new Set(["DAY", "IOC"]);

/** Legacy order-feature descriptor (the UI must never offer a control this does not declare). */
export const ORDER_FEATURES = {
  bracket: false, // BO is not in Fyers' v3 product-type table.
  cover: false, // CO is not in Fyers' v3 product-type table.
  ioc: true, // validity "IOC" is documented on the single-order page and in the appendix.
  mtf: false, // documented, but equity-only; not offered in this F&O terminal.
  nativeMarketProtection: false, // no market-protection field in the v3 order request.
  maxLegQty: null, // no Fyers per-order cap documented; exchange freeze limits apply (isSliceOrder is not used).
  products: ["CNC", "INTRADAY", "MARGIN"],
};

function bad(message) {
  return new BrokerInputError(message);
}

/**
 * Pure body builder. `resolvedLotSize` comes from the exchange instrument master, never from the client:
 * a lotSize field on `order` is ignored.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const {
    symbol, side, orderType, productType = "INTRADAY", validity = "DAY",
    lots, limitPrice, stopPrice, disclosedQty = 0, offlineOrder = false,
  } = order || {};
  if (typeof symbol !== "string" || !/^(NSE|BSE|MCX):[A-Z0-9&_.-]+$/.test(symbol)) {
    throw bad(`Invalid Fyers symbol: ${symbol} (expected "EXCH:TRADINGSYMBOL", e.g. "NSE:NIFTY26OCT25000CE")`);
  }
  if (!ORDER_SIDE_CODE[side]) throw bad(`Invalid side: ${side}`);
  if (!VALID_PRODUCT_TYPES.has(productType)) {
    throw bad(`Unsupported Fyers productType: ${productType} (supported: ${[...VALID_PRODUCT_TYPES].join(", ")})`);
  }
  if (!VALID_VALIDITY.has(validity)) throw bad(`Unsupported Fyers validity: ${validity} (DAY or IOC)`);
  const typeCode = ORDER_TYPE_CODE[orderType];
  if (!typeCode) throw bad(`Invalid orderType: ${orderType} (expected LIMIT, MARKET, STOP, or STOPLIMIT)`);
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  }
  if (!Number.isFinite(lots) || lots <= 0 || !Number.isInteger(lots)) throw bad("Invalid lots");
  const needsLimit = orderType === "LIMIT" || orderType === "STOPLIMIT";
  const needsStop = orderType === "STOP" || orderType === "STOPLIMIT";
  if (needsLimit && !(Number.isFinite(limitPrice) && limitPrice > 0)) throw bad(`limitPrice required for ${orderType}`);
  if (needsStop && !(Number.isFinite(stopPrice) && stopPrice > 0)) throw bad(`stopPrice required for ${orderType}`);
  return {
    symbol,
    qty: Math.round(lots * resolvedLotSize),
    type: typeCode,
    side: ORDER_SIDE_CODE[side],
    productType,
    limitPrice: needsLimit ? limitPrice : 0,
    stopPrice: needsStop ? stopPrice : 0,
    disclosedQty: Number.isInteger(disclosedQty) && disclosedQty >= 0 ? disclosedQty : 0,
    validity,
    offlineOrder: offlineOrder === true,
  };
}

/** Pure modify body: `type` is always required by Fyers; prices only for the order types that use them. */
export function buildModifyBody(orderId, changes) {
  const id = String(orderId ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) throw bad("Invalid Fyers order id");
  const { orderType, limitPrice, stopPrice, qty } = changes || {};
  const type = ORDER_TYPE_CODE[orderType];
  if (!type) throw bad(`Invalid orderType: ${orderType} (expected LIMIT, MARKET, STOP, or STOPLIMIT)`);
  const body = { id, type };
  if (type === 1 || type === 4) {
    if (!(Number.isFinite(limitPrice) && limitPrice > 0)) throw bad(`limitPrice required for ${orderType}`);
    body.limitPrice = limitPrice;
  }
  if (type === 3 || type === 4) {
    if (!(Number.isFinite(stopPrice) && stopPrice > 0)) throw bad(`stopPrice required for ${orderType}`);
    body.stopPrice = stopPrice;
  }
  if (qty !== undefined) {
    if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units (a multiple of the lot size)");
    body.qty = qty;
  }
  return body;
}

function ackStatus(json, fallback) {
  // 201 = request made but not acknowledged by the exchange yet; the caller must re-read the order book.
  return Number(json?.code) === 201 ? "UNKNOWN" : fallback;
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const body = buildOrderBody(order, resolvedLotSize);
  const json = await fyersRequest(creds, "/api/v3/orders/sync", { method: "POST", body });
  // Placement returns no order state, so this is UNKNOWN until the order book is read.
  return { orderId: String(json.id ?? ""), orderStatus: ackStatus(json, "UNKNOWN") };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const body = buildModifyBody(orderId, changes);
  const json = await fyersRequest(creds, "/api/v3/orders/sync", { method: "PATCH", body });
  return { orderId: String(json.id ?? body.id), orderStatus: ackStatus(json, "UNKNOWN") };
}

async function cancelOrderImpl(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) throw bad("Invalid Fyers order id");
  const json = await fyersRequest(creds, "/api/v3/orders/sync", { method: "DELETE", body: { id } });
  const confirmed = Number(json.code) === 1103;
  return { orderId: String(json.id ?? id), orderStatus: ackStatus(json, confirmed ? "CANCELLED" : "UNKNOWN") };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "fyers" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "fyers" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "fyers" });

// ── read-only books ──

/** Fyers numeric status (+ fills) -> contract OrderStatus. */
export function mapOrderStatus(row) {
  const status = Number(row?.status);
  const filled = num(row?.filledQty);
  const remaining = num(row?.remainingQuantity);
  switch (status) {
    case 1: return "CANCELLED";
    case 2: return "COMPLETE";
    case 5: return "REJECTED";
    case 7: return "EXPIRED";
    case 4:
    case 6:
      if (filled > 0 && remaining > 0) return "PARTIALLY_FILLED";
      return Number(row?.type) === 3 || Number(row?.type) === 4 ? "TRIGGER_PENDING" : "OPEN";
    default: return "UNKNOWN";
  }
}

export function mapOrder(row) {
  const ticker = String(row?.symbol ?? "");
  const qty = num(row?.qty);
  const filledQty = num(row?.filledQty);
  return {
    orderId: String(row?.id ?? ""),
    tradingSymbol: tradingSymbolOf(ticker),
    exchange: contractExchange(ticker, row?.segment),
    token: ticker,
    side: Number(row?.side) === -1 ? "SELL" : "BUY",
    qty,
    filledQty,
    pendingQty: row?.remainingQuantity != null ? num(row.remainingQuantity) : Math.max(0, qty - filledQty),
    price: num(row?.limitPrice),
    triggerPrice: num(row?.stopPrice),
    avgPrice: num(row?.tradedPrice),
    orderType: ORDER_TYPE_NAME[Number(row?.type)] || "UNKNOWN",
    product: contractProduct(row?.productType),
    status: mapOrderStatus(row),
    statusMessage: row?.message ? String(row.message) : null,
    placedAt: fyersTimeToIso(row?.orderDateTime),
  };
}

export async function fetchOrderBook(creds) {
  const json = await fyersRequest(creds, "/api/v3/orders");
  return { status: "success", data: (json.orderBook || []).map(mapOrder) };
}

/** One order by id (GET /api/v3/orders?id=...), normalised. */
export async function getOrderStatus(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) throw bad("Invalid Fyers order id");
  const json = await fyersRequest(creds, "/api/v3/orders", { query: { id } });
  const row = (json.orderBook || []).find((r) => String(r.id) === id);
  if (!row) throw bad(`Fyers returned no order matching id ${id}`);
  return mapOrder(row);
}

export function mapTrade(row) {
  const ticker = String(row?.symbol ?? "");
  return {
    tradeId: String(row?.tradeNumber ?? row?.row ?? ""),
    orderId: String(row?.orderNumber ?? ""),
    tradingSymbol: tradingSymbolOf(ticker),
    exchange: contractExchange(ticker, row?.segment),
    token: ticker,
    side: Number(row?.side) === -1 ? "SELL" : "BUY",
    qty: num(row?.tradedQty),
    price: num(row?.tradePrice),
    tradedAt: fyersTimeToIso(row?.orderDateTime),
  };
}

export async function fetchTradeBook(creds) {
  const json = await fyersRequest(creds, "/api/v3/tradebook");
  return { status: "success", data: (json.tradeBook || []).map(mapTrade) };
}
