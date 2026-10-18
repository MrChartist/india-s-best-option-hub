/**
 * HDFC Securities (InvestRight): read-only portfolio calls and their mapping onto the contract shapes.
 *
 * Official docs (https://developer.hdfcsec.com/ir-docs/docs/...):
 *  - overall_position: GET /oapi/v1/portfolio/cumulative-positions -> {status, data: {net: [...]}}.
 *    The page's curl sample uses /portfolio/overall_positions; we follow the endpoint block
 *    (cumulative-positions), which is also the path observed live (not in the curl sample; needs live verification). Rows carry no LTP, so
 *    ltp/unrealisedPnl are null and pnl is the realised figure (realised_pl_overall_position).
 *  - holdings: GET /oapi/v1/portfolio/holdings -> {status, data: [...]}; close_price is the previous
 *    close, not a live price, so ltp/pnl are null.
 *  - funds_and_margins: GET /oapi/v1/user/margins -> data.equity.{total_available_limit,
 *    total_utilised_limit, total_limit, totalLimitDetails.pledge_limit}.
 *  - order_status: GET /oapi/v1/orders -> {status, data: [...]}; trade_book: GET /oapi/v1/trades.
 *    Dates are "DD/MM/YYYY HH:MM:SS" IST; expiry_date in books is "30 APR 2024" or "27-JUN-24";
 *    option_type is "Call"/"Put"; transaction_type is "Buy"/"SELL" (mixed case).
 *  Order status values are not enumerated in the docs. The order_status sample shows "Traded" and our
 *  recorded fixtures show "Pending". Other InvestRight status strings (for example trigger-pending,
 *  cancel-confirmed and after-market variants) have been observed but are not in the official docs (needs live
 *  verification). orderStatusOf therefore classifies by the words a status contains rather than by
 *  an exact list, so spelling and case variants land in the right bucket; anything it cannot place is
 *  UNKNOWN. Where a word is ambiguous it leans towards "still open", so panic cancel never skips a live
 *  order.
 */

import { irRequest } from "./hdfcsecuritiesAuth.mjs";

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const nOrNull = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(n(v)) ? null : n(v));
const list = (json) => (Array.isArray(json?.data) ? json.data : []);

const SEGMENT_EXCHANGE = { OPTIDX: "FO", OPTSTK: "FO", FUTIDX: "FO", FUTSTK: "FO", OPTCUR: "CD", FUTCUR: "CD" };

/** (exchange, instrument_segment) -> contract exchange. */
export function exchangeOf(exchange, segment) {
  const ex = String(exchange ?? "").toUpperCase();
  const kind = SEGMENT_EXCHANGE[String(segment ?? "").toUpperCase().replace(/[^A-Z]/g, "")];
  if (ex === "MCX") return "MCX";
  if (kind === "CD") return "CDS";
  if (kind === "FO") return ex === "BSE" ? "BFO" : "NFO";
  return ex === "BSE" ? "BSE" : "NSE";
}

const PRODUCT_OF = { DELIVERY: "CNC", "COLL-SELL": "CNC", ENCASH: "CNC", INTRADAY: "INTRADAY", OVERNIGHT: "MARGIN", MTF: "MTF", COVER: "CO" };
export const productOf = (p) => PRODUCT_OF[String(p ?? "").toUpperCase()] ?? "INTRADAY";

/**
 * InvestRight status text -> contract status. The checks run from most to least specific:
 *  - a rejected or failed cancel/modify leaves the original order standing, so it is OPEN, not REJECTED;
 *  - a cancel still in flight is OPEN; a finished cancel is CANCELLED;
 *  - "trigger" means a stop order waiting for its trigger; "part" means a partial fill;
 *  - traded/executed/complete is a full fill; the remaining live-order words are OPEN.
 */
const LIVE_WORDS = /\b(PENDING|OPEN|PLACED|ACCEPTED|CONFIRMED|RECEIVED|MODIFIED|TRANSIT|VALIDATION)\b/;

function classifyStatus(raw) {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z]+/g, " ").trim();
  if (!s) return "UNKNOWN";
  const aboutAmendment = /^(CANCEL|MODIFY)\b/.test(s);
  if (s.includes("REJECT")) return aboutAmendment ? "OPEN" : "REJECTED";
  if (s.includes("CANCEL")) return /PENDING|REQ/.test(s) ? "OPEN" : "CANCELLED";
  if (s.includes("TRIGGER")) return "TRIGGER_PENDING";
  if (/\bPART/.test(s)) return "PARTIALLY_FILLED";
  if (s.includes("EXPIRED")) return "EXPIRED";
  if (/\b(TRADED|EXECUTED|COMPLETED?)\b/.test(s)) return "COMPLETE";
  if (LIVE_WORDS.test(s)) return "OPEN";
  return "UNKNOWN";
}

export function orderStatusOf(status, filled = 0, pending = 0) {
  const s = classifyStatus(status);
  if (s === "OPEN" && filled > 0 && pending > 0) return "PARTIALLY_FILLED";
  return s;
}

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "30 APR 2024" | "27-JUN-24" | "2024-04-30" -> "2024-04-30" (or "" when unparseable). */
export function bookExpiryIso(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\s-]([A-Z]{3})[\s-](\d{2}|\d{4})$/);
  if (!m || !MONTHS[m[2]]) return "";
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
}

