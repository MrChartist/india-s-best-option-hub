/**
 * mStock (Mirae Asset) Type B portfolio + books -> contract shapes. Read-only.
 *
 * Official docs (checked 2026-10):
 *  - GET /portfolio/positions -> data[] { exchange, symboltoken, producttype, tradingsymbol, symbolname,
 *    instrumenttype, netqty, avgnetprice, netprice, totalbuyvalue, totalsellvalue, buyqty, sellqty, ... }.
 *    The sample reports exchange "NSE" for an OPTIDX row, so derivatives are moved to NFO/BFO from
 *    instrumenttype. No LTP or P&L is documented, so P&L is the realised cash flow on the closed quantity.
 *    https://tradingapi.mstock.com/docs/v1/typeB/Position/
 *  - GET /portfolio/holdings -> data[] { tradingsymbol, exchange (null in the sample), isin, quantity,
 *    t1quantity, averageprice, ltp, symboltoken, close, profitandloss }. .../typeB/Portfolio/
 *  - GET /user/fundsummary -> data[0] { AVAILABLE_BALANCE, AMOUNT_UTILIZED, SUM_OF_ALL, COLLATERALS,
 *    PAY_OUT_AMT, ... }. .../typeB/User/
 *  - GET /orders -> data[] { orderid, tradingsymbol, symboltoken, exchange, instrumenttype, transactiontype,
 *    ordertype, producttype, price, triggerprice, quantity, filledshares, unfilledshares, averageprice,
 *    status/orderstatus ("Rejected", "Pending", ...), text, updatetime "2024-Nov-06 12:42:18" }.
 *  - GET /tradebook -> data[] { ORDER_NUMBER, TRADE_NUMBER, SYMBOL, EXCHANGE, SEC_ID, BUY_SELL, QUANTITY,
 *    PRICE, INSTRUMENT_NAME, SEGMENT, ORDER_DATE_TIME "10-06-2025 13:08:42" }. .../typeB/Orders/
 * Product codes (Orders glossary): DELIVERY (CNC), INTRADAY, MARGIN (margin delivery -> app MTF),
 * CARRYFORWARD (NRML -> app MARGIN).
 */

import { authRequest } from "./mstockAuth.mjs";

export const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(parseFloat(v)) ? num(v) : null);

const PRODUCT = { DELIVERY: "CNC", CNC: "CNC", INTRADAY: "INTRADAY", MIS: "INTRADAY", CARRYFORWARD: "MARGIN", NRML: "MARGIN", MARGIN: "MTF", MTF: "MTF", CO: "CO", BO: "BO" };
export const contractProduct = (p) => PRODUCT[String(p ?? "").trim().toUpperCase()] || "INTRADAY";

const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
const DERIV_TYPES = /^(OPT|FUT)/;

/** Contract exchange: derivatives reported as NSE/BSE move to NFO/BFO; unknown -> NSE. */
export function contractExchange(exchange, instrumentType) {
  const e = String(exchange ?? "").trim().toUpperCase();
  const deriv = DERIV_TYPES.test(String(instrumentType ?? "").toUpperCase());
  if (deriv && e === "NSE") return "NFO";
  if (deriv && e === "BSE") return "BFO";
  return EXCHANGES.has(e) ? e : "NSE";
}

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** IST timestamps in mStock's two documented layouts -> ISO with +05:30; raw text otherwise. */
export function mstockTimeToIso(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s); // 2024-Nov-06 12:42:18
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[1]}-${MONTHS[m[2].toUpperCase()]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s); // 10-06-2025 13:08:42
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  return s;
}

const list = (json) => (Array.isArray(json?.data) ? json.data : []);

