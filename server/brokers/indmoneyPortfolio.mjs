/**
 * IndMoney (INDstocks) portfolio and books, read-only. Official Postman collection, checked 2026-10:
 *  - GET /portfolio/positions?segment=derivative|equity&product=margin|intraday|cnc -> data[] { net_qty,
 *    avg_price, realized_profit, segment, product, exchange ("" on the derivative sample), security_id,
 *    symbol, drv_instrument, drv_expiry_date ("07/16/2026 14:00"), drv_option_type, drv_strike_price, ... }.
 *    https://api-docs.indstocks.com/portfolio_funds/ lists the products per segment (cnc/intraday for equity,
 *    margin/intraday for derivative and commodity; product must come with segment). This app reads every equity and
 *    derivative pair from that table (commodity is out of scope). No LTP / unrealised P&L in the response.
 *  - GET /portfolio/holdings -> data[] { security_id, symbol, isin, total_qty, avg_price, ... } (no exchange).
 *  - GET /funds -> data { sod_balance, withdrawal_balance, pledge_received, detailed_avl_balance { eq_cnc,
 *    eq_mis, eq_mtf, future, option_buy, option_sell, comm_option_buy }, realized_pnl, unrealized_pnl, ... }.
 *  - GET /order-book -> data[] { id (EQ- / DRV- / GTT-), exch_order_id, security_id, name, txn_type, exchange,
 *    segment, product, order_type, validity, requested_qty, traded_qty, requested_price, traded_price,
 *    sl_trigger_price, status, created_at, extra_info }.
 *  - GET /trade-book?segment=EQUITY|DERIVATIVE -> data[] { fill_id, exch_order_id, quantity, price, trade_date,
 *    scrip_code }. Fills carry no side or symbol, so they are joined to the order book on exch_order_id;
 *    a fill whose order is not in today's book is skipped (its side is unknown).
 *
 * Order status: mapped from the "Order Status Types" table at https://api-docs.indstocks.com/normal_orders/ (15
 * values, kept in the page's order). Also accepted: PARTIALLY_EXECUTED (order-update feed docs), CREATED (glossary)
 * and REJECTED, the one value not in the official docs (observed status; needs live verification). Unknown values map to
 * UNKNOWN, never to a guess.
 */

import { indRequest } from "./indmoneyAuth.mjs";

// Products each segment accepts on GET /portfolio/positions (portfolio_funds docs). Commodity is not read.
const PRODUCTS_BY_SEGMENT = Object.freeze({ equity: ["cnc", "intraday"], derivative: ["margin", "intraday"] });
const positionFilters = () =>
  Object.entries(PRODUCTS_BY_SEGMENT).flatMap(([segment, products]) => products.map((product) => ({ segment, product })));
const BSE_INDEX_UNDERLYINGS = new Set(["SENSEX", "BANKEX", "SENSEX50"]);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const n = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const x = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const str = (v) => (v === null || v === undefined ? "" : String(v));
const list = (json) => (Array.isArray(json?.data) ? json.data : []);

const PRODUCTS = new Set(["CNC", "INTRADAY", "MARGIN", "MTF"]);
export const productOf = (p) => (PRODUCTS.has(String(p ?? "").toUpperCase()) ? String(p).toUpperCase() : "INTRADAY");

/** exchange ("NSE" | "BSE" | "") + segment -> contract exchange. */
export function exchangeOf(exchange, segment, symbol) {
  const drv = String(segment ?? "").toUpperCase() === "DERIVATIVE";
  let ex = String(exchange ?? "").toUpperCase();
  if (ex !== "NSE" && ex !== "BSE") ex = drv && BSE_INDEX_UNDERLYINGS.has(String(symbol ?? "").toUpperCase()) ? "BSE" : "NSE";
  if (!drv) return ex;
  return ex === "BSE" ? "BFO" : "NFO";
}

// "Order Status Types", in the order the official Orders page lists them -> contract status.
const STATUS_MAP = new Map([
  ["QUEUED", "OPEN"],
  ["O-PENDING", "OPEN"],
  ["SL-PENDING", "TRIGGER_PENDING"],
  ["PROCESSING", "OPEN"],
  ["ABORTED", "REJECTED"],
  ["INITIATED", "OPEN"],
  ["SUCCESS", "COMPLETE"],
  ["CANCELLED", "CANCELLED"],
  ["MODIFIED", "OPEN"],
  ["PENDING", "OPEN"],
  ["EXPIRED", "EXPIRED"],
  ["FAILED", "REJECTED"],
  ["PARTIALLY FILLED", "PARTIALLY_FILLED"],
  ["PARTIALLY FILLED - CANCELLED", "CANCELLED"],
  ["PARTIALLY FILLED - EXPIRED", "EXPIRED"],
  // Outside that table: the order-update feed's spelling, the glossary's CREATED, and REJECTED (observed, not in the official docs).
  ["PARTIALLY_EXECUTED", "PARTIALLY_FILLED"],
  ["CREATED", "OPEN"],
  ["REJECTED", "REJECTED"],
]);
export function orderStatusOf(status) {
  return STATUS_MAP.get(String(status ?? "").toUpperCase().trim()) ?? "UNKNOWN";
}

