/**
 * Alice Blue instrument/contract master handling — daily CSV download + parse,
 * symbol -> exchange/token resolution for index options and index spot rows.
 *
 * CSV column names verified against marketcalls/openalgo's production
 * broker/aliceblue/database/master_contract_db.py and the official pya3
 * ("Ant API") SDK's get_instrument_for_fno(). Per pya3, the NFO/BFO "Expiry
 * Date" column is already ISO "YYYY-MM-DD" (only the CDS file uses DD-MM-YYYY,
 * which we don't touch here) — parseExpiryDate() trusts that but falls back
 * to a couple of other common broker date shapes defensively.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

const CONTRACT_MASTER_BASE = "https://v2api.aliceblueonline.com/restpy/static/contract_master/V2";

// NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY options trade on NSE F&O (NFO); SENSEX
// options trade on BSE F&O (BFO) — different contract master file.
export const OPTIONS_EXCHANGE = {
  NIFTY: "NFO",
  BANKNIFTY: "NFO",
  FINNIFTY: "NFO",
  MIDCPNIFTY: "NFO",
  SENSEX: "BFO",
};

// Index spot token lookup: Alice Blue ships a dedicated INDICES.csv (exch,
// symbol, token) with human-readable index names — more direct than scanning
// the NSE/BSE equity contract masters. Verified live against the real file at
// https://v2api.aliceblueonline.com/restpy/static/contract_master/V2/INDICES.csv
// (e.g. "NSE,NIFTY 50,26000", "NSE,NIFTY FIN SERVICE,26037", "BSE,SENSEX,1").
export const INDEX_SPOT = {
  NIFTY: { rawSymbol: "NIFTY 50", exch: "NSE" },
  BANKNIFTY: { rawSymbol: "NIFTY BANK", exch: "NSE" },
  FINNIFTY: { rawSymbol: "NIFTY FIN SERVICE", exch: "NSE" },
  MIDCPNIFTY: { rawSymbol: "NIFTY MIDCAP SELECT", exch: "NSE" },
  SENSEX: { rawSymbol: "SENSEX", exch: "BSE" },
};

/** Minimal CSV line splitter — handles simple double-quoted fields (no embedded quotes-in-quotes). */
function splitCsvLine(line) {
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

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return { headers: [], headerIndex: {}, rows: [] };
  const headers = splitCsvLine(lines[0]);
  const headerIndex = {};
  headers.forEach((h) => { headerIndex[h.toLowerCase()] = h; });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    if (values.length === 1 && values[0] === "") continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j];
    rows.push(row);
  }
  return { headers, headerIndex, rows };
}

/** Case-insensitive field lookup — CSV header casing is unverified beyond openalgo's reference. */
function getField(row, headerIndex, candidates) {
  for (const c of candidates) {
    const key = headerIndex[c.toLowerCase()];
    if (key !== undefined && row[key] !== undefined) return row[key];
  }
  return undefined;
}

/** ISO YYYY-MM-DD if parseable, else null. NFO/BFO ship this format natively per the pya3 SDK. */
function parseExpiryDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Fallback: "25-SEP-2025" / "25-SEP-25" / "25SEP2025" — unverified, defensive only.
  const m = s.match(/^(\d{1,2})[-\s]?([A-Za-z]{3})[-\s]?(\d{2,4})$/);
  if (m) {
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const mi = months.indexOf(m[2].toUpperCase());
    if (mi !== -1) {
      let year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
      const dd = String(m[1]).padStart(2, "0");
      const mm = String(mi + 1).padStart(2, "0");
      return `${year}-${mm}-${dd}`;
    }
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

// These CSVs run several MB (NFO.csv is ~10MB) and downstream cache to disk once/day,
// so a couple of quick retries on transient network/TLS hiccups is worth it here.
async function downloadCsvWithRetry(fileKey, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${CONTRACT_MASTER_BASE}/${fileKey}.csv`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw new Error(`Alice Blue contract master download failed [${fileKey}]: ${lastErr?.message || "unknown error"}`);
}

async function getContractMaster(fileKey) {
  return getCachedOrFetch(`aliceblue:contract:${fileKey}`, async () => {
    const text = await downloadCsvWithRetry(fileKey);
    return parseCsv(text);
  }, ONE_DAY_MS);
}

async function getOptionRows(symbol) {
  const exch = OPTIONS_EXCHANGE[symbol];
  if (!exch) throw new Error(`Alice Blue: unknown symbol ${symbol}`);
  const { rows, headerIndex } = await getContractMaster(exch);
  return rows
    .map((row) => ({
      symbol: (getField(row, headerIndex, ["Symbol"]) || "").trim().toUpperCase(),
      optionType: (getField(row, headerIndex, ["Option Type"]) || "").trim().toUpperCase(),
      strike: Number(getField(row, headerIndex, ["Strike Price"])),
      expiry: parseExpiryDate(getField(row, headerIndex, ["Expiry Date"])),
      token: String(getField(row, headerIndex, ["Token"]) || "").trim(),
      exch: (getField(row, headerIndex, ["Exch"]) || exch).trim().toUpperCase(),
    }))
    .filter((r) => r.symbol === symbol && (r.optionType === "CE" || r.optionType === "PE") && r.token && r.expiry);
}

export async function fetchExpiries(symbol) {
  const rows = await getOptionRows(symbol);
  const set = new Set(rows.map((r) => r.expiry));
  return Array.from(set).sort();
}

export async function resolveNearestExpiry(symbol) {
  const list = await fetchExpiries(symbol);
  if (!list.length) throw new Error(`Alice Blue: no expiries found for ${symbol}`);
  return list[0];
}

/** Map<strikeString, { ce?: {token, exch}, pe?: {token, exch} }> for one symbol+expiry. */
export async function resolveStrikeTokens(symbol, expiryISO) {
  const rows = await getOptionRows(symbol);
  const map = new Map();
  for (const r of rows) {
    if (r.expiry !== expiryISO || !Number.isFinite(r.strike)) continue;
    const key = String(r.strike);
    if (!map.has(key)) map.set(key, {});
    map.get(key)[r.optionType.toLowerCase()] = { token: r.token, exch: r.exch };
  }
  return map;
}

export async function resolveIndexSpotToken(symbol) {
  const spot = INDEX_SPOT[symbol];
  if (!spot) throw new Error(`Alice Blue: no index spot mapping for ${symbol}`);
  const { rows, headerIndex } = await getContractMaster("INDICES");
  const row = rows.find((r) => {
    const sym = (getField(r, headerIndex, ["symbol", "Symbol"]) || "").trim().toUpperCase();
    const exch = (getField(r, headerIndex, ["exch", "Exch"]) || "").trim().toUpperCase();
    return sym === spot.rawSymbol && exch === spot.exch;
  });
  if (!row) throw new Error(`Alice Blue: index spot token not found for ${symbol} (${spot.rawSymbol})`);
  const token = String(getField(row, headerIndex, ["token", "Token"]) || "").trim();
  if (!token) throw new Error(`Alice Blue: index spot token empty for ${symbol}`);
  return { token, exch: spot.exch };
}
