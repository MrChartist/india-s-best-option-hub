/**
 * Arrow orders (real money, gated), order book / trade book and portfolio reads (read-only).
 *
 * Official docs (checked 2026-10): https://docs.arrow.trade/rest-api/orders/ , /rest-api/positions/ ,
 * /rest-api/holdings/ , /rest-api/funds/ .
 *  - POST /order/regular { exchange, symbol, quantity, disclosedQty, product: I|C|M, transactionType: B|S,
 *    order: LMT|MKT|SL-LMT|SL-MKT, price, validity: DAY|IOC, triggerPrice, remarks } -> data { orderNo, requestTime }.
 *    All values are strings, prices in rupees. Plain MKT is disabled on the API by regulation (`mpp: true`
 *    turns it into a protected limit order); this module only builds LMT and SL-LMT orders with DAY validity.
 *  - PATCH /order/regular/{orderNo} with the same full body; DELETE /order/regular/{orderNo}.
 *  - GET /user/orders, /user/trades, /user/positions, /user/holdings, /user/limits. Portfolio values are rupee
 *    strings (unlike market data, which is in paise).
 *  - Order statuses: PENDING, OPEN, COMPLETE, CANCELLED, REJECTED (plus TRIGGER_PENDING for stop orders).
 * Every real-money call is wrapped with withOrderGate(); no route mints Arrow gates today.
 */

import { BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { arrowFetch } from "./arrowAuth.mjs";
import { fromArrowExchange, toArrowExchange, isDerivativeExchange } from "./arrowInstruments.mjs";

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(parseFloat(v)) ? null : parseFloat(v));
const bad = (m) => new BrokerInputError(m);

const PRODUCT_CODE = { INTRADAY: "I", CNC: "C", MARGIN: "M" };
const PRODUCT_NAME = { I: "INTRADAY", C: "CNC", M: "MARGIN" };
const ORDER_TYPE_CODE = { LIMIT: "LMT", STOPLOSS_LIMIT: "SL-LMT" };
const ORDER_EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX"]);
const ORDER_ID_RE = /^[A-Za-z0-9]{1,30}$/;

/** Legacy order-feature descriptor. */
export const ORDER_FEATURES = {
  bracket: false,
  cover: false, // CO/BO products are listed in /user/details but not documented for the REST order API.
  ioc: false, // documented; not offered here so every order rests with DAY validity.
  mtf: false,
  nativeMarketProtection: true, // `mpp: true` (market protection) exists but this module does not send market orders.
  maxLegQty: null,
  products: ["CNC", "INTRADAY", "MARGIN"],
};

