/**
 * Firstock portfolio + books -> contract shapes. Read-only.
 *
 * Official docs (https://firstock.in/api/docs/, checked 2026-10):
 *  - position-book/ : POST /positionBook -> data[] { exchange, token, tradingSymbol, product (C/I/M),
 *    netQuantity, netAveragePrice, lastTradedPrice, RealizedPNL, totalMTM, totalPNL, dayBuy..., daySell... }.
 *  - holding-details/ : POST /holdingsDetails -> data[] { exchangeTradingSymbol: [{ exchange, token,
 *    tradingSymbol, ... }], holdQuantity, dpQuantity, BTSTQuantity, usedQuantity, uploadPrice, ... }.
 *    (/holdings only returns { exchange, tradingSymbol } pairs, with no quantity, so it is not used.)
 *  - limits/ : POST /limit -> data { availableMargin, cash, collateral, marginused, totalMargin, payin, ... }.
 *  - order-book/ : POST /orderBook -> data[] { orderNumber, exchange, tradingSymbol, token, transactionType
 *    (B/S), priceType, product, quantity, fillShares, averagePrice, price, triggerPrice, status, rejectReason,
 *    orderTime (epoch seconds as a string) }.
 *  - trade-book/ : POST /tradeBook -> data[] { fillId, orderNumber, exchange, tradingSymbol, token,
 *    transactionType, fillQuantity, fillPrice, fillTime "21-04-2025 09:30:02" }.
 * Product codes (place-order/): C = CNC, I = intraday, M = margin (NRML); B/H (bracket/cover) are mapped
 * for display only.
 */

import { callApi } from "./firstockAuth.mjs";

export const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(parseFloat(v)) ? num(v) : null);

const PRODUCT = { C: "CNC", I: "INTRADAY", M: "MARGIN", B: "BO", H: "CO", CNC: "CNC", MIS: "INTRADAY", NRML: "MARGIN" };
export const contractProduct = (p) => PRODUCT[String(p ?? "").trim().toUpperCase()] || "INTRADAY";
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
export const contractExchange = (e) => (EXCHANGES.has(String(e ?? "").toUpperCase()) ? String(e).toUpperCase() : "NSE");
const side = (t) => (/^s/i.test(String(t ?? "")) ? "SELL" : "BUY");
const list = (json) => (Array.isArray(json?.data) ? json.data : []);

