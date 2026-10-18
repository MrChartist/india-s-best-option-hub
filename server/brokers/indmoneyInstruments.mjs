/**
 * IndMoney (INDstocks) instrument master. Official docs: "Get Instrument List (CSV)" in the official Postman
 * collection (https://documenter.getpostman.com/view/56363899/2sBY4LShyj), checked 2026-10.
 *
 * GET /market/instruments?source=equity|fno|index (authenticated, Data bucket 5/s) returns CSV:
 *  - fno / equity: EXCH, SEGMENT (D | E), SECURITY_ID, INSTRUMENT_NAME (OPTIDX | OPTSTK | FUTIDX | FUTSTK |
 *    EQUITY), EXPIRY_CODE ("29 Sep 2026"), TRADING_SYMBOL ("NIFTY-Sep2026-22150-CE"), LOT_UNITS,
 *    CUSTOM_SYMBOL ("NIFTY 29 SEP 22150 CE"), EXPIRY_DATE ("09/29/2026 14:00", month first), STRIKE_PRICE,
 *    OPTION_TYPE (CE | PE | XX for futures), TICK_SIZE, EXPIRY_FLAG, SEM_EXCH_INSTRUMENT_TYPE, SERIES,
 *    SYMBOL_NAME (blank on derivatives in the sample).
 *  - index: EXCH, SEGMENT (the index name, e.g. "NIFTY 50", "BANK NIFTY"), SECURITY_ID.
 * TICK_SIZE is in paise in the sample (5 for a NIFTY option = Rs 0.05; 1 for SUZLON = Rs 0.01), so it is
 * divided by 100.
 *
 * Fixed here (vs the earlier adapter): it matched options on SYMBOL_NAME, which is blank on derivatives, so
 * no option was ever found; it read EXPIRY_DATE as day-first ("09/29/2026" is 29 Sep); the index names did
 * not match the documented index file. The underlying now comes from TRADING_SYMBOL before the first "-".
 *
 * REST scrip codes are SEGMENT_TOKEN: NSE_ / BSE_ (equity), NFO_ / BFO_ (derivatives), NIDX_ / BIDX_ (index;
 * prefixes from the WebSocket section, which lists NIDX/BIDX for indices).
 */

import { CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { indRequest } from "./indmoneyAuth.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

/** Documented index-file names for the six canonical underlyings. */
export const INDEX_NAME = {
  NIFTY: { exch: "NSE", name: "NIFTY 50" },
  BANKNIFTY: { exch: "NSE", name: "BANK NIFTY" },
  FINNIFTY: { exch: "NSE", name: "Nifty Financial" },
  MIDCPNIFTY: { exch: "NSE", name: "Nifty Midcap Sel" },
  SENSEX: { exch: "BSE", name: "SENSEX" },
  BANKEX: { exch: "BSE", name: "BANKEX" },
};
const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
const OTHER_INDEX_UNDERLYING = /^(NIFTY|SENSEX|BANKEX|FINNIFTY|MIDCPNIFTY)/;
const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    head.forEach((h, i) => { row[h] = (cols[i] ?? "").trim(); });
    return row;
  });
}

/** "09/29/2026 14:00" (MM/DD/YYYY) or EXPIRY_CODE "29 Sep 2026" -> "2026-09-29"; null if neither parses. */
export function expiryIso(expiryDate, expiryCode) {
  const a = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(expiryDate ?? "").trim());
  if (a && +a[1] >= 1 && +a[1] <= 12) return `${a[3]}-${a[1].padStart(2, "0")}-${a[2].padStart(2, "0")}`;
  const b = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(String(expiryCode ?? "").trim());
  if (b && MONTHS[b[2].toUpperCase()]) return `${b[3]}-${MONTHS[b[2].toUpperCase()]}-${b[1].padStart(2, "0")}`;
  return null;
}

/** TICK_SIZE (paise) -> rupees. */
export function tickRupees(v) {
  const t = Number(v);
  return Number.isFinite(t) && t > 0 ? Math.round(t) / 100 : 0.05;
}

export function scripPrefix(exchange, isIndex = false) {
  if (isIndex) return exchange === "BSE" ? "BIDX" : "NIDX";
  return { NSE: "NSE", BSE: "BSE", NFO: "NFO", BFO: "BFO" }[exchange] ?? null;
}

