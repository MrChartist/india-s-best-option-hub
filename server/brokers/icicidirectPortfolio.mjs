/**
 * ICICI Direct (Breeze) portfolio and books, read-only. Official docs (checked 2026-10):
 *  - GET /portfoliopositions body {} -> Success [ { segment, product_type (Options | Futures | Cash), exchange_code,
 *    stock_code, expiry_date ("27-Feb-2025"), strike_price, right (Call | Put | Others), action (Buy | Sell | NA),
 *    quantity, average_price, ltp, ... } ].
 *  - GET /dematholdings body {} -> Success [ { stock_code, stock_ISIN, quantity, demat_avail_quantity, ... } ]
 *    (no average price is given, so avgPrice is 0 and P&L is null).
 *  - GET /funds body {} -> Success { total_bank_balance, allocated_equity, allocated_fno, block_by_trade_equity,
 *    block_by_trade_fno, unallocated_balance, ... }.
 *  - GET /order body { exchange_code, from_date, to_date } -> Success [ { order_id, exchange_code, stock_code,
 *    product_type, action, order_type, stoploss, quantity, price, average_price, cancelled_quantity,
 *    pending_quantity, status, order_datetime ("05-Feb-2025 09:26"), expiry_date, right, strike_price } ].
 *    Status words: Requested, Queued, Ordered, Partially Executed, Executed, Rejected, Expired, Partially Executed
 *    And Expired, Partially Executed And Cancelled, Freezed, Cancelled.
 *  - GET /trades body { from_date, to_date, exchange_code } -> Success [ { trade_date, stock_code, action, quantity,
 *    average_cost, exchange_code, order_id, expiry_date, right, strike_price } ] (no trade id in the list).
 * Books are per exchange, so the NSE and NFO books are read one after the other (two calls each).
 */

import { breezeRequest } from "./icicidirectAuth.mjs";
import { expiryIso, findDerivative, getMaster } from "./icicidirectInstruments.mjs";

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const nOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

const exchangeOf = (e) => (str(e).toUpperCase() === "NFO" ? "NFO" : "NSE");
const isFno = (row) => exchangeOf(row?.exchange_code) === "NFO" || /option|future/i.test(str(row?.product_type));
export const productOf = (row) => (isFno(row) ? "MARGIN" : /margin/i.test(str(row?.product_type)) ? "INTRADAY" : "CNC");
const sideOf = (a) => (str(a).toLowerCase().startsWith("s") ? "SELL" : "BUY");

