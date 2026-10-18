/**
 * Kotak Securities (Neo) orders (real money). Every exported call is wrapped with withOrderGate(); no route mints
 * Kotak gates today.
 *
 * Official source: https://github.com/Kotak-Neo/Kotak-neo-api-v2 docs/Place_Order.md, Modify_Order.md,
 * Cancel_Order.md and neo_api_client/api/order_api.py + modify_order_api.py (checked 2026-10):
 *  - POST <baseUrl>/quick/order/rule/ms/place?sId=..  jData { am, dq, es, mp, pc, pf, pr, pt, qt, rt, tp, ts, tt, os }
 *      es nse_cm|bse_cm|nse_fo|bse_fo|cde_fo|mcx_fo · pc NRML|CNC|MIS|CO|BO|MTF · pt L|MKT|SL|SL-M ·
 *      rt DAY|IOC|GTC|EOS|GTD · tt B|S · ts = pTrdSymbol from the scrip master  -> { stat: "Ok", nOrdNo, stCode: 200 }
 *  - POST <baseUrl>/quick/order/vr/modify  jData { tk, mp, pc, dd: "NA", dq, vd, ts, tt, pr, pt, fq, am, tp, qt, no, es, os }
 *      (the full order is resent, so the current order-book row is read first)
 *  - POST <baseUrl>/quick/order/cancel     jData { on: <order no>, am: "NO" }
 * Only LIMIT (L) and stop-loss limit (SL) orders with DAY validity are built (no market orders from this terminal).
 */

import { BrokerError, BrokerInputError, withOrderGate } from "./contract.mjs";
import { ORDER_SOURCE, tradeRequest } from "./kotakAuth.mjs";
import { kotakSegment } from "./kotakInstruments.mjs";
import { readOrderRows } from "./kotakPortfolio.mjs";

