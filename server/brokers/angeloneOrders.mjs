/**
 * Angel One (SmartAPI) orders (real money, gated) + order book / trade book (read-only).
 *
 * Official docs (https://smartapi.angelone.in/docs/Orders, checked 2026-10):
 *  - POST order/v1/placeOrder  { variety, tradingsymbol, symboltoken, transactiontype, exchange, ordertype,
 *    producttype, duration, price, triggerprice, squareoff, stoploss, quantity } -> data { script, orderid, uniqueorderid }
 *  - POST order/v1/modifyOrder { variety, orderid, ordertype, producttype, duration, price, quantity,
 *    tradingsymbol, symboltoken, exchange } (the instrument keys appear in the docs' sample and in Angel One's
 *    own smartapi-python test, test/api_test.py)
 *  - POST order/v1/cancelOrder { variety, orderid } — the variety must match the order's own variety, so a
 *    STOPLOSS order is cancelled with variety STOPLOSS. When the caller does not pass one, cancelOrder reads it
 *    from a fresh order-book row rather than assuming NORMAL.
 *  - GET  order/v1/getOrderBook / order/v1/getTradeBook
 *  - Enums: variety NORMAL | STOPLOSS | ROBO; ordertype MARKET | LIMIT | STOPLOSS_LIMIT | STOPLOSS_MARKET;
 *    producttype DELIVERY | CARRYFORWARD | MARGIN | INTRADAY | BO; duration DAY | IOC; exchange BSE NSE NFO MCX BFO.
 *  - Order status strings (order-status WebSocket table): open, cancelled, rejected, modified, complete,
 *    after market order req received, cancelled after market order, modify after market order req received,
 *    open pending, trigger pending, modify pending.
 *
 * Angel One's notice "What's changing in SmartAPI access from April 1, 2026" (angelone.in) states that market
 * and IOC orders are prohibited for API (algorithmic) trading and that orders must come from a registered
 * static IP. buildOrderBody therefore only builds LIMIT and STOPLOSS_LIMIT orders with DAY validity.
 * Every real-money call is wrapped with withOrderGate(); no route mints Angel One gates today.
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { authFetch } from "./angeloneAuth.mjs";
import { contractExchange, contractProduct, num } from "./angelonePortfolio.mjs";

const PLACE_PATH = "/rest/secure/angelbroking/order/v1/placeOrder";
const MODIFY_PATH = "/rest/secure/angelbroking/order/v1/modifyOrder";
const CANCEL_PATH = "/rest/secure/angelbroking/order/v1/cancelOrder";
const ORDERBOOK_PATH = "/rest/secure/angelbroking/order/v1/getOrderBook";
const TRADEBOOK_PATH = "/rest/secure/angelbroking/order/v1/getTradeBook";

// App product vocabulary -> Angel producttype. MTF (Angel "MARGIN") is equity-only and not offered here.
const PRODUCT_CODE = { CNC: "DELIVERY", MARGIN: "CARRYFORWARD", INTRADAY: "INTRADAY" };
const ORDER_TYPES = new Set(["LIMIT", "STOPLOSS_LIMIT"]);
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX"]);

/** Legacy order-feature descriptor. */
export const ORDER_FEATURES = {
  bracket: false, // ROBO/BO exists but is not built here.
  cover: false,
  ioc: false, // documented, but prohibited for API trading from 1 April 2026 (Angel One notice).
  mtf: false,
  nativeMarketProtection: false,
  maxLegQty: null, // per-scrip freeze_qty is in the master; no per-order API cap documented.
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);

