/**
 * Pocketful contract master (official docs, checked 2026-10: https://api.pocketful.in/docs/curl/security-id-list).
 *  - GET https://algo.pocketful.in/api/v1/contract/Compact?info=download&exchanges=NSE,NFO,BSE,BFO -> a ZIP with one
 *    CSV per exchange (NSECompactScrip.csv, NFOCompactScrip.csv, BSECompactScrip.csv, BFOCompactScrip.csv). Public,
 *    no auth header needed. (MCX is skipped: no MCX instrument is used here.)
 *  - Live header (2026-10): exchange_token,trading_symbol,company_name,close_price,expiry,strike,tick_size,lot_size,
 *    instrument_name,option_type,segment,exchange,fin_instrm_pdct_tp_cd,asset_code
 *  - expiry is "27-Oct-2026". NFO instrument_name: OPTIDX/FUTIDX/OPTSTK/FUTSTK; BFO: IO/IF/SO/SF. option_type CE/PE,
 *    XX for futures. company_name is the underlying (NIFTY, SENSEX, RELIANCE ...).
 *  - Index spots: NSE rows with segment INDICES ("Nifty 50" 26000, "Nifty Bank" 26009, "Nifty Fin Service" 26037,
 *    "NIFTY MID SELECT" 26074) and BSE rows with segment IDX ("SENSEX" 1, "BANKEX" 12).
 *  - WebSocket exchange codes (Detailed Marketdata docs): NSE 1, NFO 2, CDS 3, MCX 4, BSE 6, BFO 7.
 *
 * Fixed here: the old parser turned "27-Oct-2026" into a Date at LOCAL midnight and printed it in UTC, so on a machine
 * set to IST every expiry came out one day early. Expiries are now parsed field by field. BANKEX and stock options were
 * also missing.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { brokerFetch, BrokerInputError } from "./contract.mjs";
import { BASE_URL } from "./pocketfulAuth.mjs";
import { extractCsvEntries } from "./pocketfulZip.mjs";
import { readBodyCapped } from "../lib/safeArchive.mjs";

export const CONTRACT_URL = `${BASE_URL}/api/v1/contract/Compact?info=download&exchanges=NSE,NFO,BSE,BFO`;
export const EXCHANGE_CODE = { NSE: 1, NFO: 2, CDS: 3, MCX: 4, BSE: 6, BFO: 7 };
export const CANONICAL = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"]);
const INDEX_NAME = { "NSE|Nifty 50": "NIFTY", "NSE|Nifty Bank": "BANKNIFTY", "NSE|Nifty Fin Service": "FINNIFTY", "NSE|NIFTY MID SELECT": "MIDCPNIFTY", "BSE|SENSEX": "SENSEX", "BSE|BANKEX": "BANKEX" };
const TYPE_OF = {
  "NFO|OPTIDX": "OPTIDX", "NFO|FUTIDX": "FUTIDX", "NFO|OPTSTK": "OPTSTK", "NFO|FUTSTK": "FUTSTK",
  "BFO|IO": "OPTIDX", "BFO|IF": "FUTIDX", "BFO|SO": "OPTSTK", "BFO|SF": "FUTSTK", "NSE|EQ": "EQ",
};
const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "27-Oct-2026" -> "2026-10-27" (no Date object, so no timezone shift). */
export function pocketfulExpiryToIso(raw) {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  const mm = m && MONTHS[m[2].toUpperCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
}

/** Minimal CSV parser that copes with quoted fields (company names can contain commas). */
export function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = split(lines[i]);
    if (cells.length < head.length) continue;
    const row = {};
    head.forEach((h, j) => { row[h] = (cells[j] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

/** One CSV row -> contract Instrument (+ exchangeCode for the feed), or null. */
export function toInstrument(row) {
  const exchange = String(row.exchange ?? "").toUpperCase();
  const token = String(row.exchange_token ?? "").trim();
  if (!token || !EXCHANGE_CODE[exchange]) return null;
  const base = { token, exchange, exchangeCode: EXCHANGE_CODE[exchange], tickSize: Number(row.tick_size) > 0 ? Number(row.tick_size) : 0.05 };
  const seg = String(row.segment ?? "").toUpperCase();
  if ((exchange === "NSE" && seg === "INDICES") || (exchange === "BSE" && seg === "IDX")) {
    const underlying = INDEX_NAME[`${exchange}|${row.trading_symbol}`];
    if (!underlying) return null;
    return { ...base, tradingSymbol: row.trading_symbol, underlying, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1 };
  }
  const instrumentType = TYPE_OF[`${exchange}|${String(row.instrument_name ?? "").toUpperCase()}`];
  if (!instrumentType) return null;
  const lotSize = Number(row.lot_size) > 0 ? Number(row.lot_size) : 1;
  if (instrumentType === "EQ") {
    const sym = String(row.trading_symbol ?? "").replace(/-EQ$/, "");
    return { ...base, tradingSymbol: row.trading_symbol, underlying: sym, instrumentType, expiry: null, strike: null, optionType: null, lotSize };
  }
  const underlying = String(row.company_name ?? "").toUpperCase();
  if (instrumentType.endsWith("IDX") && !CANONICAL.has(underlying)) return null;
  const expiry = pocketfulExpiryToIso(row.expiry);
  if (!expiry) return null;
  const isOpt = instrumentType.startsWith("OPT");
  const optionType = isOpt ? String(row.option_type ?? "").toUpperCase() : null;
  const strike = isOpt ? Number(row.strike) : null;
  if (isOpt && (!(strike > 0) || (optionType !== "CE" && optionType !== "PE"))) return null;
  return { ...base, tradingSymbol: row.trading_symbol, underlying, instrumentType, expiry, strike, optionType, lotSize };
}

async function download() {
  const res = await brokerFetch(CONTRACT_URL, { redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`Pocketful contract master download failed (HTTP ${res.status})`);
  const entries = extractCsvEntries(await readBodyCapped(res, { label: "Pocketful contract master" }));
  const out = [];
  for (const file of ["nsecompactscrip.csv", "bsecompactscrip.csv", "nfocompactscrip.csv", "bfocompactscrip.csv"]) {
    for (const row of parseCsv(entries.get(file) || "")) {
      const inst = toInstrument(row);
      if (inst) out.push(inst);
    }
  }
  return out;
}

/** Cached once a day and shared by every user (public data). */
export function getInstruments() {
  return getCachedOrFetch("pocketful:contract:v2", download, ONE_DAY_MS);
}

export function resolveUnderlying(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (CANONICAL.has(s)) return { symbol: s, isIndex: true };
  if (/^[A-Z0-9&-]{1,20}$/.test(s)) return { symbol: s, isIndex: false };
  throw new BrokerInputError(`Pocketful: unknown symbol ${symbol}`);
}

export async function optionRows(symbol) {
  const u = resolveUnderlying(symbol);
  const rows = await getInstruments();
  const exch = u.symbol === "SENSEX" || u.symbol === "BANKEX" ? "BFO" : "NFO";
  return rows.filter((r) => r.underlying === u.symbol && r.exchange === exch && r.optionType);
}

export function distinctExpiries(rows) {
  return Array.from(new Set(rows.map((r) => r.expiry))).sort();
}

/** Index row (NSE/BSE) or NSE equity row for an underlying. */
export async function spotRow(symbol) {
  const u = resolveUnderlying(symbol);
  const rows = await getInstruments();
  const hit = rows.find((r) => r.underlying === u.symbol && r.instrumentType === (u.isIndex ? "INDEX" : "EQ"));
  if (!hit) throw new BrokerInputError(`Pocketful: no spot instrument for ${u.symbol}`);
  return hit;
}

export async function findByRef(ref) {
  const rows = await getInstruments();
  const token = String(ref?.token ?? "");
  const exchange = String(ref?.exchange ?? "").toUpperCase();
  return rows.find((r) => r.token === token && (!exchange || r.exchange === exchange)) || null;
}
