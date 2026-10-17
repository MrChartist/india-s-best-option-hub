/**
 * Tradejini scrip-master handling — daily group discovery + per-group CSV
 * download, symbol -> exchange/token resolution for index spot rows and
 * index option contracts.
 *
 * Endpoints, response shape, and the id/idFormat scheme are verified against
 * marketcalls/openalgo's production broker/tradejini/database/master_contract_db.py
 * and mapping/transform_data.py — no public docs mirror exists for this broker.
 * Both endpoints are unauthenticated public data (openalgo's own client sends
 * no Authorization header to them), so this file never needs creds.
 *
 * Each scrip group (e.g. "NSEOptions") declares its own `idFormat`
 * (e.g. "instrument_symbol_exchange_expiry_strike_optType") describing how its
 * composite `id` field is laid out; we use that as a fallback whenever a named
 * CSV column is missing, mirroring openalgo's parse_scrip_id/process_scrip_data.
 * Per openalgo's verified NSE/BSE index symbol maps, Tradejini's raw index
 * `symbol` values for our five underlyings are already the bare uppercase
 * names (e.g. "NIFTY", "BANKNIFTY", "SENSEX") with no reshaping needed.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

const BASE = "https://api.tradejini.com/v2";
const GROUPS_URL = `${BASE}/api/mkt-data/scrips/symbol-store`;
const groupDataUrl = (group) => `${BASE}/api/mkt-data/scrips/symbol-store/${encodeURIComponent(group)}`;

// NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY options trade on NSE F&O; SENSEX options
// trade on BSE F&O — different scrip group and a different WS exchange segment.
export const OPTIONS_GROUP = {
  NIFTY: { group: "NSEOptions", exch: "NFO" },
  BANKNIFTY: { group: "NSEOptions", exch: "NFO" },
  FINNIFTY: { group: "NSEOptions", exch: "NFO" },
  MIDCPNIFTY: { group: "NSEOptions", exch: "NFO" },
  SENSEX: { group: "BSEOptions", exch: "BFO" },
};

export const INDEX_SPOT = {
  NIFTY: { exch: "NSE" },
  BANKNIFTY: { exch: "NSE" },
  FINNIFTY: { exch: "NSE" },
  MIDCPNIFTY: { exch: "NSE" },
  SENSEX: { exch: "BSE" },
};

/** No embedded-comma/quoting in these CSVs per openalgo's own naive split — matched here. */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values.length !== headers.length) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = values[j].trim(); });
    rows.push(row);
  }
  return rows;
}

/** Case-insensitive column lookup across candidate names. */
function field(row, ...names) {
  for (const n of names) {
    if (row[n]) return row[n];
    const found = Object.keys(row).find((k) => k.toLowerCase() === n.toLowerCase());
    if (found && row[found]) return row[found];
  }
  return undefined;
}

/** Split a scrip id into named components per the group's idFormat (e.g. "instrument_symbol_exchange_expiry_strike_optType"). */
function parseScripId(id, idFormat) {
  const parts = String(id || "").split("_");
  const names = String(idFormat || "").split("_").filter(Boolean);
  if (!names.length || parts.length < names.length) return {};
  const out = {};
  names.forEach((n, i) => { out[n] = parts[i]; });
  return out;
}

