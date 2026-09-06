/**
 * 5paisa instrument (scrip) master — daily CSV download, parse, and lookups for
 * resolving strike/expiry -> ScripCode. 5paisa has no reliable native option-chain
 * endpoint, so the app builds the chain itself from this master + batched quotes.
 *
 * CSV column names below (Exch, ExchType, ScripCode, Series, ScripType, StrikeRate,
 * SymbolRoot, Expiry) are verified against marketcalls/openalgo's production 5paisa
 * adapter. Note: 5paisa's real column carrying CE/PE is `ScripType` (Series is "XX"
 * for all F&O rows and does not itself distinguish CE/PE) — this differs from an
 * earlier "CPType" assumption and was confirmed against openalgo's live parsing logic.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { sleep } from "../lib/batch.mjs";

const SCRIP_MASTER_URL = "https://Openapi.5paisa.com/VendorsAPI/Service1.svc/ScripMaster/segment/All";

// Exchange each index's derivatives/spot trade on. NIFTY-family -> NSE ("N"), SENSEX -> BSE ("B").
export const INDEX_ROOTS = {
  NIFTY: "N",
  BANKNIFTY: "N",
  FINNIFTY: "N",
  MIDCPNIFTY: "N",
  SENSEX: "B",
};

const KNOWN_ROOTS = new Set(Object.keys(INDEX_ROOTS));

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

/** ISO "YYYY-MM-DD" from either a plain date-ish string or a .NET "/Date(ms)/" wire format. */
function normalizeExpiryToIso(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const dotNet = /\/Date\((\d+)/.exec(trimmed);
  if (dotNet) return new Date(Number(dotNet[1])).toISOString().slice(0, 10);
  const isoPrefix = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoPrefix) return `${isoPrefix[1]}-${isoPrefix[2]}-${isoPrefix[3]}`;
  // Last-resort fallback for an unexpected format (e.g. "25-Jan-2024") — unverified
  // against a live CSV sample since 5paisa's ScripMaster endpoint is currently
  // returning a transient "cache not available" error at implementation time.
  // Read back the LOCAL calendar fields Date() assigned it (not .toISOString(),
  // which would re-express those same fields in UTC and can shift the day by one
  // whenever the host server's timezone offset is non-zero).
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null; // unparseable — caller filters these out
}

function normalizeStrike(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : null;
}

async function downloadScripMasterCsv() {
  // The "segment/All" endpoint is documented as occasionally returning a transient
  // "Cache not available for segment 'all'. Retry after some time." 404 on 5paisa's
  // side (unrelated to our request) — a short retry loop absorbs that.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(SCRIP_MASTER_URL);
      const text = await res.text();
      if (!res.ok) throw new Error(`5paisa ScripMaster download failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
      return text;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await sleep(2000);
    }
  }
  throw lastErr;
}

async function fetchAndFilterScripMaster() {
  const csvText = await downloadScripMasterCsv();
  const rows = parseCsv(csvText);
  const filtered = [];
  for (const row of rows) {
    const root = (row.SymbolRoot || "").trim();
    if (!KNOWN_ROOTS.has(root)) continue;
    const exch = row.Exch;
    const exchType = row.ExchType;
    // Keep index-cash rows (ExchType "C", for spot LTP) and derivatives rows (ExchType "D", for CE/PE legs).
    if (exchType !== "C" && exchType !== "D") continue;
    if (exch !== INDEX_ROOTS[root]) continue;
    filtered.push({
      Exch: exch,
      ExchType: exchType,
      ScripCode: row.ScripCode,
      SymbolRoot: root,
      StrikeRate: row.StrikeRate,
      ScripType: row.ScripType,
      Expiry: row.Expiry,
    });
  }
  return filtered;
}

/** Cached once/day — this CSV covers the full exchange and is otherwise far too large/slow to fetch per request. */
export async function getInstrumentMaster() {
  return getCachedOrFetch("fivepaisa:scripmaster", fetchAndFilterScripMaster, ONE_DAY_MS);
}

/** Distinct, ascending ISO expiry dates for a symbol's option contracts. */
export function listExpiries(master, symbol) {
  const dates = new Set();
  for (const row of master) {
    if (row.SymbolRoot !== symbol || row.ExchType !== "D") continue;
    if (row.ScripType !== "CE" && row.ScripType !== "PE") continue;
    const iso = normalizeExpiryToIso(row.Expiry);
    if (iso) dates.add(iso);
  }
  return Array.from(dates).sort();
}

/** Map of strike (string) -> { ce?: {scripCode, exch, exchType}, pe?: {...} } for one symbol+expiry. */
export function strikeMapForExpiry(master, symbol, expiryIso) {
  const map = new Map();
  for (const row of master) {
    if (row.SymbolRoot !== symbol || row.ExchType !== "D") continue;
    const side = row.ScripType === "CE" ? "ce" : row.ScripType === "PE" ? "pe" : null;
    if (!side) continue;
    if (normalizeExpiryToIso(row.Expiry) !== expiryIso) continue;
    const strike = normalizeStrike(row.StrikeRate);
    if (!strike) continue;
    if (!map.has(strike)) map.set(strike, {});
    map.get(strike)[side] = { scripCode: row.ScripCode, exch: row.Exch, exchType: row.ExchType };
  }
  return map;
}

/** The index-cash (spot) instrument for a symbol, or null if not found in the cached master. */
export function indexScripInfo(master, symbol) {
  const row = master.find((r) => r.SymbolRoot === symbol && r.ExchType === "C");
  if (!row) return null;
  return { scripCode: row.ScripCode, exch: row.Exch, exchType: row.ExchType };
}
