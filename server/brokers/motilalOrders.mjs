/**
 * Motilal Oswal orders (real money). Every exported call is wrapped with withOrderGate(); no route mints Motilal gates
 * today.
 *
 * Official docs (https://invest.motilaloswal.com/moAPI/APIDocumentation/Introduction, "Place Order", "Modify Order",
 * "Cancel Order", "Parameters / Constants"; checked 2026-10):
 *  - POST /rest/trans/v2/placeorder { exchange, symboltoken, buyorsell BUY|SELL, ordertype LIMIT|MARKET|STOPLOSS,
 *    producttype, orderduration DAY|GTC|GTD|IOC, price, triggerprice, quantityinlot (IN LOTS), disclosedquantity,
 *    amoorder Y|N, goodtilldate, algoid, tag (max 10 chars) } -> { status: "SUCCESS", uniqueorderid }
 *  - POST /rest/trans/v5/modifyorder { uniqueorderid, newordertype, neworderduration, newprice, newtriggerprice,
 *    newquantityinlot, newdisclosedquantity, newgoodtilldate, lastmodifiedtime "dd-MMM-yyyy HH:mm:ss", qtytradedtoday }
 *    (lastmodifiedtime and qtytradedtoday come from the current order-book row, so it is read first)
 *  - POST /rest/trans/v2/cancelorder { uniqueorderid }
 * Products: MARGIN -> NORMAL (carry-forward), INTRADAY -> VALUEPLUS, CNC -> DELIVERY. OpenAlgo reports derivatives
 * orders being placed as NORMAL only, and the doc gives no per-segment product table, so F&O orders accept MARGIN only.
 * Only priced orders (LIMIT, STOPLOSS with a limit price) with DAY validity are built.
 */

import { BrokerError, BrokerInputError, withOrderGate } from "./contract.mjs";
import { authPost } from "./motilalAuth.mjs";
import { motilalExchange } from "./motilalInstruments.mjs";
import { readOrderRows } from "./motilalPortfolio.mjs";

export const ORDER_FEATURES = {
  bracket: false,
  cover: false,
  ioc: false, // IOC is a documented orderduration; not offered from this terminal.
  mtf: false,
  nativeMarketProtection: false,
  maxLegQty: null, // per-contract maxqtyperorder is in the scrip master; no API-wide cap is documented.
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const PRODUCT_CODE = { MARGIN: "NORMAL", INTRADAY: "VALUEPLUS", CNC: "DELIVERY" };
const bad = (m) => new BrokerInputError(m);

/**
 * Pure place body. order: { token, exchange, side, orderType: LIMIT|STOPLOSS_LIMIT, product, lots, price, triggerPrice? }.
 * `resolvedLotSize` (from the scrip master) is required by the contract; Motilal itself takes the quantity in lots.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { token, exchange, side, orderType = "LIMIT", product = "MARGIN", lots, price, triggerPrice } = order || {};
  if (!/^\d{1,12}$/.test(String(token ?? ""))) throw bad("Invalid Motilal Oswal scrip code");
  if (!["NSE", "BSE", "NFO", "BFO"].includes(exchange)) throw bad(`Invalid exchange for Motilal Oswal orders: ${exchange}`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (orderType === "MARKET" || orderType === "STOPLOSS_MARKET") throw bad("Motilal Oswal orders from this terminal must be priced (LIMIT or STOPLOSS_LIMIT).");
  if (orderType !== "LIMIT" && orderType !== "STOPLOSS_LIMIT") throw bad(`Unsupported Motilal Oswal order type: ${orderType}`);
  const producttype = PRODUCT_CODE[product];
  if (!producttype) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  const fno = exchange === "NFO" || exchange === "BFO";
  if (fno && product !== "MARGIN") throw bad("Motilal Oswal F&O orders use the NORMAL product: choose MARGIN.");
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  }
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required for a limit order");
  const stop = orderType === "STOPLOSS_LIMIT";
  if (stop && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for STOPLOSS_LIMIT");
  return {
    exchange: motilalExchange(exchange),
    symboltoken: Number(token),
    buyorsell: side,
    ordertype: stop ? "STOPLOSS" : "LIMIT",
    producttype,
    orderduration: "DAY",
    price,
    triggerprice: stop ? triggerPrice : 0,
    quantityinlot: lots,
    disclosedquantity: 0,
    amoorder: "N",
    algoid: "",
    goodtilldate: "",
    tag: "MRC",
  };
}

/** Pure modify body from the order-book row + changes { price, qty (units), triggerPrice?, orderType? }. */
export function buildModifyBody(row, changes) {
  const { price, qty, triggerPrice, orderType } = changes || {};
  if (!row?.uniqueorderid) throw bad("Order not found in the Motilal Oswal order book");
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required");
  const lot = Number(row.lotsize) || 1;
  if (!Number.isInteger(qty) || qty <= 0 || qty % lot !== 0) throw bad(`qty must be a positive multiple of the lot size (${lot})`);
  const current = String(row.ordertype ?? "LIMIT").toUpperCase();
  const stop = orderType ? orderType === "STOPLOSS_LIMIT" : current === "STOPLOSS";
  if (orderType && orderType !== "LIMIT" && orderType !== "STOPLOSS_LIMIT") throw bad("Only LIMIT and STOPLOSS_LIMIT orders can be modified from this terminal");
  const trig = triggerPrice ?? Number(row.triggerprice);
  if (stop && !(Number.isFinite(trig) && trig > 0)) throw bad("triggerPrice required for STOPLOSS_LIMIT");
  if (!row.lastmodifiedtime || String(row.lastmodifiedtime) === "0") throw new BrokerError("Motilal Oswal order has no lastmodifiedtime yet; refresh and try again.");
  return {
    uniqueorderid: String(row.uniqueorderid),
    newordertype: stop ? "STOPLOSS" : "LIMIT",
    neworderduration: "DAY",
    newprice: price,
    newtriggerprice: stop ? trig : 0,
    newquantityinlot: qty / lot,
    newdisclosedquantity: 0,
    newgoodtilldate: "",
    lastmodifiedtime: String(row.lastmodifiedtime),
    qtytradedtoday: Number(row.qtytradedtoday) || 0,
  };
}

function assertOk(json, label) {
  if (String(json?.status).toUpperCase() !== "SUCCESS") {
    throw new BrokerError(`Motilal Oswal ${label} rejected: ${json?.message || "no reason given"}${json?.errorcode ? ` (${json.errorcode})` : ""}`);
  }
  return json;
}

const ORDER_ID_RE = /^[A-Za-z0-9]{1,50}$/;

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const json = assertOk(await authPost(creds, "placeorder", buildOrderBody(order, resolvedLotSize)), "order");
  if (!json.uniqueorderid) throw new BrokerError("Motilal Oswal order: no uniqueorderid returned");
  // "The status of the order is not known at the moment of placing order."
  return { orderId: String(json.uniqueorderid), orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Motilal Oswal order id");
  const row = (await readOrderRows(creds)).find((o) => String(o.uniqueorderid) === id);
  if (!row) throw new BrokerError(`Motilal Oswal: order ${id} is not in today's order book.`);
  assertOk(await authPost(creds, "modifyorder", buildModifyBody(row, changes)), "modify");
  return { orderId: id, orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Motilal Oswal order id");
  assertOk(await authPost(creds, "cancelorder", { uniqueorderid: id }), "cancel");
  // "Cancel Order Request Sent" is not proof of cancellation; panic flows re-read the book.
  return { orderId: id, orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "motilal" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "motilal" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "motilal" });