/** "SENSEX 16 JUL 82000 CE" for a derivative position row (the API returns the underlying in `symbol`). */
function positionSymbol(p) {
  if (String(p.segment).toUpperCase() !== "DERIVATIVE" || !p.drv_instrument) return str(p.symbol);
  const m = /^(\d{1,2})\/(\d{1,2})\/\d{4}/.exec(str(p.drv_expiry_date));
  const date = m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? ""}` : "";
  const isFut = String(p.drv_instrument).startsWith("FUT");
  return [str(p.symbol), date, isFut ? "FUT" : `${n(p.drv_strike_price)} ${str(p.drv_option_type)}`].filter(Boolean).join(" ");
}

export function mapPosition(p) {
  const realised = n(p.realized_profit);
  return {
    tradingSymbol: positionSymbol(p),
    exchange: exchangeOf(p.exchange, p.segment, p.symbol),
    token: str(p.security_id),
    product: productOf(p.product),
    netQty: n(p.net_qty),
    avgPrice: n(p.avg_price),
    ltp: null,
    pnl: realised,
    realisedPnl: realised,
    unrealisedPnl: null,
  };
}

export function mapHolding(h) {
  return {
    tradingSymbol: str(h.symbol), exchange: "NSE", token: str(h.security_id), isin: h.isin ? str(h.isin) : null,
    qty: n(h.total_qty), avgPrice: n(h.avg_price), ltp: null, pnl: null,
  };
}

/**
 * availableCash = the equity CNC balance (cash usable for delivery); totalBalance = start-of-day balance;
 * usedMargin is derived (start-of-day balance minus that cash, floored at 0) because the API returns no
 * utilised-margin figure.
 */
export function mapFunds(f) {
  const total = n(f?.sod_balance);
  const avail = n(f?.detailed_avl_balance?.eq_cnc ?? f?.withdrawal_balance);
  return {
    availableCash: avail,
    usedMargin: Math.max(0, Math.round((total - avail) * 100) / 100),
    totalBalance: f?.sod_balance != null ? total : null,
    collateral: f?.pledge_received != null ? n(f.pledge_received) : null,
    withdrawable: f?.withdrawal_balance != null ? n(f.withdrawal_balance) : null,
  };
}

export function mapOrder(o) {
  const qty = n(o.requested_qty);
  const filled = n(o.traded_qty);
  const status = orderStatusOf(o.status);
  const working = status === "OPEN" || status === "PARTIALLY_FILLED" || status === "TRIGGER_PENDING";
  return {
    orderId: str(o.id),
    tradingSymbol: str(o.name),
    exchange: exchangeOf(o.exchange, o.segment, String(o.name ?? "").split(" ")[0]),
    token: str(o.security_id) || str(o.id),
    side: String(o.txn_type).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty,
    filledQty: filled,
    pendingQty: working ? Math.max(0, qty - filled) : 0,
    price: n(o.requested_price),
    triggerPrice: n(o.sl_trigger_price),
    avgPrice: n(o.traded_price),
    orderType: str(o.order_type) || "UNKNOWN",
    product: productOf(o.product),
    status,
    statusMessage: o.extra_info ? str(o.extra_info) : null,
    placedAt: o.created_at ? str(o.created_at) : null,
  };
}

export function mapTrade(t, order, segment) {
  return {
    tradeId: str(t.fill_id ?? t.trade_serial_no),
    orderId: str(order.id),
    tradingSymbol: str(order.name),
    exchange: exchangeOf(order.exchange, order.segment ?? segment, String(order.name ?? "").split(" ")[0]),
    token: str(t.scrip_code ?? order.security_id),
    side: String(order.txn_type).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: n(t.quantity),
    price: n(t.price),
    tradedAt: t.trade_date ? str(t.trade_date) : null,
  };
}

export async function fetchPositions(creds) {
  const rows = [];
  for (const params of positionFilters()) rows.push(...list(await indRequest(creds, "/portfolio/positions", { params })));
  return { status: "success", data: rows.map(mapPosition) };
}

export async function fetchHoldings(creds) {
  return { status: "success", data: list(await indRequest(creds, "/portfolio/holdings")).map(mapHolding) };
}

export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds((await indRequest(creds, "/funds"))?.data) };
}

export async function listRawOrders(creds) {
  return list(await indRequest(creds, "/order-book"));
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await listRawOrders(creds)).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  const orders = await listRawOrders(creds);
  const byExch = new Map(orders.filter((o) => o.exch_order_id).map((o) => [String(o.exch_order_id), o]));
  const trades = [];
  for (const segment of ["EQUITY", "DERIVATIVE"]) {
    for (const t of list(await indRequest(creds, "/trade-book", { params: { segment } }))) {
      const order = byExch.get(String(t.exch_order_id));
      if (order) trades.push(mapTrade(t, order, segment));
    }
  }
  return { status: "success", data: trades };
}
