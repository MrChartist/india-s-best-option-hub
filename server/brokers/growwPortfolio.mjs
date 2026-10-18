/**
 * Groww portfolio and books, read-only (official docs: https://groww.in/trade-api/docs/curl/portfolio,
 * /margin, /orders, /annexures).
 *
 *  - GET /v1/positions/user -> payload.positions[] { trading_symbol, segment?, exchange, quantity, product,
 *    net_price, realised_pnl, credit_*, debit_*, symbol_isin }. No LTP and no token, so `ltp` is null,
 *    `token` is the trading symbol and `pnl` is the realised P&L only.
 *  - GET /v1/holdings/user -> payload.holdings[] { isin, trading_symbol, quantity, average_price, ... }.
 *    No exchange field; holdings are shown against NSE.
 *  - GET /v1/margins/detail/user -> payload { clear_cash, net_margin_used, collateral_available, ... }.
 *  - GET /v1/order/list?segment=CASH|FNO&page&page_size (max 100) -> payload.order_list[].
 *  - Groww has no day-wide trade book; GET /v1/order/trades/{groww_order_id}?segment&page&page_size (max 50)
 *    lists one order's fills, so the trade book reads the fills of today's (partly) filled orders.
 *
 * Order status (Annexures): NEW, ACKED, APPROVED, MODIFICATION_REQUESTED, CANCELLATION_REQUESTED -> OPEN
 * (PARTIALLY_FILLED when some quantity is filled); TRIGGER_PENDING -> TRIGGER_PENDING; EXECUTED, COMPLETED,
 * DELIVERY_AWAITED -> COMPLETE; CANCELLED -> CANCELLED; REJECTED, FAILED -> REJECTED. The doc samples also
 * show "OPEN", treated as OPEN.
 */

import { growwRequest } from "./growwAuth.mjs";

const SEGMENTS = ["CASH", "FNO"];
const ORDER_PAGE = 100;
const MAX_ORDER_PAGES = 5;
const MAX_TRADE_ORDERS = 40;

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const str = (v) => (v === null || v === undefined ? "" : String(v));

const PRODUCT = { CNC: "CNC", MIS: "INTRADAY", NRML: "MARGIN" };
export const productOf = (p) => PRODUCT[String(p ?? "").toUpperCase()] ?? "INTRADAY";

const DERIVATIVE_SYMBOL = /\d.*(CE|PE|FUT)$/;
/** NSE/BSE + segment -> contract exchange. Without a segment, an option/future-looking symbol counts as F&O. */
export function exchangeOf(exchange, segment, tradingSymbol) {
  const ex = String(exchange ?? "NSE").toUpperCase() === "BSE" ? "BSE" : "NSE";
  const fno = segment ? String(segment).toUpperCase() === "FNO" : DERIVATIVE_SYMBOL.test(str(tradingSymbol));
  if (!fno) return ex;
  return ex === "BSE" ? "BFO" : "NFO";
}

const OPEN_STATES = new Set(["NEW", "ACKED", "APPROVED", "OPEN", "MODIFICATION_REQUESTED", "CANCELLATION_REQUESTED"]);
const COMPLETE_STATES = new Set(["EXECUTED", "COMPLETED", "DELIVERY_AWAITED"]);
export function orderStatusOf(status, filled = 0, remaining = 0) {
  const s = String(status ?? "").toUpperCase();
  if (OPEN_STATES.has(s)) return filled > 0 && remaining > 0 ? "PARTIALLY_FILLED" : "OPEN";
  if (s === "TRIGGER_PENDING") return "TRIGGER_PENDING";
  if (COMPLETE_STATES.has(s)) return "COMPLETE";
  if (s === "CANCELLED") return "CANCELLED";
  if (s === "REJECTED" || s === "FAILED") return "REJECTED";
  return "UNKNOWN";
}

export function mapPosition(p) {
  const realised = n(p.realised_pnl);
  return {
    tradingSymbol: str(p.trading_symbol),
    exchange: exchangeOf(p.exchange, p.segment, p.trading_symbol),
    token: str(p.trading_symbol),
    product: productOf(p.product),
    netQty: n(p.quantity),
    avgPrice: n(p.net_price),
    ltp: null,
    pnl: realised,
    realisedPnl: realised,
    unrealisedPnl: null,
  };
}

