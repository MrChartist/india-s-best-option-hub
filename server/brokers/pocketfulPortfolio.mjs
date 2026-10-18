/**
 * Pocketful read-only portfolio (official docs, checked 2026-10, https://api.pocketful.in/docs/curl/):
 *  - GET /api/v1/positions?client_id&type=historical (net-wise; type=live is day-wise) -> data[] { trading_symbol,
 *    exchange, instrument_token, product (CNC/MIS/NRML), net_quantity, average_buy_price, average_sell_price,
 *    buy_amount, sell_amount, ltp, multiplier, realized_mtm }.
 *  - GET /api/v1/holdings?client_id -> data.holdings[] { trading_symbol, exchange, token, isin, quantity, buy_avg, ltp }.
 *  - GET /api/v2/funds/view?client_id&type=all -> data.values: [[label, "amount"], ...] ("Available", "Cash Deposit",
 *    "Span Margin", "Var Margin", "Extreme Loss Margin", "Premium", "DP Collateral Benefit", ...).
 *  - GET /api/v1/orders?type=pending|completed&client_id -> data.orders[] { oms_order_id, trading_symbol, exchange,
 *    instrument_token, order_side, quantity, filled_quantity, remaining_quantity, price, trigger_price,
 *    average_trade_price, order_type, product, order_status, rejection_reason, order_entry_time (epoch s) }.
 *    The order book is the union of both lists.
 *  - GET /api/v1/trades?client_id -> data.orders[] (same row shape; trade_price / filled_quantity / exchange_time).
 * Order statuses: the docs list COMPLETE, REJECTED, CANCELLED and PENDING, and the samples add AMO_REQ_RECEIVED,
 * AMO_MODIFY_CONFIRMED, AMO_CANCEL_CONFIRMED and CONFIRMED.
 */

import { pfRequest, resolveClientId } from "./pocketfulAuth.mjs";

