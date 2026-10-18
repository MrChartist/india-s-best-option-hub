/**
 * 5paisa portfolio reads (read-only): net positions, holdings, margin, order book and trade book.
 *
 * Official docs (https://xstream.5paisa.com/dev-docs/, checked 2026-10). Every call is
 * POST <Service1.svc path> with { head: { key }, body: { ClientCode } } and `Authorization: bearer <token>`.
 *  - V3/NetPositionNetWise (portfolio-management-system/netwise-positions) -> body.NetPositionDetail[]
 *  - V3/Holding            (portfolio-management-system/holdings)          -> body.Data[]
 *  - V4/Margin             (funds-management-system/margin)                -> body.EquityMargin[0]
 *  - V4/OrderBook          (order-tracking-system/order-book)              -> body.OrderBookDetail[]
 *  - V1/TradeBook          (order-tracking-system/trade-book)              -> body.TradeBookDetail[]
 * OpenAlgo calls V2/NetPositionNetWise and V3/OrderBook; the official pages now document V3 and V4, which we use.
 * body.Status 1 ("No orders/records found") is an empty book, not an error.
 *
 * Order statuses (order-book doc): Fully Executed, Modified, Xmitted, Rejected By 5P, AH Cancelled, AH Modified,
 * Rejected by Exch, AH Placed, Cancelled, Pending. DelvIntra: D delivery/carry-forward, I intraday, S bracket,
 * C cover. The trade book carries ExchOrderID only (no BrokerOrderId), so Trade.orderId is the exchange order id.
 */

