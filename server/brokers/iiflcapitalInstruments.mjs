/**
 * IIFL Capital contract (instrument) master — daily CSV downloads + lookups.
 *
 * IIFL has no native option-chain endpoint (confirmed against openalgo's
 * production adapter: broker/iiflcapital/api/data.py builds chains itself
 * from batched /marketdata/marketquotes + per-leg /marketdata/openinterest
 * calls). Strike/expiry/instrumentId resolution comes from IIFL's own daily
 * contract CSVs, served unauthenticated from
 * `${BASE_URL}/contractfiles/<SEGMENT>.csv` (openalgo's downloader sends no
 * Authorization header for these — they're public reference data, same
 * pattern as Zerodha's/Dhan's instrument dumps).
 *
 * Column names below (Exchange, Underlying Instrument Symbol, Instrument ID,
 * Instrument Type, Option Type, Strike Price, Underlying Instrument Name,
 * Trading Symbol, Expiry) are verified against openalgo's production
 * broker/iiflcapital/database/master_contract_db.py column map.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { sleep } from "../lib/batch.mjs";
import { BASE_URL } from "./iiflcapitalAuth.mjs";

// Which contract-file segment (and the exact `exchange` string IIFL expects
// on every /marketdata/* request) each app symbol's option contracts live in.
export const SYMBOL_SEGMENT = {
  NIFTY: "NSEFO",
  BANKNIFTY: "NSEFO",
  FINNIFTY: "NSEFO",
  MIDCPNIFTY: "NSEFO",
  SENSEX: "BSEFO",
};

// IIFL's INDICES.csv "Underlying Instrument Name" column, uppercased with
// spaces stripped, mapped to our app's symbol names — mirrors openalgo's
// NSE_INDEX_MAP (BSE's SENSEX needs no mapping: "SENSEX" already matches).
const NSE_INDEX_NAME_MAP = {
  NIFTY50: "NIFTY",
  NIFTYBANK: "BANKNIFTY",
  NIFTYFINSERVICE: "FINNIFTY",
  NIFTYMIDCAPSELECT: "MIDCPNIFTY",
};

const MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** Quote-aware CSV line splitter (handles quoted fields that may contain commas). */
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

/** "30-Apr-2026" or "24-Apr-2026 23:59" -> "2026-04-30". Returns null if unparseable. */
export function parseExpiryToIso(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(trimmed);
  if (m) {
    const day = m[1].padStart(2, "0");
    const mon = MONTHS[m[2].toUpperCase()];
    if (!mon) return null;
    return `${m[3]}-${mon}-${day}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

async function downloadSegmentCsv(segment) {
  const url = `${BASE_URL}/contractfiles/${segment}.csv`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`IIFL Capital contract file download failed for ${segment} (HTTP ${res.status})`);
      const text = await res.text();
      if (!text || text.trim().length < 10) throw new Error(`IIFL Capital contract file for ${segment} was empty`);
      return text;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

function parseSegmentCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const col = {};
  header.forEach((h, i) => { col[h] = i; });

  const rows = new Array(lines.length - 1);
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    rows[i - 1] = {
      exchange: (f[col["Exchange"]] || "").trim(),
      underlying: (f[col["Underlying Instrument Symbol"]] || "").trim(),
      name: (f[col["Underlying Instrument Name"]] || "").trim(),
      token: (f[col["Instrument ID"]] || "").trim(),
      optionType: (f[col["Option Type"]] || "").trim().toUpperCase(),
      strike: (f[col["Strike Price"]] || "").trim(),
      expiry: (f[col["Expiry"]] || "").trim(),
    };
  }
  return rows;
}

/** Cached once/day per segment, shared across all users' credentials — same TTL contract as Zerodha's instrument master. */
async function getSegmentRows(segment) {
  return getCachedOrFetch(
    `iiflcapital:contract:${segment}`,
    () => downloadSegmentCsv(segment).then(parseSegmentCsv),
    ONE_DAY_MS
  );
}

/** All CE/PE contract rows for an app symbol, across every expiry. */
export async function getOptionRows(symbol) {
  const segment = SYMBOL_SEGMENT[symbol];
  if (!segment) throw new Error(`Unknown symbol: ${symbol}`);
  const rows = await getSegmentRows(segment);
  return rows.filter(
    (r) => r.underlying === symbol && r.token && (r.optionType === "CE" || r.optionType === "PE")
  );
}

/** Distinct, ascending ISO expiry dates. */
export function distinctExpiriesAscending(rows) {
  const set = new Set();
  for (const r of rows) {
    const iso = parseExpiryToIso(r.expiry);
    if (iso) set.add(iso);
  }
  return Array.from(set).sort();
}

/** Rows belonging to one specific ISO expiry. */
export function filterRowsByExpiryIso(rows, iso) {
  return rows.filter((r) => parseExpiryToIso(r.expiry) === iso);
}

/** The index-spot instrument `{ exchange, instrumentId }` for an app symbol, from INDICES.csv, or null. */
export async function resolveIndexInfo(symbol) {
  const rows = await getSegmentRows("INDICES");
  for (const r of rows) {
    if (!r.token) continue;
    const compact = r.name.toUpperCase().replace(/\s+/g, "");
    const mapped = r.exchange === "NSEEQ" ? NSE_INDEX_NAME_MAP[compact] || compact : compact;
    if (mapped === symbol) return { exchange: r.exchange, instrumentId: r.token };
  }
  return null;
}