export const ORDER_FEATURES = {
  bracket: false, // BO is in the enum but the exchange no longer offers it for most segments.
  cover: false,
  ioc: false, // documented validity; not offered from this terminal.
  mtf: false,
  nativeMarketProtection: false, // "mp" (market protection) exists for market orders, which we do not send.
  maxLegQty: null, // per-contract lFreezeQty is in the scrip master; no API-wide cap is documented.
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const PRODUCT_CODE = { CNC: "CNC", INTRADAY: "MIS", MARGIN: "NRML" };
const PRICE_TYPE = { LIMIT: "L", STOPLOSS_LIMIT: "SL" };
const bad = (m) => new BrokerInputError(m);
const fmt = (n) => String(n);

/**
 * Pure place body. order: { tradingSymbol (pTrdSymbol), exchange, side, orderType: LIMIT|STOPLOSS_LIMIT,
 * product: CNC|INTRADAY|MARGIN, lots, price, triggerPrice? }; `resolvedLotSize` comes from the scrip master.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { tradingSymbol, exchange, side, orderType = "LIMIT", product = "INTRADAY", lots, price, triggerPrice } = order || {};
  if (typeof tradingSymbol !== "string" || !/^[A-Za-z0-9&_.-]{1,50}$/.test(tradingSymbol)) throw bad(`Invalid Kotak trading symbol: ${tradingSymbol}`);
  if (!["NSE", "BSE", "NFO", "BFO"].includes(exchange)) throw bad(`Invalid exchange for Kotak orders: ${exchange}`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (orderType === "MARKET" || orderType === "STOPLOSS_MARKET") throw bad("Kotak Neo orders from this terminal must be priced (LIMIT or STOPLOSS_LIMIT).");
  const pt = PRICE_TYPE[orderType];
  if (!pt) throw bad(`Unsupported Kotak order type: ${orderType}`);
  const pc = PRODUCT_CODE[product];
  if (!pc) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  const fno = exchange === "NFO" || exchange === "BFO";
  if (product === "CNC" && fno) throw bad("CNC applies to cash only; use MARGIN (NRML) for F&O carry-forward.");
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  }
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required for a limit order");
  const stop = pt === "SL";
  if (stop && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for STOPLOSS_LIMIT");
  return {
    am: "NO", dq: "0", es: kotakSegment(exchange), mp: "0", pc, pf: "N", pr: fmt(price), pt,
    qt: fmt(Math.round(lots * resolvedLotSize)), rt: "DAY", tp: stop ? fmt(triggerPrice) : "0",
    ts: tradingSymbol, tt: side === "BUY" ? "B" : "S", os: ORDER_SOURCE,
  };
}

/** Pure modify body from the current order-book row + changes { price, qty (units), triggerPrice?, orderType? }. */
export function buildModifyBody(row, changes) {
  const { price, qty, triggerPrice, orderType } = changes || {};
  if (!row?.nOrdNo) throw bad("Order not found in the Kotak order book");
  if (!(Number.isFinite(price) && price > 0)) throw bad("price required");
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  const pt = orderType ? PRICE_TYPE[orderType] : row.prcTp;
  if (pt !== "L" && pt !== "SL") throw bad("Only LIMIT and STOPLOSS_LIMIT orders can be modified from this terminal");
  if (pt === "SL" && !(Number.isFinite(triggerPrice ?? Number(row.trgPrc)) && (triggerPrice ?? Number(row.trgPrc)) > 0)) throw bad("triggerPrice required for STOPLOSS_LIMIT");
  return {
    tk: String(row.tok ?? ""), mp: "0", pc: String(row.prod ?? ""), dd: "NA", dq: "0", vd: String(row.vldt || "DAY"),
    ts: String(row.trdSym ?? ""), tt: String(row.trnsTp ?? ""), pr: fmt(price), pt, fq: fmt(Number(row.fldQty) || 0), am: "NO",
    tp: pt === "SL" ? fmt(triggerPrice ?? Number(row.trgPrc)) : "0", qt: fmt(qty), no: String(row.nOrdNo), es: String(row.exSeg ?? ""), os: ORDER_SOURCE,
  };
}

const ORDER_NO_RE = /^\d{1,25}$/;

function ack(json, fallbackId, label) {
  if (String(json?.stat ?? "").toLowerCase() !== "ok") throw new BrokerError(`Kotak Neo ${label} rejected: ${json?.emsg || json?.errMsg || "no reason given"}`);
  return { orderId: String(json?.nOrdNo || fallbackId || ""), orderStatus: "UNKNOWN" };
}

async function placeOrderImpl(session, order, resolvedLotSize) {
  const body = buildOrderBody(order, resolvedLotSize);
  const out = ack(await tradeRequest(session, "POST", "/quick/order/rule/ms/place", body), "", "order");
  if (!out.orderId) throw new BrokerError("Kotak Neo order: no order number returned");
  return out;
}

async function modifyOrderImpl(session, orderId, changes) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_NO_RE.test(id)) throw bad("Invalid Kotak order number");
  const row = (await readOrderRows(session)).find((o) => String(o.nOrdNo) === id);
  if (!row) throw new BrokerError(`Kotak Neo: order ${id} is not in today's order book.`);
  return ack(await tradeRequest(session, "POST", "/quick/order/vr/modify", buildModifyBody(row, changes)), id, "modify");
}

async function cancelOrderImpl(session, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_NO_RE.test(id)) throw bad("Invalid Kotak order number");
  // A successful cancel request is not proof of cancellation; panic flows re-read the book.
  return ack(await tradeRequest(session, "POST", "/quick/order/cancel", { on: id, am: "NO" }), id, "cancel");
}

/** Gated wrappers take creds; `toSession` (kotak.mjs) resolves the stored session first. */
export function gatedOrders(toSession) {
  return {
    placeOrder: withOrderGate("placeOrder", async (creds, order, lot) => placeOrderImpl(toSession(creds), order, lot), { brokerId: "kotak" }),
    modifyOrder: withOrderGate("modifyOrder", async (creds, orderId, changes) => modifyOrderImpl(toSession(creds), orderId, changes), { brokerId: "kotak" }),
    cancelOrder: withOrderGate("cancelOrder", async (creds, orderId) => cancelOrderImpl(toSession(creds), orderId), { brokerId: "kotak" }),
  };
}
