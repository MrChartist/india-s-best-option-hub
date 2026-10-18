/**
 * Goodwill orders (real money, gated). Official docs (https://developer.gwcindia.in/api/placeOrder, modifyOrder,
 * cancelOrder, appendix; checked 2026-10):
 *  - POST /placeorder { tsym, exchange, trantype (B | S), validity (DAY | IOC), pricetype (MKT | L | SL-L | SL-M),
 *    qty, discqty, price, trgprc, product (CNC | MIS | NRML | CO | BO), amo (YES | NO) } -> data { nstordno }.
 *    Numbers travel as strings, as in the doc example.
 *  - POST /modifyorder { exchange, tsym, nstordno, trantype, pricetype, price, qty, discqty, trgprc, validity,
 *    filledqty, product } -> data { result: <order number> }. Every field is mandatory, so the current order is
 *    read from the order book first and only the changed fields are replaced.
 *  - POST /cancelorder { nstordno } -> data { result }.
 * The trading symbol comes from the instrument master (by token), never from the client.
 * Every call is wrapped with withOrderGate(); no route mints Goodwill gates today.
 */

import { BrokerError, BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { gwRequest } from "./goodwillAuth.mjs";
import { findByRef } from "./goodwillInstruments.mjs";
import { listRawOrders } from "./goodwillPortfolio.mjs";

const PRICE_TYPE = { LIMIT: "L", MARKET: "MKT", SL: "SL-L", STOP_LOSS: "SL-L", STOPLOSS_LIMIT: "SL-L", "SL-M": "SL-M", SLM: "SL-M", STOP_LOSS_MARKET: "SL-M", STOPLOSS_MARKET: "SL-M" };
const PRODUCTS_CASH = { CNC: "CNC", INTRADAY: "MIS" };
const PRODUCTS_FNO = { MARGIN: "NRML", INTRADAY: "MIS" };
const ORDER_ID_RE = /^\d{6,25}$/;

export const ORDER_FEATURES = {
  bracket: false, // placeBOOrder is documented but not built here
  cover: false, // placeCoOrder is documented but not built here
  ioc: true,
  mtf: false,
  nativeMarketProtection: false,
  maxLegQty: null,
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const isPositive = (v) => Number.isFinite(v) && v > 0;

function priceTypeOf(t) {
  const p = PRICE_TYPE[String(t ?? "LIMIT").toUpperCase()];
  if (!p) throw bad(`Unsupported Goodwill order type: ${t} (LIMIT, MARKET, SL or SL-M)`);
  return p;
}

function checkPrices(pricetype, side, price, trigger) {
  const isLimit = pricetype === "L" || pricetype === "SL-L";
  const isStop = pricetype === "SL-L" || pricetype === "SL-M";
  if (isLimit && !isPositive(price)) throw bad(`price required for ${pricetype}`);
  if (isStop && !isPositive(trigger)) throw bad(`triggerPrice required for ${pricetype}`);
  if (pricetype === "SL-L" && side === "B" && !(trigger <= price)) throw bad("Buy SL: the trigger must not be above the limit price");
  if (pricetype === "SL-L" && side === "S" && !(trigger >= price)) throw bad("Sell SL: the trigger must not be below the limit price");
}

/**
 * Pure body builder. order: { tradingSymbol (from the master), exchange (NSE|NFO), side, orderType, product,
 * validity, lots, price?, triggerPrice? }. `resolvedLotSize` comes from the instrument master, never the client.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { tradingSymbol, exchange, side, orderType, product = "INTRADAY", validity = "DAY", lots, price, triggerPrice } = order || {};
  if (!tradingSymbol || typeof tradingSymbol !== "string") throw bad("Goodwill orders need the trading symbol from the instrument master");
  if (exchange !== "NSE" && exchange !== "NFO") throw bad(`Invalid exchange: ${exchange} (NSE or NFO)`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const pricetype = priceTypeOf(orderType);
  const prod = (exchange === "NSE" ? PRODUCTS_CASH : PRODUCTS_FNO)[product];
  if (!prod) throw bad(exchange === "NSE" ? `Unsupported product on equity: ${product} (CNC or INTRADAY)` : `Unsupported product on F&O: ${product} (MARGIN or INTRADAY)`);
  if (validity !== "DAY" && validity !== "IOC") throw bad(`Unsupported validity: ${validity} (DAY or IOC)`);
  if (!isPositive(resolvedLotSize)) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  const t = side === "BUY" ? "B" : "S";
  checkPrices(pricetype, t, price, triggerPrice);
  return {
    tsym: tradingSymbol,
    exchange,
    trantype: t,
    validity,
    pricetype,
    qty: String(Math.round(lots * resolvedLotSize)),
    discqty: "0",
    price: pricetype === "L" || pricetype === "SL-L" ? String(price) : "0",
    trgprc: pricetype === "SL-L" || pricetype === "SL-M" ? String(triggerPrice) : "0",
    product: prod,
    amo: "NO",
  };
}

/** Pure modify body from the current order-book row and the changes. qty is in units. */
export function buildModifyBody(current, changes) {
  if (!current || typeof current !== "object") throw bad("Goodwill: the order to modify is not in today's order book");
  const { qty, orderType, price, triggerPrice, validity } = changes || {};
  if ([qty, orderType, price, triggerPrice, validity].every((v) => v === undefined)) throw bad("Nothing to modify");
  if (qty !== undefined && (!Number.isInteger(qty) || qty <= 0)) throw bad("qty must be a positive whole number of units");
  if (validity !== undefined && validity !== "DAY" && validity !== "IOC") throw bad(`Unsupported validity: ${validity}`);
  const pricetype = orderType !== undefined ? priceTypeOf(orderType) : PRICE_TYPE[String(current.pricetype ?? "").toUpperCase()] ?? String(current.pricetype ?? "L").toUpperCase();
  const t = String(current.trantype ?? "").toUpperCase().startsWith("S") ? "S" : "B";
  const newPrice = pricetype === "L" || pricetype === "SL-L" ? (price ?? Number(current.price)) : 0;
  const newTrigger = pricetype === "SL-L" || pricetype === "SL-M" ? (triggerPrice ?? Number(current.trgprc)) : 0;
  checkPrices(pricetype, t, newPrice, newTrigger);
  return {
    exchange: String(current.exchange),
    tsym: String(current.tsym),
    nstordno: String(current.nstordno),
    trantype: t,
    pricetype,
    price: String(newPrice),
    qty: String(qty ?? current.qty),
    discqty: String(current.dscqty ?? "0") || "0",
    trgprc: String(newTrigger),
    validity: validity ?? (String(current.validity || "DAY").toUpperCase() === "IOC" ? "IOC" : "DAY"),
    filledqty: String(current.fillshares || "0"),
    product: String(current.product),
  };
}

function checkOrderId(orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Goodwill order number (digits only)");
  return id;
}

function ackOf(data, fallbackId, what) {
  const orderId = String(data?.nstordno ?? data?.result ?? fallbackId ?? "").trim();
  if (!orderId) throw new BrokerError(`Goodwill accepted the ${what} request but returned no order number. ${ORDER_BOOK_HINT}`);
  return { orderId, orderStatus: what === "order" ? "OPEN" : "UNKNOWN" };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  buildOrderBody({ ...order, tradingSymbol: "CHECK" }, resolvedLotSize); // validate before any download
  const row = await findByRef({ exchange: order?.exchange, token: order?.token });
  if (!row) throw bad(`Goodwill: ${order?.exchange}:${order?.token} is not in the instrument master`);
  const body = buildOrderBody({ ...order, tradingSymbol: row.tradingSymbol }, resolvedLotSize);
  return ackOf(await gwRequest(creds, "placeorder", { method: "POST", body }), null, "order");
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = checkOrderId(orderId);
  if ([changes?.qty, changes?.orderType, changes?.price, changes?.triggerPrice, changes?.validity].every((v) => v === undefined)) throw bad("Nothing to modify");
  const current = (await listRawOrders(creds)).find((o) => String(o.nstordno) === id);
  const body = buildModifyBody(current, changes);
  return ackOf(await gwRequest(creds, "modifyorder", { method: "POST", body }), id, "modify");
}

async function cancelOrderImpl(creds, orderId) {
  const id = checkOrderId(orderId);
  return ackOf(await gwRequest(creds, "cancelorder", { method: "POST", body: { nstordno: id } }), id, "cancel");
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "goodwill" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "goodwill" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "goodwill" });