/** "30/04/2024 12:40:12" (IST) -> "2024-04-30T12:40:12+05:30"; other strings pass through. */
export function istTimestamp(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  return s || null;
}

const OPT_OF = { CALL: "CE", PUT: "PE", CE: "CE", PE: "PE" };

/** Readable symbol from a book row: "BANKNIFTY 30 APR 2024 49900 CE", or the security id for cash. */
export function bookSymbol(row) {
  const underlying = String(row.underlying_symbol || row.company_name || row.security_id || "").trim();
  const expiry = bookExpiryIso(row.expiry_date);
  if (!expiry) return String(row.company_name || row.tradingsymbol || row.security_id || row.isin || "").trim();
  const [y, m, d] = expiry.split("-");
  const mon = Object.keys(MONTHS)[Number(m) - 1];
  const opt = OPT_OF[String(row.option_type ?? "").toUpperCase()];
  const strike = n(row.strike_price);
  return opt ? `${underlying} ${d} ${mon} ${y} ${strike} ${opt}` : `${underlying} ${d} ${mon} ${y} FUT`;
}

const side = (t) => (String(t ?? "").toUpperCase().startsWith("S") ? "SELL" : "BUY");

export function mapPosition(p) {
  const netQty = n(p.net_qty);
  const realised = n(p.realised_pl_overall_position);
  return {
    tradingSymbol: bookSymbol(p),
    exchange: exchangeOf(p.exchange, p.instrument_segment),
    token: String(p.security_id ?? ""),
    product: productOf(p.product),
    netQty,
    avgPrice: netQty > 0 ? n(p.average_buy_price) : netQty < 0 ? n(p.average_sell_price) : 0,
    ltp: null,
    pnl: realised,
    realisedPnl: realised,
    unrealisedPnl: null,
  };
}

export function mapHolding(h) {
  const isin = h.isin ? String(h.isin) : null;
  return {
    tradingSymbol: String(h.company_name || h.security_id || isin || ""),
    exchange: String(h.exchange).toUpperCase() === "BSE" ? "BSE" : "NSE",
    token: String(h.security_id || isin || ""),
    isin,
    qty: n(h.quantity),
    avgPrice: n(h.average_price),
    ltp: null,
    pnl: null,
  };
}

export function mapFunds(json) {
  const eq = json?.data?.equity ?? {};
  return {
    availableCash: n(eq.total_available_limit),
    usedMargin: n(eq.total_utilised_limit),
    totalBalance: nOrNull(eq.total_limit),
    collateral: nOrNull(eq.totalLimitDetails?.pledge_limit),
    withdrawable: null,
  };
}

export function mapOrder(o) {
  const qty = n(o.quantity);
  const filledQty = n(o.filled_quantity);
  const pendingQty = o.pending_quantity !== undefined ? n(o.pending_quantity) : Math.max(qty - filledQty, 0);
  return {
    orderId: String(o.order_id ?? ""),
    tradingSymbol: bookSymbol(o),
    exchange: exchangeOf(o.exchange, o.instrument_segment),
    token: String(o.security_id || o.tradingsymbol || ""),
    side: side(o.transaction_type),
    qty,
    filledQty,
    pendingQty,
    price: n(o.price),
    triggerPrice: n(o.trigger_price),
    avgPrice: n(o.average_price),
    orderType: String(o.order_type || "UNKNOWN").toUpperCase(),
    product: productOf(o.product),
    status: orderStatusOf(o.status, filledQty, pendingQty),
    statusMessage: o.status_message ? String(o.status_message) : null,
    placedAt: istTimestamp(o.order_timestamp),
  };
}

export function mapTrade(t) {
  return {
    tradeId: String(t.trade_id ?? ""),
    orderId: String(t.order_id ?? ""),
    tradingSymbol: bookSymbol(t),
    exchange: exchangeOf(t.exchange, t.instrument_segment),
    token: String(t.security_id ?? ""),
    side: side(t.transaction_type),
    qty: n(t.filled_quantity),
    price: n(t.average_price),
    tradedAt: istTimestamp(t.fill_timestamp),
  };
}

export async function fetchPositions(creds) {
  const json = await irRequest(creds, "GET", "/oapi/v1/portfolio/cumulative-positions");
  const rows = Array.isArray(json?.data?.net) ? json.data.net : Array.isArray(json?.data) ? json.data : [];
  return { status: "success", data: rows.map(mapPosition) };
}

export async function fetchHoldings(creds) {
  return { status: "success", data: list(await irRequest(creds, "GET", "/oapi/v1/portfolio/holdings")).map(mapHolding) };
}

export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds(await irRequest(creds, "GET", "/oapi/v1/user/margins")) };
}

export async function fetchRawOrders(creds) {
  return list(await irRequest(creds, "GET", "/oapi/v1/orders"));
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await fetchRawOrders(creds)).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  return { status: "success", data: list(await irRequest(creds, "GET", "/oapi/v1/trades")).map(mapTrade) };
}
