/**
 * Groww instrument/scrip master — daily CSV download + parsing helpers.
 *
 * Groww has no native option-chain endpoint, so strikes/expiries/trading_symbols
 * are resolved from the public instrument dump at growwapi-assets.groww.in
 * (confirmed via marketcalls/openalgo's broker/groww/database/master_contract_db.py
 * — `download_groww_instrument_data`). The download needs no auth, so it's cached
 * once/day and shared across every user's credentials rather than keyed per-user.
 *
 * CSV columns (header row, order not depended on): exchange, exchange_token,
 * trading_symbol, groww_symbol, name, instrument_type, segment, series, isin,
 * underlying_symbol, underlying_exchange_token, expiry_date, strike_price,
 * lot_size, tick_size, freeze_quantity, is_reserved, buy_allowed, sell_allowed.
 * expiry_date is already "YYYY-MM-DD". instrument_type is CE/PE/FUT/EQ/IDX.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

const INSTRUMENTS_CSV_URL = "https://growwapi-assets.groww.in/instruments/instrument.csv";

// Which exchange each app symbol's option contracts (and the index itself) live on.
export const UNDERLYING_EXCHANGE = {
  NIFTY: "NSE",
  BANKNIFTY: "NSE",
  FINNIFTY: "NSE",
  MIDCPNIFTY: "NSE",
  SENSEX: "BSE",
};

// Groww's `underlying_symbol` column value(s) for each app symbol's option contracts.
// MIDCPNIFTY is unverified — openalgo's master_contract_db.py shows Groww uses
// "NIFTYMIDSELECT" as the raw symbol for the Nifty Midcap Select index elsewhere
// in its data, so both spellings are checked defensively.
export const UNDERLYING_NAME_ALIASES = {
  NIFTY: ["NIFTY"],
  BANKNIFTY: ["BANKNIFTY"],
  FINNIFTY: ["FINNIFTY"],
  MIDCPNIFTY: ["MIDCPNIFTY", "NIFTYMIDSELECT"],
  SENSEX: ["SENSEX"],
};

// `trading_symbol` candidates for the index (IDX) row itself, used for the spot quote.
export const INDEX_SPOT_ALIASES = {
  NIFTY: ["NIFTY"],
  BANKNIFTY: ["BANKNIFTY", "NIFTY BANK"],
  FINNIFTY: ["FINNIFTY", "NIFTY FIN SERVICE"],
  MIDCPNIFTY: ["MIDCPNIFTY", "NIFTYMIDSELECT", "NIFTY MID SELECT"],
  SENSEX: ["SENSEX"],
};

/** Minimal RFC4180-ish CSV line parser — handles quoted fields with embedded commas. */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  if (start >= lines.length) return [];
  const headers = parseCsvLine(lines[start]).map((h) => h.trim());
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = parseCsvLine(line);
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = (cols[c] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

async function downloadInstruments() {
  console.log("[groww] downloading instrument master (instrument.csv)");
  const res = await fetch(INSTRUMENTS_CSV_URL);
  if (!res.ok) throw new Error(`Groww instrument master download failed [${res.status}]`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("Groww instrument master returned no rows");
  return rows;
}

/** Cached once/day, shared across all users' credentials (public market data). */
export async function getInstrumentMaster() {
  return getCachedOrFetch("groww:instrument-master", downloadInstruments, ONE_DAY_MS);
}

function normalize(s) {
  return (s || "").toUpperCase().replace(/\s+/g, "");
}

function matchesUnderlying(row, symbol) {
  const aliases = (UNDERLYING_NAME_ALIASES[symbol] || []).map(normalize);
  return aliases.includes(normalize(row.underlying_symbol));
}

/** All CE/PE instrument rows for a given app symbol, across all expiries. */
export async function getOptionRows(symbol) {
  const exchange = UNDERLYING_EXCHANGE[symbol];
  if (!exchange) throw new Error(`Unknown symbol: ${symbol}`);
  const rows = await getInstrumentMaster();
  return rows.filter((r) =>
    r.exchange === exchange &&
    r.segment === "FNO" &&
    (r.instrument_type === "CE" || r.instrument_type === "PE") &&
    matchesUnderlying(r, symbol)
  );
}

/** Distinct expiry dates (already "YYYY-MM-DD" in the CSV), ascending. */
export function distinctExpiriesAscending(rows) {
  const set = new Set(rows.map((r) => r.expiry_date).filter(Boolean));
  return Array.from(set).sort();
}

/** The index (IDX) row for an app symbol's own spot quote, or null if not found. */
export async function getIndexSpotRow(symbol) {
  const exchange = UNDERLYING_EXCHANGE[symbol];
  if (!exchange) throw new Error(`Unknown symbol: ${symbol}`);
  const aliases = (INDEX_SPOT_ALIASES[symbol] || []).map(normalize);
  const rows = await getInstrumentMaster();
  return rows.find((r) =>
    r.exchange === exchange &&
    (r.instrument_type === "IDX" || r.segment === "IDX") &&
    aliases.includes(normalize(r.trading_symbol))
  ) || null;
}
