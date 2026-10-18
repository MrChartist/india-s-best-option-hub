/**
 * Rupeezy (Vortex) portfolio and books, read-only. Official docs (checked 2026-10):
 *  - /positions/: GET /trading/portfolio/positions -> { status, data: { net: [...], day: [...] } } with ticker,
 *    exchange, symbol, token, product (INTRADAY | DELIVERY | MTF), quantity, average_price, buy_value, sell_value,
 *    overnight_buy_value, overnight_sell_value, lot_size, multiplier. No LTP: the gain formula in the docs needs
 *    the last trade price, so open positions are priced with one quotes call (ltp mode).
 *    For NSE_CUR / MCX_FO, actual quantity = quantity x lot_size x multiplier; NSE/BSE rows are already in units.
 *  - /holdings/: GET /trading/portfolio/holdings -> { status, data: [ { isin, nse: { token, exchange, symbol },
 *    bse: {...}, total_free, dp_free, pool_free, t1_quantity, average_price, collateral_quantity } ] }.
 *  - /user/: GET /user/funds -> { nse: { deposit, collateral, total_trading_power, limit_utilization,
 *    total_utilization, net_available, withdrawable_balance, ... }, mcx: {...} } (the sample has no envelope).
 *  - /regular-order/: GET /trading/orders -> { status, orders: [ { order_id, ticker, exchange, token, status,
 *    error_reason, transaction_type, product, variety, total_quantity, pending_quantity, traded_quantity,
 *    order_price, trigger_price, traded_price, order_created_at } ] }.
 *  - /trades/: GET /trading/trades -> { status, trades: [ { order_id, trade_no, ticker, exchange, token,
 *    transaction_type, product, trade_quantity, trade_price, traded_at } ] }.
 * Status words seen in the docs: PENDING, OMSXMITTED, EXECUTED, COMPLETED, CANCELLED, REJECTED. Others are
 * matched loosely; anything unknown is UNKNOWN.
 */

import { vortexRequest } from "./rupeezyAuth.mjs";
import { CONTRACT_EXCHANGE } from "./rupeezyInstruments.mjs";
import { qKey, quoteMap } from "./rupeezyMarket.mjs";

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const LOT_DENOMINATED = new Set(["MCX_FO", "NSE_CUR"]);

export const exchangeOf = (e) => CONTRACT_EXCHANGE[str(e).toUpperCase()] ?? "NSE";
const isCash = (e) => /_EQ$/.test(str(e).toUpperCase());

/** Vortex product -> contract product. DELIVERY is CNC on equity and the carry-forward (MARGIN) product on F&O. */
export function productOf(product, exchange) {
  const p = str(product).toUpperCase();
  if (p === "INTRADAY") return "INTRADAY";
  if (p === "MTF") return "MTF";
  if (p === "BTST") return "CNC";
  return isCash(exchange) ? "CNC" : "MARGIN";
}

const symbolOf = (row) => {
  const t = str(row?.ticker);
  return t.includes(":") ? t.slice(t.indexOf(":") + 1) : t || str(row?.symbol);
};

/** "2023-03-27 18:47:41" (IST) -> "2023-03-27T18:47:41+05:30"; other strings pass through; empty -> null. */
export function istIso(raw) {
  const s = str(raw);
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(s);
  if (m) return `${m[1]}T${m[2]}+05:30`;
  return s || null;
}

export function orderStatusOf(status, traded = 0, pending = 0) {
  const s = str(status).toUpperCase().replace(/[\s-]+/g, "_");
  if (/TRIGGER/.test(s)) return "TRIGGER_PENDING";
  if (/PARTIAL/.test(s)) return /CANCEL/.test(s) ? "CANCELLED" : "PARTIALLY_FILLED";
  if (["PENDING", "OPEN", "OMSXMITTED", "OMS_XMITTED", "NEW", "MODIFIED", "PUT_ORDER_REQ_RECEIVED", "VALIDATION_PENDING", "AMO", "AMO_PENDING"].includes(s)) {
    return traded > 0 && pending > 0 ? "PARTIALLY_FILLED" : "OPEN";
  }
  if (["EXECUTED", "COMPLETED", "COMPLETE", "TRADED", "FILLED"].includes(s)) return "COMPLETE";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "EXPIRED" || s === "LAPSED") return "EXPIRED";
  return "UNKNOWN";
}

/** Units for one row: NSE_CUR / MCX_FO quantities are lots (x lot_size x multiplier); everything else is units. */
const unitsOf = (row) => (LOT_DENOMINATED.has(str(row.exchange).toUpperCase()) ? n(row.quantity) * (n(row.lot_size) || 1) * (n(row.multiplier) || 1) : n(row.quantity));

/**
 * Position from a `net` row and an optional LTP. An exited position's gain is sell_value - buy_value (docs); an
 * open one is marked to the LTP: sell_value - buy_value + ltp x qty (qty negative when short). The API does not
 * split an open position's gain into realised and unrealised parts, so both are null there.
 */
