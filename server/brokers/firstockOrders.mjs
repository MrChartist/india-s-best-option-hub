/**
 * Firstock orders (real money, gated).
 *
 * Official docs (https://firstock.in/api/docs/, checked 2026-10):
 *  - place-order/ : POST /placeOrder { userId, jKey, exchange, retention (DAY | IOC), product (C | I | M),
 *    priceType (MKT | LMT | SL-LMT | SL-MKT), tradingSymbol, transactionType (B | S), price, triggerPrice,
 *    quantity, remarks, mkt_protection } -> data { orderNumber, requestTime }, or data[] of
 *    { orderNumber, quantity } when the order is above the freeze quantity and Firstock slices it (max 10).
 *    mkt_protection is required and must be > 0 for MKT and SL-MKT ("MKT orders are converted to LMT ...
 *    adjusted by the mkt_protection percentage"). quantity is in units (a sliced sample returns 1755 =
 *    27 lots of 65).
 *  - modify-order/ : POST /modifyOrder { orderNumber, product, priceType, tradingSymbol, price, quantity,
 *    triggerPrice, retention, mkt_protection } -> data { orderNumber, rejreason?, requestTime }.
 *    The original order's product / symbol are read from POST /orderBook first.
 *  - cancel-order/ : POST /cancelOrder { orderNumber } -> data { orderNumber, rejreason?, requestTime }.
 *    A reply with `rejreason` ("order is not open to cancel") is a refusal, not a success.
 * Every call is wrapped with withOrderGate(); no route mints Firstock gates today.
 */