/** Ids carry ISO "YYYY-MM-DD" per openalgo's docs comment; a couple of common broker shapes accepted defensively. */
function parseExpiryToISO(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-\s]?([A-Za-z]{3})[-\s]?(\d{2,4})$/);
  if (m) {
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const mi = months.indexOf(m[2].toUpperCase());
    if (mi !== -1) {
      let year = parseInt(m[3], 10);
      if (year < 100) year += 2000;
      return `${year}-${String(mi + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    }
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

async function fetchGroupIdFormats() {
  return getCachedOrFetch("tradejini:groups", async () => {
    const res = await fetch(`${GROUPS_URL}?version=0`);
    if (!res.ok) throw new Error(`Tradejini scrip-groups fetch failed: HTTP ${res.status}`);
    const json = await res.json().catch(() => ({}));
    const list = json?.d?.symbolStore || [];
    const map = {};
    for (const g of list) if (g?.name) map[g.name] = g.idFormat || "";
    return map;
  }, ONE_DAY_MS);
}

async function fetchGroupRows(group) {
  return getCachedOrFetch(`tradejini:group:${group}`, async () => {
    const res = await fetch(`${groupDataUrl(group)}?version=0`);
    if (!res.ok) throw new Error(`Tradejini scrip data fetch failed for ${group}: HTTP ${res.status}`);
    return parseCsv(await res.text());
  }, ONE_DAY_MS);
}

async function getOptionRows(symbol) {
  const cfg = OPTIONS_GROUP[symbol];
  if (!cfg) throw new Error(`Tradejini: unknown symbol ${symbol}`);
  const [idFormats, rows] = await Promise.all([fetchGroupIdFormats(), fetchGroupRows(cfg.group)]);
  const idFormat = idFormats[cfg.group];

  const out = [];
  for (const row of rows) {
    const id = field(row, "id");
    const components = id ? parseScripId(id, idFormat) : {};

    const rowSymbol = (field(row, "symbol") || components.symbol || "").trim().toUpperCase();
    if (rowSymbol !== symbol) continue;
    // Skip spot/underlying rows if a group ever mixes them in (mirrors openalgo's guard).
    if (id && id.toLowerCase().includes("spot")) continue;

    const optType = (field(row, "optType", "optiontype") || components.optType || "").trim().toUpperCase();
    if (optType !== "CE" && optType !== "PE") continue;

    const expiryISO = parseExpiryToISO(field(row, "expiry") || components.expiry);
    const strike = Number(field(row, "strike") || components.strike);
    const token = String(field(row, "excToken", "token") || "").trim();
    if (!expiryISO || !Number.isFinite(strike) || !token) continue;

    out.push({ expiry: expiryISO, strike, optType, token, exch: cfg.exch });
  }
  return out;
}

export async function fetchExpiries(symbol) {
  const rows = await getOptionRows(symbol);
  return Array.from(new Set(rows.map((r) => r.expiry))).sort();
}

export async function resolveNearestExpiry(symbol) {
  const list = await fetchExpiries(symbol);
  if (!list.length) throw new Error(`Tradejini: no expiries found for ${symbol}`);
  return list[0];
}

/** Map<strikeString, { ce?: {token, exch}, pe?: {token, exch} }> for one symbol+expiry. */
export async function resolveStrikeTokens(symbol, expiryISO) {
  const rows = await getOptionRows(symbol);
  const map = new Map();
  for (const r of rows) {
    if (r.expiry !== expiryISO) continue;
    const key = String(r.strike);
    if (!map.has(key)) map.set(key, {});
    map.get(key)[r.optType.toLowerCase()] = { token: r.token, exch: r.exch };
  }
  return map;
}

export async function resolveIndexSpotToken(symbol) {
  const spot = INDEX_SPOT[symbol];
  if (!spot) throw new Error(`Tradejini: no index spot mapping for ${symbol}`);
  const [idFormats, rows] = await Promise.all([fetchGroupIdFormats(), fetchGroupRows("Index")]);
  const idFormat = idFormats["Index"];

  for (const row of rows) {
    const id = field(row, "id");
    const components = id ? parseScripId(id, idFormat) : {};
    const rowSymbol = (field(row, "symbol") || components.symbol || "").trim().toUpperCase();
    if (rowSymbol !== symbol) continue;

    const rowExch = (components.exchange || (id ? id.split("_").pop() : "") || "").trim().toUpperCase();
    if (rowExch && rowExch !== spot.exch) continue;

    const token = String(field(row, "excToken", "token") || "").trim();
    if (token) return { token, exch: spot.exch };
  }
  throw new Error(`Tradejini: index spot token not found for ${symbol}`);
}
