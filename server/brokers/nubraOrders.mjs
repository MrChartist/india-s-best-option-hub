/**
 * Nubra Trading API V3 orders (real money, gated), order book and portfolio reads.
 *
 * Official docs (checked 2026-10), https://nubra.io/products/api/docs/rest-api-v3/ :
 *  - trading/orders/place-order.html: POST /sentinel/orders/create { orders: [{ refId, qty, side: BUY|SELL,
 *    deliveryType: IDAY|CNC, priceType: LIMIT|MARKET, validityType: DAY|IOC|GTE, isMultiLeg: false,
 *    executionMode: ENTRY, entryPrice (paise, LIMIT only), stratTags? }] } -> 201 { orders: [{ intentOrderId, status, ... }] }
 *  - trading/orders/modify-order.html: POST /sentinel/orders/modify { orders: [{ orderId, qty, deliveryType, priceType,
 *    entryPrice, validityType, executionMode }] } -> acknowledgement only.
 *  - trading/orders/cancel-order.html: POST /sentinel/orders/cancel { orders: [{ orderId }] } -> acknowledgement only.
 *  - trading/orders/get-order.html: GET /sentinel/orders -> { orders: { open: [], executed: [], cancelled: [],
 *    rejected: [], expired: [], gtt: [] } } (bucketed by lifecycle state; prices in paise).
 *  - trading/portfolio/{positions,holdings,funds}.html: GET /sentinel/portfolio/positions | holdings |
 *    user_funds_and_margin (paise).
 *  - No trade-book (fills) endpoint is documented for V3, so `tradeBook` is not declared.
 * deliveryType has only IDAY and CNC: CNC is Nubra's carry-forward bucket for F&O as well as equity delivery,
 * so this app's MARGIN maps to CNC on derivatives. Only LIMIT DAY orders are built.
 * Every real-money call is wrapped with withOrderGate(); no route mints Nubra gates today.
 */

import { BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { nubraFetch } from "./nubraAuth.mjs";
import { contractExchange, isDerivativeRow } from "./nubraInstruments.mjs";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const paise = (v) => num(v) / 100;
const paiseOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v) / 100);
const bad = (m) => new BrokerInputError(m);
const ORDER_ID_RE = /^\d{1,20}$/;
const FNO = new Set(["NFO", "BFO"]);

export const ORDER_FEATURES = {
  bracket: false, // exitConfig stop-loss/target exists in V3 but is not built here.
  cover: false,
  ioc: false, // MARKET orders must be IOC; this module sends LIMIT DAY only.
  mtf: false,
  nativeMarketProtection: false,
  maxLegQty: null,
  products: ["CNC", "INTRADAY", "MARGIN"],
};

function deliveryType(product, exchange) {
  if (product === "INTRADAY") return "IDAY";
  if (product === "CNC" && FNO.has(exchange)) throw bad("CNC (delivery) is for cash equity; use MARGIN or INTRADAY for F&O");
  if (product === "MARGIN" && !FNO.has(exchange)) throw bad("MARGIN is for F&O; use CNC or INTRADAY for equity");
  if (product === "CNC" || product === "MARGIN") return "CNC";
  throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
}

function limitPrice(orderType, price) {
  if (orderType === "MARKET" || orderType === "STOPLOSS_MARKET") throw bad("Market orders are not sent from this app. Use a limit order.");
  if (orderType !== "LIMIT") throw bad(`Unsupported Nubra order type: ${orderType} (LIMIT only)`);
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required for a limit order");
  return Math.round(price * 100);
}

/**
 * Pure body builder. `resolvedLotSize` comes from the instrument master, never from the client.
 * order: { token (Nubra ref_id), exchange, side, orderType: LIMIT, product: CNC|INTRADAY|MARGIN, lots, price }
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { token, exchange, side, orderType = "LIMIT", product = "INTRADAY", lots, price } = order || {};
  if (!/^\d{1,12}$/.test(String(token ?? ""))) throw bad("Invalid Nubra instrument ref_id (token)");
  if (!["NSE", "BSE", "NFO", "BFO"].includes(exchange)) throw bad(`Invalid exchange: ${exchange}`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const entryPrice = limitPrice(orderType, price);
  const delivery = deliveryType(product, exchange);
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  return {
    orders: [{
      refId: Number(token), qty: Math.round(lots * resolvedLotSize), side, deliveryType: delivery, priceType: "LIMIT",
      validityType: "DAY", isMultiLeg: false, executionMode: "ENTRY", entryPrice,
    }],
  };
}

/** Pure modify body. changes: { exchange, orderType: LIMIT, product, price, qty (units) } */
export function buildModifyBody(orderId, changes) {
  if (!ORDER_ID_RE.test(String(orderId ?? ""))) throw bad("Invalid Nubra order id (intentOrderId)");
  const { exchange = "NFO", orderType = "LIMIT", product = "INTRADAY", price, qty } = changes || {};
  const entryPrice = limitPrice(orderType, price);
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  return { orders: [{ orderId: Number(orderId), qty, deliveryType: deliveryType(product, exchange), priceType: "LIMIT", entryPrice, validityType: "DAY", executionMode: "ENTRY" }] };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const json = await nubraFetch(creds, "/sentinel/orders/create", { method: "POST", body: buildOrderBody(order, resolvedLotSize), what: "place order" });
  const o = Array.isArray(json?.orders) ? json.orders[0] : null;
  const orderId = o?.intentOrderId !== undefined ? String(o.intentOrderId) : "";
  if (!orderId) throw new BrokerInputError(`Nubra accepted the request but returned no order id. ${ORDER_BOOK_HINT}`);
  return { orderId, orderStatus: mapStatus(String(o.status || "").toLowerCase(), o) };
}

