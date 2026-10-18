/**
 * Paytm Money: read-only portfolio calls mapped onto the contract shapes.
 *
 * Official docs (https://developer.paytmmoney.com/docs/api/<slug>/):
 *  - position-api: GET /orders/v1/position -> {status, data:[{exchange, segment E|D, product C|I|M|B|V,
 *    security_id, display_name, buy_avg, sell_avg, net_qty, last_traded_price, realised_profit, ...}]}
 *  - user-holdings-data-api: GET /holdings/v1/get-user-holdings-data -> {data:{results:[{nse_symbol,
 *    nse_security_id, bse_security_id, exchange ("ALL"), isin_code, quantity, cost_price,
 *    last_traded_price, ...}]}}
 *  - get-funds-summary: GET /accounts/v1/funds/summary?config=true -> {data:{funds_summary:{trade_balance,
 *    utilised_amount, withdrawal_balance, adhoc_limit, opening_balance, funds_added, collaterals}}}
 *  - order-book-all-orders: GET /orders/v1/user/orders -> {status, data:[{order_no, txn_type B|S, exchange,
 *    segment, product, security_id, quantity, traded_qty, remaining_quantity, price, trigger_price,
 *    avg_traded_price, order_type LMT|MKT|SL|SLM, display_status, reason_description, order_date_time,
 *    serial_no, group_id, leg_no, ext_info, ...}]}
 *  - trade-book-api: GET /orders/v1/trade-details?order_no&leg_no&segment -> {data:[{trade_no, quantity,
 *    traded_price, exch_trade_time "31-07-2019 14:55:00", ...}]}. Trades are fetched per order, so the
 *    trade book reads the order book first and asks for each order with traded_qty > 0 (max 25).
 *  display_status values are not enumerated in the docs (sample: "Pending"); Successful, Pending,
 *  Open, Rejected and Cancelled are handled (observed values, not in the official docs: needs live verification). Unknown values map to UNKNOWN.
 */

import { sleep } from "../lib/batch.mjs";
import { paytmGet, istTimestamp } from "./paytmClient.mjs";

const TRADE_BOOK_MAX_ORDERS = 25;
const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const list = (json) => (Array.isArray(json?.data) ? json.data : []);

export const exchangeOf = (exchange, segment) => {
  const bse = String(exchange ?? "").toUpperCase() === "BSE";
  return String(segment ?? "").toUpperCase() === "D" ? (bse ? "BFO" : "NFO") : bse ? "BSE" : "NSE";
};
const PRODUCT_OF = { C: "CNC", I: "INTRADAY", M: "MARGIN", B: "BO", V: "CO" };
export const productOf = (p) => PRODUCT_OF[String(p ?? "").toUpperCase()] ?? "INTRADAY";
const ORDER_TYPE_OF = { LMT: "LIMIT", MKT: "MARKET", SL: "SL", SLM: "SL-M" };
const side = (t) => (String(t ?? "").toUpperCase().startsWith("S") ? "SELL" : "BUY");

const STATUS_OF = {
  SUCCESSFUL: "COMPLETE", EXECUTED: "COMPLETE", TRADED: "COMPLETE", COMPLETE: "COMPLETE", COMPLETED: "COMPLETE",
  PENDING: "OPEN", OPEN: "OPEN", RECEIVED: "OPEN", MODIFIED: "OPEN", "VALIDATION PENDING": "OPEN",
  "TRIGGER PENDING": "TRIGGER_PENDING",
  "PARTIALLY EXECUTED": "PARTIALLY_FILLED", "PART TRADED": "PARTIALLY_FILLED", "PARTIALLY TRADED": "PARTIALLY_FILLED",
  REJECTED: "REJECTED", CANCELLED: "CANCELLED", CANCELED: "CANCELLED", EXPIRED: "EXPIRED",
};
export function orderStatusOf(displayStatus, filled = 0, remaining = 0) {
  const s = STATUS_OF[String(displayStatus ?? "").trim().toUpperCase()] ?? "UNKNOWN";
  return s === "OPEN" && filled > 0 && remaining > 0 ? "PARTIALLY_FILLED" : s;
}

