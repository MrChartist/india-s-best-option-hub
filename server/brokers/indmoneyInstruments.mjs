/**
 * IndMoney (INDstocks) instrument master + strike/expiry/index resolution.
 *
 * INDstocks has no native option-chain endpoint (confirmed against docs
 * indstocks-api-docs/05-instruments.md + 06-market-quotes.md, and against
 * marketcalls/openalgo's production broker/indmoney adapter, which builds quotes purely
 * from /market/instruments + /market/quotes/*). Two CSV dumps resolve everything this app
 * needs:
 *   source=fno   -> every option/future contract (strike, expiry, SECURITY_ID)
 *   source=index -> the index spot instruments (NIFTY 50, SENSEX, ...)
 * Both are cached once/day via instrumentCache, shared across every user's credentials —
 * they only change on expiry days, and are public reference data once downloaded.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { apiGetRaw } from "./indmoneyAuth.mjs";

export const SYMBOL_EXCHANGE = {
  NIFTY: "NSE",
  BANKNIFTY: "NSE",
  FINNIFTY: "NSE",
  MIDCPNIFTY: "NSE",
  SENSEX: "BSE",
};

// Candidate index-instrument names to match against the source=index dump's
// SYMBOL_NAME / TRADING_SYMBOL / CUSTOM_SYMBOL columns. Unverified against a live response
// (no sandbox access) — best-effort, same caveat as zerodha.mjs's SPOT_TICKER map.
export const INDEX_ALIASES = {
  NIFTY: ["NIFTY 50", "NIFTY50", "NIFTY"],
  BANKNIFTY: ["NIFTY BANK", "BANKNIFTY", "NIFTY BANK INDEX"],
  FINNIFTY: ["NIFTY FIN SERVICE", "FINNIFTY", "NIFTY FINANCIAL SERVICES"],
  MIDCPNIFTY: ["NIFTY MIDCAP SELECT", "MIDCPNIFTY", "NIFTY MID SELECT"],
  SENSEX: ["SENSEX", "BSE SENSEX", "S&P BSE SENSEX"],
};

// REST scrip-code segment prefixes (indstocks-api-docs/03-conventions.md: "NSE_3045",
// "NFO_51011", "NIDX:26000"). The instrument-master CSV's own EXCH column is only ever
// NSE/BSE, so the FNO/index prefix is derived from which CSV `source` a row came from
// rather than trusting a SEGMENT value the docs don't fully enumerate.
function buildScripCode(exch, kind, securityId) {
  const prefix = kind === "index" ? (exch === "BSE" ? "BIDX" : "NIDX") : (exch === "BSE" ? "BFO" : "NFO");
  return `${prefix}_${securityId}`;
}

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** CSV parser tolerant of quoted fields — INDstocks columns are plain, this is cheap insurance. */
function parseCSV(text) {
  const rows = [];
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return rows;
  const headers = splitCSVLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < headers.length) continue;
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = cols[c];
    rows.push(row);
  }
  return rows;
}

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

function istDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Normalize INDstocks' EXPIRY_DATE column to "YYYY-MM-DD". The docs (05-instruments.md)
 * don't pin down the exact format, so this accepts epoch ms/seconds, "YYYY-MM-DD",
 * "DD-MM-YYYY"/"DD/MM/YYYY", and "DD-MMM-YYYY" (e.g. "30-JAN-2025"), falling back to
 * Date.parse for anything else.
 */
export function parseExpiryToIso(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  if (/^\d+$/.test(s)) {
    const num = Number(s);
    const ms = s.length >= 13 ? num : num * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return istDateString(d);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}`;

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : istDateString(d);
}

async function downloadInstruments(creds, source) {
  const text = await apiGetRaw(creds, "/market/instruments", { source });
  return parseCSV(text);
}

/** Cached once/day, shared across all users' credentials — creds are only needed to prime an empty cache. */
export async function getFnoMaster(creds) {
  return getCachedOrFetch("indmoney:instruments:fno", () => downloadInstruments(creds, "fno"), ONE_DAY_MS);
}

export async function getIndexMaster(creds) {
  return getCachedOrFetch("indmoney:instruments:index", () => downloadInstruments(creds, "index"), ONE_DAY_MS);
}

/** All CE/PE rows for `symbol` across every expiry, normalized. */
function optionRowsForSymbol(fnoMaster, symbol) {
  const exch = SYMBOL_EXCHANGE[symbol];
  if (!exch) return [];
  const out = [];
  for (const r of fnoMaster) {
    if ((r.SYMBOL_NAME || "").toUpperCase() !== symbol) continue;
    if ((r.EXCH || "").toUpperCase() !== exch) continue;
    const type = (r.OPTION_TYPE || "").toUpperCase();
    if (type !== "CE" && type !== "PE") continue;
    const strike = Number(r.STRIKE_PRICE);
    const securityId = r.SECURITY_ID;
    const expiryIso = parseExpiryToIso(r.EXPIRY_DATE);
    if (!strike || !securityId || !expiryIso) continue;
    out.push({ strike, type: type.toLowerCase(), expiryIso, scripCode: buildScripCode(exch, "fno", securityId) });
  }
  return out;
}

/** Distinct expiry dates ("YYYY-MM-DD"), ascending. */
export function listExpiries(fnoMaster, symbol) {
  const set = new Set(optionRowsForSymbol(fnoMaster, symbol).map((r) => r.expiryIso));
  return Array.from(set).sort();
}

export function optionRowsForExpiry(fnoMaster, symbol, expiryIso) {
  return optionRowsForSymbol(fnoMaster, symbol).filter((r) => r.expiryIso === expiryIso);
}

/** Resolve the index-spot scrip code for `symbol` from the source=index dump, or null. */
export function resolveIndexScrip(indexMaster, symbol) {
  const exch = SYMBOL_EXCHANGE[symbol];
  const aliases = (INDEX_ALIASES[symbol] || []).map((a) => a.toUpperCase());
  if (!exch || !aliases.length) return null;

  const rowsForExchange = indexMaster.filter((r) => (r.EXCH || "").toUpperCase() === exch);

  const exact = rowsForExchange.find((r) => {
    const candidates = [r.SYMBOL_NAME, r.TRADING_SYMBOL, r.CUSTOM_SYMBOL].map((v) => (v || "").toUpperCase());
    return candidates.some((c) => aliases.includes(c));
  });
  if (exact) return { scripCode: buildScripCode(exch, "index", exact.SECURITY_ID) };

  // Fallback: substring match, in case live column values carry extra suffixes
  // (e.g. "NIFTY 50 INDEX") the exact alias list didn't anticipate.
  const fuzzy = rowsForExchange.find((r) => {
    const candidates = [r.SYMBOL_NAME, r.TRADING_SYMBOL, r.CUSTOM_SYMBOL].map((v) => (v || "").toUpperCase());
    return candidates.some((c) => c && aliases.some((a) => c.includes(a) || a.includes(c)));
  });
  return fuzzy ? { scripCode: buildScripCode(exch, "index", fuzzy.SECURITY_ID) } : null;
}
