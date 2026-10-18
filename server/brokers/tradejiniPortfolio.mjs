/**
 * Tradejini — read-only portfolio (official docs, checked 2026-10, https://developer.tradejini.com/docs/):
 *  - GET /api/oms/positions?symDetails=true -> d[] { symId, product, netQty, netAvgPrice, realizedPnl, buyQty, sellQty,
 *    sym { exchange, tradSymbol, ... } }. No LTP comes back (the docs say to take it from the stream), so ltp and
 *    unrealised P&L are null and pnl is the realised figure.
 *  - GET /api/oms/holdings?symDetails=true -> d.holdings[] { symId, qty, avgPrice, realizedPnl, sym }.
 *  - GET /api/oms/limits -> d { availMargin, availCash, marginUsed, totalCredits, stockCollateral, payOut, ... }.
 *  - GET /api/oms/orders?symDetails=true -> d[] { orderId, symId, status open|completed|rejected|cancelled, qty, fillQty,
 *    pendingQty, side buy|sell, type limit|market|stoplimit|stopmarket, product delivery|intraday|normal|cover|bracket,
 *    limitPrice, trigPrice, avgPrice, reason, orderTime 'dd-MM-yyyy HH:mm:ss' }.
 *  - GET /api/oms/trades?symDetails=true -> d[] { orderId, fillId, fillQty, fillPrice, side, time, symId, sym }.
 * Token for these rows is the symId (the same value Instrument.token carries).
 */

import { tjRequest } from "./tradejiniAuth.mjs";

const PRODUCTS = { delivery: "CNC", intraday: "INTRADAY", normal: "MARGIN", cover: "CO", bracket: "BO" };
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
const TYPES = { limit: "LIMIT", market: "MARKET", stoplimit: "SL", stopmarket: "SL-M" };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : num(v));
export const productOf = (p) => PRODUCTS[String(p ?? "").toLowerCase()] ?? "INTRADAY";
const sideOf = (s) => (String(s ?? "").toLowerCase() === "sell" ? "SELL" : "BUY");

/** Exchange from sym.exchange or the symId (EQT_X_EQ_NSE -> NSE; OPTIDX_NIFTY_NFO_... -> NFO). */
export function exchangeOf(row) {
  const e = String(row?.sym?.exchange ?? "").toUpperCase();
  if (EXCHANGES.has(e)) return e;
  const parts = String(row?.symId ?? "").split("_");
  const hit = parts.find((p) => EXCHANGES.has(p));
  return hit ?? "NSE";
}

const symbolOf = (row) => String(row?.sym?.tradSymbol || row?.sym?.dispSymbol || row?.symId || "");

/** Tradejini order status -> contract status. */
export function orderStatusOf(o) {
  const s = String(o?.status ?? "").toLowerCase();
  if (s === "completed") return "COMPLETE";
  if (s === "rejected") return "REJECTED";
  if (s === "cancelled") return "CANCELLED";
  if (s === "open") {
    if (num(o.fillQty) > 0) return "PARTIALLY_FILLED";
    return o.type === "stoplimit" || o.type === "stopmarket" ? "TRIGGER_PENDING" : "OPEN";
  }
  return "UNKNOWN";
}

export function mapPosition(p) {
  const realised = numOrNull(p.realizedPnl);
  return {
    tradingSymbol: symbolOf(p),
    exchange: exchangeOf(p),
    token: String(p.symId ?? ""),
    product: productOf(p.product),
    netQty: num(p.netQty),
    avgPrice: num(p.netAvgPrice),
    ltp: null,
    pnl: realised ?? 0,
    realisedPnl: realised,
    unrealisedPnl: null,
  };
}

export function mapHolding(h) {
  return {
    tradingSymbol: symbolOf(h),
    exchange: exchangeOf(h),
    token: String(h.symId ?? ""),
    isin: null,
    qty: num(h.qty),
    avgPrice: num(h.avgPrice),
    ltp: null,
    pnl: numOrNull(h.realizedPnl),
  };
}

export function mapFunds(d) {
  return {
    availableCash: num(d?.availMargin),
    usedMargin: num(d?.marginUsed),
    totalBalance: numOrNull(d?.totalCredits),
    collateral: numOrNull(d?.stockCollateral),
    withdrawable: numOrNull(d?.availCash),
  };
}

export function mapOrder(o) {
  const qty = num(o.qty);
  const filled = num(o.fillQty);
  return {
    orderId: String(o.orderId ?? ""),
    tradingSymbol: symbolOf(o),
    exchange: exchangeOf(o),
    token: String(o.symId ?? ""),
    side: sideOf(o.side),
    qty,
    filledQty: filled,
    pendingQty: o.pendingQty !== undefined ? num(o.pendingQty) : Math.max(qty - filled, 0),
    price: num(o.limitPrice),
    triggerPrice: num(o.trigPrice),
    avgPrice: num(o.avgPrice),
    orderType: TYPES[String(o.type ?? "").toLowerCase()] ?? String(o.type || "UNKNOWN"),
    product: productOf(o.product),
    status: orderStatusOf(o),
    statusMessage: o.reason ? String(o.reason) : null,
    placedAt: o.orderTime ? String(o.orderTime) : null,
  };
}

export function mapTrade(t) {
  return {
    tradeId: String(t.fillId ?? ""),
    orderId: String(t.orderId ?? ""),
    tradingSymbol: symbolOf(t),
    exchange: exchangeOf(t),
    token: String(t.symId ?? ""),
    side: sideOf(t.side),
    qty: num(t.fillQty),
    price: num(t.fillPrice),
    tradedAt: t.time ? String(t.time) : null,
  };
}

const list = (v) => (Array.isArray(v) ? v : []);
const SYM = { symDetails: "true" };

export async function fetchPositions(creds) {
  return { status: "success", data: list(await tjRequest(creds, "/api/oms/positions", { query: SYM })).map(mapPosition) };
}
export async function fetchHoldings(creds) {
  const d = await tjRequest(creds, "/api/oms/holdings", { query: SYM });
  return { status: "success", data: list(d?.holdings).map(mapHolding) };
}
export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds(await tjRequest(creds, "/api/oms/limits")) };
}
export async function fetchOrderBook(creds) {
  return { status: "success", data: list(await tjRequest(creds, "/api/oms/orders", { query: SYM })).map(mapOrder) };
}
export async function fetchTradeBook(creds) {
  return { status: "success", data: list(await tjRequest(creds, "/api/oms/trades", { query: SYM })).map(mapTrade) };
}
