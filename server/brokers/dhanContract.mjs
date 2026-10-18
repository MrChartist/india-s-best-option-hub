/**
 * Dhan v2 on the canonical adapter contract (server/brokers/contract.mjs): portfolio reads normalised
 * to the contract's Position/Holding/Funds/Order/Trade shapes, gated order calls and an error
 * normaliser. Re-exported from dhan.mjs, which is the reference adapter for every other broker.
 *
 * Field names verified against Dhan's official docs (dhanhq.co/docs/v2/portfolio/, /funds/, /orders/).
 * Note Dhan's own spelling `availabelBalance` in /fundlimit; `availableBalance` is accepted too in case
 * it is ever corrected. Dhan's /positions and /holdings carry no LTP, so `ltp` is null there.
 *
 * The existing 1Cliq routes in proxy-server.mjs keep calling server/lib/dhanOrders.mjs and
 * dhanPortfolio.mjs directly (behind validateOrder + live arming). The gated wrappers here are the
 * contract surface only; nothing in the proxy calls them yet.
 */

import * as dhanOrders from "../lib/dhanOrders.mjs";
import * as dhanPortfolio from "../lib/dhanPortfolio.mjs";
import { BrokerError, normaliseError as baseNormalise, withOrderGate } from "./contract.mjs";

const EXCHANGE_OF_SEGMENT = {
  NSE_EQ: "NSE", NSE_FNO: "NFO", BSE_EQ: "BSE", BSE_FNO: "BFO", MCX_COMM: "MCX", NSE_CURRENCY: "CDS", BSE_CURRENCY: "CDS", IDX_I: "NSE",
};
// Annexure "Order Status": TRANSIT, PENDING, CLOSED, TRIGGERED, REJECTED, CANCELLED, PART_TRADED, TRADED
// (+ EXPIRED in the order book). CLOSED is used when a super/forever order has fully run its course;
// TRIGGERED means a stop order's trigger hit and the child is now working.
const STATUS_OF = {
  TRANSIT: "OPEN", PENDING: "OPEN", TRIGGERED: "OPEN", PART_TRADED: "PARTIALLY_FILLED", TRADED: "COMPLETE",
  CLOSED: "COMPLETE", CANCELLED: "CANCELLED", REJECTED: "REJECTED", EXPIRED: "EXPIRED",
};
const PRODUCTS = new Set(["CNC", "INTRADAY", "MARGIN", "MTF", "CO", "BO"]);

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const exchangeOf = (seg) => EXCHANGE_OF_SEGMENT[seg] ?? "NSE";
const productOf = (p) => (PRODUCTS.has(p) ? p : "INTRADAY");
export const dhanOrderStatus = (s) => STATUS_OF[s] ?? "UNKNOWN";
const list = (raw) => (Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : []);

