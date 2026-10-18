/**
 * HDFC Sky: read-only portfolio calls mapped onto the contract shapes.
 *
 * Official docs (https://developer.hdfcsky.com/sky-docs/docs/...):
 *  - portfolio/fetchpositionsnetwise: GET /oapi/v1/positions?client_id&type=historical -> {data:[...]}
 *    (net-wise; type=live is the day-wise book). Rows carry ltp, net_quantity, average_buy_price,
 *    average_sell_price, realized_mtm, multiplier, product CNC|MIS|NRML, token.
 *  - portfolio/fetchdematholdings: GET /oapi/v1/holdings?client_id -> {data:{holdings:[...]}}.
 *  - funds/fetchfundsv2: GET /oapi/v2/funds/view?client_id&type=all -> {data:{values:[{"0":label,"1":value}]}}.
 *    The docs' sample is not valid JSON (no commas between rows); OpenAlgo reports that v2 answers 404
 *    in production and that v1 (/oapi/v1/funds/view, also documented) returns [label, value] pairs.
 *    We call v2 as documented and fall back to v1 on a 404, accepting both row shapes.
 *  - orders/order_book/fetchpendingorder + fetchcompletedorder: GET /oapi/v1/orders?type=pending|completed
 *    &client_id -> {data:{orders:[...]}}; orders/order_book/tradebook: GET /oapi/v1/trades?client_id ->
 *    {data:{trades:[...]}}. Times are epoch seconds.
 *  Order status: the docs do not enumerate order_status. Their samples show CONFIRMED (fetchpendingorder) and
 *  COMPLETE (fetchcompletedorder, orderhistory), and our fixtures use the same two. The OMS also sends longer
 *  compound strings (OpenAlgo reports, for example, CANCEL_CONFIRMED and SL_TRIGGER_CONFIRMED), so orderStatusOf
 *  classifies a status by the words it contains rather than by a fixed list. Anything it cannot place is UNKNOWN.
 */

import { BrokerError } from "./contract.mjs";
import { requireClientId, skyRequest } from "./hdfcskyClient.mjs";

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
export const exchangeOf = (e) => {
  const x = String(e ?? "").toUpperCase();
  if (x === "NCD") return "CDS";
  return EXCHANGES.has(x) ? x : "NSE";
};
const PRODUCT_OF = { CNC: "CNC", MIS: "INTRADAY", NRML: "MARGIN", MTF: "MTF", CO: "CO", BO: "BO" };
export const productOf = (p) => PRODUCT_OF[String(p ?? "").toUpperCase()] ?? "INTRADAY";
const side = (s) => (String(s ?? "").toUpperCase().startsWith("S") ? "SELL" : "BUY");
const epochIso = (s) => (Number(s) > 1e9 ? new Date(Number(s) * 1000).toISOString() : null);

/**
 * HDFC Sky order_status -> contract OrderStatus, decided by the words in the status (checked in this order):
 *  - a rejected or failed modify/cancel REQUEST leaves the order itself working  -> OPEN
 *  - any other rejection                                                       -> REJECTED
 *  - a cancel still in flight (pending/accepted/requested)                     -> OPEN
 *  - any other cancel                                                          -> CANCELLED
 *  - expiry, partial fill, full fill and stop-loss trigger words               -> their own states
 *  - received/accepted/confirmed/pending/modified/validated and similar        -> OPEN (still working)
 * An OPEN order that has filled some and has some left is PARTIALLY_FILLED.
 */
const STATUS_RULES = [
  [/^(MODIFY|CANCEL)_REJECT/, "OPEN"],
  [/REJECT/, "REJECTED"],
  [/CANCEL.*(PENDING|ACCEPTED|REQ)/, "OPEN"],
  [/CANCEL/, "CANCELLED"],
  [/EXPIRE/, "EXPIRED"],
  [/PARTIAL/, "PARTIALLY_FILLED"],
  [/^(COMPLETE|COMPLETED|TRADED|EXECUTED|FILLED)$/, "COMPLETE"],
  [/TRIGGER/, "TRIGGER_PENDING"],
  [/RECEIVED|ACCEPTED|CONFIRMED|PENDING|MODIFIED|VALIDATION|^OPEN$/, "OPEN"],
];

export function orderStatusOf(status, filled = 0, remaining = 0) {
  const raw = String(status ?? "").trim().toUpperCase();
  const s = (raw && STATUS_RULES.find(([re]) => re.test(raw))?.[1]) || "UNKNOWN";
  return s === "OPEN" && filled > 0 && remaining > 0 ? "PARTIALLY_FILLED" : s;
}

