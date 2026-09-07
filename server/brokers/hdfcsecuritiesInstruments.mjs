/**
 * HDFC Securities (InvestRight) instrument/symbol master.
 *
 * InvestRight has no native option-chain endpoint and no per-symbol lookup API
 * — the only way to resolve strikes/expiries/tokens is its public Security
 * Master CSV (~8MB, ~117k rows, unauthenticated — no api_key/Authorization/
 * User-Agent required per the docs, though a User-Agent is sent anyway since
 * it's mandatory on nearly everything else this broker serves):
 *   GET https://developer.hdfcsec.com/oapi/v1/security-master
 *
 * CSV columns (verified against openalgo's production adapter, which reverse-
 * engineered the live file): exchange, security_id, instrument_segment,
 * expiry_date, strike_price, option_type, lot_size, tick_size, close_price,
 * exch_security_id, symbol_name, underline_symbol, open_price.
 *   - `exchange` is only ever NSE / BSE / MCX — derivatives are addressed by
 *     this PARENT exchange + `instrument_segment` (OPTIDX for index options),
 *     never a distinct NFO/BFO code.
 *   - `expiry_date` is already "YYYY-MM-DD" on option/future rows.
 *   - `symbol_name` on an OPTIDX row is the plain underlying name (NIFTY,
 *     BANKNIFTY, SENSEX, ...), not the full contract symbol.
 *   - `exch_security_id` is the market-data token /fetch-ltp and the WS feed
 *     key on; `security_id` is the separate order-placement code.
 *   - Index SPOT rows are EQUITY-segment rows whose `exch_security_id` falls
 *     in a reserved token band (NSE 26000-26999, BSE <1000) rather than a
 *     distinct instrument_segment value.
 *
 * The exact `symbol_name` spelling HDFC uses for each index spot row (e.g.
 * "NIFTY 50" vs "NIFTY50") is NOT independently verified here — no network
 * access to the live CSV during development — so index-spot resolution
 * matches against a small alias list per symbol rather than one exact string.
 * If a fresh master ships a spelling outside that list, fetchLTP/spot
 * resolution degrades to 0 rather than guessing.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { SECURITY_MASTER_URL, USER_AGENT } from "./hdfcsecuritiesAuth.mjs";

// app symbol -> where its OPTIDX rows and index-spot row live in the CSV, and
// the exchange codes InvestRight's own APIs expect for each purpose.
export const SYMBOL_CONFIG = {
  NIFTY: { csvExchange: "NSE", derivExchange: "NFO", indexLtpExchange: "NSE_INDEX", wsIndexPrefix: "NSE_INDEX", aliases: ["NIFTY", "NIFTY50", "NIFTY 50"] },
  BANKNIFTY: { csvExchange: "NSE", derivExchange: "NFO", indexLtpExchange: "NSE_INDEX", wsIndexPrefix: "NSE_INDEX", aliases: ["BANKNIFTY", "NIFTYBANK", "NIFTY BANK"] },
  FINNIFTY: { csvExchange: "NSE", derivExchange: "NFO", indexLtpExchange: "NSE_INDEX", wsIndexPrefix: "NSE_INDEX", aliases: ["FINNIFTY", "NIFTYFINSERVICE", "NIFTY FIN SERVICE"] },
  MIDCPNIFTY: { csvExchange: "NSE", derivExchange: "NFO", indexLtpExchange: "NSE_INDEX", wsIndexPrefix: "NSE_INDEX", aliases: ["MIDCPNIFTY", "NIFTYMIDCAPSELECT", "NIFTY MID SELECT"] },
  SENSEX: { csvExchange: "BSE", derivExchange: "BFO", indexLtpExchange: "BSE_INDEX", wsIndexPrefix: "BSE_INDEX", aliases: ["SENSEX"] },
};

const WS_PREFIX_BY_DERIV_EXCHANGE = { NFO: "NFO", BFO: "BFO" };

function normalizeKey(s) {
  return String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Minimal CSV parser: the master's columns carry no embedded commas/quotes (confirmed by openalgo's production usage). */
function parseCSV(text) {
  const lines = text.split("\n");
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = line.split(",");
    if (cols.length < headers.length) continue;
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = (cols[c] || "").trim();
    rows.push(row);
  }
  return rows;
}

async function downloadSecurityMaster() {
  const res = await fetch(SECURITY_MASTER_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`HDFC Securities security-master download failed [${res.status}]`);
  }
  const text = await res.text();
  return parseCSV(text);
}

/** Cached once/day, unauthenticated, shared across every user's credentials. */
async function getSecurityMaster() {
  return getCachedOrFetch("hdfcsecurities:security-master", downloadSecurityMaster, ONE_DAY_MS);
}

/** All OPTIDX rows (CE + PE, every expiry) for one app symbol. */
export async function getOptionRows(symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) throw new Error(`HDFC Securities: unknown symbol ${symbol}`);
  const rows = await getSecurityMaster();
  const wantedName = normalizeKey(symbol);
  return rows.filter((r) => {
    if ((r.exchange || "").toUpperCase() !== cfg.csvExchange) return false;
    if ((r.instrument_segment || "").toUpperCase() !== "OPTIDX") return false;
    return normalizeKey(r.symbol_name) === wantedName;
  });
}

export function distinctExpiriesAscending(rows) {
  const set = new Set(rows.map((r) => r.expiry_date).filter(Boolean));
  return Array.from(set).sort();
}

/** The index spot row (EQUITY segment, reserved token band) for one app symbol, or null if unresolvable. */
export async function resolveIndexSpotRow(symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) return null;
  const rows = await getSecurityMaster();
  const aliasKeys = new Set(cfg.aliases.map(normalizeKey));

  for (const r of rows) {
    if ((r.exchange || "").toUpperCase() !== cfg.csvExchange) continue;
    if ((r.instrument_segment || "").toUpperCase() !== "EQUITY") continue;
    const token = Number(r.exch_security_id);
    if (!Number.isFinite(token)) continue;
    const inBand = cfg.csvExchange === "NSE" ? token >= 26000 && token <= 26999 : token > 0 && token < 1000;
    if (!inBand) continue;
    if (aliasKeys.has(normalizeKey(r.symbol_name)) || aliasKeys.has(normalizeKey(r.security_id))) {
      return { token: String(token), exchange: cfg.csvExchange };
    }
  }
  return null;
}

/** WS feed scripId for an option leg row, e.g. "NFO_48521". */
export function legScripId(symbol, row) {
  const cfg = SYMBOL_CONFIG[symbol];
  const prefix = WS_PREFIX_BY_DERIV_EXCHANGE[cfg.derivExchange] || cfg.derivExchange;
  return `${prefix}_${row.exch_security_id}`;
}

/** WS feed scripId for the index spot row. */
export function indexScripId(symbol, spotRow) {
  const cfg = SYMBOL_CONFIG[symbol];
  return `${cfg.wsIndexPrefix}_${spotRow.token}`;
}

/** fetch-ltp instrument descriptor for an option leg row. */
export function legLtpInstrument(symbol, row) {
  const cfg = SYMBOL_CONFIG[symbol];
  return { exchange: cfg.csvExchange, token: String(row.exch_security_id) };
}

/** fetch-ltp instrument descriptor for the index spot row. */
export function indexLtpInstrument(symbol, spotRow) {
  const cfg = SYMBOL_CONFIG[symbol];
  return { exchange: cfg.indexLtpExchange, token: spotRow.token };
}
