/**
 * Alice Blue Open API (V2) portfolio reads -> contract shapes. Read-only.
 *
 * Official docs (checked 2026-10):
 *  - GET /open-api/od/v1/positions -> result[] { instrumentId, tradingSymbol, exchange, product, netQuantity,
 *    netAveragePrice, realizedPnl, lotsize, ticksize, previousDayClose, ... }. The positions API carries no LTP,
 *    so unrealised P&L is null and pnl is the realised figure. https://ant.aliceblueonline.com/productdocumentation/portfolio/
 *  - GET /open-api/od/v1/holdings/CNC -> result[] { isin, nseInstrumentId, nseTradingSymbol, bseTradingSymbol,
 *    averageTradedPrice, dpQuantity, totalQuantity, t1Quantity, ltp, ... }
 *  - GET /open-api/od/v1/limits -> result[0] { tradingLimit, openingCashLimit, collateralMargin, utilizedMargin, ... }
 *    https://ant.aliceblueonline.com/productdocumentation/Funds/
 * Product codes (Appendix): INTRADAY, LONGTERM (delivery), MTF. Older payloads also say DELIVERY / CNC / MIS /
 * NRML / NORMAL, which are mapped too.
 */

import { abRequest } from "./aliceblueAuth.mjs";

export const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const PRODUCT = { INTRADAY: "INTRADAY", MIS: "INTRADAY", LONGTERM: "CNC", DELIVERY: "CNC", CNC: "CNC", MTF: "MTF", NRML: "MARGIN", NORMAL: "MARGIN", CO: "CO", BO: "BO" };
export const contractProduct = (p) => PRODUCT[String(p ?? "").toUpperCase()] || "INTRADAY";
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
export const contractExchange = (e) => {
  const v = String(e ?? "").toUpperCase();
  return EXCHANGES.has(v) ? v : v === "BCD" ? "CDS" : "NSE";
};

export function mapPosition(row) {
  const realised = numOrNull(row?.realizedPnl);
  return {
    tradingSymbol: String(row?.tradingSymbol ?? ""),
    exchange: contractExchange(row?.exchange),
    token: String(row?.instrumentId ?? ""),
    product: contractProduct(row?.product),
    netQty: num(row?.netQuantity),
    avgPrice: num(row?.netAveragePrice),
    ltp: null,
    pnl: realised ?? 0,
    realisedPnl: realised,
    unrealisedPnl: null, // needs a live LTP, which the positions API does not return
  };
}

export async function fetchPositions(creds) {
  const json = await abRequest(creds, "/open-api/od/v1/positions");
  return { status: "success", data: (Array.isArray(json.result) ? json.result : []).map(mapPosition) };
}

export function mapHolding(row) {
  const onNse = !!row?.nseTradingSymbol;
  const qty = num(row?.totalQuantity) || num(row?.dpQuantity) + num(row?.t1Quantity);
  const avg = num(row?.averageTradedPrice);
  const ltp = numOrNull(row?.ltp);
  return {
    tradingSymbol: String((onNse ? row.nseTradingSymbol : row?.bseTradingSymbol) ?? ""),
    exchange: onNse ? "NSE" : "BSE",
    token: String((onNse ? row.nseInstrumentId : row?.bseInstrumentId) ?? ""),
    isin: row?.isin ? String(row.isin) : null,
    qty,
    avgPrice: avg,
    ltp,
    pnl: ltp != null ? Math.round((ltp - avg) * qty * 100) / 100 : null,
  };
}

export async function fetchHoldings(creds) {
  const json = await abRequest(creds, "/open-api/od/v1/holdings/CNC");
  return { status: "success", data: (Array.isArray(json.result) ? json.result : []).map(mapHolding) };
}

export function mapFunds(r) {
  return {
    availableCash: num(r?.tradingLimit),
    usedMargin: num(r?.utilizedMargin),
    totalBalance: numOrNull(r?.openingCashLimit),
    collateral: numOrNull(r?.collateralMargin),
    withdrawable: null, // not in the limits response
  };
}

export async function fetchFunds(creds) {
  const json = await abRequest(creds, "/open-api/od/v1/limits");
  return { status: "success", data: mapFunds(Array.isArray(json.result) ? json.result[0] : null) };
}
