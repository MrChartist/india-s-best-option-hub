/**
 * Definedge Securities (Integrate API) orders (real money, gated), order book / trade book and portfolio reads.
 *
 * Official sources (checked 2026-10): pyintegrate 3.0.0 (Definedge, MIT) integrate/orders.py and
 * tests/mock_responses/{place_order,modify_order,cancel_order,orders,trades,positions,holdings,limits}.json.
 *  - POST /placeorder { exchange, tradingsymbol, order_type: BUY|SELL, price, price_type: MARKET|LIMIT|SL-MARKET|SL-LIMIT,
 *    product_type: CNC|INTRADAY|NORMAL, quantity, validity: DAY|IOC|EOS, trigger_price?, algo_id } -> { status, order_id }
 *    pyintegrate refuses a blank algo_id (exchange algo-ID rules); it is sent when creds.algoId is saved.
 *  - POST /modify { exchange, order_id, order_type, price, price_type, product_type, quantity, tradingsymbol, trigger_price? }
 *  - GET  /cancel/{order_id} (Definedge cancels with a GET)
 *  - GET  /orders -> { orders: [...] }, /trades -> { trades: [...] }, /positions -> { positions: [...] },
 *    /holdings -> { data: [...] }, /limits -> { cash, payin, payout, ... }
 *  - Order statuses: NEW, OPEN, COMPLETE, CANCELED, REJECTED, REPLACED (plus TRIGGER PENDING for SL orders, per OpenAlgo).
 * Only LIMIT and SL-LIMIT DAY orders are built. Every real-money call is wrapped with withOrderGate(); no route
 * mints Definedge gates today.
 */

import { BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { definedgeFetch } from "./definedgeAuth.mjs";
import { getLimits } from "./definedgeQuotes.mjs";

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(parseFloat(v)) ? null : parseFloat(v));
const bad = (m) => new BrokerInputError(m);

const PRODUCT_CODE = { CNC: "CNC", INTRADAY: "INTRADAY", MARGIN: "NORMAL" };
const PRODUCT_NAME = { CNC: "CNC", INTRADAY: "INTRADAY", NORMAL: "MARGIN" };
const PRICE_TYPE = { LIMIT: "LIMIT", STOPLOSS_LIMIT: "SL-LIMIT" };
const PRICE_TYPE_NAME = { LIMIT: "LIMIT", MARKET: "MARKET", "SL-LIMIT": "STOPLOSS_LIMIT", "SL-MARKET": "STOPLOSS_MARKET" };
const ORDER_EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX"]);
const ORDER_ID_RE = /^[A-Za-z0-9]{1,30}$/;

export const ORDER_FEATURES = {
  bracket: false,
  cover: false,
  ioc: false, // IOC and EOS validities exist; every order here rests with DAY validity.
  mtf: false,
  nativeMarketProtection: false, // market_protection is documented for BSE/MCX only and not used here.
  maxLegQty: null,
  products: ["CNC", "INTRADAY", "MARGIN"],
};