import { BrokerError } from "./contract.mjs";
import { authenticatedPost } from "./fivepaisaAuth.mjs";
import { contractExchange } from "./fivepaisaInstruments.mjs";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** "/Date(1707279047230+0530)/" -> ISO string, or null. */
export function dotNetDate(raw) {
  const m = /\/Date\((-?\d+)/.exec(String(raw ?? ""));
  if (!m || Number(m[1]) <= 0) return null;
  return new Date(Number(m[1])).toISOString();
}

/** Rows of a book response; Status 1 (nothing found) is an empty list. */
export function bookRows(json, key, label) {
  const body = json?.body;
  const status = Number(body?.Status ?? 0);
  if (status !== 0 && status !== 1) throw new BrokerError(`5paisa ${label}: ${body?.Message || "request failed"} (Status ${status})`);
  return Array.isArray(body?.[key]) ? body[key] : [];
}

/** DelvIntra / OrderFor + segment -> contract product. */
export function contractProduct(code, exchType, mtf) {
  if (mtf === "Y") return "MTF";
  switch (code) {
    case "I": return "INTRADAY";
    case "S": return "BO";
    case "C": return "CO";
    default: return exchType === "C" ? "CNC" : "MARGIN";
  }
}

const STATUS_OF = {
  "fully executed": "COMPLETE",
  modified: "OPEN",
  xmitted: "OPEN",
  pending: "OPEN",
  "ah placed": "OPEN",
  "ah modified": "OPEN",
  "rejected by 5p": "REJECTED",
  "rejected by exch": "REJECTED",
  cancelled: "CANCELLED",
  "ah cancelled": "CANCELLED",
};

export function mapOrderStatus(o) {
  const base = STATUS_OF[String(o?.OrderStatus ?? "").trim().toLowerCase()] ?? "UNKNOWN";
  if (base !== "OPEN") return base;
  if (num(o.TradedQty) > 0 && num(o.PendingQty) > 0) return "PARTIALLY_FILLED";
  if (o.WithSL === "Y" && o.SLTriggered !== "Y") return "TRIGGER_PENDING";
  return "OPEN";
}

export function mapPosition(p) {
  const netQty = num(p.NetQty);
  const realised = num(p.BookedPL);
  const unrealised = num(p.MTOM);
  let avgPrice = netQty > 0 ? num(p.BuyAvgRate) : netQty < 0 ? num(p.SellAvgRate) : 0;
  if (!avgPrice && netQty !== 0) avgPrice = num(p.BODPositionPrice);
  return {
    tradingSymbol: String(p.ScripName ?? ""),
    exchange: contractExchange(p.Exch, p.ExchType),
    token: String(p.ScripCode ?? ""),
    product: contractProduct(p.OrderFor, p.ExchType, p.MtfFlag),
    netQty,
    avgPrice,
    ltp: numOrNull(p.LTP),
    pnl: realised + unrealised,
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

export function mapHolding(h) {
  const qty = num(h.Quantity);
  const avg = num(h.AvgRate);
  const ltp = numOrNull(h.CurrentPrice);
  const bse = h.Exch === "B";
  return {
    tradingSymbol: String(h.Symbol ?? h.FullName ?? ""),
    exchange: bse ? "BSE" : "NSE",
    token: String((bse ? h.BseCode : h.NseCode) ?? h.NseCode ?? h.BseCode ?? ""),
    isin: h.ISIN ? String(h.ISIN) : null,
    qty,
    avgPrice: avg,
    ltp,
    pnl: ltp === null ? null : Math.round((ltp - avg) * qty * 100) / 100,
  };
}

export function mapFunds(m) {
  return {
    availableCash: num(m?.NetAvailableMargin),
    usedMargin: num(m?.MarginUtilized),
    totalBalance: numOrNull(m?.Ledgerbalance),
    collateral: numOrNull(m?.CollateralValueAfterHairCut),
    withdrawable: null,
  };
}

function orderTypeOf(o) {
  if (o.WithSL === "Y") return o.AtMarket === "Y" ? "STOPLOSS_MARKET" : "STOPLOSS_LIMIT";
  return o.AtMarket === "Y" ? "MARKET" : "LIMIT";
}

export function mapOrder(o) {
  const qty = num(o.Qty);
  const filled = num(o.TradedQty);
  return {
    orderId: String(o.BrokerOrderId ?? ""),
    tradingSymbol: String(o.ScripName ?? ""),
    exchange: contractExchange(o.Exch, o.ExchType),
    token: String(o.ScripCode ?? ""),
    side: o.BuySell === "S" ? "SELL" : "BUY",
    qty,
    filledQty: filled,
    pendingQty: o.PendingQty !== undefined ? num(o.PendingQty) : Math.max(qty - filled, 0),
    price: num(o.Rate),
    triggerPrice: num(o.SLTriggerRate),
    avgPrice: num(o.AveragePrice),
    orderType: orderTypeOf(o),
    product: contractProduct(o.DelvIntra, o.ExchType, o.MtfFlag),
    status: mapOrderStatus(o),
    statusMessage: o.Reason ? String(o.Reason) : null,
    placedAt: dotNetDate(o.BrokerOrderTime) ?? dotNetDate(o.ExchOrderTime),
  };
}

export function mapTrade(t) {
  return {
    tradeId: String(t.ExchangeTradeID ?? ""),
    orderId: String(t.ExchOrderID ?? ""),
    tradingSymbol: String(t.ScripName ?? ""),
    exchange: contractExchange(t.Exch, t.ExchType),
    token: String(t.ScripCode ?? ""),
    side: t.BuySell === "S" ? "SELL" : "BUY",
    qty: num(t.Qty),
    price: num(t.Rate),
    tradedAt: dotNetDate(t.ExchangeTradeTime),
  };
}

const clientBody = (session) => ({ ClientCode: session.clientCode });

/** Raw order-book rows (used by modify/cancel to resolve the exchange order id). */
export async function readOrderBookRows(creds) {
  return bookRows(await authenticatedPost(creds, "/V4/OrderBook", clientBody), "OrderBookDetail", "order book");
}

export async function fetchPositions(creds) {
  const rows = bookRows(await authenticatedPost(creds, "/V3/NetPositionNetWise", clientBody), "NetPositionDetail", "positions");
  return { status: "success", data: rows.map(mapPosition) };
}

export async function fetchHoldings(creds) {
  const rows = bookRows(await authenticatedPost(creds, "/V3/Holding", clientBody), "Data", "holdings");
  return { status: "success", data: rows.map(mapHolding) };
}

export async function fetchFunds(creds) {
  const json = await authenticatedPost(creds, "/V4/Margin", clientBody);
  const rows = bookRows(json, "EquityMargin", "margin");
  return { status: "success", data: mapFunds(rows[0] || {}) };
}

export async function fetchOrderBook(creds) {
  return { status: "success", data: (await readOrderBookRows(creds)).map(mapOrder) };
}

export async function fetchTradeBook(creds) {
  const rows = bookRows(await authenticatedPost(creds, "/V1/TradeBook", clientBody), "TradeBookDetail", "trade book");
  return { status: "success", data: rows.map(mapTrade) };
}