const PRODUCTS = { CNC: "CNC", MIS: "INTRADAY", INTRADAY: "INTRADAY", NRML: "MARGIN", MARGIN: "MARGIN", MTF: "MTF", CO: "CO", BO: "BO" };
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : num(v));
export const productOf = (p) => PRODUCTS[String(p ?? "").toUpperCase()] ?? "INTRADAY";
export const exchangeOf = (e) => (EXCHANGES.has(String(e ?? "").toUpperCase()) ? String(e).toUpperCase() : "NSE");
const sideOf = (s) => (String(s ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY");
const epochIso = (s) => (Number(s) > 0 ? new Date(Number(s) * 1000).toISOString() : null);

export function orderStatusOf(o) {
  const s = String(o?.order_status ?? "").toUpperCase();
  const filled = num(o?.filled_quantity);
  const qty = num(o?.quantity);
  if (s.includes("REJECT")) return "REJECTED";
  if (s.includes("CANCEL")) return "CANCELLED";
  if (s.includes("EXPIRE")) return "EXPIRED";
  if (["COMPLETE", "COMPLETED", "EXECUTED", "FILLED", "TRADED"].includes(s)) return "COMPLETE";
  if (s.includes("TRIGGER")) return "TRIGGER_PENDING";
  if (s.includes("PENDING") || s.includes("OPEN") || s.includes("CONFIRMED") || s.includes("RECEIVED") || s.includes("MODIF") || s === "NEW") {
    if (filled > 0 && filled < qty) return "PARTIALLY_FILLED";
    return String(o?.order_type ?? "").toUpperCase().startsWith("SL") ? "TRIGGER_PENDING" : "OPEN";
  }
  return "UNKNOWN";
}

export function mapPosition(p) {
  const net = num(p.net_quantity);
  const ltp = numOrNull(p.ltp);
  const mult = num(p.multiplier) || 1;
  const avg = net > 0 ? num(p.average_buy_price) : net < 0 ? num(p.average_sell_price) : num(p.average_price);
  const realised = numOrNull(p.realized_mtm);
  // MTM = cash flow so far + value of the open quantity at the last price.
  const pnl = num(p.sell_amount) - num(p.buy_amount) + (ltp !== null ? net * ltp * mult : 0);
  return {
    tradingSymbol: String(p.trading_symbol ?? ""),
    exchange: exchangeOf(p.exchange),
    token: String(p.instrument_token ?? p.token ?? ""),
    product: productOf(p.product),
    netQty: net,
    avgPrice: avg,
    ltp,
    pnl,
    realisedPnl: realised,
    unrealisedPnl: ltp !== null && net !== 0 ? (ltp - avg) * net * mult : null,
  };
}

export function mapHolding(h) {
  const qty = num(h.quantity);
  const ltp = numOrNull(h.ltp);
  const avg = num(h.buy_avg);
  return {
    tradingSymbol: String(h.trading_symbol ?? h.instrument_details?.trading_symbol ?? ""),
    exchange: exchangeOf(h.exchange),
    token: String(h.token ?? h.instrument_details?.instrument_token ?? ""),
    isin: h.isin ? String(h.isin) : null,
    qty,
    avgPrice: avg,
    ltp,
    pnl: ltp !== null ? (ltp - avg) * qty : null,
  };
}

export function mapFunds(data) {
  const v = new Map((Array.isArray(data?.values) ? data.values : []).map(([k, val]) => [String(k).trim().toLowerCase(), num(val)]));
  const get = (k) => v.get(k.toLowerCase());
  const sum = (...ks) => ks.reduce((a, k) => a + (get(k) ?? 0), 0);
  return {
    availableCash: get("Available") ?? 0,
    usedMargin: sum("Span Margin", "Var Margin", "Extreme Loss Margin", "Premium"),
    totalBalance: get("Cash Deposit") ?? null,
    collateral: v.size ? sum("DP Collateral Benefit", "Pool Collateral Benefit", "Sar Collateral Benefit", "Manual Collateral") : null,
    withdrawable: null,
  };
}

export function mapOrder(o) {
  const qty = num(o.quantity);
  const filled = num(o.filled_quantity);
  return {
    orderId: String(o.oms_order_id ?? ""),
    tradingSymbol: String(o.trading_symbol ?? ""),
    exchange: exchangeOf(o.exchange),
    token: String(o.instrument_token ?? ""),
    side: sideOf(o.order_side),
    qty,
    filledQty: filled,
    pendingQty: o.remaining_quantity !== undefined && o.remaining_quantity !== null ? num(o.remaining_quantity) : Math.max(qty - filled, 0),
    price: num(o.price),
    triggerPrice: num(o.trigger_price),
    avgPrice: num(o.average_trade_price || o.average_price),
    orderType: String(o.order_type || "UNKNOWN").toUpperCase(),
    product: productOf(o.product),
    status: orderStatusOf(o),
    statusMessage: o.rejection_reason && o.rejection_reason !== "NONE" ? String(o.rejection_reason) : null,
    placedAt: epochIso(o.order_entry_time),
  };
}

export function mapTrade(t) {
  return {
    tradeId: String(t.trade_id ?? t.exchange_trade_id ?? t.exchange_order_id ?? t.oms_order_id ?? ""),
    orderId: String(t.oms_order_id ?? ""),
    tradingSymbol: String(t.trading_symbol ?? ""),
    exchange: exchangeOf(t.exchange),
    token: String(t.instrument_token ?? ""),
    side: sideOf(t.order_side),
    qty: num(t.filled_quantity) || num(t.quantity),
    price: num(t.trade_price) || num(t.average_trade_price) || num(t.price),
    tradedAt: epochIso(t.exchange_time),
  };
}

const list = (v) => (Array.isArray(v) ? v : []);

export async function fetchPositions(creds) {
  const client_id = await resolveClientId(creds);
  const json = await pfRequest(creds, "/api/v1/positions", { query: { client_id, type: "historical" } });
  return { status: "success", data: list(json?.data).map(mapPosition) };
}

export async function fetchHoldings(creds) {
  const client_id = await resolveClientId(creds);
  const json = await pfRequest(creds, "/api/v1/holdings", { query: { client_id } });
  return { status: "success", data: list(json?.data?.holdings).map(mapHolding) };
}

export async function fetchFunds(creds) {
  const client_id = await resolveClientId(creds);
  const json = await pfRequest(creds, "/api/v2/funds/view", { query: { client_id, type: "all" } });
  return { status: "success", data: mapFunds(json?.data) };
}

/** Raw rows of both books (pending first), de-duplicated by oms_order_id. */
export async function rawOrders(creds) {
  const client_id = await resolveClientId(creds);
  const seen = new Map();
  for (const type of ["pending", "completed"]) {
    const json = await pfRequest(creds, "/api/v1/orders", { query: { type, client_id } });
    for (const o of list(json?.data?.orders)) if (!seen.has(String(o.oms_order_id))) seen.set(String(o.oms_order_id), o);
  }
  return [...seen.values()];
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await rawOrders(creds)).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  const client_id = await resolveClientId(creds);
  const json = await pfRequest(creds, "/api/v1/trades", { query: { client_id } });
  return { status: "success", data: list(json?.data?.orders ?? json?.data?.trades).map(mapTrade) };
}