export function mapPosition(p) {
  const netQty = n(p.net_qty);
  const avgPrice = netQty > 0 ? n(p.buy_avg) : netQty < 0 ? n(p.sell_avg) : 0;
  const ltp = n(p.last_traded_price) > 0 ? n(p.last_traded_price) : null;
  const realised = n(p.realised_profit);
  const unrealised = ltp === null ? null : (ltp - avgPrice) * netQty;
  return {
    tradingSymbol: String(p.display_name || p.security_id || ""),
    exchange: exchangeOf(p.exchange, p.segment),
    token: String(p.security_id ?? ""),
    product: productOf(p.product),
    netQty,
    avgPrice,
    ltp,
    pnl: realised + (unrealised ?? 0),
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

export function mapHolding(h) {
  const onNse = Boolean(h.nse_security_id) && String(h.exchange).toUpperCase() !== "BSE";
  const qty = n(h.quantity);
  const avgPrice = n(h.cost_price);
  const ltp = n(h.last_traded_price) > 0 ? n(h.last_traded_price) : null;
  return {
    tradingSymbol: String((onNse ? h.nse_symbol : h.bse_symbol) || h.display_name || h.isin_code || ""),
    exchange: onNse ? "NSE" : "BSE",
    token: String((onNse ? h.nse_security_id : h.bse_security_id) || h.isin_code || ""),
    isin: h.isin_code ? String(h.isin_code) : null,
    qty,
    avgPrice,
    ltp,
    pnl: ltp === null ? null : (ltp - avgPrice) * qty,
  };
}

export function mapFunds(json) {
  const f = json?.data?.funds_summary ?? {};
  return {
    availableCash: n(f.trade_balance),
    usedMargin: n(f.utilised_amount),
    totalBalance: null,
    collateral: f.collaterals === undefined ? null : n(f.collaterals),
    withdrawable: f.withdrawal_balance === undefined ? null : n(f.withdrawal_balance),
  };
}

export function mapOrder(o) {
  const qty = n(o.quantity);
  const filledQty = n(o.traded_qty);
  const pendingQty = o.remaining_quantity !== undefined ? n(o.remaining_quantity) : Math.max(qty - filledQty, 0);
  return {
    orderId: String(o.order_no ?? ""),
    tradingSymbol: String(o.display_name || o.security_id || ""),
    exchange: exchangeOf(o.exchange, o.segment),
    token: String(o.security_id ?? ""),
    side: side(o.txn_type),
    qty,
    filledQty,
    pendingQty,
    price: n(o.price),
    triggerPrice: n(o.trigger_price),
    avgPrice: n(o.avg_traded_price),
    orderType: ORDER_TYPE_OF[String(o.order_type ?? "").toUpperCase()] ?? (String(o.order_type || "UNKNOWN").toUpperCase()),
    product: productOf(o.product),
    status: orderStatusOf(o.display_status, filledQty, pendingQty),
    statusMessage: o.reason_description ? String(o.reason_description) : null,
    placedAt: istTimestamp(o.order_date_time),
  };
}

export async function fetchPositions(creds) {
  return { status: "success", data: list(await paytmGet("/orders/v1/position", creds)).map(mapPosition) };
}

export async function fetchHoldings(creds) {
  const json = await paytmGet("/holdings/v1/get-user-holdings-data", creds);
  return { status: "success", data: (Array.isArray(json?.data?.results) ? json.data.results : []).map(mapHolding) };
}

export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds(await paytmGet("/accounts/v1/funds/summary?config=true", creds)) };
}

export async function fetchRawOrders(creds) {
  return list(await paytmGet("/orders/v1/user/orders", creds));
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await fetchRawOrders(creds)).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  const filled = (await fetchRawOrders(creds)).filter((o) => n(o.traded_qty) > 0).slice(0, TRADE_BOOK_MAX_ORDERS);
  const data = [];
  for (let i = 0; i < filled.length; i++) {
    if (i > 0) await sleep(100);
    const o = filled[i];
    const q = new URLSearchParams({ order_no: String(o.order_no), leg_no: String(o.leg_no ?? "1"), segment: String(o.segment ?? "E") });
    for (const t of list(await paytmGet(`/orders/v1/trade-details?${q}`, creds))) {
      data.push({
        tradeId: String(t.trade_no ?? ""),
        orderId: String(o.order_no),
        tradingSymbol: String(o.display_name || o.security_id || ""),
        exchange: exchangeOf(o.exchange, o.segment),
        token: String(o.security_id ?? ""),
        side: side(o.txn_type),
        qty: n(t.quantity),
        price: n(t.traded_price),
        tradedAt: istTimestamp(t.exch_trade_time),
      });
    }
  }
  return { status: "success", data };
}
