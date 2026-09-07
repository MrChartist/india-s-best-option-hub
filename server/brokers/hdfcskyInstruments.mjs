/**
 * HDFC Sky Security Master — daily ZIP+CSV download + parsing helpers.
 *
 * HDFC Sky has no native option-chain or expiry-list endpoint, so strikes,
 * expiries and the numeric `exchange_token` every quote call needs are all
 * resolved from this master. It's a public, unauthenticated download (no
 * Authorization header required), so — like Zerodha's instrument dump — it's
 * cached once/day and shared across every user's credentials rather than
 * keyed per-user.
 *
 * CSV columns (verified against the live file by marketcalls/openalgo's
 * HDFC Sky plugin): exchange_token, trading_symbol, company_name,
 * close_price, expiry, strike, tick_size, lot_size, instrument_name,
 * option_type, segment, exchange, fin_instrm_pdct_tp_cd, asset_code,
 * settlement_type, isin.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { unzipFirstCsv } from "./hdfcskyZip.mjs";
import { USER_AGENT } from "./hdfcskyClient.mjs";

const SECURITY_MASTER_URL = "https://hdfcsky.com/api/v1/contract/Compact?info=download";

// Which exchange + `company_name` value each app symbol's OPTIDX contracts
// carry in the master. NFO_INDEX_UNDERLYINGS / BFO index names per openalgo's
// HDFC Sky mapping (broker/hdfcsky/mapping/transform_data.py).
const UNDERLYING_MAP = {
  NIFTY: { exchange: "NFO", name: "NIFTY" },
  BANKNIFTY: { exchange: "NFO", name: "BANKNIFTY" },
  FINNIFTY: { exchange: "NFO", name: "FINNIFTY" },
  MIDCPNIFTY: { exchange: "NFO", name: "MIDCPNIFTY" },
  SENSEX: { exchange: "BFO", name: "SENSEX" },
};

// Index-spot rows live under the parent cash exchange, flagged by `segment`
// ("INDICES" on NSE, "IDX" on BSE) rather than a dedicated exchange code.
// `ltpExchange` is what /fetch-ltp itself expects for indices (NSE_INDEX /
// BSE_INDEX — the one REST endpoint that is NOT the plain cash exchange).
// display-name variants cover both spaced ("NIFTY 50") and compact forms.
const INDEX_SPOT_MAP = {
  NIFTY: { exchange: "NSE", segment: "INDICES", ltpExchange: "NSE_INDEX", names: ["NIFTY50", "NIFTY 50"] },
  BANKNIFTY: { exchange: "NSE", segment: "INDICES", ltpExchange: "NSE_INDEX", names: ["NIFTYBANK", "NIFTY BANK"] },
  FINNIFTY: { exchange: "NSE", segment: "INDICES", ltpExchange: "NSE_INDEX", names: ["NIFTYFINSERVICE", "NIFTY FIN SERVICE"] },
  MIDCPNIFTY: { exchange: "NSE", segment: "INDICES", ltpExchange: "NSE_INDEX", names: ["NIFTYMIDSELECT", "NIFTY MID SELECT", "NIFTY MIDCAP SELECT"] },
  SENSEX: { exchange: "BSE", segment: "IDX", ltpExchange: "BSE_INDEX", names: ["SENSEX"] },
};

const MONTH_INDEX = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const CSV_COLUMNS = [
  "exchange_token", "trading_symbol", "company_name", "close_price", "expiry", "strike",
  "tick_size", "lot_size", "instrument_name", "option_type", "segment", "exchange",
  "fin_instrm_pdct_tp_cd", "asset_code", "settlement_type", "isin",
];

/** "28-Aug-2025" -> "2025-08-28". Returns null for the non-expiring sentinel / unparseable values. */
function expiryToIso(ddMonYyyy) {
  const parts = String(ddMonYyyy || "").split("-");
  if (parts.length !== 3) return null;
  const [d, monRaw, y] = parts;
  const m = MONTH_INDEX[monRaw.slice(0, 3).toUpperCase()];
  if (!m || !y || y === "0001") return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Simple comma-split CSV parser — the security master's columns carry no embedded commas/quotes. */
function parseCsv(text) {
  const lines = text.split("\n");
  const rows = [];
  // Skip the header line (line 0) — column order is fixed and verified (CSV_COLUMNS).
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = line.split(",");
    if (cols.length < CSV_COLUMNS.length) continue;
    const row = {};
    for (let c = 0; c < CSV_COLUMNS.length; c++) row[CSV_COLUMNS[c]] = cols[c]?.trim();
    rows.push(row);
  }
  return rows;
}

async function downloadSecurityMaster() {
  console.log("[hdfcsky] downloading Security Master (CompactScrip.csv, ~17 MB uncompressed)");
  const res = await fetch(SECURITY_MASTER_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HDFC Sky Security Master download failed [${res.status}]`);
  const buf = Buffer.from(await res.arrayBuffer());
  const csvText = unzipFirstCsv(buf);
  return parseCsv(csvText);
}

/** Cached once/day, shared across all users' credentials — the master is a public download. */
export async function getInstrumentMaster() {
  return getCachedOrFetch("hdfcsky:security-master", downloadSecurityMaster, ONE_DAY_MS);
}

function normalizeName(s) {
  return String(s || "").replace(/\s+/g, "").toUpperCase();
}

/** Distinct ascending ISO expiry dates for an app symbol's option contracts. */
export function listExpiries(master, symbol) {
  const cfg = UNDERLYING_MAP[symbol];
  if (!cfg) throw new Error(`Unknown symbol: ${symbol}`);
  const set = new Set();
  for (const r of master) {
    if (r.exchange !== cfg.exchange || r.company_name !== cfg.name) continue;
    if (r.option_type !== "CE" && r.option_type !== "PE") continue;
    const iso = expiryToIso(r.expiry);
    if (iso) set.add(iso);
  }
  return [...set].sort();
}

/** CE/PE rows for symbol+expiry: [{ token, strike, type: "ce"|"pe", exchange }]. */
export function optionRowsForExpiry(master, symbol, expiryIso) {
  const cfg = UNDERLYING_MAP[symbol];
  if (!cfg) throw new Error(`Unknown symbol: ${symbol}`);
  const rows = [];
  for (const r of master) {
    if (r.exchange !== cfg.exchange || r.company_name !== cfg.name) continue;
    if (r.option_type !== "CE" && r.option_type !== "PE") continue;
    if (expiryToIso(r.expiry) !== expiryIso) continue;
    const strike = Number(r.strike);
    if (!(strike > 0)) continue;
    rows.push({ token: r.exchange_token, strike, type: r.option_type.toLowerCase(), exchange: cfg.exchange });
  }
  return rows;
}

/** { token, ltpExchange } for the underlying's live index-spot quote, or null if not found in the master. */
export function indexSpotRow(master, symbol) {
  const cfg = INDEX_SPOT_MAP[symbol];
  if (!cfg) return null;
  const wanted = cfg.names.map(normalizeName);
  for (const r of master) {
    if (r.exchange !== cfg.exchange || r.segment !== cfg.segment) continue;
    if (wanted.includes(normalizeName(r.trading_symbol))) {
      return { token: r.exchange_token, ltpExchange: cfg.ltpExchange };
    }
  }
  return null;
}
