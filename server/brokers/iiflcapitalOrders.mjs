/**
 * IIFL Capital orders (real money, gated). Official docs: https://developers.iiflcapital.com/apidocs/ordermanagement
 * and the annexure error codes (checked 2026-10):
 *  - POST /orders (Single/Bulk) [ { instrumentId, exchange (NSEEQ | NSEFO | BSEEQ | BSEFO ...), transactionType
 *    (BUY | SELL), quantity, orderComplexity (REGULAR | AMO | BO | CO), product (NORMAL | INTRADAY | DELIVERY |
 *    BNPL), orderType (LIMIT | MARKET | SL | SLM), validity (DAY | IOC), price, slTriggerPrice, disclosedQuantity,
 *    marketProtectionPercent, apiOrderSource, algoId, orderTag (<= 50 chars) } ]
 *    -> { status: "Ok", result: [ { status: "Success", message, brokerOrderId, requestTime } ] }.
 *  - PUT /orders/{brokerOrderId} { quantity?, orderType?, price?, slTriggerPrice?, validity?, ... } -> result {...}.
 *  - DELETE /orders/{brokerOrderId} -> result { status: "Success", brokerOrderId }.
 * EC978: price only for LIMIT / SL; EC977: slTriggerPrice only for SL / SLM; EC954: quantity a multiple of the
 * lot size; EC956: DELIVERY / BNPL only on NSEEQ / BSEEQ.
 * Observed (not in the official docs): the live API may reject bare SLM orders; the
 * official docs list SLM, so SLM is passed as documented (needs live verification).
 * Every call is wrapped with withOrderGate(); no route mints IIFL Capital gates today.
 */

