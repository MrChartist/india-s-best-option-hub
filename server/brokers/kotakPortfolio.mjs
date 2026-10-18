/**
 * Kotak Securities (Neo) portfolio reads (read-only): positions, holdings, limits, order book, trade book.
 *
 * Official source: https://github.com/Kotak-Neo/Kotak-neo-api-v2 (docs/Positions.md, Holdings.md, Limits.md,
 * Order_report.md, Trade_report.md; neo_api_client/settings.py PROD_URL), checked 2026-10. Every call goes to the
 * session baseUrl with headers { Sid, Auth } and ?sId=<hsServerId>:
 *  - GET  quick/user/orders     -> { stat: "Ok", data: [ { nOrdNo, ordSt, trdSym, exSeg, tok, trnsTp, qty, fldQty, unFldSz,
 *                                   prc, trgPrc, avgPrc, prcTp, prod, rejRsn, ordDtTm, ... } ] }
 *  - GET  quick/user/trades     -> { stat: "Ok", data: [ { flId, nOrdNo, trdSym, exSeg, tok, trnsTp, fldQty, avgPrc, flDt, flTm } ] }
 *  - GET  quick/user/positions  -> { stat: "ok", data: [ ... cfBuyQty, flBuyQty, cfSellQty, flSellQty, cfBuyAmt, buyAmt,
 *                                   cfSellAmt, sellAmt, multiplier, genNum, genDen, prcNum, prcDen, precision, lotSz ] }
 *    (Positions.md "Positions Calculations": net qty = (cfBuyQty+flBuyQty) - (cfSellQty+flSellQty); averages and
 *    PnL from the amount fields and the multiplier/gen/prc ratios. Positions carry no LTP, so one quotes call
 *    back-fills it for open rows; without it unrealised PnL is null.)
 *  - GET  portfolio/v1/holdings -> { data: [ { displaySymbol, averagePrice, quantity, exchangeSegment, exchangeIdentifier,
 *                                   closingPrice, mktValue, holdingCost } ] }
 *  - POST quick/user/limits     jData { seg: "ALL", exch: "ALL", prod: "ALL" } -> { Net, MarginUsed, CollateralValue, Collateral, ... }
 * Empty books come back as stat "Not_Ok" with a "no data" style emsg; that is read as an empty list.
 */

import { BrokerError } from "./contract.mjs";
import { tradeRequest } from "./kotakAuth.mjs";
import { contractExchange } from "./kotakInstruments.mjs";
import { fetchQuotesBatched, parseQuote } from "./kotakQuotes.mjs";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const clean = (v) => (v === undefined || v === null || v === "" || v === "--" || v === "NA" ? null : String(v));

const PRODUCT_OF = { CNC: "CNC", MIS: "INTRADAY", INTRADAY: "INTRADAY", NRML: "MARGIN", CO: "CO", BO: "BO", MTF: "MTF" };
export const contractProduct = (p) => PRODUCT_OF[String(p || "").toUpperCase()] ?? "MARGIN";

const ORDER_TYPE_OF = { L: "LIMIT", MKT: "MARKET", SL: "STOPLOSS_LIMIT", "SL-M": "STOPLOSS_MARKET" };

const OPEN_STATES = new Set(["open", "open pending", "put order req received", "validation pending", "modify pending",
  "modify validation pending", "modified", "after market order req received", "modify after market order req received", "cancel pending"]);

export function mapOrderStatus(o) {
  const s = String(o?.ordSt ?? o?.stat ?? "").trim().toLowerCase();
  if (s === "complete" || s === "traded") return "COMPLETE";
  if (s === "rejected") return "REJECTED";
  if (s === "cancelled" || s === "cancelled after market order") return "CANCELLED";
  if (s === "expired") return "EXPIRED";
  if (s === "trigger pending") return "TRIGGER_PENDING";
  if (OPEN_STATES.has(s)) return num(o.fldQty) > 0 && num(o.unFldSz) > 0 ? "PARTIALLY_FILLED" : "OPEN";
  return "UNKNOWN";
}

/** Rows of a book; stat Not_Ok with a no-data message is an empty book, any other Not_Ok is an error. */
export function bookRows(json, label) {
  if (Array.isArray(json?.data)) return json.data;
  const stat = String(json?.stat ?? "").toLowerCase();
  if (stat === "not_ok") {
    if (/no\s*data|no\s*record|not\s*found|no\s*order|no\s*trade|no\s*position/i.test(String(json?.emsg || ""))) return [];
    throw new BrokerError(`Kotak Neo ${label}: ${json?.emsg || "request failed"}`);
  }
  return [];
}

export function mapOrder(o) {
  const qty = num(o.qty);
  const filled = num(o.fldQty);
  return {
    orderId: String(o.nOrdNo ?? ""),
    tradingSymbol: String(o.trdSym ?? o.sym ?? ""),
    exchange: contractExchange(o.exSeg),
    token: String(o.tok ?? ""),
    side: o.trnsTp === "S" ? "SELL" : "BUY",
    qty,
    filledQty: filled,
    pendingQty: o.unFldSz !== undefined ? num(o.unFldSz) : Math.max(qty - filled, 0),
    price: num(o.prc),
    triggerPrice: num(o.trgPrc),
    avgPrice: num(o.avgPrc),
    orderType: ORDER_TYPE_OF[o.prcTp] ?? String(o.prcTp || "UNKNOWN"),
    product: contractProduct(o.prod),
    status: mapOrderStatus(o),
    statusMessage: clean(o.rejRsn),
    placedAt: clean(o.ordDtTm),
  };
}

