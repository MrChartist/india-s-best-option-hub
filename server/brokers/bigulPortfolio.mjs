/**
 * Bigul portfolio reads (read-only). Official docs (checked 2026-10): https://connect.bigul.co/docs#portfolio_reporting,
 * #trade_position_holdings and #margin_check. Every call is a POST with { source, clientCode, ... }:
 *  - /order/order-book    -> data[] { nOrdNo, ordSt, trdSym, exSeg, tok, trnsTp, qty, fldQty, unFldSz, prc, trgPrc, avgPrc,
 *                            prcTp, prod, rejRsn, ordDtTm, ... }  (ordSt: open, complete, cancelled, rejected,
 *                            trigger pending, open pending, ...)
 *  - /order/trade-book    -> data[] { flId, nOrdNo, trdSym, exSeg, trnsTp, fldQty, avgPrc, exTm, flDt, flTm, ... }
 *  - /order/get-position  -> data[] { trdSym, exSeg, prod, flBuyQty, flSellQty, buyAmt, sellAmt, cfBuyQty, cfSellQty,
 *                            cfBuyAmt, cfSellAmt, lotSz, ... } (no LTP)
 *  - /order/get-holdings  { prod: "CNC" } -> data.hldVal[] { nseTrdSym, bseTrdSym, ex1, ex2, tok1, tok2, hldQty, prc,
 *                            clprc, ... }
 *  - /order/user-limits   { seg: "ALL", exch: "ALL", prod: "ALL" } -> RMS limits (CollateralValue, AmountUtilizedPrsnt, ...)
 * The book and position rows use the same field names as Kotak Neo's API (both run the same OMS), so the order and
 * position mappers of kotakPortfolio.mjs are reused. Rows the docs show without a token (positions, trades) get it
 * from the master by trading symbol; open positions get a best-effort LTP from the feed.
 */

import { bgRequest } from "./bigulAuth.mjs";
import { feedKey, subscribeAndCollect } from "./bigulFeed.mjs";
import { findBySymbol } from "./bigulInstruments.mjs";
import { mapOrder, mapPosition } from "./kotakPortfolio.mjs";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const clean = (v) => (v === undefined || v === null || v === "" || v === "--" || v === "NA" ? null : String(v));
const EXCHANGE_OF = { nse_cm: "NSE", bse_cm: "BSE", nse_fo: "NFO", bse_fo: "BFO", cde_fo: "CDS", mcx_fo: "MCX" };
export const contractExchange = (seg) => EXCHANGE_OF[String(seg ?? "").toLowerCase()] ?? "NSE";
const POSITION_LTP_WAIT_MS = 2000;

const rows = (data) => (Array.isArray(data) ? data : []);

/** Fill a missing `tok` from the master (by segment + trading symbol). Returns the master row too. */
async function withToken(r) {
  const master = await findBySymbol(String(r.exSeg ?? "").toLowerCase(), r.trdSym).catch(() => null);
  return { row: r.tok ? r : { ...r, tok: master?.token ?? "" }, master };
}

export async function readOrderRows(creds) {
  return rows(await bgRequest(creds, "/order/order-book", { emptyOk: true, kind: "read" }));
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await readOrderRows(creds)).map(mapOrder) };
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
    tradedAt: clean(t.exTm) ?? clean(t.flTm),
  };
}

export async function fetchTradeBook(creds) {
  const data = [];
  for (const t of rows(await bgRequest(creds, "/order/trade-book", { emptyOk: true, kind: "read" }))) data.push(mapTrade((await withToken(t)).row));
  return { status: "success", data };
}

export async function fetchPositions(creds) {
  const filled = [];
  for (const p of rows(await bgRequest(creds, "/order/get-position", { emptyOk: true, kind: "read" }))) filled.push(await withToken(p));
  const open = filled.filter(({ row, master }) => master && mapPosition(row).netQty !== 0);
  let ticks = new Map();
  if (open.length) {
    try {
      ticks = await subscribeAndCollect(creds, open.map(({ master }) => feedKey(master)), POSITION_LTP_WAIT_MS);
    } catch {
      ticks = new Map(); // the LTP is best effort; positions stay authoritative without it
    }
  }
  const data = filled.map(({ row, master }) => {
    const ltp = master ? num(ticks.get(feedKey(master))?.ltp) || null : null;
    return { ...mapPosition(row, ltp), exchange: contractExchange(row.exSeg) };
  });
  return { status: "success", data };
}

export function mapHolding(h) {
  const nse = Boolean(h.nseTrdSym && h.tok1);
  const qty = num(h.hldQty);
  const avgPrice = num(h.prc);
  const ltp = num(h.clprc) > 0 ? num(h.clprc) : null;
  return {
    tradingSymbol: String((nse ? h.nseTrdSym : h.bseTrdSym) ?? ""),
    exchange: contractExchange(nse ? h.ex1 : h.ex2),
    token: String((nse ? h.tok1 : h.tok2) ?? ""),
    isin: clean(h.isin),
    qty,
    avgPrice,
    ltp,
    pnl: ltp === null ? null : Math.round((ltp - avgPrice) * qty * 100) / 100,
  };
}

export async function fetchHoldings(creds) {
  const data = await bgRequest(creds, "/order/get-holdings", { body: { prod: "CNC" }, emptyOk: true, kind: "read" });
  return { status: "success", data: rows(data?.hldVal).map(mapHolding) };
}

/**
 * RMS limits -> Funds. The docs list the fields without a glossary. "Net" (the available margin on the same OMS, see
 * kotakPortfolio.mjs) is used when present; otherwise available = CollateralValue - AmountUtilizedPrsnt. Needs a live
 * check against the Bigul app's funds screen.
 */
export function mapFunds(l) {
  const cash = numOrNull(l?.CollateralValue);
  const used = num(l?.AmountUtilizedPrsnt ?? l?.MarginUsed);
  const net = numOrNull(l?.Net);
  return {
    availableCash: net ?? Math.max((cash ?? 0) - used, 0),
    usedMargin: used,
    totalBalance: cash,
    collateral: numOrNull(l?.Collateral),
    withdrawable: null,
  };
}

export async function fetchFunds(creds) {
  const data = await bgRequest(creds, "/order/user-limits", { body: { seg: "ALL", exch: "ALL", prod: "ALL" }, kind: "read" });
  return { status: "success", data: mapFunds(data) };
}
