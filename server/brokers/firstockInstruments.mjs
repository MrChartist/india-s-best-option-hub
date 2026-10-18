/**
 * Firstock symbol masters + index spot resolution.
 *
 * Official docs (https://firstock.in/api/docs/downloaders/, checked 2026-10) link five public CSV files:
 *   https://api.firstock.in/V1/symbols/{NSE|BSE|NFO|BFO|Indices}?ref=firstock.in
 * Headers (read from the published files):
 *   Indices: Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize
 *            (NFO and BFO index futures/options: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX, ...)
 *   NFO/BFO: Exchange,Token,LotSize,Symbol,TradingSymbol,CompanyName,Expiry,Instrument,OptionType,StrikePrice,
 *            TickSize,FreezeQty (stock F&O lives here; CompanyName may be quoted)
 *   NSE/BSE: Exchange,Token,LotSize,TradingSymbol,CompanyName,ISIN,TickSize,FreezeQty
 * Expiry is "DD-MON-YYYY"; OptionType is CE / PE / FUT. Index options use the index name in Symbol
 * (SENSEX and BANKEX as well), so no product-code mapping is needed.
 *
 * Index spot quotes need the index's own tradingSymbol: POST /indexList (authenticated, docs index-list/)
 * returns { exchange, token, tradingSymbol, symbol, idxname } (NIFTY / BANKNIFTY on NSE, SENSEX on BSE in
 * the documented sample). It is cached for a day; the documented names are the fallback.
 *
 * This module previously downloaded the full NFO + BFO files for index options; the smaller Indices file
 * carries all index derivatives (BANKEX included), and NFO is now only downloaded for stock options.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { brokerFetch, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { callApi } from "./firstockAuth.mjs";

export const SYMBOL_BASE = "https://api.firstock.in/V1/symbols";
const INDEX_EXCHANGE = { NIFTY: "NFO", BANKNIFTY: "NFO", FINNIFTY: "NFO", MIDCPNIFTY: "NFO", SENSEX: "BFO", BANKEX: "BFO" };
const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const MONTH_NAMES = Object.keys(MONTHS);

/** Documented spot names (index-list sample) used when /indexList does not list an index. */
const SPOT_FALLBACK = {
  NIFTY: { exchange: "NSE", tradingSymbol: "NIFTY", token: "26000" },
  BANKNIFTY: { exchange: "NSE", tradingSymbol: "BANKNIFTY", token: "26009" },
  SENSEX: { exchange: "BSE", tradingSymbol: "SENSEX", token: "1" },
};
const INDEX_ALIASES = {
  NIFTY: ["NIFTY", "NIFTY50"],
  BANKNIFTY: ["BANKNIFTY", "NIFTYBANK"],
  FINNIFTY: ["FINNIFTY", "NIFTYFINSERVICE", "NIFTYFINSERV", "NIFTYFINANCIALSERVICES"],
  MIDCPNIFTY: ["MIDCPNIFTY", "NIFTYMIDSELECT", "NIFTYMIDCAPSELECT"],
  SENSEX: ["SENSEX", "SPBSESENSEX", "BSESENSEX"],
  BANKEX: ["BANKEX", "SPBSEBANKEX", "BSEBANKEX"],
};
const ALIAS_LOOKUP = new Map();
for (const [sym, aliases] of Object.entries(INDEX_ALIASES)) for (const a of aliases) ALIAS_LOOKUP.set(a, sym);
const squash = (v) => String(v ?? "").toUpperCase().replace(/[\s_&.-]/g, "");

export const isIndex = (symbol) => Object.prototype.hasOwnProperty.call(INDEX_EXCHANGE, String(symbol ?? "").toUpperCase());

/** Quote-aware CSV line splitter (CompanyName can contain commas). */
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
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const f = splitCsvLine(line);
    const row = {};
    header.forEach((h, j) => { if (h) row[h] = (f[j] ?? "").trim(); });
    return row;
  });
}

/** "28-Sep-2023" | "08MAY2025" -> ISO date, or null. */
export function expiryToIso(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  const m = /^(\d{1,2})-?([A-Z]{3})-?(\d{4})$/.exec(s);
  if (!m || !MONTHS[m[2]]) return null;
  return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
}

/** ISO date -> Firstock's option-chain expiry "DDMONYY" (e.g. 2026-10-20 -> 20OCT26). */
export function isoToDdMonYy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!m) return null;
  return `${m[3]}${MONTH_NAMES[Number(m[2]) - 1]}${m[1].slice(2)}`;
}

const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