export function mapTrade(t) {
  return {
    tradeId: String(t.flId ?? ""),
    orderId: String(t.nOrdNo ?? ""),
    tradingSymbol: String(t.trdSym ?? t.sym ?? ""),
    exchange: contractExchange(t.exSeg),
    token: String(t.tok ?? ""),
    side: t.trnsTp === "S" ? "SELL" : "BUY",
    qty: num(t.fldQty),
    price: num(t.avgPrc),
    tradedAt: t.flDt && t.flTm ? `${t.flDt} ${t.flTm}` : clean(t.exTm),
  };
}

/** Positions.md calculations. `ltp` is null when no quote was available. */
export function mapPosition(p, ltp = null) {
  const buyQty = num(p.cfBuyQty) + num(p.flBuyQty);
  const sellQty = num(p.cfSellQty) + num(p.flSellQty);
  const netQty = buyQty - sellQty;
  const buyAmt = num(p.cfBuyAmt) + num(p.buyAmt);
  const sellAmt = num(p.cfSellAmt) + num(p.sellAmt);
  const ratio = (num(p.multiplier) || 1) * ((num(p.genNum) || 1) / (num(p.genDen) || 1)) * ((num(p.prcNum) || 1) / (num(p.prcDen) || 1));
  const precision = Number.isInteger(num(p.precision)) && num(p.precision) > 0 ? num(p.precision) : 2;
  const round = (v) => Number(v.toFixed(precision));
  const avgBuy = buyQty ? buyAmt / (buyQty * ratio) : 0;
  const avgSell = sellQty ? sellAmt / (sellQty * ratio) : 0;
  const avgPrice = netQty > 0 ? round(avgBuy) : netQty < 0 ? round(avgSell) : 0;
  const cashFlow = sellAmt - buyAmt;
  const mtm = ltp === null ? null : netQty * ltp * ratio;
  const pnl = mtm === null ? cashFlow : cashFlow + mtm;
  // Realised = PnL on the closed quantity; unrealised = the open quantity marked to the LTP.
  const closedQty = Math.min(buyQty, sellQty);
  const realised = closedQty ? round(closedQty * (avgSell - avgBuy) * ratio) : 0;
  return {
    tradingSymbol: String(p.trdSym ?? p.sym ?? ""),
    exchange: contractExchange(p.exSeg),
    token: String(p.tok ?? ""),
    product: contractProduct(p.prod),
    netQty,
    avgPrice,
    ltp,
    pnl: round(pnl),
    realisedPnl: realised,
    unrealisedPnl: mtm === null ? null : round(pnl - realised),
  };
}

export function mapHolding(h) {
  const qty = num(h.quantity);
  const avg = num(h.averagePrice);
  const ltp = numOrNull(h.closingPrice);
  return {
    tradingSymbol: String(h.displaySymbol ?? h.symbol ?? ""),
    exchange: contractExchange(h.exchangeSegment),
    token: String(h.exchangeIdentifier ?? h.instrumentToken ?? ""),
    isin: h.isin ? String(h.isin) : null,
    qty,
    avgPrice: avg,
    ltp,
    pnl: h.mktValue !== undefined && h.holdingCost !== undefined ? Math.round((num(h.mktValue) - num(h.holdingCost)) * 100) / 100 : ltp === null ? null : Math.round((ltp - avg) * qty * 100) / 100,
  };
}

/**
 * Limits -> Funds. "Net" is the available margin the Kotak app shows; CollateralValue is the cash leg and
 * Collateral the pledged-securities leg (OpenAlgo verified this on a live account; the docs give no field glossary).
 */
export function mapFunds(l) {
  const cash = numOrNull(l?.CollateralValue);
  const collateral = numOrNull(l?.Collateral);
  return {
    availableCash: num(l?.Net),
    usedMargin: num(l?.MarginUsed),
    totalBalance: cash === null && collateral === null ? null : (cash ?? 0) + (collateral ?? 0),
    collateral,
    withdrawable: null,
  };
}

export async function readOrderRows(session) {
  return bookRows(await tradeRequest(session, "GET", "/quick/user/orders"), "order book");
}

export async function fetchOrderBook(session) {
  return { status: "success", data: (await readOrderRows(session)).map(mapOrder) };
}

export async function fetchTradeBook(session) {
  const rows = bookRows(await tradeRequest(session, "GET", "/quick/user/trades"), "trade book");
  return { status: "success", data: rows.map(mapTrade) };
}

export async function fetchPositions(session) {
  const rows = bookRows(await tradeRequest(session, "GET", "/quick/user/positions"), "positions");
  const open = rows.filter((p) => mapPosition(p).netQty !== 0 && /^\d+$/.test(String(p.tok ?? "")));
  let quotes = new Map();
  if (open.length) {
    try {
      quotes = await fetchQuotesBatched(session, open.map((p) => ({ exchSeg: String(p.exSeg), query: String(p.tok) })));
    } catch {
      quotes = new Map(); // LTP back-fill is best effort; positions are still authoritative without it
    }
  }
  const data = rows.map((p) => {
    const q = quotes.get(`${p.exSeg}|${p.tok}`);
    const ltp = q ? parseQuote(q).ltp || null : null;
    return mapPosition(p, ltp);
  });
  return { status: "success", data };
}

export async function fetchHoldings(session) {
  const json = await tradeRequest(session, "GET", "/portfolio/v1/holdings", undefined, { withServerId: false });
  return { status: "success", data: bookRows(json, "holdings").map(mapHolding) };
}

export async function fetchFunds(session) {
  const json = await tradeRequest(session, "POST", "/quick/user/limits", { seg: "ALL", exch: "ALL", prod: "ALL" });
  if (String(json?.stat ?? "").toLowerCase() !== "ok") throw new BrokerError(`Kotak Neo limits: ${json?.emsg || "request failed"}`);
  return { status: "success", data: mapFunds(json) };
}