export function mapPosition(p, ltp = null) {
  const qty = unitsOf(p);
  const booked = n(p.sell_value) - n(p.buy_value);
  const pnl = qty === 0 ? booked : ltp !== null ? booked + ltp * qty : 0;
  return {
    tradingSymbol: symbolOf(p), exchange: exchangeOf(p.exchange), token: str(p.token) || symbolOf(p), product: productOf(p.product, p.exchange),
    netQty: qty, avgPrice: n(p.average_price), ltp, pnl, realisedPnl: qty === 0 ? booked : null, unrealisedPnl: null,
  };
}

export function mapHolding(h) {
  const ref = h?.nse && str(h.nse.token) ? h.nse : h?.bse && str(h.bse.token) ? h.bse : {};
  return {
    tradingSymbol: str(ref.symbol) || symbolOf(ref) || str(h?.isin), exchange: exchangeOf(ref.exchange || "NSE_EQ"), token: str(ref.token) || str(h?.isin),
    isin: h?.isin ? str(h.isin) : null, qty: n(h?.total_free) + n(h?.t1_quantity), avgPrice: n(h?.average_price), ltp: null, pnl: null,
  };
}

export function mapFunds(f) {
  const s = f?.nse ?? {};
  return {
    availableCash: n(s.net_available),
    usedMargin: Math.abs(n(s.limit_utilization)),
    totalBalance: s.total_trading_power != null ? n(s.total_trading_power) : null,
    collateral: s.collateral != null ? n(s.collateral) : null,
    withdrawable: s.withdrawable_balance != null ? n(s.withdrawable_balance) : null,
  };
}

export function mapOrder(o) {
  const traded = n(o.traded_quantity);
  const pending = n(o.pending_quantity);
  const status = orderStatusOf(o.status, traded, pending);
  const working = status === "OPEN" || status === "PARTIALLY_FILLED" || status === "TRIGGER_PENDING";
  return {
    orderId: str(o.order_id), tradingSymbol: symbolOf(o), exchange: exchangeOf(o.exchange), token: str(o.token) || str(o.order_id),
    side: str(o.transaction_type).toUpperCase() === "SELL" ? "SELL" : "BUY", qty: n(o.total_quantity), filledQty: traded, pendingQty: working ? pending : 0,
    price: n(o.order_price), triggerPrice: n(o.trigger_price), avgPrice: n(o.traded_price), orderType: str(o.variety) || "UNKNOWN",
    product: productOf(o.product, o.exchange), status, statusMessage: str(o.error_reason) || null, placedAt: istIso(o.order_created_at),
  };
}

export function mapTrade(t) {
  return {
    tradeId: str(t.trade_no) || str(t.exchange_order_no), orderId: str(t.order_id), tradingSymbol: symbolOf(t), exchange: exchangeOf(t.exchange),
    token: str(t.token) || str(t.trade_no), side: str(t.transaction_type).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: n(t.trade_quantity), price: n(t.trade_price), tradedAt: istIso(t.traded_at),
  };
}

export async function fetchPositions(creds) {
  const json = await vortexRequest(creds, "/trading/portfolio/positions");
  const rows = Array.isArray(json?.data?.net) ? json.data.net : [];
  const open = rows.filter((p) => n(p.quantity) !== 0 && str(p.exchange) && str(p.token)).map((p) => ({ exchange: str(p.exchange), token: str(p.token) }));
  let ltps = new Map();
  if (open.length) {
    try { ltps = await quoteMap(creds, open, "ltp"); } catch (e) { if (e?.code === "SESSION_LOGIN_REQUIRED") throw e; /* positions still show without LTP */ }
  }
  return {
    status: "success",
    data: rows.map((p) => {
      const q = ltps.get(qKey({ exchange: str(p.exchange), token: str(p.token) }));
      const ltp = q && Number.isFinite(Number(q.last_trade_price)) ? Number(q.last_trade_price) : null;
      return mapPosition(p, ltp);
    }),
  };
}

export async function fetchHoldings(creds) {
  const json = await vortexRequest(creds, "/trading/portfolio/holdings");
  return { status: "success", data: (Array.isArray(json?.data) ? json.data : []).map(mapHolding) };
}

export async function fetchFunds(creds) {
  const json = await vortexRequest(creds, "/user/funds");
  return { status: "success", data: mapFunds(json?.data?.nse ? json.data : json) };
}

export async function fetchOrderBook(creds) {
  const json = await vortexRequest(creds, "/trading/orders");
  return { status: "success", data: (Array.isArray(json?.orders) ? json.orders : []).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  const json = await vortexRequest(creds, "/trading/trades");
  return { status: "success", data: (Array.isArray(json?.trades) ? json.trades : []).map(mapTrade) };
}
