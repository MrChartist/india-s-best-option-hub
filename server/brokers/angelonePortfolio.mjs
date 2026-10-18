/**
 * Angel One (SmartAPI) portfolio reads -> contract shapes. Read-only.
 *
 * Official docs (https://smartapi.angelone.in/docs/Portfolio and /docs/User, checked 2026-10):
 *  - GET /rest/secure/angelbroking/order/v1/getPosition -> data[] { exchange, symboltoken, producttype,
 *    tradingsymbol, netqty, avgnetprice/netprice, buyamount, sellamount, totalbuyvalue, totalsellvalue, ... }.
 *    The documented sample carries no ltp or P&L, so P&L is the realised cash flow (sell value - buy value)
 *    for flat positions and is left to the caller's live LTP otherwise; ltp/pnl/realised/unrealised are read
 *    when Angel does send them.
 *  - GET /rest/secure/angelbroking/portfolio/v1/getAllHolding -> data.holdings[] { tradingsymbol, exchange,
 *    isin, quantity, t1quantity, averageprice, ltp, symboltoken, profitandloss } + data.totalholding.
 *  - GET /rest/secure/angelbroking/user/v1/getRMS -> data { net, availablecash, collateral, utiliseddebits, ... }.
 * Product codes: DELIVERY (CNC), CARRYFORWARD (NRML -> app MARGIN), MARGIN (margin delivery -> app MTF),
 * INTRADAY (MIS), BO.
 */

import { authFetch } from "./angeloneAuth.mjs";

const POSITIONS_PATH = "/rest/secure/angelbroking/order/v1/getPosition";
const HOLDINGS_PATH = "/rest/secure/angelbroking/portfolio/v1/getAllHolding";
const RMS_PATH = "/rest/secure/angelbroking/user/v1/getRMS";

export const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(num(v)) ? num(v) : null);

const PRODUCT = { DELIVERY: "CNC", CARRYFORWARD: "MARGIN", MARGIN: "MTF", INTRADAY: "INTRADAY", BO: "BO" };
export const contractProduct = (p) => PRODUCT[String(p ?? "").toUpperCase()] || "INTRADAY";
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
export const contractExchange = (e) => (EXCHANGES.has(String(e ?? "").toUpperCase()) ? String(e).toUpperCase() : "NSE");

export function mapPosition(row) {
  const netQty = num(row?.netqty);
  const ltp = numOrNull(row?.ltp);
  const cashFlow = num(row?.totalsellvalue ?? row?.sellamount) - num(row?.totalbuyvalue ?? row?.buyamount);
  const realised = row?.realised != null ? numOrNull(row.realised) : netQty === 0 ? cashFlow : null;
  const unrealised = row?.unrealised != null ? numOrNull(row.unrealised) : netQty === 0 ? 0 : ltp != null ? cashFlow + netQty * ltp : null;
  const pnl = row?.pnl != null ? num(row.pnl) : (realised ?? 0) + (netQty === 0 ? 0 : unrealised ?? 0);
  return {
    tradingSymbol: String(row?.tradingsymbol ?? ""),
    exchange: contractExchange(row?.exchange),
    token: String(row?.symboltoken ?? ""),
    product: contractProduct(row?.producttype),
    netQty,
    avgPrice: num(row?.avgnetprice ?? row?.netprice),
    ltp,
    pnl,
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

export async function fetchPositions(creds) {
  const json = await authFetch(creds, POSITIONS_PATH);
  return { status: "success", data: (Array.isArray(json?.data) ? json.data : []).map(mapPosition) };
}

export function mapHolding(row) {
  return {
    tradingSymbol: String(row?.tradingsymbol ?? ""),
    exchange: contractExchange(row?.exchange),
    token: String(row?.symboltoken ?? ""),
    isin: row?.isin ? String(row.isin) : null,
    qty: num(row?.quantity) + num(row?.t1quantity),
    avgPrice: num(row?.averageprice),
    ltp: numOrNull(row?.ltp),
    pnl: numOrNull(row?.profitandloss),
  };
}

export async function fetchHoldings(creds) {
  const json = await authFetch(creds, HOLDINGS_PATH);
  const rows = Array.isArray(json?.data?.holdings) ? json.data.holdings : Array.isArray(json?.data) ? json.data : [];
  return { status: "success", data: rows.map(mapHolding) };
}

export function mapFunds(d) {
  return {
    availableCash: num(d?.availablecash),
    usedMargin: num(d?.utiliseddebits),
    totalBalance: numOrNull(d?.net),
    collateral: numOrNull(d?.collateral),
    withdrawable: null, // not part of getRMS
  };
}

export async function fetchFunds(creds) {
  const json = await authFetch(creds, RMS_PATH);
  return { status: "success", data: mapFunds(json?.data) };
}