/** IST calendar day "YYYY-MM-DD" for `now`. */
export function istToday(now = Date.now()) {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** "05-Feb-2025 09:26" (IST) -> "2025-02-05T09:26:00+05:30"; null otherwise. */
export function istIso(raw) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(str(raw));
  if (!m || !MONTHS[m[2].toUpperCase()]) return null;
  return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}+05:30`;
}

export function orderStatusOf(status, filled = 0) {
  const s = str(status).toLowerCase();
  if (s === "partially executed and cancelled") return "CANCELLED";
  if (s === "partially executed and expired") return "EXPIRED";
  if (s === "partially executed") return "PARTIALLY_FILLED";
  if (["requested", "queued", "ordered", "open", "pending"].includes(s)) return filled > 0 ? "PARTIALLY_FILLED" : "OPEN";
  if (s === "executed" || s === "complete") return "COMPLETE";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  if (s === "rejected") return "REJECTED";
  if (s === "expired") return "EXPIRED";
  return "UNKNOWN";
}

/** Contract token + display symbol for a Breeze row (F&O via the master; cash via the NSE list by stock_code). */
function identify(master, row) {
  if (isFno(row)) {
    const d = findDerivative(master, row);
    if (d) return { token: d.token, tradingSymbol: d.tradingSymbol };
    const exp = expiryIso(row.expiry_date) ?? "";
    return { token: str(row.order_id) || str(row.stock_code), tradingSymbol: [str(row.stock_code), exp, str(row.strike_price), str(row.right)].filter(Boolean).join("-") };
  }
  const eq = master.nse.find((m) => m.breezeCode === str(row.stock_code));
  return eq ? { token: eq.token, tradingSymbol: eq.tradingSymbol } : { token: str(row.stock_code), tradingSymbol: str(row.stock_code) };
}

export function mapPosition(master, p) {
  const qty = n(p.quantity) * (sideOf(p.action) === "SELL" ? -1 : 1);
  const avg = n(p.average_price);
  const ltp = nOrNull(p.ltp);
  const id = identify(master, p);
  return {
    ...id, exchange: exchangeOf(p.exchange_code), product: productOf(p), netQty: qty, avgPrice: avg, ltp,
    pnl: ltp !== null && qty !== 0 ? (ltp - avg) * qty : 0, realisedPnl: null, unrealisedPnl: ltp !== null && qty !== 0 ? (ltp - avg) * qty : null,
  };
}

export function mapHolding(master, h) {
  const eq = master.nse.find((m) => m.breezeCode === str(h.stock_code));
  return {
    tradingSymbol: eq?.tradingSymbol ?? str(h.stock_code), exchange: "NSE", token: eq?.token ?? (str(h.stock_ISIN) || str(h.stock_code)),
    isin: h.stock_ISIN ? str(h.stock_ISIN) : null, qty: n(h.quantity), avgPrice: 0, ltp: null, pnl: null,
  };
}

export function mapFunds(f) {
  const used = n(f?.block_by_trade_equity) + n(f?.block_by_trade_fno);
  return {
    availableCash: n(f?.allocated_equity) + n(f?.allocated_fno) - used,
    usedMargin: used,
    totalBalance: f?.total_bank_balance != null ? n(f.total_bank_balance) : null,
    collateral: null,
    withdrawable: f?.unallocated_balance != null ? n(f.unallocated_balance) : null,
  };
}

export function mapOrder(master, o) {
  const qty = n(o.quantity);
  const pending = n(o.pending_quantity);
  const cancelled = n(o.cancelled_quantity);
  const status = orderStatusOf(o.status);
  const working = status === "OPEN" || status === "PARTIALLY_FILLED" || status === "TRIGGER_PENDING";
  const filled = status === "COMPLETE" ? qty : Math.max(0, qty - pending - cancelled);
  const finalStatus = status === "OPEN" && filled > 0 ? "PARTIALLY_FILLED" : status;
  return {
    orderId: str(o.order_id), ...identify(master, o), exchange: exchangeOf(o.exchange_code), side: sideOf(o.action), qty, filledQty: filled,
    pendingQty: working ? pending : 0, price: n(o.price), triggerPrice: n(o.stoploss), avgPrice: n(o.average_price), orderType: str(o.order_type).toUpperCase() || "UNKNOWN",
    product: productOf(o), status: finalStatus, statusMessage: null, placedAt: istIso(o.order_datetime),
  };
}

export function mapTrade(master, t, i) {
  return {
    tradeId: `${str(t.order_id)}#${i + 1}`, orderId: str(t.order_id), ...identify(master, t), exchange: exchangeOf(t.exchange_code), side: sideOf(t.action),
    qty: n(t.quantity), price: n(t.average_cost), tradedAt: istIso(t.trade_date),
  };
}

const dayRange = () => {
  const d = istToday();
  return { from_date: `${d}T00:00:00.000Z`, to_date: `${d}T23:59:59.000Z` };
};

/** Today's raw orders for NSE and NFO (Breeze books are per exchange). */
export async function listRawOrders(creds) {
  const out = [];
  for (const exchange_code of ["NSE", "NFO"]) out.push(...await breezeRequest(creds, "order", { params: { exchange_code, ...dayRange() }, list: true }));
  return out;
}

export async function fetchPositions(creds) {
  const rows = await breezeRequest(creds, "portfoliopositions", { list: true });
  const master = await getMaster();
  return { status: "success", data: rows.map((p) => mapPosition(master, p)) };
}

export async function fetchHoldings(creds) {
  const rows = await breezeRequest(creds, "dematholdings", { list: true });
  const master = await getMaster();
  return { status: "success", data: rows.map((h) => mapHolding(master, h)) };
}

export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds(await breezeRequest(creds, "funds")) };
}

export async function fetchOrderBook(creds) {
  const rows = await listRawOrders(creds);
  const master = await getMaster();
  return { status: "success", data: rows.map((o) => mapOrder(master, o)) };
}

export async function fetchTradeBook(creds) {
  const rows = [];
  for (const exchange_code of ["NSE", "NFO"]) rows.push(...await breezeRequest(creds, "trades", { params: { exchange_code, ...dayRange() }, list: true }));
  const master = await getMaster();
  return { status: "success", data: rows.map((t, i) => mapTrade(master, t, i)) };
}
