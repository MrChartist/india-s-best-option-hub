/**
 * Arrow instrument master, symbol mapping and exchange codes.
 *
 * Official docs (checked 2026-10): https://docs.arrow.trade/rest-api/symbols/ and /rest-api/utility/ .
 *  - GET https://edge.arrow.trade/all (authenticated, CSV, refreshed 08:00 IST) with columns
 *    Exchange,Segment,ExchSeg,Token,FullName,Symbol,TradingSymbol,Series,ISIN,LotSize,TickSize,PricePrecision,
 *    OptionType,Underlying,UnderlyingToken,StrikePrice,Expiry,FreezeQty,Lower Band,Upper Band,SurCodes,Events,ExchangeID
 *    ExchSeg: NSECM / BSECM (cash), NSEFO / BSEFO (F&O), MCXFO, NSECD, NSEIDX / BSEIDX (index rows).
 *    Expiry "30-Mar-2026"; StrikePrice and TickSize in rupees in the documented sample rows
 *    ("6450.00", "0.05"). The field table says StrikePrice is "multiplied by 100" and TickSize is "in paisa";
 *    the sample rows contradict that, and this module follows the sample rows.
 *  - GET /info/option-chain-symbols/all -> { data: { indices: { "INDEX:NIFTY": ["12-MAY-2026", ...] },
 *    equity: { "NSE:RELIANCE-EQ": [...] } } }.
 *  - Quote/order exchange codes: NSE, NFO, BSE, BFO, MCXFO and INDEX (index quotes). Funds use "MCX".
 */

import { CANONICAL_UNDERLYINGS } from "./contract.mjs";

/** Canonical underlying -> how Arrow names it in /info/option-chain and INDEX quotes. */
export const INDEX_UNDERLYINGS = Object.freeze({
  NIFTY: { name: "NIFTY", cash: "NSE" },
  BANKNIFTY: { name: "BANKNIFTY", cash: "NSE" },
  FINNIFTY: { name: "FINNIFTY", cash: "NSE" },
  MIDCPNIFTY: { name: "MIDCPNIFTY", cash: "NSE" },
  SENSEX: { name: "SENSEX", cash: "BSE" },
  BANKEX: { name: "BANKEX", cash: "BSE" },
});

/** Index-row display names in the master's Symbol column (spaces removed, upper case) -> canonical. */
const INDEX_ROW_NAMES = Object.freeze({
  NIFTY50: "NIFTY", NIFTYBANK: "BANKNIFTY", NIFTYFINSERVICE: "FINNIFTY", NIFTYMIDSELECT: "MIDCPNIFTY", SENSEX: "SENSEX", BANKEX: "BANKEX",
});

/** Index derivative underlyings that exist at the exchange but are not canonical in this app. */
const OTHER_INDEX_UNDERLYINGS = new Set(["NIFTYNXT50", "SENSEX50"]);

const EXCHSEG_TO_EXCHANGE = { NSECM: "NSE", BSECM: "BSE", NSEFO: "NFO", BSEFO: "BFO", MCXFO: "MCX", NSECD: "CDS", NSEIDX: "NSE", BSEIDX: "BSE" };

/** Contract exchange -> Arrow quote/order exchange code. */
export function toArrowExchange(exchange) {
  return exchange === "MCX" ? "MCXFO" : exchange;
}

/** Arrow exchange code -> contract exchange. */
export function fromArrowExchange(exchange) {
  const e = String(exchange || "").toUpperCase();
  if (e === "MCXFO") return "MCX";
  if (e === "NCD") return "CDS";
  return e;
}

/** Contract exchange -> lowercase path segment of the historical API (/candle/:exchange/:token/:interval). */
export function toHistoryExchange(exchange) {
  return String(exchange || "").toLowerCase();
}

/** Is this an F&O exchange (option/future tradingsymbols)? */
export const isDerivativeExchange = (e) => e === "NFO" || e === "BFO" || e === "MCX" || e === "CDS";

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "30-Mar-2026" / "21-JUL-2026" -> "2026-03-30" / "2026-07-21"; null when unparseable. */
export function arrowDateToIso(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toUpperCase()];
  return mon ? `${m[3]}-${mon}-${m[1].padStart(2, "0")}` : null;
}