import { BrokerError, BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { iiflRequest, rowsOf } from "./iiflcapitalAuth.mjs";
import { IIFL_EXCHANGE, getSegment } from "./iiflcapitalInstruments.mjs";
import { orderStatusOf } from "./iiflcapitalPortfolio.mjs";

const PRODUCT = { CNC: "DELIVERY", INTRADAY: "INTRADAY", MARGIN: "NORMAL" };
const ORDER_TYPE = { LIMIT: "LIMIT", MARKET: "MARKET", SL: "SL", STOPLOSS_LIMIT: "SL", STOP_LOSS: "SL", "SL-M": "SLM", SLM: "SLM", STOPLOSS_MARKET: "SLM", STOP_LOSS_MARKET: "SLM" };
const ORDER_ID_RE = /^\d{6,25}$/;
const SEGMENT_FILE = { NFO: "NSEFO", BFO: "BSEFO", NSE: "NSEEQ", BSE: "BSEEQ" };

export const ORDER_FEATURES = {
  bracket: false, // BO is documented but not built here
  cover: false, // CO is documented but not built here
  ioc: true, // validity IOC is documented
  mtf: false, // BNPL exists; not exposed until verified
  nativeMarketProtection: true, // marketProtectionPercent is a documented order field
  maxLegQty: null, // qtyLimit is per instrument in the contract file
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const isPositive = (v) => Number.isFinite(v) && v > 0;

function orderTypeOf(t) {
  const out = ORDER_TYPE[String(t ?? "LIMIT").toUpperCase()];
  if (!out) throw bad(`Unsupported IIFL Capital order type: ${t} (LIMIT, MARKET, SL or SL-M)`);
  return out;
}

/**
 * Pure body builder (one order object; the API takes an array of them). order: { instrumentId | token, exchange
 * (NSE|BSE|NFO|BFO), side, orderType, product, validity, lots, price?, triggerPrice?, marketProtectionPercent?, tag? }.
 * `resolvedLotSize` comes from the contract file, never the client.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { exchange, side, orderType, product = "INTRADAY", validity = "DAY", lots, price, triggerPrice, marketProtectionPercent, tag } = order || {};
  const instrumentId = String(order?.instrumentId ?? order?.token ?? "");
  if (!/^\d{1,15}$/.test(instrumentId)) throw bad("IIFL Capital orders need the numeric instrument id from the contract file");
  const iiflExchange = IIFL_EXCHANGE[exchange];
  if (!iiflExchange) throw bad(`Invalid exchange: ${exchange} (NSE, BSE, NFO or BFO)`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const type = orderTypeOf(orderType);
  const prod = PRODUCT[product];
  if (!prod) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  if (prod === "DELIVERY" && !iiflExchange.endsWith("EQ")) throw bad("CNC (DELIVERY) is only allowed on NSE/BSE equity");
  if (validity !== "DAY" && validity !== "IOC") throw bad(`Unsupported validity: ${validity} (DAY or IOC)`);
  if (!isPositive(resolvedLotSize)) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  const isLimit = type === "LIMIT" || type === "SL";
  const isStop = type === "SL" || type === "SLM";
  if (isLimit && !isPositive(price)) throw bad(`price required for ${type}`);
  if (isStop && !isPositive(triggerPrice)) throw bad(`triggerPrice required for ${type}`);
  // EC973 / EC974: a buy SL needs trigger < price, a sell SL needs trigger > price.
  if (type === "SL" && side === "BUY" && !(triggerPrice < price)) throw bad("Buy SL: the trigger must be below the limit price");
  if (type === "SL" && side === "SELL" && !(triggerPrice > price)) throw bad("Sell SL: the trigger must be above the limit price");
  const body = {
    instrumentId,
    exchange: iiflExchange,
    transactionType: side,
    quantity: String(Math.round(lots * resolvedLotSize)),
    orderComplexity: "REGULAR",
    product: prod,
    orderType: type,
    validity,
  };
  if (isLimit) body.price = String(price);
  if (isStop) body.slTriggerPrice = String(triggerPrice);
  if (marketProtectionPercent !== undefined && (type === "MARKET" || type === "SLM")) {
    const mp = Number(marketProtectionPercent);
    if (!(mp > 0 && mp <= 20)) throw bad("marketProtectionPercent must be between 0 and 20");
    body.marketProtectionPercent = String(mp);
  }
  if (tag !== undefined) body.orderTag = String(tag).slice(0, 50);
  return body;
}

/** Pure modify body: only the fields being changed. changes: { qty? (units), orderType?, price?, triggerPrice?, validity? }. */
export function buildModifyBody(orderId, changes) {
  if (!ORDER_ID_RE.test(String(orderId ?? "").trim())) throw bad("Invalid IIFL Capital order id (digits only)");
  const { qty, orderType, price, triggerPrice, validity } = changes || {};
  const body = {};
  if (qty !== undefined) {
    if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
    body.quantity = String(qty);
  }
  if (orderType !== undefined) body.orderType = orderTypeOf(orderType);
  if (price !== undefined) {
    if (!isPositive(price)) throw bad("price must be positive");
    body.price = String(price);
  }
  if (triggerPrice !== undefined) {
    if (!isPositive(triggerPrice)) throw bad("triggerPrice must be positive");
    body.slTriggerPrice = String(triggerPrice);
  }
  if (validity !== undefined) {
    if (validity !== "DAY" && validity !== "IOC") throw bad(`Unsupported validity: ${validity}`);
    body.validity = validity;
  }
  if (!Object.keys(body).length) throw bad("Nothing to modify");
  return body;
}

async function resolveInstrument(order) {
  if (/^\d{1,15}$/.test(String(order?.instrumentId ?? order?.token ?? ""))) return order;
  const file = SEGMENT_FILE[order?.exchange];
  if (!file) throw bad(`Invalid exchange: ${order?.exchange}`);
  const row = (await getSegment(file)).find((m) => m.tradingSymbol === order?.tradingSymbol);
  if (!row) throw bad(`IIFL Capital: ${order?.tradingSymbol} is not in the ${file} contract file`);
  return { ...order, instrumentId: row.token };
}

function ackOf(json, fallbackId, what) {
  const r = rowsOf(json)[0] ?? {};
  const status = String(r.status ?? "").toLowerCase();
  const orderId = String(r.brokerOrderId ?? fallbackId ?? "").trim();
  if (status && status !== "success" && status !== "ok") throw new BrokerError(`IIFL Capital ${what} refused: ${String(r.message || r.status).slice(0, 160)}`);
  if (!orderId) throw new BrokerError(`IIFL Capital accepted the ${what} request but returned no order id. ${ORDER_BOOK_HINT}`);
  return { orderId, orderStatus: what === "cancel" ? "CANCELLED" : orderStatusOf(r.orderStatus ?? "open") };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  buildOrderBody({ ...order, instrumentId: order?.instrumentId ?? order?.token ?? "0" }, resolvedLotSize); // validate before any download
  const body = buildOrderBody(await resolveInstrument(order), resolvedLotSize);
  return ackOf(await iiflRequest(creds, "/orders", { method: "POST", body: [body] }), null, "order");
}

async function modifyOrderImpl(creds, orderId, changes) {
  const body = buildModifyBody(orderId, changes);
  return ackOf(await iiflRequest(creds, `/orders/${String(orderId).trim()}`, { method: "PUT", body }), orderId, "modify");
}

async function cancelOrderImpl(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid IIFL Capital order id (digits only)");
  return ackOf(await iiflRequest(creds, `/orders/${id}`, { method: "DELETE" }), id, "cancel");
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "iiflcapital" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "iiflcapital" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "iiflcapital" });
