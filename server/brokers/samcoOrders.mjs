/**
 * Samco Trade API v3.2 — orders (real money; every call is behind withOrderGate, no route mints Samco gates).
 *
 * Official docs (checked 2026-10):
 *  - POST /order/placeOrder (https://docs-tradeapi.samco.in/order/place-order.html) { symbolName, exchange,
 *    transactionType BUY|SELL, orderType "L"|"SL", quantity, price, triggerPrice, orderValidity DAY|IOC,
 *    productType CNC|NRML|MIS, afterMarketOrderFlag "NO" } -> { status: "Success", orderNumber, exchangeOrderStatus }.
 *    symbolName is the scrip-master `name` for cash equities and the `tradingSymbol` for F&O.
 *    Only L (limit) and SL (stop-loss limit) are documented for placeOrder, so MARKET / SL-M are refused here
 *    (the session response's orderTypeList mentions MKT and SL-M, but the order page does not).
 *  - PUT /order/modifyOrder/{orderNumber} { orderType, quantity, orderValidity, price, triggerPrice }.
 *  - DELETE /order/cancelOrder?orderNumber=... (the Postman collection spells it OrderNUmber; the docs page wins).
 *  - BFO: "only SENSEX and BANKEX trades are allowed".
 * Order calls are never retried (samcoAuth only retries reads), and a cancel being accepted is not proof that the
 * order is gone: panic flows re-read the order book.
 */

import { BrokerInputError, withOrderGate } from "./contract.mjs";
import { samcoRequest } from "./samcoAuth.mjs";
import { findByToken } from "./samcoInstruments.mjs";
import { orderStatusOf } from "./samcoPortfolio.mjs";

export const ORDER_FEATURES = {
  bracket: false, // /order/placeOrderBO exists but is not built here.
  cover: false, // /order/placeOrderCO likewise.
  ioc: true, // orderValidity IOC is documented.
  mtf: false,
  nativeMarketProtection: false, // market orders are not documented for placeOrder.
  maxLegQty: null, // no documented per-order cap.
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const TYPES = { LIMIT: "L", SL: "SL" };
const PRODUCTS = { CNC: "CNC", INTRADAY: "MIS", MARGIN: "NRML" };
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO"]);
const VALIDITY = new Set(["DAY", "IOC"]);
const ORDER_NO = /^\d{6,30}$/;
const price2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

function checkPrices(orderType, price, triggerPrice) {
  if (!(Number.isFinite(price) && price > 0)) throw bad(`price required for ${orderType}`);
  if (orderType === "SL" && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for SL");
}

/**
 * Pure body builder. order: { token, exchange, side, orderType LIMIT|SL, product CNC|INTRADAY|MARGIN, validity DAY|IOC,
 * lots, price, triggerPrice }. `instrument` is the scrip-master row for order.token and `resolvedLotSize` comes from the
 * master too, never from the client.
 */
export function buildOrderBody(order, resolvedLotSize, instrument) {
  const { exchange, side, orderType = "LIMIT", product = "INTRADAY", validity = "DAY", lots, price, triggerPrice } = order || {};
  if (!instrument || instrument.token !== String(order?.token)) throw bad("Samco: order token not found in the scrip master");
  if (!EXCHANGES.has(exchange) || instrument.exchange !== exchange) throw bad(`Samco: exchange ${exchange} does not match the instrument`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (!TYPES[orderType]) throw bad(`Samco API orders must be LIMIT or SL (got ${orderType})`);
  if (!VALIDITY.has(validity)) throw bad(`Invalid validity: ${validity} (DAY or IOC)`);
  const productType = PRODUCTS[product];
  if (!productType) throw bad(`Unsupported Samco product ${product}`);
  if (product === "CNC" && exchange !== "NSE" && exchange !== "BSE") throw bad("CNC is for cash equities only");
  if (product === "MARGIN" && (exchange === "NSE" || exchange === "BSE")) throw bad("MARGIN (NRML) is for derivatives only");
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) throw bad("Missing resolved lot size — it must come from the scrip master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  checkPrices(orderType, price, triggerPrice);
  const body = {
    symbolName: instrument.instrumentType === "EQ" ? instrument.name : instrument.tradingSymbol,
    exchange,
    transactionType: side,
    orderType: TYPES[orderType],
    quantity: String(Math.round(lots * resolvedLotSize)),
    price: price2(price),
    orderValidity: validity,
    productType,
    afterMarketOrderFlag: "NO",
  };
  if (orderType === "SL") body.triggerPrice = price2(triggerPrice);
  return body;
}

/** Pure modify body. changes: { orderType LIMIT|SL, qty (units), price, triggerPrice?, validity? }. */
export function buildModifyBody(changes) {
  const { orderType = "LIMIT", qty, price, triggerPrice, validity = "DAY" } = changes || {};
  if (!TYPES[orderType]) throw bad(`Samco API orders must be LIMIT or SL (got ${orderType})`);
  if (!VALIDITY.has(validity)) throw bad(`Invalid validity: ${validity}`);
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  checkPrices(orderType, price, triggerPrice);
  const body = { orderType: TYPES[orderType], quantity: String(qty), orderValidity: validity, price: price2(price) };
  if (orderType === "SL") body.triggerPrice = price2(triggerPrice);
  return body;
}

function orderNo(orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_NO.test(id)) throw bad("Invalid Samco order number");
  return id;
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const instrument = await findByToken(order?.token);
  const body = buildOrderBody(order, resolvedLotSize, instrument);
  const json = await samcoRequest(creds, "/order/placeOrder", { method: "POST", body });
  return { orderId: String(json?.orderNumber ?? ""), orderStatus: json?.exchangeOrderStatus ? orderStatusOf(json.exchangeOrderStatus) : "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = orderNo(orderId);
  const json = await samcoRequest(creds, `/order/modifyOrder/${id}`, { method: "PUT", body: buildModifyBody(changes) });
  return { orderId: String(json?.ordernumber ?? json?.orderNumber ?? id), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  const id = orderNo(orderId);
  const json = await samcoRequest(creds, "/order/cancelOrder", { method: "DELETE", query: { orderNumber: id } });
  return { orderId: String(json?.orderNumber ?? id), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "samco" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "samco" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "samco" });
