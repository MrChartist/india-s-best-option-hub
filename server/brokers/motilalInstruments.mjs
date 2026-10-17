/**
 * Motilal Oswal instrument-master helpers.
 *
 * Motilal has no native option-chain endpoint (confirmed against openalgo's
 * production adapter — `broker/motilal/api/data.py` only exposes a
 * single-scrip LTP call). The chain is built here from Motilal's own public,
 * unauthenticated CSV dumps:
 *
 *   GET /getscripmastercsv?name=NSEFO   (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY options)
 *   GET /getscripmastercsv?name=BSEFO   (SENSEX options)
 *   GET /getindexdatacsv?name=NSE|BSE   (index codes, for resolving the underlying spot)
 *
 * Column names, the SENSEX "BSX" house code and the scripname-based expiry
 * parse below are all taken verbatim from openalgo's
 * `broker/motilal/database/master_contract_db.py`, which documents each of
 * these as cross-checked against a live download (0 mismatches vs. the
 * `expirydate` epoch field across ~146k NSEFO/BSEFO/NSECD rows).
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

const OPTION_MASTER_URL = "https://openapi.motilaloswal.com/getscripmastercsv";
const INDEX_MASTER_URL = "https://openapi.motilaloswal.com/getindexdatacsv";

// Which F&O scrip-master file + Motilal "scripshortname" identifies each
// app symbol's option contracts. NSEFO's scripshortname is already canonical
// (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY) — no aliasing needed. BSEFO ships
// SENSEX index derivatives under the house code "BSX" (ultoken 999901), not
// the spelled-out name.
const SYMBOL_CONFIG = {
  NIFTY: { foName: "NSEFO", scripShortName: "NIFTY" },
  BANKNIFTY: { foName: "NSEFO", scripShortName: "BANKNIFTY" },
  FINNIFTY: { foName: "NSEFO", scripShortName: "FINNIFTY" },
  MIDCPNIFTY: { foName: "NSEFO", scripShortName: "MIDCPNIFTY" },
  SENSEX: { foName: "BSEFO", scripShortName: "BSX" },
};

// Index-master CSV ("NSE"/"BSE") + the broker-house index names that resolve
// to each app symbol, matched after upper-casing and stripping all whitespace.
const INDEX_CONFIG = {
  NIFTY: { csv: "NSE", aliases: ["NIFTY50", "NIFTY"] },
  BANKNIFTY: { csv: "NSE", aliases: ["NIFTYBANK", "BANKNIFTY"] },
  FINNIFTY: { csv: "NSE", aliases: ["NIFTYFINSERVICE", "NIFTYFINSERV", "FINNIFTY"] },
  MIDCPNIFTY: { csv: "NSE", aliases: ["NIFTYMIDSELECT", "NIFTYMIDCAPSELECT", "MIDCPNIFTY"] },
  SENSEX: { csv: "BSE", aliases: ["SENSEX", "BSESENSEX"] },
};

export const KNOWN_SYMBOLS = new Set(Object.keys(SYMBOL_CONFIG));

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const EXPIRY_RE = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/;

/** "NIFTY 30-OCT-2025 CE 24000" -> "2025-10-30", per scripname's embedded DD-MMM-YYYY token. */
function parseExpiryFromScripname(scripname) {
  if (!scripname) return null;
  for (const part of String(scripname).split(/\s+/)) {
    const m = EXPIRY_RE.exec(part);
    if (!m) continue;
    const month = MONTHS[m[2].toUpperCase()];
    if (!month) continue;
    return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/** Quote-aware CSV line splitter (Motilal's scripname field can be quoted). */
function splitCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = new Array(lines.length - 1);
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = fields[j];
    rows[i - 1] = row;
  }
  return rows;
}

async function downloadCsv(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Motilal Oswal CSV download failed [HTTP ${res.status}] (${url}): ${text.slice(0, 200)}`);
  return parseCsv(text);
}

/** Parses every CE/PE row out of one F&O scrip-master CSV, keyed by scripshortname. NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY share the same NSEFO file, so this is fetched once per file, not once per symbol. */
async function fetchAndFilterOptionMaster(foName) {
  const rows = await downloadCsv(`${OPTION_MASTER_URL}?name=${foName}`);
  const filtered = [];
  for (const row of rows) {
    const optionType = (row.optiontype || "").trim().toUpperCase();
    if (optionType !== "CE" && optionType !== "PE") continue;
    const expiryIso = parseExpiryFromScripname(row.scripname);
    const strike = Number(row.strikeprice);
    const token = (row.scripcode || "").trim();
    const exchangename = (row.exchangename || foName).trim();
    const scripShortName = (row.scripshortname || "").trim().toUpperCase();
    if (!expiryIso || !Number.isFinite(strike) || strike <= 0 || !token || !scripShortName) continue;
    filtered.push({ scripShortName, token, exchangename, strike, expiryIso, side: optionType === "CE" ? "ce" : "pe" });
  }
  return filtered;
}

/** Cached once/day per F&O file (NSEFO/BSEFO) — public, unauthenticated CSV; shared across every user's credentials and every symbol on that exchange. */
async function getFoMaster(foName) {
  return getCachedOrFetch(`motilal:optmaster:${foName}`, () => fetchAndFilterOptionMaster(foName), ONE_DAY_MS);
}

/** All CE/PE rows for one app symbol (filtered in-memory from the shared per-exchange master). */
export async function getOptionMaster(symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) throw new Error(`Unknown symbol for Motilal Oswal: ${symbol}`);
  const rows = await getFoMaster(cfg.foName);
  return rows.filter((r) => r.scripShortName === cfg.scripShortName);
}

/** Distinct, ascending ISO expiry dates. */
export function listExpiries(rows) {
  return Array.from(new Set(rows.map((r) => r.expiryIso))).sort();
}

/** Map of strike (string) -> { ce?: {token, exchangename}, pe?: {token, exchangename} } for one expiry. */
export function strikeMapForExpiry(rows, expiryIso) {
  const map = new Map();
  for (const row of rows) {
    if (row.expiryIso !== expiryIso) continue;
    const strikeKey = String(row.strike);
    if (!map.has(strikeKey)) map.set(strikeKey, {});
    map.get(strikeKey)[row.side] = { token: row.token, exchangename: row.exchangename };
  }
  return map;
}

async function fetchAndFilterIndexMaster(csvName) {
  const rows = await downloadCsv(`${INDEX_MASTER_URL}?name=${csvName}`);
  return rows.map((r) => ({
    token: (r.indexcode || "").trim(),
    name: (r.indexname || "").trim(),
    exchangename: (r.exchangename || csvName).trim(),
  }));
}

/** Cached once/day per index CSV ("NSE"/"BSE"). */
async function getIndexMaster(csvName) {
  return getCachedOrFetch(`motilal:indexmaster:${csvName}`, () => fetchAndFilterIndexMaster(csvName), ONE_DAY_MS);
}

/** The index-master row (token + Motilal exchange) for an app symbol's underlying spot, or null. */
export async function resolveIndexInfo(symbol) {
  const cfg = INDEX_CONFIG[symbol];
  if (!cfg) return null;
  const rows = await getIndexMaster(cfg.csv);
  const aliasSet = new Set(cfg.aliases);
  const row = rows.find((r) => aliasSet.has(r.name.toUpperCase().replace(/\s+/g, "")));
  if (!row || !row.token) return null;
  return { token: row.token, exchangename: cfg.csv }; // getindexltpdata wants the bare "NSE"/"BSE" exchange
}