export function mapPosition(p) {
  const netQty = n(p.net_quantity);
  const avgPrice = netQty > 0 ? n(p.average_buy_price) : netQty < 0 ? n(p.average_sell_price) : 0;
  const ltp = n(p.ltp) > 0 ? n(p.ltp) : null;
  const realised = n(p.realized_mtm);
  const unrealised = ltp !== null && netQty !== 0 ? (ltp - avgPrice) * netQty * (n(p.multiplier) || 1) : ltp !== null ? 0 : null;
  return {
    tradingSymbol: String(p.trading_symbol || p.symbol || ""),
    exchange: exchangeOf(p.exchange),
    token: String(p.token ?? p.instrument_token ?? ""),
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
  const qty = n(h.quantity);
  const avgPrice = n(h.buy_avg);
  const ltp = n(h.ltp) > 0 ? n(h.ltp) : null;
  return {
    tradingSymbol: String(h.trading_symbol || h.symbol || h.isin || ""),
    exchange: String(h.exchange).toUpperCase() === "BSE" ? "BSE" : "NSE",
    token: String(h.token ?? h.instrument_details?.instrument_token ?? h.isin ?? ""),
    isin: h.isin ? String(h.isin) : null,
    qty,
    avgPrice,
    ltp,
    pnl: ltp === null ? null : (ltp - avgPrice) * qty,
  };
}

/** values rows -> Map<normalised label, number>; accepts {"0","1"} objects and [label, value] pairs. */
export function fundsTable(values) {
  const out = new Map();
  for (const row of Array.isArray(values) ? values : []) {
    const label = Array.isArray(row) ? row[0] : row?.["0"];
    const value = Array.isArray(row) ? row[1] : row?.["1"];
    if (label === undefined) continue;
    out.set(String(label).toLowerCase().replace(/[^a-z]/g, ""), n(value));
  }
  return out;
}

export function mapFunds(json) {
  const t = fundsTable(json?.data?.values);
  if (!t.size) throw new BrokerError("HDFC Sky funds: unexpected response shape");
  const get = (k) => (t.has(k) ? t.get(k) : null);
  return {
    availableCash: get("availablemargin") ?? 0,
    usedMargin: get("marginused") ?? 0,
    totalBalance: null,
    collateral: get("pledgebenefit"),
    withdrawable: null,
  };
}

export function mapOrder(o) {
  const qty = n(o.quantity);
  const filledQty = n(o.filled_quantity);
  const pendingQty = o.remaining_quantity !== undefined ? n(o.remaining_quantity) : Math.max(qty - filledQty, 0);
  return {
    orderId: String(o.oms_order_id ?? ""),
    tradingSymbol: String(o.trading_symbol ?? ""),
    exchange: exchangeOf(o.exchange),
    token: String(o.instrument_token ?? ""),
    side: side(o.order_side),
    qty,
    filledQty,
    pendingQty,
    price: n(o.price),
    triggerPrice: n(o.trigger_price),
    avgPrice: n(o.average_price || o.average_trade_price),
    orderType: String(o.order_type || "UNKNOWN").toUpperCase() === "SLM" ? "SL-M" : String(o.order_type || "UNKNOWN").toUpperCase(),
    product: productOf(o.product),
    status: orderStatusOf(o.order_status, filledQty, pendingQty),
    statusMessage: o.rejection_reason && o.rejection_reason !== "NONE" ? String(o.rejection_reason) : o.order_status_info ? String(o.order_status_info) : null,
    placedAt: epochIso(o.order_entry_time),
  };
}

export function mapTrade(t) {
  return {
    tradeId: String(t.trade_number ?? ""),
    orderId: String(t.oms_order_id ?? ""),
    tradingSymbol: String(t.trading_symbol ?? ""),
    exchange: exchangeOf(t.exchange),
    token: String(t.instrument_token ?? ""),
    side: side(t.order_side),
    qty: n(t.trade_quantity || t.filled_quantity),
    price: n(t.trade_price),
    tradedAt: epochIso(t.trade_time || t.exchange_time),
  };
}

export async function fetchPositions(creds) {
  const client_id = requireClientId(creds);
  const json = await skyRequest(creds, "GET", "/oapi/v1/positions", { params: { client_id, type: "historical" } });
  return { status: "success", data: (Array.isArray(json?.data) ? json.data : []).map(mapPosition) };
}

export async function fetchHoldings(creds) {
  const client_id = requireClientId(creds);
  const json = await skyRequest(creds, "GET", "/oapi/v1/holdings", { params: { client_id } });
  const rows = Array.isArray(json?.data?.holdings) ? json.data.holdings : Array.isArray(json?.data) ? json.data : [];
  return { status: "success", data: rows.map(mapHolding) };
}

export async function fetchFunds(creds) {
  const client_id = requireClientId(creds);
  let json;
  try {
    json = await skyRequest(creds, "GET", "/oapi/v2/funds/view", { params: { client_id, type: "all" } });
  } catch (e) {
    if (!(e instanceof BrokerError) || !/\[404\]/.test(e.message)) throw e;
    json = await skyRequest(creds, "GET", "/oapi/v1/funds/view", { params: { client_id, type: "all" } });
  }
  return { status: "success", data: mapFunds(json) };
}

/** Pending + completed books (the API serves them separately), de-duplicated by oms_order_id. */
export async function fetchRawOrders(creds, types = ["pending", "completed"]) {
  const client_id = requireClientId(creds);
  const seen = new Map();
  for (const type of types) {
    const json = await skyRequest(creds, "GET", "/oapi/v1/orders", { params: { type, client_id } });
    for (const o of Array.isArray(json?.data?.orders) ? json.data.orders : []) seen.set(String(o.oms_order_id), o);
  }
  return [...seen.values()];
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await fetchRawOrders(creds)).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  const client_id = requireClientId(creds);
  const json = await skyRequest(creds, "GET", "/oapi/v1/trades", { params: { client_id } });
  return { status: "success", data: (Array.isArray(json?.data?.trades) ? json.data.trades : []).map(mapTrade) };
}