import { BrokerError, BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { callApi } from "./firstockAuth.mjs";

const PRODUCT_CODE = { CNC: "C", INTRADAY: "I", MARGIN: "M" };
const PRICE_TYPE = { LIMIT: "LMT", MARKET: "MKT", STOPLOSS_LIMIT: "SL-LMT", STOP_LOSS: "SL-LMT", SL: "SL-LMT",
  STOPLOSS_MARKET: "SL-MKT", STOP_LOSS_MARKET: "SL-MKT", "SL-M": "SL-MKT", LMT: "LMT", MKT: "MKT", "SL-LMT": "SL-LMT", "SL-MKT": "SL-MKT" };
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO"]);
const VALIDITY = new Set(["DAY", "IOC"]);
const MAX_MARKET_PROTECTION = 20;

export const ORDER_FEATURES = {
  bracket: false, // not built here
  cover: false,
  ioc: true, // retention IOC is documented
  mtf: false,
  nativeMarketProtection: true, // mkt_protection is a documented (and for MKT required) field
  maxLegQty: null, // Firstock slices above the freeze quantity itself (max 10 slices)
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const isPositive = (v) => Number.isFinite(v) && v > 0;

function priceTypeOf(t) {
  const out = PRICE_TYPE[String(t ?? "LIMIT").toUpperCase()];
  if (!out) throw bad(`Unsupported Firstock order type: ${t} (LIMIT, MARKET, STOPLOSS_LIMIT or STOPLOSS_MARKET)`);
  return out;
}

function protectionFor(priceType, value) {
  if (priceType !== "MKT" && priceType !== "SL-MKT") return undefined;
  const v = Number(value);
  if (!(v > 0 && v <= MAX_MARKET_PROTECTION)) throw bad(`marketProtectionPercent (0-${MAX_MARKET_PROTECTION}) is required for Firstock market orders`);
  return String(v);
}

/**
 * Pure body builder (without userId/jKey, which callApi adds). order: { tradingSymbol, exchange, side,
 * orderType, product, validity, lots, price, triggerPrice?, marketProtectionPercent?, tag? }.
 * `resolvedLotSize` must come from the symbol master, never from the client.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { tradingSymbol, exchange, side, orderType, product = "INTRADAY", validity = "DAY", lots, price, triggerPrice, marketProtectionPercent, tag } = order || {};
  if (typeof tradingSymbol !== "string" || !/^[A-Za-z0-9&_.-]{1,40}$/.test(tradingSymbol)) throw bad(`Invalid Firstock trading symbol: ${tradingSymbol}`);
  if (!EXCHANGES.has(exchange)) throw bad(`Invalid exchange: ${exchange}`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const priceType = priceTypeOf(orderType);
  const productCode = PRODUCT_CODE[product];
  if (!productCode) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  if (!VALIDITY.has(validity)) throw bad(`Unsupported validity: ${validity} (DAY or IOC)`);
  if (!isPositive(resolvedLotSize)) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  const isLimit = priceType === "LMT" || priceType === "SL-LMT";
  const isStop = priceType.startsWith("SL-");
  if (isLimit && !isPositive(price)) throw bad(`price required for ${priceType}`);
  if (isStop && !isPositive(triggerPrice)) throw bad(`triggerPrice required for ${priceType}`);
  const body = {
    exchange,
    retention: validity,
    product: productCode,
    priceType,
    tradingSymbol,
    transactionType: side === "BUY" ? "B" : "S",
    price: isLimit ? String(price) : "0",
    triggerPrice: isStop ? String(triggerPrice) : "0",
    quantity: String(Math.round(lots * resolvedLotSize)),
    remarks: tag !== undefined ? String(tag).slice(0, 40) : "",
  };
  const mp = protectionFor(priceType, marketProtectionPercent);
  if (mp !== undefined) body.mkt_protection = mp;
  return body;
}

const ORDER_ID_RE = /^[A-Za-z0-9]{1,30}$/;

/** Pure modify body. `original` is the order-book row; changes: { orderType?, price?, qty? (units), triggerPrice?, validity?, marketProtectionPercent? }. */
export function buildModifyBody(orderId, changes, original) {
  const orderNumber = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(orderNumber)) throw bad("Invalid Firstock order number");
  if (!original) throw bad(`Firstock order ${orderNumber} is not in today's order book`);
  const { orderType, price, qty, triggerPrice, validity, marketProtectionPercent } = changes || {};
  const priceType = priceTypeOf(orderType ?? original.priceType);
  const quantity = qty !== undefined ? qty : Number(original.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) throw bad("qty must be a positive whole number of units");
  const newPrice = price !== undefined ? price : Number(original.price);
  const newTrigger = triggerPrice !== undefined ? triggerPrice : Number(original.triggerPrice);
  const isLimit = priceType === "LMT" || priceType === "SL-LMT";
  const isStop = priceType.startsWith("SL-");
  if (isLimit && !isPositive(newPrice)) throw bad("price required");
  if (isStop && !isPositive(newTrigger)) throw bad("triggerPrice required");
  const retention = validity ?? original.retention ?? "DAY";
  if (!VALIDITY.has(retention)) throw bad(`Unsupported validity: ${retention}`);
  const body = {
    orderNumber,
    product: String(original.product ?? ""),
    priceType,
    tradingSymbol: String(original.tradingSymbol ?? ""),
    price: isLimit ? String(newPrice) : "0",
    quantity: String(quantity),
    triggerPrice: isStop ? String(newTrigger) : "0",
    retention,
  };
  const mp = protectionFor(priceType, marketProtectionPercent);
  if (mp !== undefined) body.mkt_protection = mp;
  return body;
}

function refusal(data, what) {
  const reason = data && typeof data === "object" && !Array.isArray(data) ? data.rejreason : null;
  if (reason) throw new BrokerError(`Firstock ${what} refused: ${String(reason).slice(0, 160)}`);
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const json = await callApi(creds, "/placeOrder", buildOrderBody(order, resolvedLotSize));
  const slices = Array.isArray(json?.data) ? json.data : [json?.data];
  const ids = slices.map((s) => String(s?.orderNumber ?? "").trim()).filter(Boolean);
  if (!ids.length) throw new Error(`Firstock accepted the request but returned no order number. ${ORDER_BOOK_HINT}`);
  const ack = { orderId: ids[0], orderStatus: "UNKNOWN" };
  if (ids.length > 1) ack.orderIds = ids; // sliced above the freeze quantity
  return ack;
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Firstock order number");
  const book = await callApi(creds, "/orderBook");
  const original = (Array.isArray(book?.data) ? book.data : []).find((r) => String(r?.orderNumber ?? "") === id);
  const json = await callApi(creds, "/modifyOrder", buildModifyBody(id, changes, original));
  refusal(json?.data, "modify");
  return { orderId: String(json?.data?.orderNumber ?? id), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Firstock order number");
  const json = await callApi(creds, "/cancelOrder", { orderNumber: id });
  refusal(json?.data, "cancel");
  // A cancel request is not proof of cancellation; panic flows re-read the book.
  return { orderId: String(json?.data?.orderNumber ?? id), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "firstock" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "firstock" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "firstock" });
