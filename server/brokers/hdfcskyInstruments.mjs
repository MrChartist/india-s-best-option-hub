/**
 * HDFC Sky Security Master: download, parsing and symbol mapping.
 *
 * Official docs: https://developer.hdfcsky.com/sky-docs/docs/security_master ("Download CSV" ->
 * https://hdfcsky.com/api/v1/contract/Compact?info=download, a public ZIP holding CompactScrip.csv).
 * The docs do not describe the columns; they were read from the live file header (October 2026):
 *   exchange_token, trading_symbol, company_name, close_price, expiry, strike, tick_size, lot_size,
 *   instrument_name, option_type, segment, exchange, fin_instrm_pdct_tp_cd, asset_code,
 *   settlement_type, isin
 * Facts used (live file):
 *   - `exchange` is already NSE / BSE / NFO / BFO / CDS / MCX. Index spot rows are NSE rows with
 *     segment "INDICES" ("Nifty 50" 26000, "Nifty Bank" 26009, "Nifty Fin Service" 26037,
 *     "NIFTY MID SELECT" 26074) and BSE rows with segment "IDX" (SENSEX 1, BANKEX 12).
 *   - Derivatives: `company_name` is the underlying (NIFTY, SENSEX, RELIANCE); `instrument_name` is
 *     OPTIDX/OPTSTK/FUTIDX/FUTSTK on NFO and IO/SO/IF/SF on BFO; `option_type` CE/PE; `expiry`
 *     "27-Oct-2026" (non-expiring rows carry "01-Jan-0001"); `strike` in rupees; `tick_size` in rupees.
 *   - Cash rows carry the series in the symbol: "RELIANCE-EQ" on NSE.
 *   - `exchange_token` is the token for fetch-ltp, the WebSocket and order `instrument_token`.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { unzipFirstCsv } from "./hdfcskyZip.mjs";
import { USER_AGENT } from "./hdfcskyClient.mjs";
import { readBodyCapped } from "../lib/safeArchive.mjs";
import { brokerFetch } from "./contract.mjs";

export const SECURITY_MASTER_URL = "https://hdfcsky.com/api/v1/contract/Compact?info=download";

/** App index symbol -> options exchange + index spot row. */
export const SYMBOL_CONFIG = Object.freeze({
  NIFTY: { derivExchange: "NFO", indexExchange: "NSE", indexToken: "26000" },
  BANKNIFTY: { derivExchange: "NFO", indexExchange: "NSE", indexToken: "26009" },
  FINNIFTY: { derivExchange: "NFO", indexExchange: "NSE", indexToken: "26037" },
  MIDCPNIFTY: { derivExchange: "NFO", indexExchange: "NSE", indexToken: "26074" },
  SENSEX: { derivExchange: "BFO", indexExchange: "BSE", indexToken: "1" },
  BANKEX: { derivExchange: "BFO", indexExchange: "BSE", indexToken: "12" },
});
const CANONICAL_INDEX_BY_KEY = Object.fromEntries(Object.entries(SYMBOL_CONFIG).map(([sym, c]) => [`${c.indexExchange}:${c.indexToken}`, sym]));

const INDEX_SEGMENT = { NSE: "INDICES", BSE: "IDX" };
const INSTRUMENT_TYPE = { OPTIDX: "OPTIDX", OPTSTK: "OPTSTK", FUTIDX: "FUTIDX", FUTSTK: "FUTSTK", IO: "OPTIDX", SO: "OPTSTK", IF: "FUTIDX", SF: "FUTSTK" };
const MONTH_INDEX = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

let memoryOnly = false;
let mem = null;
let inflight = null;

/** Tests: drop the cached master and stop using the shared disk cache. */
export function resetHdfcSkyInstrumentCache({ diskCache = false } = {}) {
  memoryOnly = !diskCache;
  mem = null;
  inflight = null;
}

