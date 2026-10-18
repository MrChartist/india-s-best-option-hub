/**
 * IIFL Capital contract files (instrument master).
 *
 * Official docs (https://developers.iiflcapital.com/apidocs/annexure, "Instrument Details") list one CSV and
 * one JSON per segment at https://api.iiflcapital.com/v1/contractfiles/<SEGMENT>.csv for NSEEQ, NSEFO, NSECOMM,
 * MCXCOMM, INDICES, NSECURR, BSEEQ, BSEFO, BSECURR (2 requests/s). They download without auth.
 * The docs do not print the columns; the published files carry this header (read by name, not position):
 *   Exchange, Underlying Instrument Symbol, Instrument ID, Instrument Type, Option Type, Strike Price,
 *   Underlying Instrument Name, Formatted Ins Name, Trading Symbol, qtyLimit, Expiry ("29-Dec-2026 23:59"),
 *   Lot Size, Tick Size
 * Instrument Type: OPTIDX, OPTSTK, FUTIDX, FUTSTK, INDEX (the published BSEFO file also spells some stock
 * options "OTPSTK"; they are read as OPTSTK). INDICES rows sit on NSEEQ / BSEEQ with the index name in
 * "Underlying Instrument Name" (NIFTY 50, NIFTY BANK, NIFTY FIN SERVICE, NIFTY MIDCAP SELECT, SENSEX, BANKEX).
 * The `exchange` sent to /marketdata/* is the file's Exchange value (NSEFO, BSEFO, NSEEQ, BSEEQ).
 */