/**
 * Pure body builder. `resolvedLotSize` comes from the instrument master (never the client).
 * order: { tradingSymbol, token, exchange, side, orderType: LIMIT|STOPLOSS_LIMIT, product: CNC|MARGIN|INTRADAY,
 *          lots, price, triggerPrice? }
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { tradingSymbol, token, exchange, side, orderType = "LIMIT", product = "INTRADAY", lots, price, triggerPrice } = order || {};
  checkInstrument(tradingSymbol, token, exchange);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (orderType === "MARKET" || orderType === "STOPLOSS_MARKET") {
    throw bad("Angel One does not accept market orders from API trading (SmartAPI change of 1 April 2026). Use a limit order.");
  }
  if (!ORDER_TYPES.has(orderType)) throw bad(`Unsupported Angel One ordertype: ${orderType} (LIMIT or STOPLOSS_LIMIT)`);
  const producttype = PRODUCT_CODE[product];
  if (!producttype) throw bad(`Unsupported product: ${product} (CNC, MARGIN or INTRADAY)`);
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  }
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required for a limit order");
  const stop = orderType === "STOPLOSS_LIMIT";
  if (stop && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for STOPLOSS_LIMIT");
  return {
    variety: stop ? "STOPLOSS" : "NORMAL",
    tradingsymbol: tradingSymbol,
    symboltoken: String(token),
    transactiontype: side,
    exchange,
    ordertype: orderType,
    producttype,
    duration: "DAY",
    price: String(price),
    triggerprice: stop ? String(triggerPrice) : "0",
    squareoff: "0",
    stoploss: "0",
    quantity: String(Math.round(lots * resolvedLotSize)),
  };
}

function checkInstrument(tradingSymbol, token, exchange) {
  if (typeof tradingSymbol !== "string" || !/^[A-Z0-9&_.-]{1,40}$/.test(tradingSymbol)) throw bad(`Invalid Angel One trading symbol: ${tradingSymbol}`);
  if (!/^\d{1,12}$/.test(String(token ?? ""))) throw bad("Invalid Angel One symbol token");
  if (!EXCHANGES.has(exchange)) throw bad(`Invalid exchange: ${exchange}`);
}

/**
 * Pure modify body.
 * changes: { tradingSymbol, token, exchange, orderType, product, price, qty (units), triggerPrice? }
 * The instrument keys are required by SmartAPI; modifyOrder fills them from the order book when absent.
 */