export function mapDhanPosition(p) {
  const netQty = n(p.netQty);
  const realised = n(p.realizedProfit);
  const unrealised = n(p.unrealizedProfit);
  return {
    tradingSymbol: String(p.tradingSymbol ?? ""),
    exchange: exchangeOf(p.exchangeSegment),
    token: String(p.securityId ?? ""),
    product: productOf(p.productType),
    netQty,
    avgPrice: netQty > 0 ? n(p.buyAvg) : netQty < 0 ? n(p.sellAvg) : n(p.costPrice),
    ltp: null,
    pnl: realised + unrealised,
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

export function mapDhanHolding(h) {
  return {
    tradingSymbol: String(h.tradingSymbol ?? ""),
    exchange: h.exchange === "BSE" ? "BSE" : "NSE",
    token: String(h.securityId ?? ""),
    isin: h.isin ? String(h.isin) : null,
    qty: n(h.totalQty),
    avgPrice: n(h.avgCostPrice),
    ltp: null,
    pnl: null,
  };
}

export function mapDhanFunds(f) {
  return {
    availableCash: n(f?.availabelBalance ?? f?.availableBalance),
    usedMargin: n(f?.utilizedAmount),
    totalBalance: f?.sodLimit != null ? n(f.sodLimit) : null,
    collateral: f?.collateralAmount != null ? n(f.collateralAmount) : null,
    withdrawable: f?.withdrawableBalance != null ? n(f.withdrawableBalance) : null,
  };
}

export function mapDhanOrder(o) {
  const qty = n(o.quantity);
  const filled = n(o.filledQty);
  const status = dhanOrderStatus(o.orderStatus);
  const isTrigger = (o.orderType === "STOP_LOSS" || o.orderType === "STOP_LOSS_MARKET") && status === "OPEN";
  return {
    orderId: String(o.orderId ?? ""),
    tradingSymbol: String(o.tradingSymbol ?? ""),
    exchange: exchangeOf(o.exchangeSegment),
    token: String(o.securityId ?? ""),
    side: o.transactionType === "SELL" ? "SELL" : "BUY",
    qty,
    filledQty: filled,
    pendingQty: o.remainingQuantity != null ? n(o.remainingQuantity) : Math.max(qty - filled, 0),
    price: n(o.price),
    triggerPrice: n(o.triggerPrice),
    avgPrice: n(o.averageTradedPrice),
    orderType: String(o.orderType ?? "UNKNOWN"),
    product: productOf(o.productType),
    status: isTrigger ? "TRIGGER_PENDING" : status,
    statusMessage: o.omsErrorDescription ? String(o.omsErrorDescription) : null,
    placedAt: o.createTime ? String(o.createTime) : null,
  };
}

export function mapDhanTrade(t) {
  return {
    tradeId: String(t.exchangeTradeId ?? ""),
    orderId: String(t.orderId ?? ""),
    tradingSymbol: String(t.tradingSymbol ?? ""),
    exchange: exchangeOf(t.exchangeSegment),
    token: String(t.securityId ?? ""),
    side: t.transactionType === "SELL" ? "SELL" : "BUY",
    qty: n(t.tradedQuantity),
    price: n(t.tradedPrice),
    tradedAt: t.exchangeTime ? String(t.exchangeTime) : t.createTime ? String(t.createTime) : null,
  };
}

const ack = (raw) => ({ orderId: String(raw?.orderId ?? ""), orderStatus: dhanOrderStatus(raw?.orderStatus) });

export async function fetchPositions(creds) {
  return { status: "success", data: list(await dhanPortfolio.getPositions(creds)).map(mapDhanPosition) };
}
export async function fetchHoldings(creds) {
  return { status: "success", data: list(await dhanPortfolio.getHoldings(creds)).map(mapDhanHolding) };
}
export async function fetchFunds(creds) {
  return { status: "success", data: mapDhanFunds(await dhanPortfolio.getFunds(creds)) };
}
export async function fetchOrderBook(creds) {
  return { status: "success", data: list(await dhanOrders.getOrders(creds)).map(mapDhanOrder) };
}
export async function fetchTradeBook(creds) {
  return { status: "success", data: list(await dhanPortfolio.getTrades(creds)).map(mapDhanTrade) };
}

export const placeOrder = withOrderGate("placeOrder", async (creds, order, resolvedLotSize) => ack(await dhanOrders.placeOrder(creds, order, resolvedLotSize)), { brokerId: "dhan" });
export const modifyOrder = withOrderGate("modifyOrder", async (creds, orderId, changes) => ack(await dhanPortfolio.modifyOrder(creds, orderId, changes)), { brokerId: "dhan" });
export const cancelOrder = withOrderGate("cancelOrder", async (creds, orderId) => ack(await dhanOrders.cancelOrder(creds, orderId)), { brokerId: "dhan" });

/**
 * dhanFetch throws DhanApiError ("Dhan API error [<http>]: <body>", status 502). Dhan's documented codes
 * get their own contract codes (annexure): DH-901 and data errors 807-810 = invalid or expired token;
 * DH-904, 805 and HTTP 429 = rate limit; DH-905 and 811-814 = bad input. Everything stays 502 (the
 * upstream refused); our own refusals (SessionRequiredError, OrderGateError, BrokerInputError) keep 422.
 */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError && err.statusCode === 422) return base;
  const m = base.message;
  if (/DH-901|"80[789]"|"810"|\[401\]/.test(m)) return { ...base, code: "UPSTREAM_AUTH" };
  if (/DH-904|"805"|\[429\]/.test(m)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  if (/DH-905|"81[1-4]"/.test(m)) return { ...base, code: "UPSTREAM_INPUT" };
  if (/DH-902|"806"/.test(m)) return { ...base, code: "UPSTREAM_NOT_SUBSCRIBED" };
  return base;
}