import { brokerFetch, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { BASE_URL } from "./iiflcapitalAuth.mjs";

export const CONTRACT_EXCHANGE = { NSEEQ: "NSE", BSEEQ: "BSE", NSEFO: "NFO", BSEFO: "BFO" };
export const IIFL_EXCHANGE = { NSE: "NSEEQ", BSE: "BSEEQ", NFO: "NSEFO", BFO: "BSEFO" };
/** INDICES.csv "Underlying Instrument Name" (spaces removed, upper-case) -> canonical underlying. */
const INDEX_NAME = { NIFTY50: "NIFTY", NIFTYBANK: "BANKNIFTY", NIFTYFINSERVICE: "FINNIFTY", NIFTYMIDCAPSELECT: "MIDCPNIFTY", SENSEX: "SENSEX", BANKEX: "BANKEX" };
export const INDEX_EXCHANGE = { NIFTY: "NSE", BANKNIFTY: "NSE", FINNIFTY: "NSE", MIDCPNIFTY: "NSE", SENSEX: "BSE", BANKEX: "BSE" };
const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
const OTHER_INDEX_UNDERLYING = /^(NIFTY|SENSEX|BANKEX|FINNIFTY|MIDCPNIFTY|FOCIT)/;
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

/** "29-Dec-2026 23:59" / "29-Dec-2026" -> "2026-12-29"; null otherwise. */
export function expiryIso(raw) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(String(raw ?? "").trim());
  if (!m || !MONTHS[m[2].toUpperCase()]) return null;
  return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}`;
}

/** One contract-file row -> compact master row (contract fields + iiflExchange), or null. */
export function toMasterRow(r) {
  const iiflExchange = r["Exchange"];
  const exchange = CONTRACT_EXCHANGE[iiflExchange];
  const token = r["Instrument ID"];
  if (!exchange || !/^\d+$/.test(String(token ?? ""))) return null;
  let type = String(r["Instrument Type"] ?? "").toUpperCase();
  if (type === "OTPSTK") type = "OPTSTK";
  const lot = Number(r["Lot Size"]);
  const tick = Number(r["Tick Size"]);
  const base = { token, iiflExchange, exchange, tradingSymbol: r["Trading Symbol"] || r["Formatted Ins Name"] };
  if (type === "INDEX") {
    const name = String(r["Underlying Instrument Name"] || r["Underlying Instrument Symbol"] || "").toUpperCase().replace(/\s+/g, "");
    const underlying = INDEX_NAME[name] ?? r["Underlying Instrument Name"];
    return { ...base, underlying, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05 };
  }
  if (iiflExchange === "NSEEQ" || iiflExchange === "BSEEQ") {
    if (!base.tradingSymbol) return null;
    return { ...base, underlying: r["Underlying Instrument Symbol"] || base.tradingSymbol, instrumentType: "EQ", expiry: null, strike: null, optionType: null,
      lotSize: lot > 0 ? lot : 1, tickSize: tick > 0 ? tick : 0.05 };
  }
  if (!["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].includes(type)) return null;
  const underlying = String(r["Underlying Instrument Symbol"] ?? "").toUpperCase();
  if (type.endsWith("IDX") && !CANONICAL.has(underlying)) return null; // NIFTYNXT50, SENSEX50, ... not mapped
  if (type.endsWith("STK") && OTHER_INDEX_UNDERLYING.test(underlying)) return null;
  const expiry = expiryIso(r["Expiry"]);
  if (!underlying || !expiry || !(lot > 0)) return null;
  const isOpt = type.startsWith("OPT");
  const strike = Number(r["Strike Price"]);
  const optionType = r["Option Type"] === "CE" || r["Option Type"] === "PE" ? r["Option Type"] : null;
  if (isOpt && (!(strike > 0) || !optionType)) return null;
  return { ...base, underlying, instrumentType: type, expiry, strike: isOpt ? strike : null, optionType: isOpt ? optionType : null, lotSize: lot, tickSize: tick > 0 ? tick : 0.05 };
}

async function download(segment) {
  const res = await brokerFetch(`${BASE_URL}/contractfiles/${segment}.csv`, { redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`IIFL Capital contract file ${segment} download failed (HTTP ${res.status})`);
  return parseCsv(await res.text()).map(toMasterRow).filter(Boolean);
}

/** Daily-cached contract file rows (public reference data shared by every user). */
export function getSegment(segment) {
  return getCachedOrFetch(`iiflcapital:contract:${segment}:v2`, () => download(segment), ONE_DAY_MS);
}

/** The F&O file a symbol's options live in. */
export async function fnoFor(symbol) {
  const u = String(symbol ?? "").toUpperCase();
  if (INDEX_EXCHANGE[u] === "BSE") return getSegment("BSEFO");
  const nse = await getSegment("NSEFO");
  if (INDEX_EXCHANGE[u] || nse.some((m) => m.underlying === u)) return nse;
  return getSegment("BSEFO");
}

export function optionRows(fno, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  return fno.filter((m) => m.underlying === u && m.strike !== null);
}

export function listExpiries(fno, symbol) {
  return [...new Set(optionRows(fno, symbol).map((m) => m.expiry))].sort();
}

/** Spot instrument { exchange: IIFL code, instrumentId } for an index or an NSE stock, or null. */
export async function spotInstrument(symbol) {
  const u = String(symbol ?? "").toUpperCase();
  if (INDEX_EXCHANGE[u]) {
    const row = (await getSegment("INDICES")).find((m) => m.underlying === u && m.exchange === INDEX_EXCHANGE[u]);
    return row ? { exchange: row.iiflExchange, instrumentId: row.token } : null;
  }
  const row = (await getSegment("NSEEQ")).find((m) => m.underlying === u || m.tradingSymbol === `${u}-EQ` || m.tradingSymbol === u);
  return row ? { exchange: row.iiflExchange, instrumentId: row.token } : null;
}

/** Contract InstrumentRef -> IIFL { exchange, instrumentId } (index tokens sit on NSEEQ/BSEEQ, so no lookup needed). */
export function iiflInstrument(ref) {
  const exchange = IIFL_EXCHANGE[ref?.exchange];
  const instrumentId = String(ref?.token ?? "");
  if (!exchange || !/^\d+$/.test(instrumentId)) return null;
  return { exchange, instrumentId };
}
