/**
 * HDFC Securities (InvestRight) Security Master: download, parsing and symbol mapping.
 *
 * Official docs: https://developer.hdfcsec.com/ir-docs/docs/security_master ("Download CSV" ->
 * GET https://developer.hdfcsec.com/oapi/v1/security-master, public, ~9 MB, refreshed daily).
 * The docs do not describe the columns; they were read from the live file header (October 2026):
 *   exchange, security_id, instrument_segment, expiry_date, strike_price, option_type, lot_size,
 *   tick_size, close_price, exch_security_id, symbol_name, underline_symbol, open_price
 * Facts used here (live file; OpenAlgo's notes agree):
 *   - `exchange` is only NSE / BSE / MCX. Derivatives are told apart by `instrument_segment`
 *     (OPTIDX, OPTSTK, FUTIDX, FUTSTK, OPTCUR, FUTCUR, ...), so NFO = NSE + derivative segment.
 *   - Index spot rows are EQUITY rows in a reserved token band: NSE 26000-26999 (NIFTY 26000,
 *     BANKNIFTY 26009, FINNIFTY 26037, MIDCPNIFTY 26074), BSE below 1000 (SENSEX 1, BANKEX 12).
 *   - `exch_security_id` is the market-data token (fetch-ltp, WebSocket); `security_id` is the order
 *     id (e.g. "51288" on NSE F&O, "B842869" on BSE F&O, "RELINDEQNR" for RELIANCE cash).
 *   - `underline_symbol` is the underlying's own security_id (NIFTYEQEQNR), which a derivative order
 *     sends as `underlying_symbol` (docs/place_order sample).
 *   - `expiry_date` is YYYY-MM-DD; `strike_price` is in rupees (futures carry -0.01).
 *   - `tick_size` is in paise when it has no decimal point ("5" = 0.05) and in rupees when it has one
 *     (".05"). Rows with a "DUMMY..." token are MF/NCD placeholders and are skipped.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { SECURITY_MASTER_URL, USER_AGENT } from "./hdfcsecuritiesAuth.mjs";
import { brokerFetch } from "./contract.mjs";

/** App index symbol -> master facts. derivExchange is the contract exchange of its options. */
export const SYMBOL_CONFIG = Object.freeze({
  NIFTY: { csvExchange: "NSE", derivExchange: "NFO", indexToken: "26000" },
  BANKNIFTY: { csvExchange: "NSE", derivExchange: "NFO", indexToken: "26009" },
  FINNIFTY: { csvExchange: "NSE", derivExchange: "NFO", indexToken: "26037" },
  MIDCPNIFTY: { csvExchange: "NSE", derivExchange: "NFO", indexToken: "26074" },
  SENSEX: { csvExchange: "BSE", derivExchange: "BFO", indexToken: "1" },
  BANKEX: { csvExchange: "BSE", derivExchange: "BFO", indexToken: "12" },
});

const DERIV_SEGMENTS = new Set(["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"]);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// ── cache (memory-only mode for tests so fixtures never land in the shared disk cache) ──
let memoryOnly = false;
let mem = null;
let inflight = null;

export function resetHdfcSecuritiesInstrumentCache({ diskCache = false } = {}) {
  memoryOnly = !diskCache;
  mem = null;
  inflight = null;
}