export function buildModifyBody(orderId, changes) {
  const orderid = String(orderId ?? "").trim();
  if (!/^[A-Za-z0-9]{1,30}$/.test(orderid)) throw bad("Invalid Angel One order id");
  const { tradingSymbol, token, exchange, orderType = "LIMIT", product = "INTRADAY", price, qty, triggerPrice } = changes || {};
  checkInstrument(tradingSymbol, token, exchange);
  if (!ORDER_TYPES.has(orderType)) throw bad(`Unsupported Angel One ordertype: ${orderType} (LIMIT or STOPLOSS_LIMIT)`);
  const producttype = PRODUCT_CODE[product];
  if (!producttype) throw bad(`Unsupported product: ${product}`);
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required");
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  const stop = orderType === "STOPLOSS_LIMIT";
  if (stop && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for STOPLOSS_LIMIT");
  const body = {
    variety: stop ? "STOPLOSS" : "NORMAL",
    orderid,
    ordertype: orderType,
    producttype,
    duration: "DAY",
    price: String(price),
    quantity: String(qty),
    tradingsymbol: tradingSymbol,
    symboltoken: String(token),
    exchange,
  };
  if (stop) body.triggerprice = String(triggerPrice);
  return body;
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const body = buildOrderBody(order, resolvedLotSize);
  const json = await authFetch(creds, PLACE_PATH, body);
  // Placement returns ids only; the state is unknown until the order book is read.
  return { orderId: String(json?.data?.orderid ?? ""), orderStatus: "UNKNOWN" };
}

const VARIETIES = new Set(["NORMAL", "STOPLOSS", "ROBO"]);

/** The raw order-book row for `orderid`, read fresh from Angel One (authoritative, never cached). */
async function findOrderRow(creds, orderid) {
  const json = await authFetch(creds, ORDERBOOK_PATH);
  const row = (Array.isArray(json?.data) ? json.data : []).find((r) => String(r?.orderid ?? "") === orderid);
  if (!row) throw bad(`Angel One order ${orderid} is not in today's order book`);
  return row;
}

async function modifyOrderImpl(creds, orderId, changes) {
  let c = changes || {};
  if (c.tradingSymbol == null || c.token == null || c.exchange == null) {
    const row = await findOrderRow(creds, String(orderId ?? "").trim());
    c = { tradingSymbol: row.tradingsymbol, token: row.symboltoken, exchange: row.exchange, ...c };
  }
  const json = await authFetch(creds, MODIFY_PATH, buildModifyBody(orderId, c));
  return { orderId: String(json?.data?.orderid ?? orderId), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId, opts = {}) {
  const orderid = String(orderId ?? "").trim();
  if (!/^[A-Za-z0-9]{1,30}$/.test(orderid)) throw bad("Invalid Angel One order id");
  let variety = opts?.variety;
  if (variety == null) variety = String((await findOrderRow(creds, orderid)).variety ?? "").toUpperCase();
  if (!VARIETIES.has(variety)) throw bad(`Invalid variety: ${variety}`);
  const json = await authFetch(creds, CANCEL_PATH, { variety, orderid });
  // A successful cancel request is not proof of cancellation; panic flows re-read the book.
  return { orderId: String(json?.data?.orderid ?? orderid), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "angelone" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "angelone" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "angelone" });

// ── books ──

const OPEN_STATES = new Set(["open", "open pending", "modified", "modify pending", "put order req received", "validation pending",
  "after market order req received", "modify after market order req received", "cancel pending"]);

export function mapOrderStatus(row) {
  const s = String(row?.orderstatus || row?.status || "").trim().toLowerCase();
  const filled = num(row?.filledshares);
  const unfilled = num(row?.unfilledshares);
  if (s === "complete") return "COMPLETE";
  if (s === "rejected") return "REJECTED";
  if (s === "cancelled" || s === "cancelled after market order") return "CANCELLED";
  if (s === "trigger pending") return "TRIGGER_PENDING";
  if (OPEN_STATES.has(s)) return filled > 0 && unfilled > 0 ? "PARTIALLY_FILLED" : "OPEN";
  return "UNKNOWN";
}

/** "20-Oct-2020 13:10:59" (IST) -> ISO with +05:30; raw value if it does not parse. */
export function angelTimeToIso(s) {
  const raw = String(s ?? "").trim();
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw);
  if (!m) return raw || null;
  const mi = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(m[2].toUpperCase());
  return mi < 0 ? raw : `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
}

export function mapOrder(row) {
  const qty = num(row?.quantity);
  const filledQty = num(row?.filledshares);
  return {
    orderId: String(row?.orderid ?? ""),
    tradingSymbol: String(row?.tradingsymbol ?? ""),
    exchange: contractExchange(row?.exchange),
    token: String(row?.symboltoken ?? row?.tradingsymbol ?? ""),
    side: String(row?.transactiontype).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty,
    filledQty,
    pendingQty: row?.unfilledshares != null ? num(row.unfilledshares) : Math.max(0, qty - filledQty),
    price: num(row?.price),
    triggerPrice: num(row?.triggerprice),
    avgPrice: num(row?.averageprice),
    orderType: String(row?.ordertype || "UNKNOWN"),
    product: contractProduct(row?.producttype),
    status: mapOrderStatus(row),
    statusMessage: row?.text ? String(row.text) : null,
    placedAt: angelTimeToIso(row?.exchtime || row?.updatetime) || null,
  };
}

export async function fetchOrderBook(creds) {
  const json = await authFetch(creds, ORDERBOOK_PATH);
  return { status: "success", data: (Array.isArray(json?.data) ? json.data : []).map(mapOrder) };
}

export function mapTrade(row) {
  return {
    tradeId: String(row?.fillid ?? ""),
    orderId: String(row?.orderid ?? ""),
    tradingSymbol: String(row?.tradingsymbol ?? ""),
    exchange: contractExchange(row?.exchange),
    token: String(row?.symboltoken ?? row?.tradingsymbol ?? ""),
    side: String(row?.transactiontype).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: num(row?.fillsize),
    price: num(row?.fillprice),
    tradedAt: row?.filltime ? String(row.filltime) : null, // documented as time of day only ("13:27:53", IST)
  };
}

export async function fetchTradeBook(creds) {
  const json = await authFetch(creds, TRADEBOOK_PATH);
  return { status: "success", data: (Array.isArray(json?.data) ? json.data : []).map(mapTrade) };
}
