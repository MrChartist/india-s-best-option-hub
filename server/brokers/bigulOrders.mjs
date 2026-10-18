/**
 * Bigul orders (real money). Every exported call is wrapped with withOrderGate(); no route mints Bigul gates.
 *
 * Official docs (checked 2026-10): https://connect.bigul.co/docs#place_order_api, #modify_order_api, #cancel_order_api:
 *  - POST /order/vr-place  { source, clientCode, es, pc, pr, mp, pt, qt, rt, tk, tp, ts, tt, am, os, bc, cf, pf, ur, ut, dq }
 *      es nse_cm|bse_cm|nse_fo|bse_fo · pc CNC|MIS|NRML · pt M/MKT|L|SL|SL-M · rt DAY|IOC|GTC|GTD · tt B|S ·
 *      tp 0 unless a stop order · am NO · cf C · pf N · dq 0  -> data.nOrdNo
 *  - POST /order/vr-modify { source, clientCode, no, vd, es, pc, pr, mp, pt, qt, rt, tk, tp, ts, tt, am, sr, au, dq }
 *      The whole order is resent, so the live order-book row is read first. sr ("scrip name") is sent as the row's
 *      trading symbol and au as "PENDING" (the docs' sample value); both need a live check.
 *  - POST /order/cancel    { source, clientCode, on, am: "NO" }  -> data.result
 *  - Limits: 10 orders a second, 2,000 API orders a day, order:trade ratio 49:1.
 * Only priced orders are built (LIMIT and SL with DAY or IOC validity); market and SL-M orders are refused here.
 */

import { BrokerError, BrokerInputError, withOrderGate } from "./contract.mjs";
import { bgRequest } from "./bigulAuth.mjs";
import { findByRef } from "./bigulInstruments.mjs";
import { readOrderRows } from "./bigulPortfolio.mjs";

export const ORDER_FEATURES = {
  bracket: false,
  cover: false,
  ioc: true, // rt IOC is documented.
  mtf: false,
  nativeMarketProtection: false, // "mp" exists for market orders, which are not sent.
  maxLegQty: null, // per-contract FREEZEQTY is in the master; no API-wide cap is documented.
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const PRODUCT_CODE = { CNC: "CNC", INTRADAY: "MIS", MARGIN: "NRML" };
const PRICE_TYPE = { LIMIT: "L", SL: "SL", STOPLOSS_LIMIT: "SL" };
const VALIDITY = new Set(["DAY", "IOC"]);
const CASH = new Set(["NSE", "BSE"]);
const ORDER_NO_RE = /^\d{1,25}$/;
const bad = (m) => new BrokerInputError(m);
const fmt = (n) => String(n);

function priceFields(orderType, price, triggerPrice) {
  const pt = PRICE_TYPE[orderType];
  if (!pt) throw bad(`Bigul orders from this terminal must be LIMIT or SL (got ${orderType}); market and SL-M orders are not sent.`);
  if (!(Number.isFinite(price) && price > 0)) throw bad(`price required for ${orderType}`);
  if (pt === "SL" && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw bad("triggerPrice required for SL");
  return { pr: fmt(price), pt, tp: pt === "SL" ? fmt(triggerPrice) : "0" };
}

/**
 * Pure place body. order: { token, exchange, side, orderType LIMIT|SL, product CNC|INTRADAY|MARGIN, validity DAY|IOC,
 * lots, price, triggerPrice? }. `instrument` is the master row for order.token/exchange; `resolvedLotSize` comes from the
 * master, never from the client.
 */
export function buildOrderBody(order, resolvedLotSize, instrument) {
  const { exchange, side, orderType = "LIMIT", product = "INTRADAY", validity = "DAY", lots, price, triggerPrice } = order || {};
  if (!instrument || instrument.token !== String(order?.token ?? "") || instrument.exchange !== exchange) throw bad("Bigul: order instrument not found in the master");
  if (instrument.instrumentType === "INDEX") throw bad("Bigul: an index cannot be traded");
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  if (!VALIDITY.has(validity)) throw bad(`Invalid validity: ${validity} (DAY or IOC)`);
  const pc = PRODUCT_CODE[product];
  if (!pc) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  if (product === "CNC" && !CASH.has(exchange)) throw bad("CNC applies to cash only; use MARGIN (NRML) for F&O carry-forward.");
  if (product === "MARGIN" && CASH.has(exchange)) throw bad("MARGIN (NRML) is for derivatives only");
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) throw bad("Missing resolved lot size — it must come from the instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  return {
    es: instrument.segment,
    pc,
    ...priceFields(orderType, price, triggerPrice),
    mp: "0",
    qt: fmt(Math.round(lots * resolvedLotSize)),
    rt: validity,
    tk: instrument.token,
    ts: instrument.tradingSymbol,
    tt: side === "BUY" ? "B" : "S",
    am: "NO",
    os: "API",
    bc: "1",
    cf: "C",
    pf: "N",
    ur: "mrchub",
    ut: "",
    dq: "0",
  };
}

/** Pure modify body from the live order-book row. changes: { orderType LIMIT|SL, qty (units), price, triggerPrice?, validity? }. */
export function buildModifyBody(row, changes) {
  const { orderType = "LIMIT", qty, price, triggerPrice, validity = "DAY" } = changes || {};
  if (!row?.nOrdNo) throw bad("Bigul: the order is not in today's order book");
  if (!Number.isInteger(qty) || qty <= 0) throw bad("qty must be a positive whole number of units");
  if (!VALIDITY.has(validity)) throw bad(`Invalid validity: ${validity}`);
  return {
    no: String(row.nOrdNo),
    vd: validity,
    es: String(row.exSeg ?? ""),
    pc: String(row.prod ?? ""),
    ...priceFields(orderType, price, triggerPrice),
    mp: "0",
    qt: fmt(qty),
    rt: validity,
    tk: String(row.tok ?? ""),
    ts: String(row.trdSym ?? ""),
    tt: String(row.trnsTp ?? ""),
    am: "NO",
    sr: String(row.trdSym ?? ""),
    au: "PENDING",
    dq: "0",
  };
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const body = buildOrderBody(order, resolvedLotSize, await findByRef(order));
  const data = await bgRequest(creds, "/order/vr-place", { body, kind: "write" });
  const orderId = String(data?.nOrdNo ?? "");
  if (!orderId) throw new BrokerError("Bigul order: no order number returned. Open the order book to confirm whether the order went through before you place it again.");
  return { orderId, orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_NO_RE.test(id)) throw bad("Invalid Bigul order number");
  const row = (await readOrderRows(creds)).find((o) => String(o.nOrdNo) === id);
  if (!row) throw new BrokerError(`Bigul: order ${id} is not in today's order book.`);
  const data = await bgRequest(creds, "/order/vr-modify", { body: buildModifyBody(row, changes), kind: "write" });
  return { orderId: String(data?.nOrdNo ?? id), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_NO_RE.test(id)) throw bad("Invalid Bigul order number");
  // An accepted cancel request is not proof of cancellation; panic flows re-read the order book.
  const data = await bgRequest(creds, "/order/cancel", { body: { on: id, am: "NO" }, kind: "write" });
  return { orderId: String(data?.result ?? id), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "bigul" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "bigul" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "bigul" });
