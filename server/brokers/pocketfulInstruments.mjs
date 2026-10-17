/**
 * Pocketful daily contract master — download, parse, cache.
 *
 * Pocketful has no native option-chain REST endpoint and no per-symbol
 * "search instruments" API; the only documented way to resolve an
 * exchange_token for an index or an option strike is the compact contract
 * ZIP (GET /api/v1/contract/Compact?info=download&exchanges=...), one CSV
 * per exchange. Layout + the symbol-building conventions below are
 * transcribed from OpenAlgo's production adapter
 * (broker/pocketful/database/master_contract_db.py) — the CSV's own header
 * names (trading_symbol, company_name, exchange_token, expiry, option_type,
 * strike, segment) are used verbatim as our source of truth.
 *
 * This download appears to need no Authorization header in OpenAlgo's
 * implementation (contract data is exchange-public), so it is cached once a
 * day and shared across every user's credentials, same as Zerodha's
 * instrument master (zerodhaInstruments.mjs).
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { extractCsvEntries } from "./pocketfulZip.mjs";

const TRADE_BASE = "https://trade.pocketful.in";
// Only the exchanges our 5 app symbols ever live on — OpenAlgo's own default
// additionally requests MCX, which we skip since we never resolve commodities.
const CONTRACT_URL = `${TRADE_BASE}/api/v1/contract/Compact?info=download&exchanges=NSE,NFO,BSE,BFO`;

// Pocketful WebSocket exchange codes, from pocketfulwebsocket.py's exchange_map.
export const EXCHANGE_CODE = { NSE: 1, NFO: 2, CDS: 3, MCX: 4, BSE: 6, BFO: 7 };

// NSECompactScrip.csv's "segment=INDICES" trading_symbol -> our app symbol.
// (master_contract_db.py's process_pocketful_indices_csv mapping.) Verified
// against a live contract download — all 5 app symbols resolve.
const NSE_INDEX_NAME = {
  "Nifty 50": "NIFTY",
  "Nifty Bank": "BANKNIFTY",
  "Nifty Fin Service": "FINNIFTY",
  "NIFTY MID SELECT": "MIDCPNIFTY",
};

// Which options CSV (NFO vs BFO) + which company_name value each app symbol's
// option contracts are filed under. company_name equals the bare index name
// (as OpenAlgo's build_symbol() concatenates it directly into the trading
// symbol) — verified against a live download: NIFTY/BANKNIFTY/FINNIFTY/
// MIDCPNIFTY/SENSEX each resolve 1,000+ CE/PE legs.
const OPTIONS_SOURCE = {
  NIFTY: { file: "nfocompactscrip.csv", exchange: "NFO", companyName: "NIFTY" },
  BANKNIFTY: { file: "nfocompactscrip.csv", exchange: "NFO", companyName: "BANKNIFTY" },
  FINNIFTY: { file: "nfocompactscrip.csv", exchange: "NFO", companyName: "FINNIFTY" },
  MIDCPNIFTY: { file: "nfocompactscrip.csv", exchange: "NFO", companyName: "MIDCPNIFTY" },
  SENSEX: { file: "bfocompactscrip.csv", exchange: "BFO", companyName: "SENSEX" },
};

/** Tolerant CSV parser — handles quoted fields (company names can contain commas). */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const splitRow = (line) => {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === "," && !inQuotes) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  };

  const headers = splitRow(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (cells.length < headers.length) continue;
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = cells[c]?.trim();
    rows.push(row);
  }
  return rows;
}