/** fno/equity CSV row -> compact master row (contract fields + scripCode), or null. */
export function toMasterRow(r) {
  const exch = r.EXCH;
  if (exch !== "NSE" && exch !== "BSE") return null;
  const token = r.SECURITY_ID;
  if (!/^\d+$/.test(String(token ?? ""))) return null;
  const kind = r.INSTRUMENT_NAME;
  const lot = Number(r.LOT_UNITS);
  if (r.SEGMENT === "E" && kind === "EQUITY") {
    if (r.SEM_EXCH_INSTRUMENT_TYPE === "DBT") return null;
    return { token, exchange: exch, tradingSymbol: r.TRADING_SYMBOL, underlying: r.TRADING_SYMBOL, instrumentType: "EQ",
      expiry: null, strike: null, optionType: null, lotSize: lot > 0 ? lot : 1, tickSize: tickRupees(r.TICK_SIZE), scripCode: `${exch}_${token}` };
  }
  if (r.SEGMENT !== "D" || !["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].includes(kind)) return null;
  const underlying = String(r.TRADING_SYMBOL ?? "").split("-")[0].trim().toUpperCase();
  const isIndexKind = kind.endsWith("IDX");
  if (isIndexKind && !CANONICAL.has(underlying)) return null; // NIFTYNXT50, SENSEX50 ... not mapped
  if (!isIndexKind && OTHER_INDEX_UNDERLYING.test(underlying)) return null; // an index labelled as a stock
  const expiry = expiryIso(r.EXPIRY_DATE, r.EXPIRY_CODE);
  if (!underlying || !expiry || !(lot > 0)) return null;
  const isOpt = kind.startsWith("OPT");
  const strike = Number(r.STRIKE_PRICE);
  const optionType = r.OPTION_TYPE === "CE" || r.OPTION_TYPE === "PE" ? r.OPTION_TYPE : null;
  if (isOpt && (!(strike > 0) || !optionType)) return null;
  const exchange = exch === "NSE" ? "NFO" : "BFO";
  return { token, exchange, tradingSymbol: r.TRADING_SYMBOL, underlying, instrumentType: kind, expiry,
    strike: isOpt ? strike : null, optionType: isOpt ? optionType : null, lotSize: lot, tickSize: tickRupees(r.TICK_SIZE), scripCode: `${exchange}_${token}` };
}

/** index CSV row -> master row. Canonical names map to NIFTY ... BANKEX; others keep the index name. */
export function toIndexRow(r) {
  const exch = r.EXCH;
  if ((exch !== "NSE" && exch !== "BSE") || !/^\d+$/.test(String(r.SECURITY_ID ?? ""))) return null;
  const canonical = Object.entries(INDEX_NAME).find(([, v]) => v.exch === exch && v.name.toUpperCase() === String(r.SEGMENT).toUpperCase())?.[0];
  const name = canonical ?? r.SEGMENT;
  return { token: r.SECURITY_ID, exchange: exch, tradingSymbol: name, underlying: name, instrumentType: "INDEX",
    expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05, scripCode: `${scripPrefix(exch, true)}_${r.SECURITY_ID}` };
}

async function download(creds, source, mapRow) {
  const text = await indRequest(creds, "/market/instruments", { params: { source }, raw: true });
  return parseCsv(text).map(mapRow).filter(Boolean);
}

/**
 * Daily-cached master files. The cache is shared by every user (public reference data); `creds` are only
 * used to authenticate the download when the cache is empty. Callers check the session first.
 */
export const getFno = (creds) => getCachedOrFetch("indmoney:fno:v2", () => download(creds, "fno", toMasterRow), ONE_DAY_MS);
export const getEquity = (creds) => getCachedOrFetch("indmoney:equity:v2", () => download(creds, "equity", toMasterRow), ONE_DAY_MS);
export const getIndices = (creds) => getCachedOrFetch("indmoney:index:v2", () => download(creds, "index", toIndexRow), ONE_DAY_MS);

export function optionRows(fno, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  return fno.filter((m) => m.underlying === u && m.strike !== null);
}

export function listExpiries(fno, symbol) {
  return [...new Set(optionRows(fno, symbol).map((m) => m.expiry))].sort();
}

/** Spot row: the canonical index, or the NSE equity of a stock underlying. */
export function spotRow(indices, equity, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  if (INDEX_NAME[u]) return indices.find((m) => m.underlying === u) ?? null;
  return equity?.find((m) => m.exchange === "NSE" && m.tradingSymbol === u) ?? null;
}

/** REST scrip code for a contract InstrumentRef; index tokens are recognised from the index file. */
export function scripCodeOf(ref, indices = []) {
  const token = String(ref?.token ?? "");
  if (!/^\d+$/.test(token)) return null;
  const idx = indices.find((m) => m.token === token && m.exchange === ref?.exchange);
  if (idx) return idx.scripCode;
  const p = scripPrefix(ref?.exchange);
  return p ? `${p}_${token}` : null;
}