export function mapPosition(row) {
  const netQty = num(row?.netqty);
  const buyQty = num(row?.buyqty) + num(row?.cfbuyqty);
  const sellQty = num(row?.sellqty) + num(row?.cfsellqty);
  const buyAvg = num(row?.buyavgprice || row?.totalbuyavgprice);
  const sellAvg = num(row?.sellavgprice || row?.totalsellavgprice);
  const closedQty = Math.min(buyQty, sellQty);
  const realised = closedQty > 0 ? closedQty * (sellAvg - buyAvg) : 0;
  const ltp = numOrNull(row?.ltp);
  const avgPrice = num(row?.avgnetprice ?? row?.netprice);
  const unrealised = netQty === 0 ? 0 : ltp != null ? netQty * (ltp - avgPrice) : null;
  return {
    tradingSymbol: String(row?.tradingsymbol || row?.symbolname || ""),
    exchange: contractExchange(row?.exchange, row?.instrumenttype),
    token: String(row?.symboltoken ?? ""),
    product: contractProduct(row?.producttype),
    netQty,
    avgPrice,
    ltp,
    pnl: realised + (unrealised ?? 0),
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

export async function fetchPositions(creds) {
  return { status: "success", data: list(await authRequest(creds, "/portfolio/positions")).map(mapPosition) };
}

export function mapHolding(row) {
  const qty = num(row?.quantity) + num(row?.t1quantity);
  const avgPrice = num(row?.averageprice);
  const ltp = numOrNull(row?.ltp);
  return {
    tradingSymbol: String(row?.tradingsymbol ?? ""),
    exchange: contractExchange(row?.exchange, "EQ"),
    token: String(row?.symboltoken ?? ""),
    isin: row?.isin ? String(row.isin) : null,
    qty,
    avgPrice,
    ltp,
    pnl: ltp != null ? (ltp - avgPrice) * qty : numOrNull(row?.profitandloss),
  };
}

export async function fetchHoldings(creds) {
  return { status: "success", data: list(await authRequest(creds, "/portfolio/holdings")).map(mapHolding) };
}

export function mapFunds(data) {
  const row = Array.isArray(data) ? data[0] || {} : data || {};
  return {
    availableCash: num(row.AVAILABLE_BALANCE),
    usedMargin: num(row.AMOUNT_UTILIZED),
    totalBalance: numOrNull(row.SUM_OF_ALL),
    collateral: numOrNull(row.COLLATERALS),
    withdrawable: null, // PAY_OUT_AMT is a requested pay-out, not a withdrawable balance
  };
}

export async function fetchFunds(creds) {
  const json = await authRequest(creds, "/user/fundsummary");
  return { status: "success", data: mapFunds(json?.data) };
}

// ── books ──

const OPEN_STATES = new Set(["open", "pending", "open pending", "modified", "modify pending", "validation pending",
  "put order req received", "after market order req received", "modify after market order req received", "cancel pending", "confirmed"]);

export function mapOrderStatus(row) {
  const s = String(row?.orderstatus || row?.status || "").trim().toLowerCase();
  const filled = num(row?.filledshares);
  const unfilled = num(row?.unfilledshares);
  if (s === "complete" || s === "completed" || s === "traded" || s === "executed") return "COMPLETE";
  if (s === "rejected") return "REJECTED";
  if (s === "cancelled" || s === "canceled" || s === "cancelled after market order") return "CANCELLED";
  if (s === "trigger pending") return "TRIGGER_PENDING";
  if (s === "expired") return "EXPIRED";
  if (OPEN_STATES.has(s)) return filled > 0 && unfilled > 0 ? "PARTIALLY_FILLED" : "OPEN";
  return "UNKNOWN";
}

export function mapOrder(row) {
  const qty = num(row?.quantity);
  const filledQty = num(row?.filledshares);
  const status = mapOrderStatus(row);
  const live = status === "OPEN" || status === "TRIGGER_PENDING" || status === "PARTIALLY_FILLED" || status === "UNKNOWN";
  const unfilled = num(row?.unfilledshares);
  return {
    orderId: String(row?.orderid ?? "").trim(),
    tradingSymbol: String(row?.tradingsymbol ?? ""),
    exchange: contractExchange(row?.exchange, row?.instrumenttype),
    token: String(row?.symboltoken ?? ""),
    side: String(row?.transactiontype).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty,
    filledQty,
    pendingQty: !live ? 0 : unfilled > 0 ? unfilled : Math.max(0, qty - filledQty),
    price: num(row?.price),
    triggerPrice: num(row?.triggerprice),
    avgPrice: num(row?.averageprice),
    orderType: String(row?.ordertype || "UNKNOWN"),
    product: contractProduct(row?.producttype),
    status,
    statusMessage: row?.text ? String(row.text) : null,
    placedAt: mstockTimeToIso(row?.exchorderupdatetime || row?.updatetime),
  };
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: list(await authRequest(creds, "/orders")).map(mapOrder) };
}

export function mapTrade(row) {
  const instrument = String(row?.INSTRUMENT_NAME ?? "").toUpperCase();
  const deriv = DERIV_TYPES.test(instrument) || String(row?.SEGMENT ?? "").toUpperCase() === "D";
  return {
    tradeId: String(row?.TRADE_NUMBER ?? row?.fillid ?? ""),
    orderId: String(row?.ORDER_NUMBER ?? row?.orderid ?? ""),
    tradingSymbol: String(row?.SYMBOL ?? row?.tradingsymbol ?? ""),
    exchange: contractExchange(row?.EXCHANGE ?? row?.exchange, deriv ? "OPT" : "EQ"),
    token: String(row?.SEC_ID ?? row?.symboltoken ?? ""),
    side: /^s/i.test(String(row?.BUY_SELL ?? row?.transactiontype ?? "")) ? "SELL" : "BUY",
    qty: num(row?.QUANTITY ?? row?.fillsize),
    price: num(row?.PRICE ?? row?.fillprice),
    tradedAt: mstockTimeToIso(row?.ORDER_DATE_TIME ?? row?.filltime),
  };
}

export async function fetchTradeBook(creds) {
  return { status: "success", data: list(await authRequest(creds, "/tradebook")).map(mapTrade) };
}
