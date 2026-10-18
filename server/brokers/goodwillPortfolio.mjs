/**
 * Goodwill portfolio and books, read-only. Official docs (https://developer.gwcindia.in/api/*, checked 2026-10):
 *  - GET /positions -> data [ { exchange, product (MIS | CNC | NRML | CO | BO), tsym, token, netqty, netbuyavgprc,
 *    netsellavgprc, netamt, ltp, realisedprofitloss, unrealisedprofitloss, ... } ].
 *  - GET /holdings  -> data [ { exchange, token, tsym, isin, holdqty, btst_qty, sellable_qty, average_price, ltp,
 *    pcode, coll_qty } ].
 *  - GET /balance   -> data { segment, bookedpnl, unbookedpnl, openingbalance, credits, payinamt, utilizedamount,
 *    payoutamt, varmargin, spanmargin, realisedmtom, unrealisedmtom, debits }.
 *  - GET /orderbook -> data [ { exchange, token, tsym, product, pricetype, validity, price, trgprc, qty, trantype
 *    (B | S), avgprc, fillshares, nstordno, orderentrytime ("13:10:32 14-03-2023"), status ("complete", "open",
 *    ...), rejreason } ].
 *  - GET /tradebook -> data [ { exchange, tsym, product, pricetype, trantype, qty, exchordid, nstordno, exchtime,
 *    price } ] (no token and no separate trade id: the exchange order id stands in).
 * Status words follow the Noren backend (open, complete, rejected, cancelled, trigger_pending), read with the
 * shared Noren status mapper.
 */

import { mapOrderStatus, norenTimeToIso } from "./shoonyaNorenCore.mjs";
import { gwRequest } from "./goodwillAuth.mjs";

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const nOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);

const PRODUCT = { MIS: "INTRADAY", CNC: "CNC", NRML: "MARGIN", CO: "CO", BO: "BO", I: "INTRADAY", C: "CNC", M: "MARGIN" };
export const productOf = (p) => PRODUCT[str(p).toUpperCase()] ?? "MARGIN";
export const exchangeOf = (e) => (EXCHANGES.has(str(e).toUpperCase()) ? str(e).toUpperCase() : "NSE");
const sideOf = (t) => (str(t).toUpperCase().startsWith("S") ? "SELL" : "BUY");
const ORDER_TYPE = { L: "LIMIT", LMT: "LIMIT", MKT: "MARKET", "SL-L": "SL", "SL-LMT": "SL", "SL-M": "SL-M", "SL-MKT": "SL-M" };

export function mapPosition(p) {
  const qty = n(p.netqty);
  const realised = nOrNull(p.realisedprofitloss);
  const unrealised = nOrNull(p.unrealisedprofitloss);
  return {
    tradingSymbol: str(p.tsym), exchange: exchangeOf(p.exchange), token: str(p.token) || str(p.tsym), product: productOf(p.product),
    netQty: qty, avgPrice: qty < 0 ? n(p.netsellavgprc) : n(p.netbuyavgprc), ltp: nOrNull(p.ltp),
    pnl: (realised ?? 0) + (unrealised ?? 0), realisedPnl: realised, unrealisedPnl: unrealised,
  };
}

export function mapHolding(h) {
  const qty = n(h.holdqty) + n(h.btst_qty);
  const avg = n(h.average_price);
  const ltp = nOrNull(h.ltp);
  return {
    tradingSymbol: str(h.tsym), exchange: exchangeOf(h.exchange), token: str(h.token) || str(h.tsym), isin: h.isin ? str(h.isin) : null,
    qty, avgPrice: avg, ltp, pnl: ltp !== null ? (ltp - avg) * qty : null,
  };
}

export function mapFunds(f) {
  const opening = n(f?.openingbalance);
  const payin = n(f?.payinamt);
  const used = n(f?.utilizedamount);
  return { availableCash: opening + payin - used, usedMargin: used, totalBalance: opening + payin, collateral: null, withdrawable: null };
}

export function mapOrder(o) {
  const qty = n(o.qty);
  const filled = n(o.fillshares);
  const status = mapOrderStatus(o);
  const working = status === "OPEN" || status === "TRIGGER_PENDING" || status === "PARTIALLY_FILLED";
  return {
    orderId: str(o.nstordno), tradingSymbol: str(o.tsym), exchange: exchangeOf(o.exchange), token: str(o.token) || str(o.tsym), side: sideOf(o.trantype),
    qty, filledQty: filled, pendingQty: working ? Math.max(0, qty - filled) : 0, price: n(o.price), triggerPrice: n(o.trgprc), avgPrice: n(o.avgprc),
    orderType: ORDER_TYPE[str(o.pricetype).toUpperCase()] ?? (str(o.pricetype) || "UNKNOWN"), product: productOf(o.product), status,
    statusMessage: str(o.rejreason) || null, placedAt: norenTimeToIso(o.orderentrytime) ?? norenTimeToIso(o.exchconfrmtime),
  };
}

export function mapTrade(t) {
  return {
    tradeId: str(t.exchordid) || str(t.nstordno), orderId: str(t.nstordno), tradingSymbol: str(t.tsym), exchange: exchangeOf(t.exchange),
    token: str(t.token) || str(t.tsym), side: sideOf(t.trantype), qty: n(t.qty), price: n(t.price), tradedAt: norenTimeToIso(t.exchtime),
  };
}

export async function fetchPositions(creds) {
  return { status: "success", data: (await gwRequest(creds, "positions", { list: true })).map(mapPosition) };
}

export async function fetchHoldings(creds) {
  return { status: "success", data: (await gwRequest(creds, "holdings", { list: true })).map(mapHolding) };
}

export async function fetchFunds(creds) {
  return { status: "success", data: mapFunds(await gwRequest(creds, "balance")) };
}

export async function listRawOrders(creds) {
  return gwRequest(creds, "orderbook", { list: true });
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await listRawOrders(creds)).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  return { status: "success", data: (await gwRequest(creds, "tradebook", { list: true })).map(mapTrade) };
}
