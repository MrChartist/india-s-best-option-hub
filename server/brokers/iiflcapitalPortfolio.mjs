/**
 * IIFL Capital portfolio and books, read-only. Official docs: https://developers.iiflcapital.com/apidocs/portfolio,
 * /ordermanagement and /user (checked 2026-10):
 *  - GET /positions -> rows { instrumentId, tradingSymbol, formattedInstrumentName, exchange (NSEFO ...), product
 *    (NORMAL | INTRADAY | DELIVERY | BNPL), netQuantity, netAveragePrice, realizedPnl, buyQuantity, ...,
 *    lotSize, tickSize, previousDayClose }. No LTP, so `ltp` is null and `pnl` is the realised P&L.
 *  - GET /holdings -> rows { isin, nseInstrumentId, bseInstrumentId, nseTradingSymbol, bseTradingSymbol,
 *    product, totalQuantity, dpQuantity, t1Quantity, averageTradedPrice, previousDayClose }.
 *  - GET /limits -> result { tradingLimit, openingCashLimit, intradayPayin, collateralMargin, creditForSell,
 *    adhocMargin, utilizedMargin, blockedForPayout, utilizedSpanMargin, utilizedExposureMargin } (pooled for
 *    resident clients; NRI clients get segment-wise /limits/equity and /limits/fno).
 *  - GET /orders -> rows { brokerOrderId, exchangeOrderId, orderStatus, tradingSymbol, instrumentId, exchange,
 *    transactionType, quantity, product, orderType, price, averageTradedPrice, slTriggerPrice, pendingQuantity,
 *    filledQuantity, rejectionReason, exchangeTimestamp, ... }.
 *  - GET /trades -> rows { brokerOrderId, exchangeTradeId, tradingSymbol, instrumentId, exchange,
 *    transactionType, tradedPrice, filledQuantity, fillTimestamp, ... }.
 * Empty books come back as errors EC916 / EC920 / EC922 / EC926 ("No ... found"), read as empty lists.
 * Order status: the docs say "e.g., Open, Complete, Rejected, Cancelled" (samples lower-case: "cancelled",
 * "rejected"). Trigger-pending / partial spellings are matched loosely; anything else is UNKNOWN.
 */

import { iiflRequest, rowsOf } from "./iiflcapitalAuth.mjs";
import { CONTRACT_EXCHANGE } from "./iiflcapitalInstruments.mjs";

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const str = (v) => (v === null || v === undefined || v === "NA" ? "" : String(v));

const PRODUCT = { NORMAL: "MARGIN", INTRADAY: "INTRADAY", DELIVERY: "CNC", BNPL: "MTF" };
export const productOf = (p) => PRODUCT[String(p ?? "").toUpperCase()] ?? "INTRADAY";
export const exchangeOf = (e) => CONTRACT_EXCHANGE[String(e ?? "").toUpperCase()] ?? "NSE";

export function orderStatusOf(status, filled = 0, pending = 0) {
  const s = String(status ?? "").toLowerCase().replace(/[_-]+/g, " ").trim();
  if (/trigger/.test(s)) return "TRIGGER_PENDING";
  if (/partial/.test(s)) return /cancel/.test(s) ? "CANCELLED" : "PARTIALLY_FILLED";
  if (["open", "pending", "new", "modified", "put order req received", "validation pending", "open pending"].includes(s)) return filled > 0 && pending > 0 ? "PARTIALLY_FILLED" : "OPEN";
  if (["complete", "completed", "filled", "executed", "traded", "success"].includes(s)) return "COMPLETE";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  if (s === "rejected" || s === "failed") return "REJECTED";
  if (s === "expired") return "EXPIRED";
  return "UNKNOWN";
}

export function mapPosition(p) {
  const realised = n(p.realizedPnl);
  return {
    tradingSymbol: str(p.tradingSymbol) || str(p.formattedInstrumentName), exchange: exchangeOf(p.exchange), token: str(p.instrumentId),
    product: productOf(p.product), netQty: n(p.netQuantity), avgPrice: n(p.netAveragePrice), ltp: null,
    pnl: realised, realisedPnl: p.realizedPnl != null ? realised : null, unrealisedPnl: null,
  };
}

export function mapHolding(h) {
  const onNse = !!str(h.nseInstrumentId);
  return {
    tradingSymbol: str(onNse ? h.nseTradingSymbol : h.bseTradingSymbol) || str(h.formattedInstrumentName),
    exchange: onNse ? "NSE" : "BSE", token: str(onNse ? h.nseInstrumentId : h.bseInstrumentId) || str(h.isin),
    isin: h.isin ? str(h.isin) : null, qty: n(h.totalQuantity), avgPrice: n(h.averageTradedPrice), ltp: null, pnl: null,
  };
}

export function mapFunds(f) {
  return {
    availableCash: n(f?.tradingLimit),
    usedMargin: n(f?.utilizedMargin),
    totalBalance: f?.openingCashLimit != null || f?.intradayPayin != null ? n(f?.openingCashLimit) + n(f?.intradayPayin) : null,
    collateral: f?.collateralMargin != null ? n(f.collateralMargin) : null,
    withdrawable: null,
  };
}

export function mapOrder(o) {
  const filled = n(o.filledQuantity);
  const pending = n(o.pendingQuantity);
  const status = orderStatusOf(o.orderStatus, filled, pending);
  const working = status === "OPEN" || status === "PARTIALLY_FILLED" || status === "TRIGGER_PENDING";
  return {
    orderId: str(o.brokerOrderId), tradingSymbol: str(o.tradingSymbol) || str(o.formattedInstrumentName), exchange: exchangeOf(o.exchange),
    token: str(o.instrumentId) || str(o.brokerOrderId), side: String(o.transactionType).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: n(o.quantity) || filled + pending + n(o.cancelledQuantity), filledQty: filled, pendingQty: working ? pending : 0,
    price: n(o.price), triggerPrice: n(o.slTriggerPrice), avgPrice: n(o.averageTradedPrice), orderType: str(o.orderType) || "UNKNOWN",
    product: productOf(o.product), status, statusMessage: str(o.rejectionReason) || null, placedAt: str(o.exchangeTimestamp) || str(o.brokerUpdateTime) || null,
  };
}

export function mapTrade(t) {
  return {
    tradeId: str(t.exchangeTradeId), orderId: str(t.brokerOrderId), tradingSymbol: str(t.tradingSymbol) || str(t.formattedInstrumentName),
    exchange: exchangeOf(t.exchange), token: str(t.instrumentId) || str(t.exchangeTradeId), side: String(t.transactionType).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: n(t.filledQuantity), price: n(t.tradedPrice), tradedAt: str(t.fillTimestamp) || null,
  };
}

export async function fetchPositions(creds) {
  return { status: "success", data: rowsOf(await iiflRequest(creds, "/positions")).map(mapPosition) };
}

export async function fetchHoldings(creds) {
  return { status: "success", data: rowsOf(await iiflRequest(creds, "/holdings")).map(mapHolding) };
}

export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds(rowsOf(await iiflRequest(creds, "/limits"))[0]) };
}

export async function listRawOrders(creds) {
  return rowsOf(await iiflRequest(creds, "/orders"));
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await listRawOrders(creds)).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  return { status: "success", data: rowsOf(await iiflRequest(creds, "/trades")).map(mapTrade) };
}