/** "21-04-2025 09:30:02" | "09:30:02 21-04-2025" | epoch seconds -> ISO (+05:30); raw text otherwise. */
export function firstockTimeToIso(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{9,11}$/.test(s)) {
    const ist = new Date(Number(s) * 1000 + 5.5 * 3600 * 1000).toISOString().slice(0, 19);
    return `${ist}+05:30`;
  }
  let m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  m = /^(\d{2}):(\d{2}):(\d{2}) (\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[6]}-${m[5]}-${m[4]}T${m[1]}:${m[2]}:${m[3]}+05:30`;
  return s;
}

export function mapPosition(r) {
  const netQty = num(r?.netQuantity);
  const realised = numOrNull(r?.RealizedPNL);
  const total = numOrNull(r?.totalPNL);
  const ltp = numOrNull(r?.lastTradedPrice);
  const unrealised = total != null && realised != null ? total - realised : numOrNull(r?.totalMTM);
  return {
    tradingSymbol: String(r?.tradingSymbol ?? ""),
    exchange: contractExchange(r?.exchange),
    token: String(r?.token ?? ""),
    product: contractProduct(r?.product),
    netQty,
    avgPrice: num(r?.netAveragePrice),
    ltp,
    pnl: total ?? (realised ?? 0) + (unrealised ?? 0),
    realisedPnl: realised,
    unrealisedPnl: netQty === 0 ? 0 : unrealised,
  };
}

export async function fetchPositions(creds) {
  return { status: "success", data: list(await callApi(creds, "/positionBook")).map(mapPosition) };
}

export function mapHolding(r) {
  const legs = Array.isArray(r?.exchangeTradingSymbol) ? r.exchangeTradingSymbol : [];
  const leg = legs.find((l) => String(l?.exchange).toUpperCase() === "NSE") || legs[0] || {};
  const qty = num(r?.holdQuantity) + num(r?.BTSTQuantity) + num(r?.dpQuantity) - num(r?.usedQuantity);
  return {
    tradingSymbol: String(leg.tradingSymbol ?? ""),
    exchange: contractExchange(leg.exchange),
    token: String(leg.token ?? ""),
    isin: r?.isin ? String(r.isin) : null,
    qty: Math.max(0, qty),
    avgPrice: num(r?.uploadPrice),
    ltp: null,
    pnl: null,
  };
}

export async function fetchHoldings(creds) {
  return { status: "success", data: list(await callApi(creds, "/holdingsDetails")).map(mapHolding) };
}

export function mapFunds(d) {
  return {
    availableCash: num(d?.availableMargin),
    usedMargin: num(d?.marginused),
    totalBalance: numOrNull(d?.cash),
    collateral: numOrNull(d?.collateral),
    withdrawable: null,
  };
}

export async function fetchFunds(creds) {
  const json = await callApi(creds, "/limit");
  return { status: "success", data: mapFunds(json?.data) };
}

// ── books ──

export function mapOrderStatus(r) {
  const s = String(r?.status ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const filled = num(r?.fillShares);
  const qty = num(r?.quantity);
  if (s === "COMPLETE" || s === "COMPLETED" || s === "FILLED") return "COMPLETE";
  if (s === "REJECTED" || s === "REJECT") return "REJECTED";
  if (s === "CANCELED" || s === "CANCELLED") return "CANCELLED";
  if (s === "TRIGGER_PENDING") return "TRIGGER_PENDING";
  if (s === "EXPIRED") return "EXPIRED";
  if (s === "OPEN" || s === "PENDING" || s === "MODIFIED" || s === "VALIDATION_PENDING") return filled > 0 && filled < qty ? "PARTIALLY_FILLED" : "OPEN";
  return "UNKNOWN";
}

export function mapOrder(r) {
  const qty = num(r?.quantity);
  const filledQty = num(r?.fillShares);
  const status = mapOrderStatus(r);
  const live = status === "OPEN" || status === "TRIGGER_PENDING" || status === "PARTIALLY_FILLED" || status === "UNKNOWN";
  return {
    orderId: String(r?.orderNumber ?? ""),
    tradingSymbol: String(r?.tradingSymbol ?? ""),
    exchange: contractExchange(r?.exchange),
    token: String(r?.token ?? ""),
    side: side(r?.transactionType),
    qty,
    filledQty,
    pendingQty: live ? Math.max(0, qty - filledQty) : 0,
    price: num(r?.price),
    triggerPrice: num(r?.triggerPrice),
    avgPrice: num(r?.averagePrice),
    orderType: String(r?.priceType || "UNKNOWN"),
    product: contractProduct(r?.product),
    status,
    statusMessage: r?.rejectReason ? String(r.rejectReason).replace(/\s+/g, " ").trim() : null,
    placedAt: firstockTimeToIso(r?.orderTime),
  };
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: list(await callApi(creds, "/orderBook")).map(mapOrder) };
}

export function mapTrade(r) {
  return {
    tradeId: String(r?.fillId ?? ""),
    orderId: String(r?.orderNumber ?? ""),
    tradingSymbol: String(r?.tradingSymbol ?? ""),
    exchange: contractExchange(r?.exchange),
    token: String(r?.token ?? ""),
    side: side(r?.transactionType),
    qty: num(r?.fillQuantity ?? r?.fillshares),
    price: num(r?.fillPrice),
    tradedAt: firstockTimeToIso(r?.fillTime ?? r?.exchangeUpdateTime),
  };
}

export async function fetchTradeBook(creds) {
  return { status: "success", data: list(await callApi(creds, "/tradeBook")).map(mapTrade) };
}