/** One master row -> contract Instrument, or null. `fileExchange` covers equity files. */
export function toInstrument(r) {
  const exchange = String(r.Exchange ?? "").toUpperCase();
  const token = String(r.Token ?? "").trim();
  const tradingSymbol = String(r.TradingSymbol ?? "").trim();
  if (!token || !tradingSymbol || !["NSE", "BSE", "NFO", "BFO"].includes(exchange)) return null;
  const lotSize = toNum(r.LotSize);
  const tick = toNum(r.TickSize);
  const base = { token, exchange, tradingSymbol, lotSize: lotSize > 0 ? lotSize : 1, tickSize: tick > 0 ? tick : 0.05 };
  if (exchange === "NSE" || exchange === "BSE") {
    const underlying = exchange === "NSE" ? tradingSymbol.replace(/-(EQ|BE|BZ|SM|ST)$/i, "") : tradingSymbol;
    return { ...base, underlying, instrumentType: "EQ", expiry: null, strike: null, optionType: null };
  }
  const instrumentType = String(r.Instrument ?? "").toUpperCase();
  if (!["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].includes(instrumentType)) return null;
  const underlying = String(r.Symbol ?? "").trim().toUpperCase();
  if (instrumentType.endsWith("IDX") && !CANONICAL_UNDERLYINGS.includes(underlying)) return null;
  const expiry = expiryToIso(r.Expiry);
  if (!expiry) return null;
  const isOpt = instrumentType.startsWith("OPT");
  const optionType = isOpt ? String(r.OptionType ?? "").toUpperCase() : null;
  const strike = isOpt ? toNum(r.StrikePrice) : null;
  if (isOpt && ((optionType !== "CE" && optionType !== "PE") || !(strike > 0))) return null;
  return { ...base, underlying, instrumentType, expiry, strike, optionType };
}

async function download(file) {
  const res = await brokerFetch(`${SYMBOL_BASE}/${file}?ref=firstock.in`, { redirect: "follow" }, { kind: "master" });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firstock symbol download for ${file} failed (HTTP ${res.status})`);
  return text;
}

/** Parsed instruments of one published file (cached daily; the files are public and the same for all users). */
export async function getFile(file) {
  return getCachedOrFetch(`firstock:symbols:${file}:v2`, async () => {
    const out = [];
    for (const r of parseCsv(await download(file))) {
      const i = toInstrument(r);
      if (!i) continue;
      // The NFO/BFO files repeat the index derivatives already in the Indices file; keep stock F&O only.
      if ((file === "NFO" || file === "BFO") && i.instrumentType.endsWith("IDX")) continue;
      out.push(i);
    }
    return out;
  }, ONE_DAY_MS);
}

/** Instruments that can hold `symbol`'s options: the Indices file for indices, NFO for stocks. */
export async function derivativesFor(symbol) {
  return getFile(isIndex(symbol) ? "Indices" : "NFO");
}

const isOptionOf = (i, symbol) => (i.instrumentType === "OPTIDX" || i.instrumentType === "OPTSTK") && i.underlying === symbol;

export function listExpiries(instruments, symbol) {
  const want = String(symbol ?? "").toUpperCase();
  const set = new Set();
  for (const i of instruments) if (isOptionOf(i, want)) set.add(i.expiry);
  return [...set].sort();
}

export function optionContracts(instruments, symbol, expiry) {
  const want = String(symbol ?? "").toUpperCase();
  return instruments.filter((i) => isOptionOf(i, want) && i.expiry === expiry);
}

/** Option-chain exchange for an underlying (index map, else the contracts' own exchange, else NFO). */
export function chainExchange(symbol, contracts = []) {
  return INDEX_EXCHANGE[String(symbol ?? "").toUpperCase()] || contracts[0]?.exchange || "NFO";
}

async function fetchIndexList(creds) {
  const json = await callApi(creds, "/indexList", {});
  const map = {};
  for (const item of Array.isArray(json?.data) ? json.data : []) {
    const exchange = String(item?.exchange ?? "").trim().toUpperCase();
    if (exchange !== "NSE" && exchange !== "BSE") continue;
    for (const candidate of [item.symbol, item.tradingSymbol, item.idxname]) {
      const sym = ALIAS_LOOKUP.get(squash(candidate));
      if (sym && !map[sym]) map[sym] = { exchange, tradingSymbol: String(item.tradingSymbol), token: String(item.token ?? "") };
    }
  }
  return map;
}

/** canonical index -> { exchange, tradingSymbol, token } (cached daily after one authenticated call). */
export async function getIndexMap(creds) {
  const map = await getCachedOrFetch("firstock:indexList:v2", () => fetchIndexList(creds), ONE_DAY_MS);
  return { ...SPOT_FALLBACK, ...map };
}

/** Spot quote target for an index or a stock ("<SYMBOL>-EQ" on NSE). */
export async function spotTarget(creds, symbol) {
  const want = String(symbol ?? "").toUpperCase();
  if (isIndex(want)) return (await getIndexMap(creds))[want] || null;
  return { exchange: "NSE", tradingSymbol: `${want}-EQ` };
}