function parseCsv(text) {
  const lines = String(text).split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = line.split(",");
    if (cols.length < headers.length) continue;
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = (cols[c] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

async function download() {
  const res = await brokerFetch(SECURITY_MASTER_URL, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`HDFC Securities security master download failed [${res.status}]`);
  return parseCsv(await res.text());
}

/** All master rows, cached for a day. */
export async function getSecurityMaster() {
  if (!memoryOnly) return getCachedOrFetch("hdfcsecurities:security-master:v2", download, ONE_DAY_MS);
  if (mem && Date.now() - mem.at < ONE_DAY_MS) return mem.rows;
  if (!inflight) {
    inflight = download().then((rows) => { mem = { rows, at: Date.now() }; return rows; }).finally(() => { inflight = null; });
  }
  return inflight;
}

// ── row helpers ──

export function tickSizeOf(raw) {
  const s = String(raw ?? "").trim();
  const v = Number(s);
  if (!s || !Number.isFinite(v) || v <= 0) return 0.05;
  return s.includes(".") ? v : v / 100;
}

export function isIndexRow(r) {
  if (String(r.instrument_segment).toUpperCase() !== "EQUITY") return false;
  const t = Number(r.exch_security_id);
  if (!Number.isFinite(t)) return false;
  const ex = String(r.exchange).toUpperCase();
  return ex === "NSE" ? t >= 26000 && t <= 26999 : ex === "BSE" ? t > 0 && t < 1000 : false;
}

/** Contract exchange for a master row (NFO/BFO for derivatives), or null for MCX/currency rows. */
export function contractExchangeOf(r) {
  const ex = String(r.exchange).toUpperCase();
  const seg = String(r.instrument_segment).toUpperCase();
  if (ex !== "NSE" && ex !== "BSE") return null;
  if (seg === "EQUITY") return ex;
  if (DERIV_SEGMENTS.has(seg)) return ex === "NSE" ? "NFO" : "BFO";
  return null;
}

/** fetch-ltp / scripId exchange code for a row: NSE_INDEX/BSE_INDEX for indices, else the contract code. */
export function feedExchangeOf(r) {
  if (isIndexRow(r)) return `${String(r.exchange).toUpperCase()}_INDEX`;
  return contractExchangeOf(r);
}

function fmtStrike(v) {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

/** "NIFTY 27 OCT 2026 25000 CE" style display symbol (InvestRight has no trading-symbol column). */
export function displaySymbol(underlying, expiry, strike, optionType) {
  if (!expiry) return underlying;
  const [y, m, d] = expiry.split("-");
  const base = `${underlying} ${d} ${MONTHS[Number(m) - 1]} ${y}`;
  return optionType ? `${base} ${fmtStrike(strike)} ${optionType}` : `${base} FUT`;
}

/** Master row -> contract Instrument, or null when the row is out of scope (MCX, currency, MF). */
export function toInstrument(r) {
  const exchange = contractExchangeOf(r);
  const token = String(r.exch_security_id ?? "");
  if (!exchange || !/^\d+$/.test(token)) return null;
  const seg = String(r.instrument_segment).toUpperCase();
  const lot = Number(r.lot_size);
  const lotSize = Number.isFinite(lot) && lot > 0 && lot < 1e8 ? lot : 1;
  const tickSize = tickSizeOf(r.tick_size);
  const name = String(r.symbol_name || r.security_id || "").trim();
  if (seg === "EQUITY") {
    const index = isIndexRow(r);
    return { token, exchange, tradingSymbol: name, underlying: name, instrumentType: index ? "INDEX" : "EQ", expiry: null, strike: null, optionType: null, lotSize: index ? 1 : lotSize, tickSize };
  }
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(r.expiry_date) ? r.expiry_date : null;
  if (!expiry || !name) return null;
  const isOpt = seg.startsWith("OPT");
  const optionType = String(r.option_type).toUpperCase();
  const strike = Number(r.strike_price);
  if (isOpt && (!(strike > 0) || (optionType !== "CE" && optionType !== "PE"))) return null;
  return {
    token,
    exchange,
    tradingSymbol: displaySymbol(name, expiry, strike, isOpt ? optionType : null),
    underlying: name,
    instrumentType: seg,
    expiry,
    strike: isOpt ? strike : null,
    optionType: isOpt ? optionType : null,
    lotSize,
    tickSize,
  };
}

// ── option-chain helpers ──

export async function getOptionRows(symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) throw new Error(`HDFC Securities: unknown symbol ${symbol}`);
  const rows = await getSecurityMaster();
  return rows.filter(
    (r) => String(r.exchange).toUpperCase() === cfg.csvExchange && String(r.instrument_segment).toUpperCase() === "OPTIDX" && String(r.symbol_name).toUpperCase() === symbol,
  );
}

export function distinctExpiriesAscending(rows) {
  return [...new Set(rows.map((r) => r.expiry_date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}

/** The index spot row for an app symbol (by its reserved token), or null. */
export async function resolveIndexSpotRow(symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) return null;
  const rows = await getSecurityMaster();
  return rows.find((r) => String(r.exchange).toUpperCase() === cfg.csvExchange && String(r.exch_security_id) === cfg.indexToken && isIndexRow(r)) ?? null;
}

/** Master row for a contract { exchange, token } reference. */
export async function findRow(exchange, token) {
  const rows = await getSecurityMaster();
  const ex = String(exchange).toUpperCase();
  return rows.find((r) => String(r.exch_security_id) === String(token) && contractExchangeOf(r) === ex) ?? null;
}