/** "2025-06-26", "2025-06-26 00:00:00", or a handful of common fallbacks -> "YYYY-MM-DD". */
function normalizeExpiryToISO(raw) {
  if (!raw) return null;
  const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function formatStrikeKey(strike) {
  return Number.isInteger(strike) ? String(strike) : String(strike);
}

async function downloadContractZip() {
  const res = await fetch(CONTRACT_URL);
  if (!res.ok) {
    throw new Error(`Pocketful contract master download failed [${res.status}]`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return extractCsvEntries(buf);
}

function buildIndexTokens(nseRows, bseRows) {
  const indexTokens = {};

  for (const row of nseRows) {
    if ((row.segment || "").toUpperCase() !== "INDICES") continue;
    const appSymbol = NSE_INDEX_NAME[row.trading_symbol];
    if (!appSymbol) continue;
    const token = Number(row.exchange_token);
    if (token) indexTokens[appSymbol] = { token, exchangeCode: EXCHANGE_CODE.NSE };
  }

  // SENSEX lives in the BSE compact scrip file under segment=IDX. Matched
  // loosely on "SENSEX" while excluding the SENSEX50 index (mapped separately
  // by OpenAlgo's own CSV processor) — verified against a live download.
  for (const row of bseRows) {
    if ((row.segment || "").toUpperCase() !== "IDX") continue;
    const name = (row.trading_symbol || "").toUpperCase();
    if (name.includes("SENSEX") && !name.includes("50")) {
      const token = Number(row.exchange_token);
      if (token) indexTokens.SENSEX = { token, exchangeCode: EXCHANGE_CODE.BSE };
      break;
    }
  }

  return indexTokens;
}

function buildOptionRows(nfoRows, bfoRows) {
  const bySource = { "nfocompactscrip.csv": nfoRows, "bfocompactscrip.csv": bfoRows };
  const options = {};

  for (const [symbol, src] of Object.entries(OPTIONS_SOURCE)) {
    const rows = bySource[src.file] || [];
    const exchangeCode = EXCHANGE_CODE[src.exchange];
    const legs = [];
    for (const row of rows) {
      const optionType = (row.option_type || "").toUpperCase();
      if (optionType !== "CE" && optionType !== "PE") continue;
      if ((row.company_name || "").toUpperCase() !== src.companyName) continue;

      const expiry = normalizeExpiryToISO(row.expiry);
      const strike = Number(row.strike);
      const token = Number(row.exchange_token);
      if (!expiry || !strike || !token) continue;

      legs.push({ expiry, strike, type: optionType, token, exchangeCode });
    }
    options[symbol] = legs;
  }

  return options;
}

async function downloadAndParseContract() {
  const entries = await downloadContractZip();
  const nseRows = parseCSV(entries.get("nsecompactscrip.csv") || "");
  const bseRows = parseCSV(entries.get("bsecompactscrip.csv") || "");
  const nfoRows = parseCSV(entries.get("nfocompactscrip.csv") || "");
  const bfoRows = parseCSV(entries.get("bfocompactscrip.csv") || "");

  return {
    indexTokens: buildIndexTokens(nseRows, bseRows),
    options: buildOptionRows(nfoRows, bfoRows),
  };
}

/** Cached once/day, shared across all users' credentials — see instrumentCache.mjs. */
export async function getContract() {
  return getCachedOrFetch("pocketful:contract", downloadAndParseContract, ONE_DAY_MS);
}

export async function resolveIndexToken(symbol) {
  const contract = await getContract();
  const entry = contract.indexTokens[symbol];
  if (!entry) throw new Error(`Pocketful: could not resolve an index token for ${symbol}`);
  return entry;
}

export async function resolveExpiries(symbol) {
  const contract = await getContract();
  const legs = contract.options[symbol] || [];
  const set = new Set(legs.map((l) => l.expiry));
  return Array.from(set).sort();
}

/** Map<strikeKey, { ce?: {token, exchangeCode}, pe?: {token, exchangeCode} }> for one expiry. */
export async function resolveStrikeMap(symbol, expiryISO) {
  const contract = await getContract();
  const legs = (contract.options[symbol] || []).filter((l) => l.expiry === expiryISO);

  const map = new Map();
  for (const leg of legs) {
    const key = formatStrikeKey(leg.strike);
    if (!map.has(key)) map.set(key, {});
    map.get(key)[leg.type === "CE" ? "ce" : "pe"] = { token: leg.token, exchangeCode: leg.exchangeCode };
  }
  return map;
}
