/**
 * Zebu (MYNT) orders (real money, gated).
 *
 * Official docs (https://zebumyntapi.web.app/OAuth/Order/, checked 2026-10):
 *  - PlaceOrder { uid, actid, exch, tsym, qty, prc, trgprc (SL only), dscqty, prd (C / M / H; the sample
 *    uses I for intraday), trantype (B / S), prctyp (LMT / MKT / SL-LMT / SL-MKT), ret (DAY / EOS / IOC),
 *    remarks, mkt_protection (MKT orders on BSE / BFO / MCX) } -> { stat: "Ok", norenordno }.
 *    `ordersource` is documented as MOB / WEB / TT, so it is not sent (OpenAlgo sends "API").
 *  - ModifyOrder { uid, actid, exch, norenordno, prctyp, prc, qty (total, not pending), tsym (unchanged),
 *    ret, trgprc, mkt_protection } -> { stat: "Ok", result }. The original order is read from OrderBook.
 *  - CancelOrder { uid, norenordno } -> { stat: "Ok", result }.
 *  - Values travel as strings; qty is in units.
 * The shared server/brokers/oms-noren.mjs is not used: its acknowledgement status ("PENDING") is not a
 * contract status and it sends ordersource "API". Every call is wrapped with withOrderGate(); no route
 * mints Zebu gates today.
 */

import { BrokerError, BrokerInputError, withOrderGate } from "./contract.mjs";
import { postJData, isNoData, expectOk } from "./zebuAuth.mjs";

const PRODUCT_CODE = { CNC: "C", INTRADAY: "I", MARGIN: "M" };
const PRICE_TYPE = { LIMIT: "LMT", MARKET: "MKT", STOPLOSS_LIMIT: "SL-LMT", STOP_LOSS: "SL-LMT", SL: "SL-LMT",
  STOPLOSS_MARKET: "SL-MKT", STOP_LOSS_MARKET: "SL-MKT", "SL-M": "SL-MKT", LMT: "LMT", MKT: "MKT", "SL-LMT": "SL-LMT", "SL-MKT": "SL-MKT" };
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO"]);
const VALIDITY = new Set(["DAY", "IOC"]);
const PROTECTION_EXCHANGES = new Set(["BSE", "BFO"]);

export const ORDER_FEATURES = {
  bracket: false, // product B exists in the docs but is not built here
  cover: false, // product H likewise
  ioc: true, // ret IOC is documented
  mtf: false, // no MTF product code in Zebu's docs
  nativeMarketProtection: false, // mkt_protection only applies to BSE/BFO/MCX market orders
  maxLegQty: null, // no per-order cap documented beyond exchange freeze limits
  products: ["CNC", "INTRADAY", "MARGIN"],
};

const bad = (m) => new BrokerInputError(m);
const isPositive = (v) => Number.isFinite(v) && v > 0;

function priceTypeOf(t) {
  const out = PRICE_TYPE[String(t ?? "LIMIT").toUpperCase()];
  if (!out) throw bad(`Unsupported Zebu order type: ${t} (LIMIT, MARKET, STOPLOSS_LIMIT or STOPLOSS_MARKET)`);
  return out;
}

/**
 * Pure body builder (uid/actid are added by postJData). order: { tradingSymbol, exchange, side, orderType,
 * product, validity, lots, price, triggerPrice?, marketProtectionPercent?, tag? }.
 * `resolvedLotSize` must come from the symbol master, never from the client.
 */
export function buildOrderBody(order, resolvedLotSize) {
  const { tradingSymbol, exchange, side, orderType, product = "INTRADAY", validity = "DAY", lots, price, triggerPrice, marketProtectionPercent, tag } = order || {};
  if (typeof tradingSymbol !== "string" || !/^[A-Za-z0-9&_.-]{1,40}$/.test(tradingSymbol)) throw bad(`Invalid Zebu trading symbol: ${tradingSymbol}`);
  if (!EXCHANGES.has(exchange)) throw bad(`Invalid exchange: ${exchange}`);
  if (side !== "BUY" && side !== "SELL") throw bad(`Invalid side: ${side}`);
  const prctyp = priceTypeOf(orderType);
  const prd = PRODUCT_CODE[product];
  if (!prd) throw bad(`Unsupported product: ${product} (CNC, INTRADAY or MARGIN)`);
  if (!VALIDITY.has(validity)) throw bad(`Unsupported validity: ${validity} (DAY or IOC)`);
  if (!isPositive(resolvedLotSize)) throw bad("Missing resolved lot size — it must come from the exchange instrument master, not from the client");
  if (!Number.isInteger(lots) || lots <= 0) throw bad("Invalid lots");
  const isLimit = prctyp === "LMT" || prctyp === "SL-LMT";
  const isStop = prctyp.startsWith("SL-");
  if (isLimit && !isPositive(price)) throw bad(`price required for ${prctyp}`);
  if (isStop && !isPositive(triggerPrice)) throw bad(`triggerPrice required for ${prctyp}`);
  const body = {
    exch: exchange,
    tsym: tradingSymbol,
    qty: String(Math.round(lots * resolvedLotSize)),
    prc: isLimit ? String(price) : "0",
    dscqty: "0",
    prd,
    trantype: side === "BUY" ? "B" : "S",
    prctyp,
    ret: validity,
  };
  if (isStop) body.trgprc = String(triggerPrice);
  if (tag !== undefined) body.remarks = String(tag).slice(0, 40);
  if ((prctyp === "MKT" || prctyp === "SL-MKT") && PROTECTION_EXCHANGES.has(exchange)) {
    const mp = Number(marketProtectionPercent);
    if (!(mp > 0 && mp <= 20)) throw bad("marketProtectionPercent (0-20) is required for Zebu market orders on BSE/BFO");
    body.mkt_protection = String(mp);
  }
  return body;
}