function checkCommon({ tradingSymbol, exchange, side, orderType, product }) {
  if (typeof tradingSymbol !== "string" || !/^[A-Z0-9&_.-]{1,40}$/.test(tradingSymbol)) throw bad(`Invalid Arrow trading symbol: ${tradingSymbol}`);
  if (!ORDER_EXCHANGES.has(exchange)) throw bad(`Invalid exchange: ${exchange}`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (orderType === "MARKET" || orderType === "STOPLOSS_MARKET") {
    throw bad("Arrow disables plain market orders on the API (SEBI rule). Use a limit order.");
  }
  if (!ORDER_TYPE_CODE[orderType]) throw bad(`Unsupported Arrow order type: ${orderType} (LIMIT or STOPLOSS_LIMIT)`);
  if (!PRODUCT_CODE[product]) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  if (product === "CNC" && isDerivativeExchange(exchange)) throw bad("CNC (delivery) is for cash equity only; use MARGIN or INTRADAY for F&O");
}

function priceFields({ orderType, price, triggerPrice }) {
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required for a limit order");
  const stop = orderType === "STOPLOSS_LIMIT";
  if (stop && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for STOPLOSS_LIMIT");
  return { price: String(price), triggerPrice: stop ? String(triggerPrice) : "0" };
}

/**
 * Pure body builder. `resolvedLotSize` comes from the instrument master, never from the client.
 * order: { tradingSymbol, exchange, side, orderType: LIMIT|STOPLOSS_LIMIT, product: CNC|INTRADAY|MARGIN, lots, price, triggerPrice? }
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { tradingSymbol, exchange, side, orderType = "LIMIT", product = "INTRADAY", lots, price, triggerPrice } = order || {};
  checkCommon({ tradingSymbol, exchange, side, orderType, product });
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  }
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  return {
    exchange: toArrowExchange(exchange),
    symbol: tradingSymbol,
    quantity: String(Math.round(lots * resolvedLotSize)),
    disclosedQty: "0",
    product: PRODUCT_CODE[product],
    transactionType: side === "BUY" ? "B" : "S",
    order: ORDER_TYPE_CODE[orderType],
    ...priceFields({ orderType, price, triggerPrice }),
    validity: "DAY",
  };
}

/** Pure modify body (Arrow wants the full order again). changes: { tradingSymbol, exchange, side, orderType, product, price, qty (units), triggerPrice? } */
export function buildModifyBody(orderId, changes) {
  if (!ORDER_ID_RE.test(String(orderId ?? ""))) throw bad("Invalid Arrow order id");
  const { tradingSymbol, exchange, side, orderType = "LIMIT", product = "INTRADAY", price, qty, triggerPrice } = changes || {};
  checkCommon({ tradingSymbol, exchange, side, orderType, product });
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  return {
    exchange: toArrowExchange(exchange),
    symbol: tradingSymbol,
    quantity: String(qty),
    disclosedQty: "0",
    product: PRODUCT_CODE[product],
    transactionType: side === "BUY" ? "B" : "S",
    order: ORDER_TYPE_CODE[orderType],
    ...priceFields({ orderType, price, triggerPrice }),
    validity: "DAY",
  };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const json = await arrowFetch(creds, "/order/regular", { method: "POST", body: buildOrderBody(order, resolvedLotSize), what: "place order" });
  const orderId = String(json?.data?.orderNo ?? "");
  if (!orderId) throw new BrokerInputError(`Arrow accepted the request but returned no order number. ${ORDER_BOOK_HINT}`);
  // Placement returns only the order number; the state is unknown until the order book is read.
  return { orderId, orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const body = buildModifyBody(orderId, changes);
  const json = await arrowFetch(creds, `/order/regular/${encodeURIComponent(String(orderId))}`, { method: "PATCH", body, what: "modify order" });
  return { orderId: String(json?.data?.orderNo ?? orderId), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  if (!ORDER_ID_RE.test(String(orderId ?? ""))) throw bad("Invalid Arrow order id");
  await arrowFetch(creds, `/order/regular/${encodeURIComponent(String(orderId))}`, { method: "DELETE", what: "cancel order" });
  // "order cancellation request accepted" is an acknowledgement, not a final state.
  return { orderId: String(orderId), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "arrow" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "arrow" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "arrow" });

// ── reads ──

/** Arrow order row -> contract OrderStatus. */
export function mapOrderStatus(row) {
  const s = String(row?.orderStatus || "").toUpperCase().replace(/\s+/g, "_");
  const filled = num(row?.cumulativeFillQty);
  switch (s) {
    case "COMPLETE": return "COMPLETE";
    case "CANCELLED": case "CANCELED": return "CANCELLED";
    case "REJECTED": return "REJECTED";
    case "TRIGGER_PENDING": return "TRIGGER_PENDING";
    case "OPEN": case "PENDING": case "MODIFIED": return filled > 0 ? "PARTIALLY_FILLED" : "OPEN";
    default: return "UNKNOWN";
  }
}

const ORDER_TYPE_NAME = { LMT: "LIMIT", MKT: "MARKET", "SL-LMT": "STOPLOSS_LIMIT", "SL-MKT": "STOPLOSS_MARKET" };
const product = (p) => PRODUCT_NAME[String(p || "").toUpperCase()] || "MARGIN";
const side = (t) => (String(t || "").toUpperCase().startsWith("S") ? "SELL" : "BUY");

export function toOrder(o) {
  const qty = num(o.quantity);
  const filledQty = num(o.cumulativeFillQty);
  return {
    orderId: String(o.id ?? o.orderNo ?? ""),
    tradingSymbol: String(o.symbol || ""),
    exchange: fromArrowExchange(o.exchange),
    token: String(o.token ?? ""),
    side: side(o.transactionType),
    qty,
    filledQty,
    pendingQty: o.leavesQuantity !== undefined && o.leavesQuantity !== "" ? num(o.leavesQuantity) : Math.max(0, qty - filledQty - num(o.cancelQuantity)),
    price: num(o.price),
    triggerPrice: num(o.triggerPrice),
    avgPrice: num(o.averagePrice),
    orderType: ORDER_TYPE_NAME[String(o.order || "").toUpperCase()] || String(o.order || "UNKNOWN"),
    product: product(o.product),
    status: mapOrderStatus(o),
    statusMessage: o.rejectReason ? String(o.rejectReason) : null,
    placedAt: o.orderTime ? String(o.orderTime) : null,
  };
}

export async function fetchOrderBook(creds) {
  const json = await arrowFetch(creds, "/user/orders", { what: "order book" });
  return { status: "success", data: (Array.isArray(json?.data) ? json.data : []).map(toOrder).filter((o) => o.orderId && o.token) };
}

export async function fetchTradeBook(creds) {
  const json = await arrowFetch(creds, "/user/trades", { what: "trade book" });
  const data = (Array.isArray(json?.data) ? json.data : []).map((t) => {
    const secs = Number(t.fillTime);
    return {
      tradeId: String(t.fillID ?? ""),
      orderId: String(t.id ?? ""),
      tradingSymbol: String(t.symbol || ""),
      exchange: fromArrowExchange(t.exchange),
      token: String(t.token ?? ""),
      side: side(t.transactionType),
      qty: num(t.fillQuantity ?? t.fillShares),
      price: num(t.fillPrice ?? t.averagePrice),
      tradedAt: Number.isFinite(secs) && secs > 1e9 ? new Date(secs * 1000).toISOString() : t.exchangeUpdateTime ? String(t.exchangeUpdateTime) : null,
    };
  });
  return { status: "success", data: data.filter((t) => t.tradeId && t.orderId && t.token) };
}

export async function fetchPositions(creds) {
  const json = await arrowFetch(creds, "/user/positions", { what: "positions" });
  const data = (Array.isArray(json?.data) ? json.data : []).map((p) => {
    const netQty = num(p.qty);
    const ltp = numOrNull(p.ltp);
    const buyAmt = num(p.dayBuyAmount) + num(p.carryForwardBuyAmount);
    const sellAmt = num(p.daySellAmount) + num(p.carryForwardSellAmount);
    // Arrow leaves realisedPnL / unrealisedMarkToMarket empty in its samples, so P&L is derived:
    // sold value - bought value + open quantity at LTP.
    const pnl = sellAmt - buyAmt + netQty * (ltp ?? 0);
    return {
      tradingSymbol: String(p.symbol || ""),
      exchange: fromArrowExchange(p.exchange),
      token: String(p.token ?? ""),
      product: product(p.product),
      netQty,
      avgPrice: num(p.avgPrice),
      ltp,
      pnl: Math.round(pnl * 100) / 100,
      realisedPnl: numOrNull(p.realisedPnL),
      unrealisedPnl: numOrNull(p.unrealisedMarkToMarket),
    };
  });
  return { status: "success", data: data.filter((p) => p.token) };
}

export async function fetchHoldings(creds) {
  const json = await arrowFetch(creds, "/user/holdings", { what: "holdings" });
  const data = [];
  for (const h of Array.isArray(json?.data) ? json.data : []) {
    const syms = Array.isArray(h.symbols) ? h.symbols : [];
    const s = syms.find((x) => x.exchange === "NSE") || syms[0];
    if (!s?.token) continue;
    data.push({
      tradingSymbol: String(s.tradingSymbol || s.symbol || ""),
      exchange: fromArrowExchange(s.exchange),
      token: String(s.token),
      isin: s.isin ? String(s.isin) : null,
      qty: num(h.qty),
      avgPrice: num(h.avgPrice),
      ltp: numOrNull(h.ltp),
      pnl: numOrNull(h.pnl),
    });
  }
  return { status: "success", data };
}

export async function fetchFunds(creds) {
  const json = await arrowFetch(creds, "/user/limits", { what: "funds" });
  const margin = json?.data?.margin || {};
  const allocations = Array.isArray(json?.data?.allocations) ? json.data.allocations : [];
  const allocated = num(margin.allocated);
  const utilized = num(margin.utilized); // negative when option-selling premium was credited (docs sample)
  return {
    status: "success",
    data: {
      availableCash: Math.round((allocated - utilized) * 100) / 100,
      usedMargin: utilized,
      totalBalance: allocated,
      collateral: allocations.reduce((s, a) => s + num(a.nonCashCurrent), 0),
      withdrawable: null,
    },
  };
}