export function mapHolding(h) {
  return {
    tradingSymbol: str(h.trading_symbol), exchange: "NSE", token: str(h.isin || h.trading_symbol), isin: h.isin ? str(h.isin) : null,
    qty: n(h.quantity), avgPrice: n(h.average_price), ltp: null, pnl: null,
  };
}

export function mapFunds(f) {
  return {
    availableCash: n(f?.clear_cash),
    usedMargin: n(f?.net_margin_used),
    totalBalance: null,
    collateral: f?.collateral_available != null ? n(f.collateral_available) : null,
    withdrawable: null,
  };
}

export function mapOrder(o) {
  const filled = n(o.filled_quantity);
  const remaining = n(o.remaining_quantity);
  const status = orderStatusOf(o.order_status, filled, remaining);
  const pending = status === "OPEN" || status === "PARTIALLY_FILLED" || status === "TRIGGER_PENDING" ? remaining : 0;
  return {
    orderId: str(o.groww_order_id),
    tradingSymbol: str(o.trading_symbol),
    exchange: exchangeOf(o.exchange, o.segment, o.trading_symbol),
    token: str(o.trading_symbol) || str(o.groww_order_id),
    side: String(o.transaction_type).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: n(o.quantity),
    filledQty: filled,
    pendingQty: pending,
    price: n(o.price),
    triggerPrice: n(o.trigger_price),
    avgPrice: n(o.average_fill_price),
    orderType: str(o.order_type) || "UNKNOWN",
    product: productOf(o.product),
    status,
    statusMessage: o.remark ? str(o.remark) : null,
    placedAt: o.created_at ? str(o.created_at) : null,
  };
}

export function mapTrade(t, order) {
  return {
    tradeId: str(t.groww_trade_id || t.exchange_trade_id),
    orderId: str(t.groww_order_id || order?.groww_order_id),
    tradingSymbol: str(t.trading_symbol || order?.trading_symbol),
    exchange: exchangeOf(t.exchange ?? order?.exchange, t.segment ?? order?.segment, t.trading_symbol),
    token: str(t.trading_symbol || order?.trading_symbol) || str(t.groww_trade_id),
    side: String(t.transaction_type ?? order?.transaction_type).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: n(t.quantity),
    price: n(t.price),
    tradedAt: t.trade_date_time ? str(t.trade_date_time) : t.created_at ? str(t.created_at) : null,
  };
}

export async function fetchPositions(creds) {
  const p = await growwRequest(creds, "/v1/positions/user");
  return { status: "success", data: (p?.positions ?? []).map(mapPosition) };
}

export async function fetchHoldings(creds) {
  const p = await growwRequest(creds, "/v1/holdings/user");
  return { status: "success", data: (p?.holdings ?? []).map(mapHolding) };
}

export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds(await growwRequest(creds, "/v1/margins/detail/user")) };
}

/** Raw order-list rows for both segments (each tagged with the segment it was read from). */
export async function listRawOrders(creds) {
  const out = [];
  for (const segment of SEGMENTS) {
    for (let page = 0; page < MAX_ORDER_PAGES; page++) {
      const p = await growwRequest(creds, "/v1/order/list", { params: { segment, page, page_size: ORDER_PAGE } });
      const rows = Array.isArray(p?.order_list) ? p.order_list : [];
      out.push(...rows.map((r) => ({ segment, ...r })));
      if (rows.length < ORDER_PAGE) break;
    }
  }
  return out;
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await listRawOrders(creds)).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  const filled = (await listRawOrders(creds)).filter((o) => n(o.filled_quantity) > 0).slice(0, MAX_TRADE_ORDERS);
  const trades = [];
  for (const o of filled) {
    const p = await growwRequest(creds, `/v1/order/trades/${encodeURIComponent(str(o.groww_order_id))}`, { params: { segment: o.segment, page: 0, page_size: 50 } });
    for (const t of p?.trade_list ?? []) trades.push(mapTrade(t, o));
  }
  return { status: "success", data: trades };
}
