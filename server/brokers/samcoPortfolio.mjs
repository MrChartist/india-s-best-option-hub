/**
 * Samco Trade API v3.2 — read-only portfolio (official docs, checked 2026-10, https://docs-tradeapi.samco.in/):
 *  - GET /position/getPositions?positionType=NET -> positionDetails[] { tradingSymbol, exchange, productCode,
 *    netQuantity, averagePrice, lastTradedPrice, realizedGainAndLoss, unrealizedGainAndLoss, ... }.
 *    NET is used (the documented values are DAY and NET; NET is the net/carry-forward book).
 *  - GET /holding/getHoldings -> holdingDetails[] { tradingSymbol, exchange, isin, holdingsQuantity,
 *    averagePrice, lastTradedPrice, totalGainAndLoss }.
 *  - GET /limit/getLimits -> equityLimit / commodityLimit { grossAvailableMargin, netAvailableMargin, marginUsed,
 *    payInToday, notionalCash }. The equity segment (which includes F&O) is reported.
 *  - GET /order/orderBook -> orderBookDetails[] { orderNumber, exchange, tradingSymbol, symbol, transactionType,
 *    productCode, orderType (L/MKT/SL/SL-M), orderPrice, quantity, filledQuantity, unfilledQuantity|pendingQuantity,
 *    triggerPrice, averagePrice, orderStatus, rejectionReason, orderTime }.
 *  - GET /trade/tradeBook -> tradeBookDetails[] { orderNumber, tradeNumber, exchange, tradingSymbol,
 *    transactionType, quantity, tradePrice, tradeDate, tradeTime }.
 * Order status strings are not enumerated in the docs; the samples show "Complete" and the description lists
 * executed / pending / rejected. The mapping below is case-insensitive and falls back to UNKNOWN.
 */

import { samcoRequest } from "./samcoAuth.mjs";
import { num } from "./samcoMarket.mjs";

const EXCHANGES = { NSE: "NSE", BSE: "BSE", NFO: "NFO", BFO: "BFO", MCX: "MCX", MFO: "MCX", CDS: "CDS" };
const PRODUCTS = { CNC: "CNC", MIS: "INTRADAY", NRML: "MARGIN", MTF: "MTF", CO: "CO", BO: "BO" };

export const exchangeOf = (e) => EXCHANGES[String(e ?? "").toUpperCase()] ?? "NSE";
export const productOf = (p) => PRODUCTS[String(p ?? "").toUpperCase()] ?? "INTRADAY";
const numOrNull = (v) => (v === undefined || v === null || v === "" || v === "--" ? null : num(v));
const strOrNull = (v) => (v === undefined || v === null || v === "" || v === "--" || v === "NA" ? null : String(v));
const sideOf = (t) => (/^s/i.test(String(t ?? "")) ? "SELL" : "BUY");

/** Samco order status -> contract status. */
export function orderStatusOf(status) {
  const s = String(status ?? "").trim().toLowerCase();
  if (["complete", "completed", "executed", "filled", "traded"].includes(s)) return "COMPLETE";
  if (s === "rejected") return "REJECTED";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  if (s === "expired") return "EXPIRED";
  if (s === "trigger pending") return "TRIGGER_PENDING";
  if (s.includes("partial")) return "PARTIALLY_FILLED";
  if (["open", "pending", "ordered", "modified", "after market order req received", "put order req received", "validation pending"].includes(s)) return "OPEN";
  return "UNKNOWN";
}

const ORDER_TYPES = { L: "LIMIT", MKT: "MARKET", SL: "SL", "SL-M": "SL-M" };

