/**
 * Zebu (MYNT) portfolio + books -> contract shapes. Read-only.
 *
 * Official docs (https://zebumyntapi.web.app/OAuth/, checked 2026-10):
 *  - Portfolio/ PositionBook { uid, actid } -> array of { exch, tsym, token, prd, netqty, netavgprc, lp,
 *    rpnl, urmtom, daybuyqty, daysellqty, ... }.
 *  - Portfolio/ Holdings { uid, actid, prd: "C" } -> array of { exch_tsym: [{ exch, tsym, token }], holdqty,
 *    dpqty, npoadqty, colqty, benqty, unplgdqty, brkcolqty, btstqty, usedqty, upldprc }. Quantity follows
 *    the documented valuation formula: btstqty + holdqty + brkcolqty + unplgdqty + benqty +
 *    max(npoadqty, dpqty) - usedqty.
 *  - Limits/ Limits { uid, actid } -> { cash, payin, payout, brkcollamt, collateral, daycash, marginused, ... }.
 *  - Order/ OrderBook { uid } -> array of { norenordno, exch, tsym, token, trantype B/S, prctyp, prd, qty,
 *    fillshares, avgprc, prc, trgprc, status, rejreason, norentm "hh:mm:ss DD-MM-YYYY", exch_tm }.
 *    Listed as GET in the table but every sample POSTs; POST is used.
 *  - Order/ TradeBook { uid, actid } -> array of { flid, norenordno, exch, tsym, token, trantype, flqty,
 *    flprc, fltm "DD-MM-YYYY hh:mm:ss" }.
 * An empty book is { stat: "Not_Ok", emsg: "no data" } and reads as an empty list.
 * Product codes (PlaceOrder): C = CNC, M = margin (NRML), I = intraday (in the sample), H = cover, B = bracket.
 */

import { postJData, isNoData, expectOk } from "./zebuAuth.mjs";

export const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : Number.isFinite(parseFloat(v)) ? num(v) : null);

const PRODUCT = { C: "CNC", I: "INTRADAY", M: "MARGIN", H: "CO", B: "BO", F: "MTF", CNC: "CNC", MIS: "INTRADAY", NRML: "MARGIN" };
export const contractProduct = (p) => PRODUCT[String(p ?? "").trim().toUpperCase()] || "INTRADAY";
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
export const contractExchange = (e) => (EXCHANGES.has(String(e ?? "").toUpperCase()) ? String(e).toUpperCase() : "NSE");
const side = (t) => (String(t ?? "").toUpperCase().startsWith("S") ? "SELL" : "BUY");

/** List endpoints return a bare array; "no data" is an empty list; any other Not_Ok is an error. */
async function listCall(creds, endpoint, payload, opts) {
  const json = await postJData(creds, endpoint, payload, opts);
  if (Array.isArray(json)) return json.filter((r) => r && r.stat !== "Not_Ok");
  if (isNoData(json)) return [];
  expectOk(json, endpoint.slice(1));
  return [];
}

/** "19:59:32 13-12-2020" | "13-12-2020 19:59:32" (IST) -> ISO +05:30; raw text otherwise. */
export function norenTimeToIso(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let m = /^(\d{2}):(\d{2}):(\d{2}) (\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[6]}-${m[5]}-${m[4]}T${m[1]}:${m[2]}:${m[3]}+05:30`;
  m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return m[3] === "1980" ? null : `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  return s;
}

export function mapPosition(r) {
  const netQty = num(r?.netqty);
  const realised = numOrNull(r?.rpnl);
  const unrealised = numOrNull(r?.urmtom);
  return {
    tradingSymbol: String(r?.tsym ?? ""),
    exchange: contractExchange(r?.exch),
    token: String(r?.token ?? ""),
    product: contractProduct(r?.prd ?? r?.prarr),
    netQty,
    avgPrice: num(r?.netavgprc),
    ltp: numOrNull(r?.lp),
    pnl: (realised ?? 0) + (unrealised ?? 0),
    realisedPnl: realised,
    unrealisedPnl: netQty === 0 ? 0 : unrealised,
  };
}

export async function fetchPositions(creds) {
  return { status: "success", data: (await listCall(creds, "/PositionBook", {})).map(mapPosition) };
}

