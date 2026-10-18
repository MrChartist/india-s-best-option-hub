/**
 * Zerodha (Kite Connect) instrument master.
 *
 * Official source: https://kite.trade/docs/connect/v3/market-quotes/#instruments
 *   GET /instruments/:exchange returns a CSV dump (generated once a day; fetch around 08:30 IST) with
 *   columns instrument_token, exchange_token, tradingsymbol, name, last_price, expiry, strike,
 *   tick_size, lot_size, instrument_type (EQ, FUT, CE, PE), segment, exchange. tick_size is in rupees.
 *   Index rows sit in the NSE/BSE dumps with segment "INDICES". Exchanges may reuse instrument tokens
 *   after expiry, so a token is only trusted against today's dump.
 *
 * Kite has no option-chain endpoint, so strikes, expiries and tradingsymbols come from here. The dump
 * is public market data (only the download needs a valid session), so it is cached once a day and
 * shared across users. Under vitest the cache is memory-only so fixture rows never reach .cache/.
 */

import { CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { KITE_BASE, authHeaders, kiteFetch } from "./zerodhaClient.mjs";

export { KITE_BASE, authHeaders };

/** Which dump (NFO or BFO) each app underlying's options live in. */
export const UNDERLYING_EXCHANGE = { NIFTY: "NFO", BANKNIFTY: "NFO", FINNIFTY: "NFO", MIDCPNIFTY: "NFO", SENSEX: "BFO", BANKEX: "BFO" };

/** The dump's `name` column for each underlying's option contracts. */
export const UNDERLYING_NAME = { NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY", MIDCPNIFTY: "MIDCPNIFTY", SENSEX: "SENSEX", BANKEX: "BANKEX" };

/**
 * exchange:tradingsymbol of each index for /quote and /quote/ltp (the INDICES rows of the NSE/BSE
 * dumps). NIFTY 50 / SENSEX appear verbatim in Kite's own /quote/ohlc sample; the others are the
 * INDICES tradingsymbols (NIFTY BANK, NIFTY FIN SERVICE, NIFTY MID SELECT, BANKEX).
 */
export const SPOT_TICKER = {
  NIFTY: "NSE:NIFTY 50",
  BANKNIFTY: "NSE:NIFTY BANK",
  FINNIFTY: "NSE:NIFTY FIN SERVICE",
  MIDCPNIFTY: "NSE:NIFTY MID SELECT",
  SENSEX: "BSE:SENSEX",
  BANKEX: "BSE:BANKEX",
};

/** Index option names in the F&O dumps that are not app underlyings (left out of fetchInstruments). */
const OTHER_INDEX_NAMES = new Set(["NIFTYNXT50", "SENSEX50", "NIFTYFPI"]);
const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
const CONTRACT_EXCHANGE = { NSE: "NSE", BSE: "BSE", NFO: "NFO", BFO: "BFO", MCX: "MCX", CDS: "CDS", BCD: "CDS" };

// ── CSV ──

function splitLine(line) {
  if (!line.includes('"')) return line.split(",");
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse Kite's CSV dump into plain row objects keyed by header name (quoted names handled). */
export function parseKiteCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    if (cols.length < headers.length) continue;
    const row = {};
    headers.forEach((h, c) => { row[h] = String(cols[c] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

// ── cache ──

const memCache = new Map();
async function dailyCache(key, fn) {
  if (!process.env.VITEST) return getCachedOrFetch(key, fn, ONE_DAY_MS);
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < ONE_DAY_MS) return hit.value;
  const value = await fn();
  memCache.set(key, { value, at: Date.now() });
  return value;
}

/** Test hook. */
export function resetZerodhaInstrumentCache() {
  memCache.clear();
}

/** Raw dump rows for one exchange (NSE, BSE, NFO, BFO, ...), cached once a day. */
export async function getInstrumentMaster(creds, exchange) {
  if (!/^[A-Z]{3,4}$/.test(String(exchange))) throw new Error(`Zerodha: bad exchange ${exchange}`);
  return dailyCache(`zerodha:instruments:${exchange}`, async () => parseKiteCsv(await kiteFetch(`/instruments/${exchange}`, creds, { raw: true })));
}

const STOCK_SYMBOL_RE = /^[A-Z0-9][A-Z0-9&_-]{0,24}$/;

/**
 * Where an underlying's options and spot live. The six indices use the tables above; any other symbol is treated as
 * an NSE stock: its options are the NFO rows whose `name` is the stock symbol (instrument_type CE/PE in the dump,
 * i.e. OPTSTK), and its spot is the NSE:<symbol> quote. Returns null for a symbol that cannot be a Kite name.
 */
export function optionUnderlying(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (UNDERLYING_EXCHANGE[s]) return { exchange: UNDERLYING_EXCHANGE[s], name: UNDERLYING_NAME[s], spotKey: SPOT_TICKER[s], isIndex: true };
  if (!STOCK_SYMBOL_RE.test(s) || OTHER_INDEX_NAMES.has(s)) return null;
  return { exchange: "NFO", name: s, spotKey: `NSE:${s}`, isIndex: false };
}

/** All CE/PE rows for an app underlying (index or NSE stock), across expiries. */
export async function getOptionRows(creds, symbol) {
  const u = optionUnderlying(symbol);
  if (!u) throw new Error(`Unknown symbol for Zerodha: ${symbol}`);
  const rows = (await getInstrumentMaster(creds, u.exchange)).filter((r) => r.name === u.name && (r.instrument_type === "CE" || r.instrument_type === "PE"));
  if (!rows.length && !u.isIndex) throw new Error(`Unknown symbol for Zerodha: ${symbol} has no options in today's NFO dump`);
  return rows;
}

/** Distinct expiry dates (already "YYYY-MM-DD" in the dump), ascending. */
export function distinctExpiriesAscending(rows) {
  return [...new Set(rows.map((r) => r.expiry).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)))].sort();
}

/** One dump row -> contract Instrument, or null (MCX/CDS, non-canonical index derivatives, odd rows). */
export function mapKiteRow(r) {
  const exchange = CONTRACT_EXCHANGE[r.exchange];
  if (!exchange || !r.instrument_token || !r.tradingsymbol) return null;
  const lotSize = Number(r.lot_size) > 0 ? Number(r.lot_size) : 1;
  const tickSize = Number(r.tick_size) > 0 ? Number(r.tick_size) : 0.05;
  const base = { token: String(r.instrument_token), exchange, tradingSymbol: r.tradingsymbol, lotSize, tickSize };
  if (r.segment === "INDICES") {
    return { ...base, underlying: r.tradingsymbol, instrumentType: "INDEX", expiry: null, strike: null, optionType: null };
  }
  if ((exchange === "NSE" || exchange === "BSE") && r.instrument_type === "EQ") {
    return { ...base, underlying: r.tradingsymbol, instrumentType: "EQ", expiry: null, strike: null, optionType: null };
  }
  if (exchange !== "NFO" && exchange !== "BFO") return null;
  const name = r.name;
  if (!name || OTHER_INDEX_NAMES.has(name) || !/^\d{4}-\d{2}-\d{2}$/.test(r.expiry)) return null;
  const isIndex = CANONICAL.has(name);
  if (r.instrument_type === "FUT") {
    return { ...base, underlying: name, instrumentType: isIndex ? "FUTIDX" : "FUTSTK", expiry: r.expiry, strike: null, optionType: null };
  }
  if (r.instrument_type === "CE" || r.instrument_type === "PE") {
    const strike = Number(r.strike);
    if (!(strike > 0)) return null;
    return { ...base, underlying: name, instrumentType: isIndex ? "OPTIDX" : "OPTSTK", expiry: r.expiry, strike, optionType: r.instrument_type };
  }
  return null;
}

/** Instrument[] for NSE/BSE cash + indices and NFO/BFO F&O (four dump downloads, cached daily). */
export async function fetchInstruments(creds) {
  const out = [];
  for (const exchange of ["NSE", "BSE", "NFO", "BFO"]) {
    for (const row of await getInstrumentMaster(creds, exchange)) {
      const inst = mapKiteRow(row);
      if (inst) out.push(inst);
    }
  }
  return { status: "success", data: out };
}

/**
 * Map refs to the "EXCHANGE:TRADINGSYMBOL" keys /quote needs. A token already in that form passes
 * through; a numeric instrument_token is looked up in today's dump for its exchange.
 * @returns {Promise<Map<string, { token: string, exchange: string }>>} quote key -> ref
 */
export async function quoteKeysFor(creds, refs) {
  const out = new Map();
  const byExchange = new Map();
  for (const ref of refs) {
    const token = String(ref?.token ?? "");
    if (token.includes(":")) out.set(token, ref);
    else (byExchange.get(ref.exchange) ?? byExchange.set(ref.exchange, []).get(ref.exchange)).push(ref);
  }
  for (const [exchange, list] of byExchange) {
    const rows = await getInstrumentMaster(creds, exchange);
    const symOf = new Map(rows.map((r) => [String(r.instrument_token), r.tradingsymbol]));
    for (const ref of list) {
      const sym = symOf.get(String(ref.token));
      if (sym) out.set(`${exchange}:${sym}`, ref);
    }
  }
  return out;
}
