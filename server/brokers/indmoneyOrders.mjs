/**
 * IndMoney (INDstocks) orders (real money, gated). Official Postman collection "Orders", checked 2026-10:
 *  - POST /order { txn_type (BUY | SELL), exchange (NSE | BSE), segment (EQUITY | DERIVATIVE), product
 *    (CNC | INTRADAY | MARGIN), order_type (LIMIT | MARKET), validity (DAY | IOC), security_id, qty (units, a
 *    multiple of the lot size), algo_id (required: "99999" NSE, "9999999999999999" BSE), limit_price (LIMIT),
 *    is_amo } -> data { order_id ("EQ-..." | "DRV-..."), order_status }.
 *    "No pure MARKET orders": a MARKET order is converted to LIMIT at the live price by INDstocks.
 *  - POST /order/modify { order_id, segment, qty, limit_price } (all required; at most 25 modifications).
 *  - POST /order/cancel { order_id, segment }.
 * Stop-loss orders exist only as Smart Orders (GTT), which are out of scope here, so SL types are refused.
 * The annexure notes exchanges do not permit IOC for algo orders; IOC is still documented on /order and is
 * passed through when asked for.
 * Every call is wrapped with withOrderGate(); no route mints IndMoney gates today.
 */

import { BrokerError, BrokerInputError, ORDER_BOOK_HINT, withOrderGate } from "./contract.mjs";
import { indRequest } from "./indmoneyAuth.mjs";
import { getEquity, getFno } from "./indmoneyInstruments.mjs";
import { listRawOrders, orderStatusOf } from "./indmoneyPortfolio.mjs";

const VENUE = { NSE: ["NSE", "EQUITY"], BSE: ["BSE", "EQUITY"], NFO: ["NSE", "DERIVATIVE"], BFO: ["BSE", "DERIVATIVE"] };
const ALGO_ID = { NSE: "99999", BSE: "9999999999999999" };
const PRODUCTS = new Set(["CNC", "INTRADAY", "MARGIN"]);
const ORDER_ID_RE = /^(EQ|DRV)-\d{1,20}$/;

export const ORDER_FEATURES = {
  bracket: false, // SL/target legs are Smart Orders (GTT), not built here
  cover: false,
  ioc: true, // documented on /order (see the annexure caveat above)
  mtf: false,
  nativeMarketProtection: false, // MARKET is converted to LIMIT by INDstocks; no protection field
  maxLegQty: null,
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const isPositive = (v) => Number.isFinite(v) && v > 0;

/**
 * Pure body builder. order: { securityId | token, exchange (NSE|BSE|NFO|BFO), side, orderType (LIMIT|MARKET),
 * product, validity, lots, price }. `resolvedLotSize` comes from the instrument master, never the client.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { exchange, side, orderType = "LIMIT", product = "INTRADAY", validity = "DAY", lots, price } = order || {};
  const securityId = String(order?.securityId ?? order?.token ?? "");
  if (!/^\d{1,20}$/.test(securityId)) throw bad("IndMoney orders need the numeric security id from the instrument master");
  const venue = VENUE[exchange];
  if (!venue) throw bad(`Invalid exchange: ${exchange} (NSE, BSE, NFO or BFO)`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const type = String(orderType).toUpperCase();
  if (type !== "LIMIT" && type !== "MARKET") throw bad(`Unsupported IndMoney order type: ${orderType} (LIMIT or MARKET; stop-loss needs a Smart Order)`);
  if (!PRODUCTS.has(product)) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  if (venue[1] === "DERIVATIVE" && product === "CNC") throw bad("CNC is for equity delivery; use MARGIN or INTRADAY for F&O");
  if (validity !== "DAY" && validity !== "IOC") throw bad(`Unsupported validity: ${validity} (DAY or IOC)`);
  if (!isPositive(resolvedLotSize)) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  if (type === "LIMIT" && !isPositive(price)) throw bad("price required for LIMIT");
  const body = {
    txn_type: side,
    exchange: venue[0],
    segment: venue[1],
    product,
    order_type: type,
    validity,
    security_id: securityId,
    qty: Math.round(lots * resolvedLotSize),
    algo_id: ALGO_ID[venue[0]],
    is_amo: false,
  };
  if (type === "LIMIT") body.limit_price = price;
  return body;
}

export function segmentOfOrderId(orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid IndMoney order id (expected EQ-... or DRV-...)");
  return id.startsWith("DRV-") ? "DERIVATIVE" : "EQUITY";
}

/** Pure modify body; qty/price default to the order-book row. */
export function buildModifyBody(orderId, changes, original) {
  const segment = segmentOfOrderId(orderId);
  const { qty, price } = changes || {};
  const quantity = qty !== undefined ? qty : Number(original?.requested_qty);
  const limit = price !== undefined ? price : Number(String(original?.requested_price ?? "").replace(/,/g, ""));
  if (!Number.isInteger(quantity) || quantity <= 0) throw bad("qty must be a positive whole number of units");
  if (!isPositive(limit)) throw bad("price required (IndMoney modifies the limit price)");
  return { order_id: String(orderId).trim(), segment, qty: quantity, limit_price: limit };
}

async function resolveSecurityId(creds, order) {
  if (/^\d{1,20}$/.test(String(order?.securityId ?? order?.token ?? ""))) return order;
  const ex = order?.exchange;
  const master = ex === "NFO" || ex === "BFO" ? await getFno(creds) : await getEquity(creds);
  const row = master.find((m) => m.exchange === ex && m.tradingSymbol === order?.tradingSymbol);
  if (!row) throw bad(`IndMoney: ${order?.tradingSymbol} is not in the ${ex} instrument master`);
  return { ...order, securityId: row.token };
}

function ackOf(json, fallbackId, what) {
  const orderId = String(json?.data?.order_id ?? fallbackId ?? "").trim();
  if (!orderId) throw new BrokerError(`IndMoney accepted the ${what} request but returned no order id. ${ORDER_BOOK_HINT}`);
  return { orderId, orderStatus: orderStatusOf(json?.data?.order_status) };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  buildOrderBody({ ...order, securityId: order?.securityId ?? order?.token ?? "0" }, resolvedLotSize); // validate before any download
  const body = buildOrderBody(await resolveSecurityId(creds, order), resolvedLotSize);
  return ackOf(await indRequest(creds, "/order", { method: "POST", body }), null, "order");
}

async function modifyOrderImpl(creds, orderId, changes) {
  segmentOfOrderId(orderId);
  let original = null;
  if (changes?.qty === undefined || changes?.price === undefined) {
    original = (await listRawOrders(creds)).find((o) => String(o.id) === String(orderId).trim());
    if (!original) throw bad(`IndMoney order ${orderId} is not in today's order book`);
  }
  const body = buildModifyBody(orderId, changes, original);
  return ackOf(await indRequest(creds, "/order/modify", { method: "POST", body }), orderId, "modify");
}

async function cancelOrderImpl(creds, orderId) {
  const segment = segmentOfOrderId(orderId);
  return ackOf(await indRequest(creds, "/order/cancel", { method: "POST", body: { order_id: String(orderId).trim(), segment } }), orderId, "cancel");
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "indmoney" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "indmoney" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "indmoney" });
