/**
 * mStock (Mirae Asset) Type B orders (real money, gated).
 *
 * Official docs (https://tradingapi.mstock.com/docs/v1/typeB/Orders/, checked 2026-10):
 *  - Place:  /orders/regular { variety, tradingsymbol, symboltoken, exchange, transactiontype, ordertype,
 *            quantity, producttype, price, triggerprice, squareoff, stoploss, trailingStopLoss,
 *            disclosedquantity, duration, ordertag } -> data { script, orderid, uniqueorderid }.
 *            The endpoint table says GET but every cURL sample sends the body as a POST (curl --data), so
 *            POST is used (a GET with an order body is not something to guess at).
 *  - Modify: PUT /orders/regular/{orderid} { variety, tradingsymbol, symboltoken, exchange, transactiontype,
 *            orderid, ordertype, quantity, producttype, duration, price, triggerprice, disclosedquantity,
 *            modqty_remng }. The original order's fields are read from GET /orders first.
 *  - Cancel: DELETE /orders/regular/{orderid} { variety, orderid }.
 *  - Glossary: variety NORMAL | AMO | STOPLOSS; ordertype MARKET | LIMIT | STOPLOSS_LIMIT | STOPLOSS_MARKET;
 *            producttype DELIVERY | INTRADAY | MARGIN | CARRYFORWARD; duration DAY | IOC; all values strings.
 *  - quantity is in units ("Number of shares for the order").
 * Every call is wrapped with withOrderGate(); no route mints mStock gates today. A successful reply only
 * proves the request was accepted, so orderStatus is UNKNOWN until the order book is read.
 */

import { BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { authRequest } from "./mstockAuth.mjs";

const PRODUCT_CODE = { CNC: "DELIVERY", INTRADAY: "INTRADAY", MARGIN: "CARRYFORWARD" };
const ORDER_TYPES = { LIMIT: "LIMIT", MARKET: "MARKET", STOPLOSS_LIMIT: "STOPLOSS_LIMIT", STOP_LOSS: "STOPLOSS_LIMIT", SL: "STOPLOSS_LIMIT",
  STOPLOSS_MARKET: "STOPLOSS_MARKET", STOP_LOSS_MARKET: "STOPLOSS_MARKET", "SL-M": "STOPLOSS_MARKET" };
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO"]);
const VALIDITY = new Set(["DAY", "IOC"]);

/** Legacy order-feature descriptor (conservative, from the Orders glossary). */
export const ORDER_FEATURES = {
  bracket: false, // no bracket variety in the Type B glossary
  cover: false,
  ioc: true, // duration IOC is documented
  mtf: false, // producttype MARGIN (margin delivery) exists but is not offered here
  nativeMarketProtection: false, // no market-protection field documented
  maxLegQty: null, // no per-order cap documented beyond exchange freeze limits
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const isPositive = (v) => Number.isFinite(v) && v > 0;

function normaliseOrderType(t) {
  const out = ORDER_TYPES[String(t ?? "LIMIT").toUpperCase()];
  if (!out) throw bad(`Unsupported mStock order type: ${t} (LIMIT, MARKET, STOPLOSS_LIMIT or STOPLOSS_MARKET)`);
  return out;
}

/**
 * Pure body builder. order: { tradingSymbol, token, exchange, side, orderType, product, validity, lots, price,
 * triggerPrice?, tag? }. `resolvedLotSize` must come from the scrip master, never from the client.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { tradingSymbol, token, exchange, side, orderType, product = "INTRADAY", validity = "DAY", lots, price, triggerPrice, tag } = order || {};
  if (typeof tradingSymbol !== "string" || !/^[A-Za-z0-9&_.\- ]{1,50}$/.test(tradingSymbol)) throw bad(`Invalid mStock trading symbol: ${tradingSymbol}`);
  if (!/^\d{1,12}$/.test(String(token ?? ""))) throw bad("Invalid mStock symbol token");
  if (!EXCHANGES.has(exchange)) throw bad(`Invalid exchange: ${exchange}`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const ordertype = normaliseOrderType(orderType);
  const producttype = PRODUCT_CODE[product];
  if (!producttype) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  if (!VALIDITY.has(validity)) throw bad(`Unsupported validity: ${validity} (DAY or IOC)`);
  if (!isPositive(resolvedLotSize)) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  const isLimit = ordertype === "LIMIT" || ordertype === "STOPLOSS_LIMIT";
  const isStop = ordertype.startsWith("STOPLOSS");
  if (isLimit && !isPositive(price)) throw bad(`price required for ${ordertype}`);
  if (isStop && !isPositive(triggerPrice)) throw bad(`triggerPrice required for ${ordertype}`);
  if (tag !== undefined && !/^[A-Za-z0-9]{1,19}$/.test(String(tag))) throw bad("ordertag must be 1-19 letters or digits");
  return {
    variety: isStop ? "STOPLOSS" : "NORMAL",
    tradingsymbol: tradingSymbol,
    symboltoken: String(token),
    exchange,
    transactiontype: side,
    ordertype,
    quantity: String(Math.round(lots * resolvedLotSize)),
    producttype,
    price: isLimit ? String(price) : "0",
    triggerprice: isStop ? String(triggerPrice) : "0",
    squareoff: "0",
    stoploss: "0",
    trailingStopLoss: "",
    disclosedquantity: "",
    duration: validity,
    ordertag: tag !== undefined ? String(tag) : "",
  };
}

const ORDER_ID_RE = /^[A-Za-z0-9]{1,30}$/;
const REVERSE_PRODUCT = { DELIVERY: "DELIVERY", CNC: "DELIVERY", INTRADAY: "INTRADAY", MARGIN: "MARGIN", CARRYFORWARD: "CARRYFORWARD", NRML: "CARRYFORWARD" };
const REVERSE_ORDER_TYPE = { SL: "STOPLOSS_LIMIT", "SL-M": "STOPLOSS_MARKET", LIMIT: "LIMIT", MARKET: "MARKET", STOPLOSS_LIMIT: "STOPLOSS_LIMIT", STOPLOSS_MARKET: "STOPLOSS_MARKET", LMT: "LIMIT", MKT: "MARKET" };

/**
 * Pure modify body. `original` is the order-book row; changes: { orderType?, price?, qty? (total units),
 * triggerPrice?, validity? }.
 */
export function buildModifyBody(orderId, changes, original) {
  const orderid = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(orderid)) throw bad("Invalid mStock order id");
  if (!original) throw bad(`mStock order ${orderid} is not in today's order book`);
  const { orderType, price, qty, triggerPrice, validity } = changes || {};
  const ordertype = orderType !== undefined ? normaliseOrderType(orderType) : REVERSE_ORDER_TYPE[String(original.ordertype ?? "").toUpperCase()];
  if (!ordertype) throw bad(`Cannot modify an mStock order of type ${original.ordertype}`);
  const quantity = qty !== undefined ? qty : Number(original.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) throw bad("qty must be a positive whole number of units");
  const newPrice = price !== undefined ? price : Number(original.price);
  const newTrigger = triggerPrice !== undefined ? triggerPrice : Number(original.triggerprice);
  const isLimit = ordertype === "LIMIT" || ordertype === "STOPLOSS_LIMIT";
  const isStop = ordertype.startsWith("STOPLOSS");
  if (isLimit && !isPositive(newPrice)) throw bad("price required");
  if (isStop && !isPositive(newTrigger)) throw bad("triggerPrice required");
  const duration = validity ?? original.duration ?? "DAY";
  if (!VALIDITY.has(duration)) throw bad(`Unsupported validity: ${duration}`);
  const producttype = REVERSE_PRODUCT[String(original.producttype ?? "").toUpperCase()];
  if (!producttype) throw bad(`Unknown product on mStock order ${orderid}`);
  return {
    variety: isStop ? "STOPLOSS" : "NORMAL",
    tradingsymbol: String(original.tradingsymbol ?? ""),
    symboltoken: String(original.symboltoken ?? ""),
    exchange: String(original.exchange ?? ""),
    transactiontype: String(original.transactiontype ?? "").toUpperCase(),
    orderid,
    ordertype,
    quantity: String(quantity),
    producttype,
    duration,
    price: isLimit ? String(newPrice) : "0",
    triggerprice: isStop ? String(newTrigger) : "0",
    disclosedquantity: "",
    modqty_remng: "0",
  };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const body = buildOrderBody(order, resolvedLotSize);
  const json = await authRequest(creds, "/orders/regular", { method: "POST", body });
  const orderId = String(json?.data?.orderid ?? "").trim();
  if (!orderId) throw new Error(`mStock accepted the request but returned no order id. ${ORDER_BOOK_HINT}`);
  return { orderId, orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid mStock order id");
  const book = await authRequest(creds, "/orders");
  const original = (Array.isArray(book?.data) ? book.data : []).find((r) => String(r?.orderid ?? "").trim() === id);
  const body = buildModifyBody(id, changes, original);
  const json = await authRequest(creds, `/orders/regular/${encodeURIComponent(id)}`, { method: "PUT", body });
  return { orderId: String(json?.data?.orderid ?? id).trim(), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId, { variety = "NORMAL" } = {}) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid mStock order id");
  if (!["NORMAL", "STOPLOSS", "AMO"].includes(variety)) throw bad(`Invalid variety: ${variety}`);
  const json = await authRequest(creds, `/orders/regular/${encodeURIComponent(id)}`, { method: "DELETE", body: { variety, orderid: id } });
  // A cancel request is not proof of cancellation; panic flows re-read the book.
  return { orderId: String(json?.data?.orderid ?? id).trim(), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "mstock" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "mstock" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "mstock" });
