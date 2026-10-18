/**
 * Fyers API v3 portfolio reads (positions, holdings, funds) -> contract shapes. Read-only.
 *
 * Official docs (checked 2026-10):
 *  - GET /api/v3/positions -> netPositions[] { symbol, netQty, netAvg, productType, realized_profit,
 *    unrealized_profit, pl, ltp, segment, exchange, ... } https://fyers.in/api-docs/v3/api/trading/positions/get-positions/
 *  - GET /api/v3/holdings  -> holdings[] { symbol, isin, quantity, remainingQuantity, qty_t1, costPrice, ltp, pl,
 *    exchange (10 NSE, 12 BSE), segment } https://fyers.in/api-docs/v3/api/account/holdings/
 *  - GET /api/v3/funds     -> fund_limit[] { id, title, equityAmount, commodityAmount }; look rows up by title
 *    (the docs say not to rely on position). https://fyers.in/api-docs/v3/api/account/funds/
 */

import { contractExchange, contractProduct, fyersRequest, num, numOrNull, tradingSymbolOf } from "./fyersClient.mjs";

export function mapPosition(row) {
  const ticker = String(row?.symbol ?? "");
  const pnl = num(row?.pl);
  const realised = numOrNull(row?.realized_profit);
  const unrealised = row?.unrealized_profit != null ? numOrNull(row.unrealized_profit) : realised != null ? pnl - realised : null;
  return {
    tradingSymbol: tradingSymbolOf(ticker),
    exchange: contractExchange(ticker, row?.segment),
    token: ticker,
    product: contractProduct(row?.productType),
    netQty: num(row?.netQty),
    avgPrice: num(row?.netAvg ?? row?.avgPrice),
    ltp: numOrNull(row?.ltp),
    pnl,
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

export async function fetchPositions(creds) {
  const json = await fyersRequest(creds, "/api/v3/positions");
  return { status: "success", data: (json.netPositions || []).map(mapPosition) };
}

export function mapHolding(row) {
  const ticker = String(row?.symbol ?? "");
  const exch = Number(row?.exchange) === 12 || ticker.startsWith("BSE:") ? "BSE" : "NSE";
  return {
    tradingSymbol: tradingSymbolOf(ticker),
    exchange: exch,
    token: ticker,
    isin: row?.isin ? String(row.isin) : null,
    // remainingQuantity = start-of-day quantity minus today's sales; qty_t1 = shares still in T+1 settlement.
    qty: num(row?.remainingQuantity ?? row?.quantity) + num(row?.qty_t1),
    avgPrice: num(row?.costPrice),
    ltp: numOrNull(row?.ltp),
    pnl: numOrNull(row?.pl),
  };
}

export async function fetchHoldings(creds) {
  const json = await fyersRequest(creds, "/api/v3/holdings");
  return { status: "success", data: (json.holdings || []).map(mapHolding) };
}

/** fund_limit[] -> Funds. Equity and commodity ledgers are added together. */
export function mapFunds(fundLimit) {
  const byTitle = new Map();
  for (const r of Array.isArray(fundLimit) ? fundLimit : []) {
    byTitle.set(String(r?.title ?? "").trim().toLowerCase(), num(r?.equityAmount) + num(r?.commodityAmount));
  }
  const get = (title) => (byTitle.has(title) ? byTitle.get(title) : null);
  return {
    availableCash: get("available balance") ?? 0,
    usedMargin: get("utilized amount") ?? 0,
    totalBalance: get("total balance"),
    collateral: get("collaterals"),
    withdrawable: null, // not a documented fund_limit title
  };
}

export async function fetchFunds(creds) {
  const json = await fyersRequest(creds, "/api/v3/funds");
  return { status: "success", data: mapFunds(json.fund_limit) };
}
