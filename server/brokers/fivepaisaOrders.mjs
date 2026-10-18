/**
 * 5paisa orders (real money). Every exported call is wrapped with withOrderGate(); no route mints 5paisa gates
 * today, so these stay unreachable from the browser until the owner reviews a 5paisa order path.
 *
 * Official docs (https://xstream.5paisa.com/dev-docs/order-management-system/*, checked 2026-10):
 *  - POST .../Service1.svc/V1/PlaceOrderRequest  body { Exchange N|B|M, ExchangeType C|D|U, ScripCode, ScripData,
 *    Price, StopLossPrice, OrderType B|S, Qty (units), DisQty, IsIntraday, isMTF, iOrderValidity, AHPlaced Y|N,
 *    RemoteOrderID, AlgoID (0 for non-algo users) } -> body { BrokerOrderID, ExchOrderID, Status, Message, RMSResponseCode }.
 *    HTTP 200 + head "Success" can still carry an RMS rejection in body.Status/Message, so the body is checked.
 *  - POST .../V1/ModifyOrderRequest  body { ExchOrderID, Price, Qty, StopLossPrice, DisQty }
 *  - POST .../V1/CancelOrderRequest  body { ExchOrderID }
 *  Modify/cancel are keyed by the EXCHANGE order id, so the order book is read first to resolve it from the
 *  5paisa BrokerOrderId we hand out (an order still at 5paisa with no exchange id cannot be cancelled yet).
 *
 * Only LIMIT and stop-loss LIMIT orders with DAY validity are built: 5paisa treats Price 0 as a market order and
 * plain market orders have been observed being refused by 5paisa's RMS (not in the official docs); the SEBI retail-algo framework also
 * expects priced orders. Quantity = lots x the lot size resolved from the scrip master (never from the client).
 */

import { BrokerError, BrokerInputError, withOrderGate } from "./contract.mjs";
import { authenticatedPost } from "./fivepaisaAuth.mjs";
import { brokerSegment } from "./fivepaisaInstruments.mjs";
import { readOrderBookRows } from "./fivepaisaPortfolio.mjs";

