/**
 * Motilal Oswal portfolio reads (read-only).
 *
 * Official docs (https://invest.motilaloswal.com/moAPI/APIDocumentation/Introduction, checked 2026-10). Each is a POST
 * with no body for a client login (clientcode only for dealers) and answers { status, message, errorcode, data }:
 *  - /rest/book/v4/getposition            data[] { exchange, productname, symboltoken, symbol, buyquantity, buyamount,
 *                                         sellquantity, sellamount, LTP, marktomarket, bookedprofitloss, expirydate, strikeprice, optiontype }
 *  - /rest/report/v3/getdpholding         data[] { scripisinno, dpquantity, scripname, buyavgprice, bsescripcode, nsesymboltoken }
 *  - /rest/report/v3/getreportmarginsummary data[] { srno, particulars, amount } (102-106 available margin by segment,
 *                                         201 cash deposit, 220 non-cash deposit, 301-381 margin usage, 600 MTM)
 *  - /rest/book/v5/getorderbook           data[] { uniqueorderid, orderstatus, exchange, symboltoken, symbol, buyorsell, orderqty,
 *                                         qtytradedtoday, totalqtyremaining, price, triggerprice, averageprice, ordertype, producttype,
 *                                         error, entrydatetime, lastmodifiedtime, lotsize, recordinserttime, ... }
 *  - /rest/book/v4/gettradebook           data[] { tradeno, uniqueorderid, exchange, symboltoken, symbol, buyorsell, tradeqty,
 *                                         tradeprice, precision, tradetime, ... }
 * Order statuses ("Parameters / Constants"): Unknown, Sent, Confirm, Cancel, Partial, Traded, Rejected, Error.
 * Trade-book prices are integers scaled by 10^precision (doc sample: tradeprice 278400 x tradeqty 20 = tradevalue 5568000,
 * precision 2). The order book documents its prices as Decimal rupees and has no precision field, so it is not rescaled.
 * Products: NORMAL (carry-forward margin), DELIVERY, VALUEPLUS (margin intraday), BTST, SELLFROMDP, MTF.
 * "No data" replies (MO1013/MO1014/MO1015/MO1016) are empty books.
 */

import { BrokerError } from "./contract.mjs";
import { authPost } from "./motilalAuth.mjs";
import { contractExchange } from "./motilalInstruments.mjs";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const clean = (v) => (v === undefined || v === null || v === "" || String(v) === "0" ? null : String(v));

const PRODUCT_OF = { NORMAL: "MARGIN", DELIVERY: "CNC", VALUEPLUS: "INTRADAY", BTST: "CNC", SELLFROMDP: "CNC", MTF: "MTF" };
export const contractProduct = (p) => PRODUCT_OF[String(p || "").toUpperCase().replace(/\s+/g, "")] ?? "MARGIN";

const STATUS_OF = { traded: "COMPLETE", sent: "OPEN", confirm: "OPEN", partial: "PARTIALLY_FILLED", cancel: "CANCELLED", cancelled: "CANCELLED",
  rejected: "REJECTED", error: "REJECTED", unknown: "UNKNOWN" };
export const mapOrderStatus = (o) => STATUS_OF[String(o?.orderstatus ?? "").trim().toLowerCase()] ?? "UNKNOWN";

const EMPTY_CODES = new Set(["MO1013", "MO1014", "MO1015", "MO1016"]);

export async function bookRows(creds, endpointKey) {
  const json = await authPost(creds, endpointKey);
  if (String(json?.status).toUpperCase() === "SUCCESS") return Array.isArray(json.data) ? json.data : [];
  if (EMPTY_CODES.has(String(json?.errorcode || "").toUpperCase())) return [];
  throw new BrokerError(`Motilal Oswal ${endpointKey}: ${json?.message || "request refused"}${json?.errorcode ? ` (${json.errorcode})` : ""}`);
}

/** Readable symbol: the underlying plus expiry/strike/option type for derivatives. */
function symbolOf(r) {
  const base = String(r.symbol ?? "").trim();
  const opt = String(r.optiontype ?? "").trim().toUpperCase();
  const exp = clean(r.expirydate);
  if (opt === "CE" || opt === "PE") return `${base} ${exp ?? ""} ${num(r.strikeprice)} ${opt}`.replace(/\s+/g, " ").trim();
  return exp ? `${base} ${exp} FUT` : base;
}