/** "28-Aug-2025" -> "2025-08-28"; null for the "01-Jan-0001" sentinel or anything unparseable. */
export function expiryToIso(ddMonYyyy) {
  const m = String(ddMonYyyy ?? "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m || m[3] === "0001") return null;
  const mon = MONTH_INDEX[m[2].toUpperCase()];
  return mon ? `${m[3]}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

export function parseCsv(text) {
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
  if (!res.ok) throw new Error(`HDFC Sky security master download failed [${res.status}]`);
  const buf = await readBodyCapped(res, { label: "HDFC Sky security master" });
  // A ZIP starts with "PK"; accept a plain CSV body too (the download is served as a ZIP today).
  const text = buf[0] === 0x50 && buf[1] === 0x4b ? unzipFirstCsv(buf) : buf.toString("utf8");
  return parseCsv(text);
}

export async function getInstrumentMaster() {
  if (!memoryOnly) return getCachedOrFetch("hdfcsky:security-master:v2", download, ONE_DAY_MS);
  if (mem && Date.now() - mem.at < ONE_DAY_MS) return mem.rows;
  if (!inflight) inflight = download().then((rows) => { mem = { rows, at: Date.now() }; return rows; }).finally(() => { inflight = null; });
  return inflight;
}

export function isIndexRow(r) {
  const ex = String(r.exchange).toUpperCase();
  return INDEX_SEGMENT[ex] !== undefined && String(r.segment).toUpperCase() === INDEX_SEGMENT[ex];
}

/** Canonical index name for an index row (NIFTY, BANKNIFTY, ..., else the upper-cased display name). */
export function indexNameOf(r) {
  return CANONICAL_INDEX_BY_KEY[`${String(r.exchange).toUpperCase()}:${r.exchange_token}`] ?? String(r.trading_symbol).toUpperCase().replace(/\s+/g, "");
}

/** Master row -> contract Instrument, or null for rows out of scope (MCX, CDS, sentinel rows). */
export function toInstrument(r) {
  const exchange = String(r.exchange).toUpperCase();
  const token = String(r.exchange_token ?? "");
  if (!/^\d+$/.test(token) || !["NSE", "BSE", "NFO", "BFO"].includes(exchange)) return null;
  const tick = Number(r.tick_size);
  const tickSize = Number.isFinite(tick) && tick > 0 ? tick : 0.05;
  const lot = Number(r.lot_size);
  const lotSize = Number.isFinite(lot) && lot > 0 ? lot : 1;
  if (exchange === "NSE" || exchange === "BSE") {
    if (isIndexRow(r)) {
      const name = indexNameOf(r);
      return { token, exchange, tradingSymbol: name, underlying: name, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize };
    }
    const sym = String(r.trading_symbol ?? "");
    if (!sym) return null;
    const dash = sym.lastIndexOf("-");
    const underlying = dash > 0 ? sym.slice(0, dash) : sym;
    return { token, exchange, tradingSymbol: sym, underlying, instrumentType: "EQ", expiry: null, strike: null, optionType: null, lotSize, tickSize };
  }
  const instrumentType = INSTRUMENT_TYPE[String(r.instrument_name).toUpperCase()];
  const expiry = expiryToIso(r.expiry);
  const underlying = String(r.company_name ?? "").trim();
  if (!instrumentType || !expiry || !underlying) return null;
  const isOpt = instrumentType.startsWith("OPT");
  const optionType = String(r.option_type).toUpperCase();
  const strike = Number(r.strike);
  if (isOpt && (!(strike > 0) || (optionType !== "CE" && optionType !== "PE"))) return null;
  return {
    token, exchange, tradingSymbol: String(r.trading_symbol), underlying, instrumentType, expiry,
    strike: isOpt ? strike : null, optionType: isOpt ? optionType : null, lotSize, tickSize,
  };
}

function optionRows(master, symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) throw new Error(`HDFC Sky: unknown symbol ${symbol}`);
  return master.filter((r) => r.exchange === cfg.derivExchange && r.company_name === symbol && (r.option_type === "CE" || r.option_type === "PE"));
}

/** Distinct ascending ISO expiry dates for an app symbol's options. */
export function listExpiries(master, symbol) {
  return [...new Set(optionRows(master, symbol).map((r) => expiryToIso(r.expiry)).filter(Boolean))].sort();
}

/** CE/PE rows for symbol + expiry: [{ token, strike, type: "ce"|"pe", exchange }]. */
export function optionRowsForExpiry(master, symbol, expiryIso) {
  const out = [];
  for (const r of optionRows(master, symbol)) {
    if (expiryToIso(r.expiry) !== expiryIso) continue;
    const strike = Number(r.strike);
    if (!(strike > 0)) continue;
    out.push({ token: String(r.exchange_token), strike, type: r.option_type.toLowerCase(), exchange: r.exchange });
  }
  return out;
}

/** { token, ltpExchange } for an app symbol's index spot. */
export function indexSpotRow(master, symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) return null;
  const row = master.find((r) => r.exchange === cfg.indexExchange && String(r.exchange_token) === cfg.indexToken && isIndexRow(r));
  return row ? { token: cfg.indexToken, ltpExchange: `${cfg.indexExchange}_INDEX` } : null;
}

export function findRow(master, exchange, token) {
  const ex = String(exchange).toUpperCase();
  return master.find((r) => String(r.exchange_token) === String(token) && String(r.exchange).toUpperCase() === ex) ?? null;
}