export function mapHolding(r) {
  const legs = Array.isArray(r?.exch_tsym) ? r.exch_tsym : [];
  const leg = legs.find((l) => String(l?.exch).toUpperCase() === "NSE") || legs[0] || {};
  const qty = num(r?.btstqty) + num(r?.holdqty) + num(r?.brkcolqty) + num(r?.unplgdqty) + num(r?.benqty)
    + Math.max(num(r?.npoadqty), num(r?.dpqty)) - num(r?.usedqty);
  return {
    tradingSymbol: String(leg.tsym ?? ""),
    exchange: contractExchange(leg.exch),
    token: String(leg.token ?? ""),
    isin: leg.isin ? String(leg.isin) : null,
    qty: Math.max(0, qty),
    avgPrice: num(r?.upldprc),
    ltp: null,
    pnl: null,
  };
}

export async function fetchHoldings(creds) {
  return { status: "success", data: (await listCall(creds, "/Holdings", { prd: "C" })).map(mapHolding) };
}

export function mapFunds(d) {
  const total = num(d?.cash) + num(d?.payin) + num(d?.daycash);
  const collateral = num(d?.brkcollamt) + num(d?.collateral);
  const used = num(d?.marginused);
  return {
    availableCash: total + collateral - used,
    usedMargin: used,
    totalBalance: total,
    collateral,
    withdrawable: null,
  };
}

export async function fetchFunds(creds) {
  const json = expectOk(await postJData(creds, "/Limits", {}), "Limits");
  return { status: "success", data: mapFunds(json) };
}

// ── books ──

export function mapOrderStatus(r) {
  const s = String(r?.status ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const filled = num(r?.fillshares);
  const qty = num(r?.qty);
  if (s === "COMPLETE") return "COMPLETE";
  if (s === "REJECTED" || s === "REJECT") return "REJECTED";
  if (s === "CANCELED" || s === "CANCELLED") return "CANCELLED";
  if (s === "TRIGGER_PENDING") return "TRIGGER_PENDING";
  if (s === "OPEN" || s === "PENDING" || s === "MODIFIED" || s === "VALIDATION_PENDING") return filled > 0 && filled < qty ? "PARTIALLY_FILLED" : "OPEN";
  return "UNKNOWN";
}

export function mapOrder(r) {
  const qty = num(r?.qty);
  const filledQty = num(r?.fillshares);
  const status = mapOrderStatus(r);
  const live = status === "OPEN" || status === "TRIGGER_PENDING" || status === "PARTIALLY_FILLED" || status === "UNKNOWN";
  return {
    orderId: String(r?.norenordno ?? ""),
    tradingSymbol: String(r?.tsym ?? ""),
    exchange: contractExchange(r?.exch),
    token: String(r?.token ?? r?.tsym ?? ""),
    side: side(r?.trantype),
    qty,
    filledQty,
    pendingQty: live ? Math.max(0, qty - filledQty) : 0,
    price: num(r?.prc),
    triggerPrice: num(r?.trgprc),
    avgPrice: num(r?.avgprc),
    orderType: String(r?.prctyp || "UNKNOWN"),
    product: contractProduct(r?.prd),
    status,
    statusMessage: r?.rejreason ? String(r.rejreason) : null,
    placedAt: norenTimeToIso(r?.norentm) || norenTimeToIso(r?.exch_tm),
  };
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await listCall(creds, "/OrderBook", {}, { actid: false })).map(mapOrder) };
}

export function mapTrade(r) {
  return {
    tradeId: String(r?.flid ?? ""),
    orderId: String(r?.norenordno ?? ""),
    tradingSymbol: String(r?.tsym ?? ""),
    exchange: contractExchange(r?.exch),
    token: String(r?.token ?? r?.tsym ?? ""),
    side: side(r?.trantype),
    qty: num(r?.flqty ?? r?.fillshares),
    price: num(r?.flprc),
    tradedAt: norenTimeToIso(r?.fltm) || norenTimeToIso(r?.norentm),
  };
}

export async function fetchTradeBook(creds) {
  return { status: "success", data: (await listCall(creds, "/TradeBook", {})).map(mapTrade) };
}