export function mapPosition(p) {
  const buyQty = num(p.buyquantity);
  const sellQty = num(p.sellquantity);
  const netQty = buyQty - sellQty;
  const realised = num(p.bookedprofitloss);
  const unrealised = num(p.marktomarket);
  const avgPrice = netQty > 0 && buyQty ? num(p.buyamount) / buyQty : netQty < 0 && sellQty ? num(p.sellamount) / sellQty : 0;
  return {
    tradingSymbol: symbolOf(p),
    exchange: contractExchange(p.exchange),
    token: String(p.symboltoken ?? ""),
    product: contractProduct(p.productname),
    netQty,
    avgPrice: Math.round(avgPrice * 10000) / 10000,
    ltp: numOrNull(p.LTP ?? p.ltp),
    pnl: realised + unrealised,
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

export function mapHolding(h) {
  const nse = numOrNull(h.nsesymboltoken);
  return {
    tradingSymbol: String(h.scripname ?? "").replace(/\s+EQ$/i, "").trim(),
    exchange: nse ? "NSE" : "BSE",
    token: String(nse ?? h.bsescripcode ?? ""),
    isin: h.scripisinno ? String(h.scripisinno) : null,
    qty: num(h.dpquantity),
    avgPrice: num(h.buyavgprice),
    ltp: null,
    pnl: null,
  };
}

/** Margin summary rows -> Funds (F&O available margin first, cash as the fallback). */
export function mapFunds(rows) {
  const by = new Map(rows.map((r) => [Number(r.srno), num(r.amount)]));
  const usage = rows.filter((r) => Number(r.srno) >= 300 && Number(r.srno) < 400).reduce((s, r) => s + num(r.amount), 0);
  const cash = by.get(201);
  const nonCash = by.get(220);
  return {
    availableCash: by.get(103) ?? by.get(102) ?? 0,
    usedMargin: usage,
    totalBalance: cash === undefined && nonCash === undefined ? null : (cash ?? 0) + (nonCash ?? 0),
    collateral: nonCash ?? null,
    withdrawable: null,
  };
}

function orderTypeOf(o) {
  const t = String(o.ordertype ?? "").toUpperCase();
  if (t === "STOPLOSS") return num(o.price) > 0 ? "STOPLOSS_LIMIT" : "STOPLOSS_MARKET";
  return t || "UNKNOWN";
}

export function mapOrder(o) {
  const qty = num(o.orderqty);
  const filled = num(o.qtytradedtoday ?? o.totalqtytraded);
  return {
    orderId: String(o.uniqueorderid ?? ""),
    tradingSymbol: symbolOf(o),
    exchange: contractExchange(o.exchange),
    token: String(o.symboltoken ?? ""),
    side: String(o.buyorsell ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty,
    filledQty: filled,
    pendingQty: o.totalqtyremaining !== undefined ? num(o.totalqtyremaining) : Math.max(qty - filled, 0),
    price: num(o.price),
    triggerPrice: num(o.triggerprice),
    avgPrice: num(o.averageprice),
    orderType: orderTypeOf(o),
    product: contractProduct(o.producttype),
    status: mapOrderStatus(o),
    statusMessage: o.error ? String(o.error) : null,
    placedAt: clean(o.entrydatetime) ?? clean(o.recordinserttime),
  };
}

export function mapTrade(t) {
  const precision = Number.isInteger(Number(t.precision)) && Number(t.precision) > 0 && Number(t.precision) <= 8 ? Number(t.precision) : 2;
  return {
    tradeId: String(t.tradeno ?? ""),
    orderId: String(t.uniqueorderid ?? t.orderid ?? ""),
    tradingSymbol: symbolOf(t),
    exchange: contractExchange(t.exchange),
    token: String(t.symboltoken ?? ""),
    side: String(t.buyorsell ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: num(t.tradeqty),
    price: num(t.tradeprice) / 10 ** precision,
    tradedAt: clean(t.tradetime),
  };
}

export const readOrderRows = (creds) => bookRows(creds, "getorderbook");

export async function fetchPositions(creds) {
  return { status: "success", data: (await bookRows(creds, "getposition")).map(mapPosition) };
}
export async function fetchHoldings(creds) {
  return { status: "success", data: (await bookRows(creds, "getdpholding")).map(mapHolding) };
}
export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds(await bookRows(creds, "getreportmarginsummary")) };
}
export async function fetchOrderBook(creds) {
  return { status: "success", data: (await readOrderRows(creds)).map(mapOrder) };
}
export async function fetchTradeBook(creds) {
  return { status: "success", data: (await bookRows(creds, "gettradebook")).map(mapTrade) };
}