function common({ tradingSymbol, exchange, side, orderType, product, price, triggerPrice }) {
  if (typeof tradingSymbol !== "string" || !/^[A-Z0-9&_.-]{1,40}$/.test(tradingSymbol)) throw bad(`Invalid Definedge trading symbol: ${tradingSymbol}`);
  if (!ORDER_EXCHANGES.has(exchange)) throw bad(`Invalid exchange: ${exchange}`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (orderType === "MARKET" || orderType === "STOPLOSS_MARKET") throw bad("Market orders are not sent from this app. Use a limit order.");
  if (!PRICE_TYPE[orderType]) throw bad(`Unsupported Definedge order type: ${orderType} (LIMIT or STOPLOSS_LIMIT)`);
  if (!PRODUCT_CODE[product]) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  const fno = exchange === "NFO" || exchange === "BFO" || exchange === "MCX";
  if (product === "CNC" && fno) throw bad("CNC is for cash equity only; use MARGIN (NORMAL) or INTRADAY for F&O");
  if (product === "MARGIN" && !fno) throw bad("MARGIN (NORMAL) is for derivatives only; use CNC or INTRADAY for equity");
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required for a limit order");
  const stop = orderType === "STOPLOSS_LIMIT";
  if (stop && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for STOPLOSS_LIMIT");
  if (stop && side === "BUY" && triggerPrice > price) throw bad("For an SL-LIMIT buy the trigger price cannot be above the limit price");
  if (stop && side === "SELL" && triggerPrice < price) throw bad("For an SL-LIMIT sell the trigger price cannot be below the limit price");
  const body = { exchange, tradingsymbol: tradingSymbol, order_type: side, price, price_type: PRICE_TYPE[orderType], product_type: PRODUCT_CODE[product] };
  if (stop) body.trigger_price = triggerPrice;
  return body;
}

/** Pure body builder. `resolvedLotSize` comes from the instrument master; `algoId` from creds.algoId when saved. */
export function buildOrderBody(order, resolvedLotSize, algoId) {
  const { orderType = "LIMIT", product = "INTRADAY", lots } = order || {};
  const body = common({ ...order, orderType, product });
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  body.quantity = Math.round(lots * resolvedLotSize);
  body.validity = "DAY";
  if (algoId) body.algo_id = String(algoId);
  return body;
}

/** Pure modify body. changes: { tradingSymbol, exchange, side, orderType, product, price, qty (units), triggerPrice? } */
export function buildModifyBody(orderId, changes) {
  if (!ORDER_ID_RE.test(String(orderId ?? ""))) throw bad("Invalid Definedge order id");
  const { orderType = "LIMIT", product = "INTRADAY", qty } = changes || {};
  const body = common({ ...changes, orderType, product });
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  return { ...body, order_id: String(orderId), quantity: qty, validity: "DAY" };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const algoId = /^[A-Za-z0-9]{1,20}$/.test(String(creds?.algoId ?? "")) ? creds.algoId : undefined;
  const json = await definedgeFetch(creds, "/placeorder", { method: "POST", body: buildOrderBody(order, resolvedLotSize, algoId), what: "place order" });
  const orderId = String(json?.order_id ?? "");
  if (!orderId) throw new BrokerInputError(`Definedge accepted the request but returned no order id. ${ORDER_BOOK_HINT}`);
  return { orderId, orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const json = await definedgeFetch(creds, "/modify", { method: "POST", body: buildModifyBody(orderId, changes), what: "modify order" });
  return { orderId: String(json?.order_id ?? orderId), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  if (!ORDER_ID_RE.test(String(orderId ?? ""))) throw bad("Invalid Definedge order id");
  const json = await definedgeFetch(creds, `/cancel/${encodeURIComponent(String(orderId))}`, { what: "cancel order" });
  return { orderId: String(json?.order_id ?? orderId), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "definedge" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "definedge" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "definedge" });

// ── reads ──

export function mapOrderStatus(o) {
  const s = String(o?.order_status || "").toUpperCase().replace(/[\s-]+/g, "_");
  const filled = num(o?.filled_qty);
  switch (s) {
    case "COMPLETE": return "COMPLETE";
    case "CANCELED": case "CANCELLED": return "CANCELLED";
    case "REJECTED": return "REJECTED";
    case "TRIGGER_PENDING": return "TRIGGER_PENDING";
    case "NEW": case "OPEN": case "REPLACED": return filled > 0 ? "PARTIALLY_FILLED" : "OPEN";
    default: return "UNKNOWN";
  }
}

const product = (p) => PRODUCT_NAME[String(p || "").toUpperCase()] || "MARGIN";
const sideOf = (s) => (String(s || "").toUpperCase() === "SELL" ? "SELL" : "BUY");
const epochIso = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 1e9 ? new Date(n * 1000).toISOString() : null;
};

export function toOrder(o) {
  const qty = num(o.quantity);
  const filledQty = num(o.filled_qty);
  return {
    orderId: String(o.order_id ?? ""),
    tradingSymbol: String(o.tradingsymbol || ""),
    exchange: String(o.exchange || ""),
    token: String(o.token ?? ""),
    side: sideOf(o.order_type),
    qty,
    filledQty,
    pendingQty: o.pending_qty !== undefined ? num(o.pending_qty) : Math.max(0, qty - filledQty),
    price: num(o.price),
    triggerPrice: num(o.trigger_price),
    avgPrice: num(o.average_traded_price),
    orderType: PRICE_TYPE_NAME[String(o.price_type || "").toUpperCase()] || String(o.price_type || "UNKNOWN"),
    product: product(o.product_type),
    status: mapOrderStatus(o),
    statusMessage: o.message ? String(o.message) : o.reason ? String(o.reason) : null,
    placedAt: epochIso(o.order_entry_time) ?? (o.exchange_time ? String(o.exchange_time) : null),
  };
}

export async function fetchOrderBook(creds) {
  const json = await definedgeFetch(creds, "/orders", { what: "order book" });
  return { status: "success", data: (Array.isArray(json?.orders) ? json.orders : []).map(toOrder).filter((o) => o.orderId && o.token) };
}

export async function fetchTradeBook(creds) {
  const json = await definedgeFetch(creds, "/trades", { what: "trade book" });
  const data = (Array.isArray(json?.trades) ? json.trades : []).map((t) => ({
    tradeId: String(t.fill_id ?? "").trim(),
    orderId: String(t.order_id ?? "").trim(),
    tradingSymbol: String(t.tradingsymbol || ""),
    exchange: String(t.exchange || ""),
    token: String(t.token ?? ""),
    side: sideOf(t.order_type),
    qty: num(t.last_fill_qty ?? t.filled_qty),
    price: num(t.fill_price),
    tradedAt: t.fill_time ? String(t.fill_time) : null,
  }));
  return { status: "success", data: data.filter((t) => t.tradeId && t.orderId && t.token) };
}

export async function fetchPositions(creds) {
  const json = await definedgeFetch(creds, "/positions", { what: "positions" });
  const data = (Array.isArray(json?.positions) ? json.positions : []).map((p) => {
    const realised = numOrNull(p.realized_pnl);
    const unrealised = numOrNull(p.unrealized_pnl);
    return {
      tradingSymbol: String(p.tradingsymbol || ""),
      exchange: String(p.exchange || ""),
      token: String(p.token ?? ""),
      product: product(p.product_type),
      netQty: num(p.net_quantity),
      avgPrice: num(p.net_averageprice),
      ltp: numOrNull(p.lastPrice),
      pnl: Math.round(((realised ?? 0) + (unrealised ?? 0)) * 100) / 100,
      realisedPnl: realised === null ? null : realised || 0,
      unrealisedPnl: unrealised,
    };
  });
  return { status: "success", data: data.filter((p) => p.token) };
}

export async function fetchHoldings(creds) {
  const json = await definedgeFetch(creds, "/holdings", { what: "holdings" });
  const data = [];
  for (const h of Array.isArray(json?.data) ? json.data : []) {
    const syms = Array.isArray(h.tradingsymbol) ? h.tradingsymbol : [];
    const s = syms.find((x) => x.exchange === "NSE") || syms[0];
    if (!s?.token) continue;
    data.push({
      tradingSymbol: String(s.tradingsymbol || ""),
      exchange: String(s.exchange || "NSE"),
      token: String(s.token),
      isin: s.isin ? String(s.isin) : null,
      qty: num(h.dp_qty) + num(h.t1_qty),
      avgPrice: num(h.avg_buy_price),
      ltp: null, // not in the holdings payload
      pnl: null,
    });
  }
  return { status: "success", data };
}

export async function fetchFunds(creds) {
  const l = await getLimits(creds);
  return {
    status: "success",
    data: {
      availableCash: num(l.cash), // the /limits sample carries cash, payin, payout, brokerCollateralAmount, dayCash, ...
      usedMargin: num(l.marginused ?? l.marginUsed), // not in the documented sample; 0 when absent
      totalBalance: null,
      collateral: numOrNull(l.brokerCollateralAmount),
      withdrawable: null,
    },
  };
}