export function mapPosition(p) {
  const realised = numOrNull(p.realizedGainAndLoss);
  const unrealised = numOrNull(p.unrealizedGainAndLoss);
  return {
    tradingSymbol: String(p.tradingSymbol ?? ""),
    exchange: exchangeOf(p.exchange),
    token: String(p.symbol || p.tradingSymbol || ""),
    product: productOf(p.productCode),
    netQty: num(p.netQuantity),
    avgPrice: num(p.averagePrice),
    ltp: numOrNull(p.lastTradedPrice),
    pnl: (realised ?? 0) + (unrealised ?? 0),
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

export function mapHolding(h) {
  return {
    tradingSymbol: String(h.tradingSymbol ?? ""),
    exchange: exchangeOf(h.exchange),
    token: String(h.symbol || h.isin || h.tradingSymbol || ""),
    isin: strOrNull(h.isin),
    qty: num(h.holdingsQuantity ?? h.calculatedNetQuantity),
    avgPrice: num(h.averagePrice),
    ltp: numOrNull(h.lastTradedPrice),
    pnl: numOrNull(h.totalGainAndLoss),
  };
}

export function mapFunds(json) {
  const e = json?.equityLimit || {};
  return {
    availableCash: num(e.netAvailableMargin),
    usedMargin: num(e.marginUsed),
    totalBalance: numOrNull(e.grossAvailableMargin),
    collateral: null,
    withdrawable: null,
  };
}

export function mapOrder(o) {
  const qty = num(o.quantity ?? o.totalQuanity);
  const filled = num(o.filledQuantity);
  const pending = o.unfilledQuantity ?? o.pendingQuantity;
  const status = orderStatusOf(o.orderStatus ?? o.status);
  return {
    orderId: String(o.orderNumber ?? ""),
    tradingSymbol: String(o.tradingSymbol ?? ""),
    exchange: exchangeOf(o.exchange),
    token: String(o.symbol || o.tradingSymbol || ""),
    side: sideOf(o.transactionType),
    qty,
    filledQty: filled,
    pendingQty: pending !== undefined ? num(pending) : Math.max(qty - filled, 0),
    price: num(o.orderPrice),
    triggerPrice: num(o.triggerPrice),
    avgPrice: num(o.averagePrice ?? o.fillPrice),
    orderType: ORDER_TYPES[String(o.orderType ?? "").toUpperCase()] ?? String(o.orderType || "UNKNOWN"),
    product: productOf(o.productCode),
    status: status === "OPEN" && filled > 0 && filled < qty ? "PARTIALLY_FILLED" : status,
    statusMessage: strOrNull(o.rejectionReason),
    placedAt: strOrNull(o.orderTime),
  };
}

export function mapTrade(t) {
  return {
    tradeId: String(t.tradeNumber ?? ""),
    orderId: String(t.orderNumber ?? ""),
    tradingSymbol: String(t.tradingSymbol ?? ""),
    exchange: exchangeOf(t.exchange),
    token: String(t.symbol || t.tradingSymbol || ""),
    side: sideOf(t.transactionType),
    qty: num(t.filledQuantity ?? t.quantity),
    price: num(t.tradePrice),
    tradedAt: t.tradeDate || t.tradeTime ? `${t.tradeDate ?? ""} ${t.tradeTime ?? ""}`.trim() : null,
  };
}

const list = (v) => (Array.isArray(v) ? v : []);

export async function fetchPositions(creds) {
  const json = await samcoRequest(creds, "/position/getPositions", { query: { positionType: "NET" }, emptyOk: true });
  return { status: "success", data: list(json?.positionDetails).map(mapPosition) };
}
export async function fetchHoldings(creds) {
  const json = await samcoRequest(creds, "/holding/getHoldings", { emptyOk: true });
  return { status: "success", data: list(json?.holdingDetails).map(mapHolding) };
}
export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds(await samcoRequest(creds, "/limit/getLimits")) };
}
export async function fetchOrderBook(creds) {
  const json = await samcoRequest(creds, "/order/orderBook", { emptyOk: true });
  return { status: "success", data: list(json?.orderBookDetails).map(mapOrder) };
}
export async function fetchTradeBook(creds) {
  const json = await samcoRequest(creds, "/trade/tradeBook", { emptyOk: true });
  return { status: "success", data: list(json?.tradeBookDetails).map(mapTrade) };
}