/** "2026-07-21" -> "21-JUL-2026" (the /info/option-chain request format). */
export function isoToArrowDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return null;
  const mon = Object.keys(MONTHS).find((k) => MONTHS[k] === m[2]);
  return mon ? `${m[3]}-${mon}-${m[1]}` : null;
}

/** Split one CSV line, honouring double quotes (company names can contain commas). */
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse the master CSV into objects keyed by header name. */
export function parseMasterCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const headers = splitCsvLine(lines[0] || "");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => { row[h] = cols[j] ?? ""; });
    rows.push(row);
  }
  return rows;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * One master row -> contract Instrument, or null for rows this app does not use (currency, commodity
 * indices, non-canonical index derivatives, non-EQ cash series).
 */
export function toInstrument(row) {
  const seg = String(row?.ExchSeg || "").toUpperCase();
  const exchange = EXCHSEG_TO_EXCHANGE[seg];
  if (!exchange || exchange === "CDS") return null;
  const token = String(row.Token || "").trim();
  if (!token) return null;
  if (seg === "NSEIDX" || seg === "BSEIDX") {
    const canon = INDEX_ROW_NAMES[String(row.Symbol || "").replace(/\s+/g, "").toUpperCase()];
    if (!canon || INDEX_UNDERLYINGS[canon].cash !== exchange) return null;
    return { token, exchange, tradingSymbol: canon, underlying: canon, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05 };
  }
  const tradingSymbol = String(row.TradingSymbol || "").trim();
  const lotSize = num(row.LotSize) || 1;
  const tickSize = num(row.TickSize) || 0.05;
  if (seg === "NSECM" || seg === "BSECM") {
    const series = String(row.Series || "").toUpperCase();
    if (seg === "NSECM" && series !== "EQ") return null;
    if (!tradingSymbol) return null;
    return { token, exchange, tradingSymbol, underlying: String(row.Symbol || tradingSymbol), instrumentType: "EQ", expiry: null, strike: null, optionType: null, lotSize, tickSize };
  }
  const underlyingRaw = String(row.Underlying || row.Symbol || "").toUpperCase();
  if (OTHER_INDEX_UNDERLYINGS.has(underlyingRaw)) return null;
  const isIndex = CANONICAL_UNDERLYINGS.includes(underlyingRaw);
  const expiry = arrowDateToIso(row.Expiry);
  if (!expiry || !tradingSymbol) return null;
  const optionType = String(row.OptionType || "").toUpperCase();
  if (optionType === "CE" || optionType === "PE") {
    const strike = num(row.StrikePrice);
    if (!(strike > 0)) return null;
    return { token, exchange, tradingSymbol, underlying: underlyingRaw, instrumentType: isIndex ? "OPTIDX" : "OPTSTK", expiry, strike, optionType, lotSize, tickSize };
  }
  if (exchange === "MCX") return null; // commodity futures are outside this app's instrument types
  return { token, exchange, tradingSymbol, underlying: underlyingRaw, instrumentType: isIndex ? "FUTIDX" : "FUTSTK", expiry, strike: null, optionType: null, lotSize, tickSize };
}

/**
 * Where an app symbol's options live: indices use exchange INDEX + the bare name, stocks use NSE + "<SYM>-EQ"
 * (both for /info/option-chain and the spot quote).
 */
export function underlyingRef(symbol) {
  const s = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9&_-]{1,30}$/.test(s)) return null;
  const idx = INDEX_UNDERLYINGS[s];
  if (idx) return { kind: "index", chainExchange: "INDEX", chainUnderlying: idx.name, quoteExchange: "INDEX", quoteSymbol: idx.name, expiryKey: `INDEX:${idx.name}` };
  const eq = s.endsWith("-EQ") ? s : `${s}-EQ`;
  return { kind: "stock", chainExchange: "NSE", chainUnderlying: eq, quoteExchange: "NSE", quoteSymbol: eq, expiryKey: `NSE:${eq}` };
}

/** Expiries for one underlying from the /info/option-chain-symbols/all payload, ISO ascending. */
export function expiriesFromSymbols(json, symbol) {
  const ref = underlyingRef(symbol);
  if (!ref) return [];
  const data = json?.data || {};
  const list = (ref.kind === "index" ? data.indices : data.equity)?.[ref.expiryKey] ?? [];
  return [...new Set((Array.isArray(list) ? list : []).map(arrowDateToIso).filter(Boolean))].sort();
}
