/**
 * Alice Blue Open API (V2) orders (real money, gated) + order book / trade book (read-only).
 *
 * Official docs: https://ant.aliceblueonline.com/productdocumentation/orders%20Management/ and /Appendix/ (2026-10):
 *  - POST /open-api/od/v1/orders/placeorder  body is an ARRAY of one order: { exchange, instrumentId, transactionType,
 *    quantity, product, orderComplexity, orderType, validity, price, slTriggerPrice, disclosedQuantity,
 *    marketProtectionPercent, deviceId, trailingSlAmount, orderTag, slLegPrice, targetLegPrice }
 *    -> result[0] { brokerOrderId, requestTime }
 *  - POST /open-api/od/v1/orders/modify  { brokerOrderId, quantity, orderType, price, slTriggerPrice, validity,
 *    disclosedQuantity, marketProtectionPercent, trailingSlAmount, deviceId }
 *  - POST /open-api/od/v1/orders/cancel  { brokerOrderId }
 *  - GET  /open-api/od/v1/orders/book, GET /open-api/od/v1/orders/trades
 *  - Appendix: transactionType BUY/SELL; orderType LIMIT, MARKET, SL, SLM; product INTRADAY, LONGTERM, MTF;
 *    orderComplexity REGULAR, AMO, CO, BO; validity DAY, IOC.
 * Product for F&O carry-forward: the Appendix lists only INTRADAY / LONGTERM / MTF, error EC969 says "'Product'
 * should be either 'NORMAL' or 'INTRADAY'", and OpenAlgo sends "NRML". Until a live order settles which one is
 * accepted, only INTRADAY (all segments) and LONGTERM (cash segment, app "CNC") are built here.
 * Every real-money call is wrapped with withOrderGate(); no route mints Alice Blue gates today.
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { abRequest } from "./aliceblueAuth.mjs";
import { contractExchange, contractProduct, num } from "./alicebluePortfolio.mjs";

const ORDER_TYPES = new Set(["LIMIT", "MARKET", "SL", "SLM"]);
const VALIDITY = new Set(["DAY", "IOC"]);
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX"]);
const CASH = new Set(["NSE", "BSE"]);

export const ORDER_FEATURES = {
  bracket: false, // BO is a documented orderComplexity, not built here.
  cover: false, // CO likewise.
  ioc: true, // validity IOC is documented (Appendix, EC932).
  mtf: false, // MTF is equity-only; not offered in this F&O terminal.
  nativeMarketProtection: true, // marketProtectionPercent is a documented order field.
  maxLegQty: null, // EC088 "Single order slicing limit exceeded" exists but no number is documented.
  products: ["CNC", "INTRADAY"],
};

const bad = (m) => new BrokerInputError(m);

function productCode(product, exchange) {
  if (product === "INTRADAY") return "INTRADAY";
  if (product === "CNC" && CASH.has(exchange)) return "LONGTERM";
  throw bad(`Unsupported Alice Blue product ${product} on ${exchange} (INTRADAY, or CNC on NSE/BSE cash)`);
}

/**
 * Pure body builder (returns the documented one-element array). order: { token (instrumentId), exchange, side,
 * orderType: LIMIT|MARKET|SL|SLM, product: INTRADAY|CNC, validity: DAY|IOC, lots, price?, triggerPrice?,
 * marketProtectionPercent? }. `resolvedLotSize` comes from the contract master, never the client.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { token, exchange, side, orderType = "LIMIT", product = "INTRADAY", validity = "DAY", lots, price, triggerPrice, marketProtectionPercent } = order || {};
  if (!/^\d{1,12}$/.test(String(token ?? ""))) throw bad("Invalid Alice Blue instrumentId (numeric token from the contract master)");
  if (!EXCHANGES.has(exchange)) throw bad(`Invalid exchange: ${exchange}`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (!ORDER_TYPES.has(orderType)) throw bad(`Invalid orderType: ${orderType} (LIMIT, MARKET, SL, SLM)`);
  if (!VALIDITY.has(validity)) throw bad(`Invalid validity: ${validity} (DAY or IOC)`);
  const prod = productCode(product, exchange);
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  }
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  const needsPrice = orderType === "LIMIT" || orderType === "SL";
  const needsTrigger = orderType === "SL" || orderType === "SLM";
  if (needsPrice && !(Number.isFinite(price) && price > 0)) throw bad(`price required for ${orderType}`);
  if (needsTrigger && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad(`triggerPrice required for ${orderType}`);
  const mpp = marketProtectionPercent === undefined ? "" : String(marketProtectionPercent);
  if (mpp && !(Number(mpp) > 0)) throw bad("marketProtectionPercent must be a positive number");
  return [{
    exchange,
    instrumentId: String(token),
    transactionType: side,
    quantity: Math.round(lots * resolvedLotSize),
    product: prod,
    orderComplexity: "REGULAR",
    orderType,
    validity,
    price: needsPrice ? price : 0,
    slTriggerPrice: needsTrigger ? triggerPrice : 0,
    disclosedQuantity: 0,
    marketProtectionPercent: mpp,
    deviceId: "",
    trailingSlAmount: "",
    orderTag: "",
  }];
}

/** Pure modify body. changes: { orderType, qty (units), price?, triggerPrice?, validity? } */
export function buildModifyBody(orderId, changes) {
  const brokerOrderId = String(orderId ?? "").trim();
  if (!/^\d{1,30}$/.test(brokerOrderId)) throw bad("Invalid Alice Blue brokerOrderId");
  const { orderType = "LIMIT", qty, price, triggerPrice, validity = "DAY" } = changes || {};
  if (!ORDER_TYPES.has(orderType)) throw bad(`Invalid orderType: ${orderType}`);
  if (!VALIDITY.has(validity)) throw bad(`Invalid validity: ${validity}`);
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  const needsPrice = orderType === "LIMIT" || orderType === "SL";
  const needsTrigger = orderType === "SL" || orderType === "SLM";
  if (needsPrice && !(Number.isFinite(price) && price > 0)) throw bad(`price required for ${orderType}`);
  if (needsTrigger && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad(`triggerPrice required for ${orderType}`);
  return {
    brokerOrderId,
    quantity: qty,
    orderType,
    price: needsPrice ? price : 0,
    slTriggerPrice: needsTrigger ? triggerPrice : 0,
    validity,
    disclosedQuantity: 0,
    marketProtectionPercent: "",
    trailingSlAmount: 0,
    deviceId: "",
  };
}

const firstResult = (json) => (Array.isArray(json?.result) ? json.result[0] : json?.result) || {};

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const json = await abRequest(creds, "/open-api/od/v1/orders/placeorder", { method: "POST", body: buildOrderBody(order, resolvedLotSize) });
  return { orderId: String(firstResult(json).brokerOrderId ?? ""), orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const body = buildModifyBody(orderId, changes);
  const json = await abRequest(creds, "/open-api/od/v1/orders/modify", { method: "POST", body });
  return { orderId: String(firstResult(json).brokerOrderId ?? body.brokerOrderId), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  const brokerOrderId = String(orderId ?? "").trim();
  if (!/^\d{1,30}$/.test(brokerOrderId)) throw bad("Invalid Alice Blue brokerOrderId");
  const json = await abRequest(creds, "/open-api/od/v1/orders/cancel", { method: "POST", body: { brokerOrderId } });
  // A cancel request being accepted is not proof of cancellation; panic flows re-read the book.
  return { orderId: String(firstResult(json).brokerOrderId ?? brokerOrderId), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "aliceblue" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "aliceblue" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "aliceblue" });

// ── books ──

export function mapOrderStatus(row) {
  const s = String(row?.orderStatus ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const filled = num(row?.filledQuantity);
  const pending = num(row?.pendingQuantity);
  if (s === "COMPLETE" || s === "COMPLETED" || s === "TRADED") return "COMPLETE";
  if (s === "REJECTED") return "REJECTED";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  if (s === "TRIGGER_PENDING") return "TRIGGER_PENDING";
  if (s === "EXPIRED") return "EXPIRED";
  if (s === "OPEN" || s === "PENDING" || s === "OPEN_PENDING" || s === "MODIFIED" || s === "AFTER_MARKET_ORDER_REQ_RECEIVED") {
    return filled > 0 && pending > 0 ? "PARTIALLY_FILLED" : "OPEN";
  }
  return "UNKNOWN";
}

/** "2025-05-26 14:27:43" (IST) -> ISO +05:30; null for empty values. */
export function abTimeToIso(s) {
  const raw = String(s ?? "").trim();
  if (!raw || raw === "--") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(raw);
  return m ? `${m[1]}T${m[2]}+05:30` : raw;
}

export function mapOrder(row) {
  const qty = num(row?.quantity);
  const filledQty = num(row?.filledQuantity);
  return {
    orderId: String(row?.brokerOrderId ?? ""),
    tradingSymbol: String(row?.tradingSymbol ?? row?.formattedInstrumentName ?? ""),
    exchange: contractExchange(row?.exchange),
    token: String(row?.instrumentId ?? ""),
    side: String(row?.transactionType).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty,
    filledQty,
    pendingQty: row?.pendingQuantity != null ? num(row.pendingQuantity) : Math.max(0, qty - filledQty),
    price: num(row?.price),
    triggerPrice: num(row?.slTriggerPrice),
    avgPrice: num(row?.averageTradedPrice),
    orderType: String(row?.orderType || "UNKNOWN"),
    product: contractProduct(row?.product),
    status: mapOrderStatus(row),
    statusMessage: row?.rejectionReason ? String(row.rejectionReason).trim() : null,
    placedAt: abTimeToIso(row?.orderTime || row?.exchangeTimestamp),
  };
}

export async function fetchOrderBook(creds) {
  const json = await abRequest(creds, "/open-api/od/v1/orders/book");
  return { status: "success", data: (Array.isArray(json.result) ? json.result : []).map(mapOrder) };
}

export function mapTrade(row) {
  return {
    tradeId: String(row?.exchangeTradeId ?? ""),
    orderId: String(row?.brokerOrderId ?? ""),
    tradingSymbol: String(row?.tradingSymbol ?? ""),
    exchange: contractExchange(row?.exchange),
    token: String(row?.instrumentId ?? ""),
    side: String(row?.transactionType).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: num(row?.filledQuantity),
    price: num(row?.tradedPrice),
    tradedAt: abTimeToIso(row?.fillTimestamp || row?.orderTime),
  };
}

export async function fetchTradeBook(creds) {
  const json = await abRequest(creds, "/open-api/od/v1/orders/trades");
  return { status: "success", data: (Array.isArray(json.result) ? json.result : []).map(mapTrade) };
}