const ORDER_ID_RE = /^[A-Za-z0-9]{1,30}$/;

/** Pure modify body. `original` is the OrderBook row; changes: { orderType?, price?, qty? (total units), triggerPrice?, validity? }. */
export function buildModifyBody(orderId, changes, original) {
  const norenordno = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(norenordno)) throw bad("Invalid Zebu order number");
  if (!original) throw bad(`Zebu order ${norenordno} is not in today's order book`);
  const { orderType, price, qty, triggerPrice, validity } = changes || {};
  const prctyp = priceTypeOf(orderType ?? original.prctyp);
  const quantity = qty !== undefined ? qty : Number(original.qty);
  if (!Number.isInteger(quantity) || quantity <= 0) throw bad("qty must be the order's total quantity in units");
  const newPrice = price !== undefined ? price : Number(original.prc);
  const newTrigger = triggerPrice !== undefined ? triggerPrice : Number(original.trgprc);
  const isLimit = prctyp === "LMT" || prctyp === "SL-LMT";
  const isStop = prctyp.startsWith("SL-");
  if (isLimit && !isPositive(newPrice)) throw bad("price required");
  if (isStop && !isPositive(newTrigger)) throw bad("triggerPrice required");
  const ret = validity ?? original.ret ?? "DAY";
  if (!VALIDITY.has(ret)) throw bad(`Unsupported validity: ${ret}`);
  const body = { exch: String(original.exch ?? ""), norenordno, prctyp, prc: isLimit ? String(newPrice) : "0", qty: String(quantity), tsym: String(original.tsym ?? ""), ret };
  if (isStop) body.trgprc = String(newTrigger);
  return body;
}

async function placeOrderImpl(creds, order, resolvedLotSize) {
  const json = await postJData(creds, "/PlaceOrder", buildOrderBody(order, resolvedLotSize));
  if (json?.stat !== "Ok" || !json?.norenordno) throw new BrokerError(`Zebu order refused: ${String(json?.emsg || "no order number returned").slice(0, 160)}`);
  return { orderId: String(json.norenordno), orderStatus: "UNKNOWN" };
}

async function modifyOrderImpl(creds, orderId, changes) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Zebu order number");
  const book = await postJData(creds, "/OrderBook", {}, { actid: false });
  if (!Array.isArray(book) && !isNoData(book)) expectOk(book, "OrderBook");
  const rows = Array.isArray(book) ? book : [];
  const original = rows.find((r) => String(r?.norenordno ?? "") === id);
  const json = expectOk(await postJData(creds, "/ModifyOrder", buildModifyBody(id, changes, original)), "ModifyOrder");
  return { orderId: String(json?.result || id), orderStatus: "UNKNOWN" };
}

async function cancelOrderImpl(creds, orderId) {
  const id = String(orderId ?? "").trim();
  if (!ORDER_ID_RE.test(id)) throw bad("Invalid Zebu order number");
  const json = expectOk(await postJData(creds, "/CancelOrder", { norenordno: id }, { actid: false }), "CancelOrder");
  // A cancel request is not proof of cancellation; panic flows re-read the book.
  return { orderId: String(json?.result || id), orderStatus: "UNKNOWN" };
}

export const placeOrder = withOrderGate("placeOrder", placeOrderImpl, { brokerId: "zebu" });
export const modifyOrder = withOrderGate("modifyOrder", modifyOrderImpl, { brokerId: "zebu" });
export const cancelOrder = withOrderGate("cancelOrder", cancelOrderImpl, { brokerId: "zebu" });
