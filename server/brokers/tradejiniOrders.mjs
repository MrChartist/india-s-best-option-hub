/**
 * Tradejini — orders (real money; every call is behind withOrderGate, no route mints Tradejini gates).
 *
 * Official docs (checked 2026-10, https://developer.tradejini.com/docs/orders/):
 *  - POST /api/oms/place-order (form) { symId, qty (units: lots x lot size), side buy|sell,
 *    type limit|market|stoplimit|stopmarket, product delivery|intraday|normal, limitPrice, trigPrice,
 *    validity day|ioc|eos|gtc, mktProt (market orders only) } -> d { orderId, msg }. 10 req/s.
 *  - PUT /api/oms/modify-order (form) { symId, orderId, qty (TOTAL after modification: filled + new pending), type,
 *    limitPrice, trigPrice, validity, side }.
 *  - DELETE /api/oms/cancel-order?orderId=...
 *  - 'delivery' is for equities, 'normal' for derivatives, 'intraday' for both.
 * Cover/bracket/GTT/OCO exist under Advance Orders and are not built here.
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { tjRequest } from "./tradejiniAuth.mjs";
import { findByToken } from "./tradejiniInstruments.mjs";

export const ORDER_FEATURES = {
  bracket: false, // documented (Advance Orders) but not built here.
  cover: false,
  ioc: true, // validity ioc is documented.
  mtf: false,
  nativeMarketProtection: true, // mktProt is a documented market-order field.
  maxLegQty: null, // freezeQty is in the scrip master; slicing is not built here.
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const TYPES = { LIMIT: "limit", MARKET: "market", SL: "stoplimit", "SL-M": "stopmarket", SLM: "stopmarket" };
const PRODUCTS = { CNC: "delivery", INTRADAY: "intraday", MARGIN: "normal" };
const VALIDITY = { DAY: "day", IOC: "ioc" };
const CASH = new Set(["NSE", "BSE"]);
const ORDER_ID = /^[A-Za-z0-9-]{4,40}$/;

function priceFields(orderType, price, triggerPrice, marketProtectionPercent) {
  const type = TYPES[orderType];
  if (!type) throw bad(`Invalid orderType: ${orderType} (LIMIT, MARKET, SL, SL-M)`);
  const needsPrice = type === "limit" || type === "stoplimit";
  const needsTrigger = type === "stoplimit" || type === "stopmarket";
  if (needsPrice && !(Number.isFinite(price) && price > 0)) throw bad(`price required for ${orderType}`);
  if (needsTrigger && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad(`triggerPrice required for ${orderType}`);
  const out = { type };
  if (needsPrice) out.limitPrice = price;
  if (needsTrigger) out.trigPrice = triggerPrice;
  if (type === "market" && marketProtectionPercent !== undefined) {
    if (!(Number(marketProtectionPercent) > 0)) throw bad("marketProtectionPercent must be a positive number");
    out.mktProt = Number(marketProtectionPercent);
  }
  return out;
}

/**
 * Pure body builder. order: { token (symId), exchange, side, orderType, product CNC|INTRADAY|MARGIN, validity DAY|IOC,
 * lots, price?, triggerPrice?, marketProtectionPercent? }. `instrument` is the scrip-master row for order.token;
 * `resolvedLotSize` comes from the master, never from the client.
 */
export function buildOrderBody(order, resolvedLotSize, instrument) {
  const { exchange, side, orderType = "LIMIT", product = "INTRADAY", validity = "DAY", lots, price, triggerPrice, marketProtectionPercent } = order || {};
  if (!instrument || instrument.token !== String(order?.token)) throw bad("Tradejini: order token (symId) not found in the scrip master");
  if (instrument.exchange !== exchange) throw bad(`Tradejini: exchange ${exchange} does not match the instrument`);
  if (instrument.instrumentType === "INDEX") throw bad("Tradejini: an index cannot be traded");
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (!VALIDITY[validity]) throw bad(`Invalid validity: ${validity} (DAY or IOC)`);
  const prod = PRODUCTS[product];
  if (!prod) throw bad(`Unsupported Tradejini product ${product}`);
  if (product === "CNC" && !CASH.has(exchange)) throw bad("CNC (delivery) is for equities only");
  if (product === "MARGIN" && CASH.has(exchange)) throw bad("MARGIN (normal) is for derivatives only");
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) throw bad("Missing resolved lot size — it must come from the scrip master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  return {
    symId: instrument.token,
    qty: Math.round(lots * resolvedLotSize),
    side: side.toLowerCase(),
    product: prod,
    validity: VALIDITY[validity],
    ...priceFields(orderType, price, triggerPrice, marketProtectionPercent),
  };
}

/** Pure modify body. changes: { symId (from the order book), qty (TOTAL units incl. filled), orderType, price?, triggerPrice?, validity? }. */
export function buildModifyBody(orderId, changes) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID.test(id)) throw bad("Invalid Tradejini orderId");
  const { symId, qty, orderType = "LIMIT", price, triggerPrice, validity = "DAY" } = changes || {};
  if (!String(symId ?? "").trim()) throw bad("Tradejini modify needs the order's symId");
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units (filled + pending)");
  if (!VALIDITY[validity]) throw bad(`Invalid validity: ${validity}`);
  return { symId: String(symId), orderId: id, qty, validity: VALIDITY[validity], ...priceFields(orderType, price, triggerPrice) };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const instrument = await findByToken(order?.token);
  const d = await tjRequest(creds, "/api/oms/place-order", { method: "POST", form: buildOrderBody(order, resolvedLotSize, instrument) });
  return { orderId: String(d?.orderId ?? ""), orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  // The docs require the order's symId; it is read from the broker's order book, never taken from the client.
  if (!ORDER_ID.test(String(orderId ?? "").trim())) throw bad("Invalid Tradejini orderId");
  const orders = await tjRequest(creds, "/api/oms/orders");
  const symId = (Array.isArray(orders) ? orders : []).find((o) => String(o.orderId) === String(orderId).trim())?.symId;
  if (!symId) throw bad(`Tradejini: order ${orderId} is not in today's order book`);
  const form = buildModifyBody(orderId, { ...changes, symId });
  const d = await tjRequest(creds, "/api/oms/modify-order", { method: "PUT", form });
  return { orderId: String(d?.orderId ?? form.orderId), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID.test(id)) throw bad("Invalid Tradejini orderId");
  const d = await tjRequest(creds, "/api/oms/cancel-order", { method: "DELETE", query: { orderId: id } });
  // An accepted cancel is not proof the order is gone; panic flows re-read the order book.
  return { orderId: String(d?.orderId ?? id), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "tradejini" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "tradejini" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "tradejini" });