/** Legacy order-feature descriptor (conservative). */
export const ORDER_FEATURES = {
  bracket: false, // DelvIntra "S" exists in the order book but the place-order doc has no bracket fields.
  cover: false,
  ioc: false, // OrderValidity 3 (IOC) is listed for the order book only; the place-order field table has no IOC field.
  mtf: false, // isMTF is documented; not offered from this terminal.
  nativeMarketProtection: false,
  maxLegQty: null, // per-contract QtyLimit is in the scrip master; no API-wide cap is documented.
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const ORDER_TYPES = new Set(["LIMIT", "STOPLOSS_LIMIT"]);
const bad = (m) => new BrokerInputError(m);

let remoteSeq = 0;
/** A short unique RemoteOrderID (the doc marks it mandatory and user-defined). */
export function newRemoteOrderId(now = Date.now()) {
  remoteSeq = (remoteSeq + 1) % 1296;
  return `MRC${now.toString(36).toUpperCase()}${remoteSeq.toString(36).toUpperCase().padStart(2, "0")}`;
}

/**
 * Pure body builder. order: { token, exchange, side, orderType: LIMIT|STOPLOSS_LIMIT, product: CNC|INTRADAY|MARGIN,
 * lots, price, triggerPrice? }. `resolvedLotSize` comes from the scrip master.
 */
export function buildOrderBody(order, resolvedLotSize, remoteOrderId = newRemoteOrderId()) {
  const { token, exchange, side, orderType = "LIMIT", product = "INTRADAY", lots, price, triggerPrice } = order || {};
  if (!/^\d{1,12}$/.test(String(token ?? ""))) throw bad("Invalid 5paisa ScripCode");
  if (!["NSE", "BSE", "NFO", "BFO"].includes(exchange)) throw bad(`Invalid exchange for 5paisa orders: ${exchange}`);
  const seg = brokerSegment(exchange);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (orderType === "MARKET" || orderType === "STOPLOSS_MARKET") throw bad("5paisa orders from this terminal must be priced (LIMIT or STOPLOSS_LIMIT).");
  if (!ORDER_TYPES.has(orderType)) throw bad(`Unsupported 5paisa order type: ${orderType}`);
  if (!["CNC", "INTRADAY", "MARGIN"].includes(product)) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  if (product === "CNC" && seg.exchType !== "C") throw bad("CNC (delivery) applies to NSE/BSE cash only; use MARGIN for F&O carry-forward.");
  if (product === "MARGIN" && seg.exchType !== "D") throw bad("MARGIN (carry-forward) applies to F&O; use CNC for cash delivery.");
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  }
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required for a limit order");
  const stop = orderType === "STOPLOSS_LIMIT";
  if (stop && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for STOPLOSS_LIMIT");
  return {
    Exchange: seg.exch,
    ExchangeType: seg.exchType,
    ScripCode: Number(token),
    ScripData: "",
    Price: price,
    StopLossPrice: stop ? triggerPrice : 0,
    OrderType: side === "BUY" ? "B" : "S",
    Qty: Math.round(lots * resolvedLotSize),
    DisQty: 0,
    IsIntraday: product === "INTRADAY",
    isMTF: false,
    iOrderValidity: 0,
    AHPlaced: "N",
    RemoteOrderID: remoteOrderId,
    AlgoID: 0,
  };
}

/** Pure modify body. changes: { price, qty (units), triggerPrice? } */
export function buildModifyBody(exchOrderId, changes) {
  const { price, qty, triggerPrice } = changes || {};
  if (!/^\d{1,25}$/.test(String(exchOrderId ?? ""))) throw bad("Invalid 5paisa exchange order id");
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required");
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  if (triggerPrice !== undefined && !(Number.isFinite(triggerPrice) && triggerPrice >= 0)) throw bad("Invalid triggerPrice");
  return { ExchOrderID: String(exchOrderId), Price: price, Qty: qty, StopLossPrice: triggerPrice ?? 0, DisQty: 0 };
}

function assertAccepted(json, label) {
  const body = json?.body;
  if (!body || Number(body.Status) !== 0) {
    throw new BrokerError(`5paisa ${label} rejected: ${body?.Message || json?.head?.statusDescription || "no reason given"}`);
  }
  return body;
}

const ORDER_ID_RE = /^\d{1,25}$/;

/** Resolve the exchange order id from the order book (by BrokerOrderId or ExchOrderID). */
async function resolveExchOrderId(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid 5paisa order id");
  const rows = await readOrderBookRows(creds);
  const row = rows.find((o) => String(o.BrokerOrderId) === id || String(o.ExchOrderID) === id);
  if (!row) throw new BrokerError(`5paisa: order ${id} is not in today's order book.`);
  const exch = String(row.ExchOrderID ?? "").trim();
  if (!exch || exch === "0") throw new BrokerError(`5paisa: order ${id} has not reached the exchange yet, so it cannot be changed. Refresh and try again.`);
  return { exchOrderId: exch, brokerOrderId: String(row.BrokerOrderId ?? id) };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const body = buildOrderBody(order, resolvedLotSize);
  const res = assertAccepted(await authenticatedPost(creds, "/V1/PlaceOrderRequest", () => body), "order");
  if (!res.BrokerOrderID || Number(res.BrokerOrderID) === 0) throw new BrokerError(`5paisa order rejected: ${res.Message || "no order id returned"}`);
  // Placement returns ids only; the state is known only once the order book is read.
  return { orderId: String(res.BrokerOrderID), orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const { exchOrderId, brokerOrderId } = await resolveExchOrderId(creds, orderId);
  const body = buildModifyBody(exchOrderId, changes);
  const res = assertAccepted(await authenticatedPost(creds, "/V1/ModifyOrderRequest", () => body), "modify");
  return { orderId: String(res.BrokerOrderID || brokerOrderId), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  const { exchOrderId, brokerOrderId } = await resolveExchOrderId(creds, orderId);
  assertAccepted(await authenticatedPost(creds, "/V1/CancelOrderRequest", () => ({ ExchOrderID: exchOrderId })), "cancel");
  // A successful cancel request is not proof of cancellation; panic flows re-read the book.
  return { orderId: brokerOrderId, orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "fivepaisa" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "fivepaisa" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "fivepaisa" });
