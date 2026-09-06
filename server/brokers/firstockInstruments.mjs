/**
 * Firstock instrument (symbol) master + index resolution.
 *
 * Firstock has no native option-chain endpoint — this module supplies the
 * strike/expiry -> tradingSymbol resolution that firstock.mjs joins with
 * batched /getMultiQuotes calls to build one.
 *
 * Two independent data sources, both cached once/day via instrumentCache.mjs:
 *  - NFO/BFO symbol master CSVs (`GET /V1/symbols/<seg>`) — public, no auth,
 *    documented in openalgo's firstock adapter. Columns:
 *    Exchange, Token, LotSize, Symbol, TradingSymbol, CompanyName, Expiry,
 *    Instrument, OptionType, StrikePrice, TickSize, FreezeQty
 *  - `/indexList` (POST, requires jKey) — as of Firstock's V1 API, index spot
 *    instruments (NIFTY, SENSEX, ...) are no longer in the symbol CSVs at
 *    all and must be resolved via this authenticated endpoint instead.
 */

import { callApi } from "./firstockAuth.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

const SYMBOL_BASE = "https://api.firstock.in/V1/symbols";

// Underlying name (as it appears in the NFO/BFO "Symbol" column) -> segment.
const UNDERLYING_SEGMENT = {
  NIFTY: "NFO",
  BANKNIFTY: "NFO",
  FINNIFTY: "NFO",
  MIDCPNIFTY: "NFO",
  SENSEX: "BFO",
};

// Tolerant matching for /indexList's raw broker names (e.g. "Nifty 50",
// "Nifty Bank", "Nifty Fin Service", "SENSEX") -> our canonical symbol.
const INDEX_ALIASES = {
  NIFTY: ["NIFTY", "NIFTY50"],
  BANKNIFTY: ["BANKNIFTY", "NIFTYBANK"],
  FINNIFTY: ["FINNIFTY", "NIFTYFINSERVICE", "NIFTYFINSERV", "NIFTYFINANCIALSERVICES"],
  MIDCPNIFTY: ["MIDCPNIFTY", "NIFTYMIDSELECT", "NIFTYMIDCAPSELECT"],
  SENSEX: ["SENSEX", "SPBSESENSEX", "BSESENSEX"],
};
const INDEX_ALIAS_LOOKUP = new Map();
for (const [symbol, aliases] of Object.entries(INDEX_ALIASES)) {
  for (const alias of aliases) INDEX_ALIAS_LOOKUP.set(alias, symbol);
}

function normalizeIndexKey(value) {
  if (!value) return "";
  return String(value).toUpperCase().replace(/[\s_&-]/g, "");
}

/** Quote-aware CSV line splitter (CompanyName can contain commas). */
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
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = new Array(lines.length - 1);
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = fields[j];
    rows[i - 1] = row;
  }
  return rows;
}

/** "28-Sep-2023" -> "2023-09-28". Returns null on an unparseable value. */
function expiryToIso(raw) {
  if (!raw) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(raw).trim());
  if (!m) return null;
  const months = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
  const mm = months[m[2].toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

function normalizeStrike(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : null;
}

async function downloadSegmentCsv(segment) {
  const res = await fetch(`${SYMBOL_BASE}/${segment}?ref=firstock.in`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Firstock symbol download for ${segment} failed (HTTP ${res.status})`);
  return text;
}

async function fetchOptionMaster() {
  const rows = [];
  for (const segment of ["NFO", "BFO"]) {
    const csv = await downloadSegmentCsv(segment);
    for (const r of parseCsv(csv)) {
      const optionType = (r.OptionType || "").trim().toUpperCase();
      if (optionType !== "CE" && optionType !== "PE") continue; // skip futures ("XX") and anything else
      const name = (r.Symbol || "").trim().toUpperCase();
      if (!UNDERLYING_SEGMENT[name]) continue; // only the 5 indices this app cares about
      const expiryIso = expiryToIso(r.Expiry);
      const strike = normalizeStrike(r.StrikePrice);
      if (!expiryIso || !strike || !r.TradingSymbol) continue;
      rows.push({
        name,
        segment,
        expiry: expiryIso,
        strike,
        type: optionType === "CE" ? "ce" : "pe",
        tradingSymbol: r.TradingSymbol.trim(),
      });
    }
  }
  return rows;
}

/** Cached once/day — two CSV downloads, filtered to just this app's 5 underlyings. */
export async function getOptionMaster() {
  return getCachedOrFetch("firstock:optionMaster", fetchOptionMaster, ONE_DAY_MS);
}

/** Distinct, ascending ISO expiry dates for a symbol's option contracts. */
export function listExpiries(master, symbol) {
  const dates = new Set();
  for (const row of master) {
    if (row.name === symbol) dates.add(row.expiry);
  }
  return Array.from(dates).sort();
}

/** Rows for one symbol+expiry: [{ strike, type: 'ce'|'pe', tradingSymbol, exchange }]. */
export function optionRowsForExpiry(master, symbol, expiryIso) {
  const exchange = UNDERLYING_SEGMENT[symbol];
  const out = [];
  for (const row of master) {
    if (row.name === symbol && row.expiry === expiryIso) {
      out.push({ strike: row.strike, type: row.type, tradingSymbol: row.tradingSymbol, exchange });
    }
  }
  return out;
}

async function fetchIndexList(creds) {
  const json = await callApi(creds, "/indexList", {});
  const map = {};
  for (const item of json?.data || []) {
    const brExchange = (item.exchange || "").trim().toUpperCase();
    if (brExchange !== "NSE" && brExchange !== "BSE") continue;
    const candidates = [item.tradingSymbol, item.idxname];
    for (const candidate of candidates) {
      const resolved = INDEX_ALIAS_LOOKUP.get(normalizeIndexKey(candidate));
      if (resolved && !map[resolved]) {
        map[resolved] = { exchange: brExchange, tradingSymbol: item.tradingSymbol };
      }
    }
  }
  return map;
}

/** Cached once/day: canonical symbol -> { exchange: "NSE"|"BSE", tradingSymbol }. Requires one authenticated call to seed. */
export async function getIndexMap(creds) {
  return getCachedOrFetch("firstock:indexList", () => fetchIndexList(creds), ONE_DAY_MS);
}