async function modifyOrderImpl(creds, orderId, changes) {
  await nubraFetch(creds, "/sentinel/orders/modify", { method: "POST", body: buildModifyBody(orderId, changes), what: "modify order" });
  return { orderId: String(orderId), orderStatus: "UNKNOWN" }; // acknowledgement only (docs)
}

async function cancelOrderImpl(creds, orderId) {
  if (!ORDER_ID_RE.test(String(orderId ?? ""))) throw bad("Invalid Nubra order id (intentOrderId)");
  await nubraFetch(creds, "/sentinel/orders/cancel", { method: "POST", body: { orders: [{ orderId: Number(orderId) }] }, what: "cancel order" });
  return { orderId: String(orderId), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "nubra" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "nubra" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "nubra" });

// ── reads ──

/** Bucket (or order.status) -> contract OrderStatus. */
export function mapStatus(bucket, o = {}) {
  const b = String(bucket || o.status || "").toLowerCase();
  const filled = num(o.filledQty);
  const qty = num(o.orderQty);
  switch (b) {
    case "open": return filled > 0 && filled < qty ? "PARTIALLY_FILLED" : "OPEN";
    case "executed": return "COMPLETE";
    case "cancelled": case "canceled": return "CANCELLED";
    case "rejected": return "REJECTED";
    case "expired": return "EXPIRED";
    case "gtt": case "gte": return "TRIGGER_PENDING";
    default: return "UNKNOWN";
  }
}

function productOf(delivery, derivative) {
  const d = String(delivery || "").toUpperCase();
  if (d === "IDAY") return "INTRADAY";
  return derivative ? "MARGIN" : "CNC";
}

export function toOrder(o, bucket) {
  const ref = o.refData || {};
  const derivative = isDerivativeRow(ref);
  const qty = num(o.orderQty);
  const filledQty = num(o.filledQty);
  return {
    orderId: String(o.intentOrderId ?? ""),
    tradingSymbol: String(ref.stockName || ref.displayName || ""),
    exchange: contractExchange(ref.exchange || o.exchange, derivative),
    token: o.refId !== undefined && o.refId !== null ? String(o.refId) : "",
    side: String(o.side || "").toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty,
    filledQty,
    pendingQty: bucket === "open" ? Math.max(0, qty - filledQty) : 0,
    price: paise(o.orderPrice),
    triggerPrice: 0,
    avgPrice: paise(o.filledPrice ?? o.avgFilledPrice),
    orderType: String(o.priceType || "UNKNOWN").toUpperCase(),
    product: productOf(o.deliveryType, derivative),
    status: mapStatus(bucket, o),
    statusMessage: o.rejectReason ? String(o.rejectReason) : o.message ? String(o.message) : null,
    placedAt: o.timestamps?.intentCreatedAt ? String(o.timestamps.intentCreatedAt) : null,
  };
}

export async function fetchOrderBook(creds) {
  const json = await nubraFetch(creds, "/sentinel/orders", { what: "order book" });
  const buckets = json?.orders && typeof json.orders === "object" ? json.orders : {};
  const data = [];
  for (const [bucket, rows] of Object.entries(buckets)) {
    for (const o of Array.isArray(rows) ? rows : []) {
      // Strategy (multi-leg) orders have no single refId; they are outside this app's single-leg order model.
      if (o?.isMulti) continue;
      const row = toOrder(o, bucket);
      if (row.orderId && row.token) data.push(row);
    }
  }
  return { status: "success", data };
}

export async function fetchPositions(creds) {
  const json = await nubraFetch(creds, "/sentinel/portfolio/positions", { what: "positions" });
  const data = (Array.isArray(json?.portfolio?.positions) ? json.portfolio.positions : []).map((p) => {
    const derivative = isDerivativeRow(p) || /^(OPT|FUT)/i.test(String(p.assetType || ""));
    return {
      tradingSymbol: String(p.symbol || ""),
      exchange: contractExchange(p.exchange, derivative),
      token: p.refId !== undefined ? String(p.refId) : "",
      product: productOf(p.deliveryType, derivative),
      netQty: num(p.netQuantity),
      avgPrice: paise(p.avgPrice),
      ltp: paiseOrNull(p.lastTradedPrice),
      pnl: paise(p.pnl),
      realisedPnl: null,
      unrealisedPnl: null,
    };
  });
  return { status: "success", data: data.filter((p) => p.token) };
}

export async function fetchHoldings(creds) {
  const json = await nubraFetch(creds, "/sentinel/portfolio/holdings", { what: "holdings" });
  const data = (Array.isArray(json?.portfolio?.holdings) ? json.portfolio.holdings : []).map((h) => ({
    tradingSymbol: String(h.symbol || ""),
    exchange: contractExchange(h.exchange, false),
    token: h.refId !== undefined ? String(h.refId) : "",
    isin: h.isin ? String(h.isin) : null,
    qty: num(h.quantity),
    avgPrice: paise(h.avgPrice),
    ltp: paiseOrNull(h.lastTradedPrice),
    pnl: paiseOrNull(h.netPnl),
  }));
  return { status: "success", data: data.filter((h) => h.token) };
}

export async function fetchFunds(creds) {
  const json = await nubraFetch(creds, "/sentinel/portfolio/user_funds_and_margin", { what: "funds" });
  const f = json?.portFundsAndMargin || {};
  return {
    status: "success",
    data: {
      availableCash: paise(f.netMarginAvailable),
      usedMargin: paise(f.totalMarginBlocked),
      totalBalance: paiseOrNull(f.startOfDayFunds),
      collateral: paiseOrNull(f.totalCollateral),
      withdrawable: paiseOrNull(f.netWithdrawalAmount),
    },
  };
}
