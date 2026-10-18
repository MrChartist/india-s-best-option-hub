/**
 * mStock (Mirae Asset) Type B scrip master + index spot tokens.
 *
 * Official docs (checked 2026-10):
 *  - https://tradingapi.mstock.com/docs/v1/typeB/market-quote-and-instrument/ :
 *    GET /instruments/OpenAPIScripMaster (Bearer JWT + X-PrivateKey) returns a bare JSON array of
 *    { token, symbol, name, expiry, strike, lotsize, instrumenttype, exch_seg, tick_size }. In the documented
 *    sample `symbol` is the underlying ("SENSEX") and `name` the trading symbol ("SENSEX25O2382700CE"),
 *    expiry is "23Oct2025", strike is in rupees ("82700") and tick_size in rupees ("0.05").
 *  - https://tradingapi.mstock.com/docs/v1/Annexure/ : index tokens are not in the master. NSE: Nifty 50
 *    26000, Nifty Bank 26009, Nifty Fin Service 26037, NIFTY MID SELECT 26074. BSE: SENSEX 51, BANKEX 69.
 *  - https://tradingapi.mstock.com/docs/v1/typeB/option-chain-apis/ documents GetOptionChain, which
 *    returns contract tokens only (no prices) and its master endpoint is marked "coming soon", so the chain
 *    is built from this master instead.
 *
 * The master is the same for every user, so it is cached once a day under a fixed key; it can only be
 * downloaded with a logged-in session.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { authRequest, getSession } from "./mstockAuth.mjs";

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);
const INSTRUMENT_TYPES = new Set(["EQ", "FUTIDX", "FUTSTK", "OPTIDX", "OPTSTK"]);

/** Annexure index tokens (exchange tokens, not in the scrip master). */
export const INDEX_SPOT = Object.freeze({
  NIFTY: { exchange: "NSE", token: "26000" },
  BANKNIFTY: { exchange: "NSE", token: "26009" },
  FINNIFTY: { exchange: "NSE", token: "26037" },
  MIDCPNIFTY: { exchange: "NSE", token: "26074" },
  SENSEX: { exchange: "BSE", token: "51" },
  BANKEX: { exchange: "BSE", token: "69" },
});

// Underlying spellings seen for index derivatives -> canonical name.
const UNDERLYING_ALIASES = { NIFTY50: "NIFTY", "NIFTY 50": "NIFTY", NIFTYBANK: "BANKNIFTY", NIFTYFINSERVICE: "FINNIFTY", NIFTYMIDSELECT: "MIDCPNIFTY", "NIFTY MID SELECT": "MIDCPNIFTY" };

export function canonicalUnderlying(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  return UNDERLYING_ALIASES[s] || s;
}

/** "23Oct2025" | "2024-Nov-28" | "07-Nov-2024" | "2026-10-20" -> ISO date, or null. */
export function parseExpiry(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})-?([A-Z]{3})-?(\d{4}|\d{2})$/.exec(s);
  if (m && MONTHS[m[2]]) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-([A-Z]{3})-(\d{1,2})$/.exec(s);
  if (m && MONTHS[m[2]]) return `${m[1]}-${MONTHS[m[2]]}-${m[3].padStart(2, "0")}`;
  return null;
}

const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

/** One master row -> contract Instrument, or null for rows the contract does not cover. */
export function toInstrument(row) {
  const exchange = String(row?.exch_seg ?? "").toUpperCase();
  const instrumentType = String(row?.instrumenttype ?? "").toUpperCase();
  if (!EXCHANGES.has(exchange) || !INSTRUMENT_TYPES.has(instrumentType)) return null;
  const tradingSymbol = String(row?.name ?? "").trim();
  const token = String(row?.token ?? "").trim();
  if (!tradingSymbol || !token) return null;
  const underlying = canonicalUnderlying(row?.symbol);
  const isOpt = instrumentType.startsWith("OPT");
  const isDeriv = isOpt || instrumentType.startsWith("FUT");
  const expiry = isDeriv ? parseExpiry(row?.expiry) : null;
  if (isDeriv && !expiry) return null;
  if (instrumentType.endsWith("IDX") && !CANONICAL_UNDERLYINGS.includes(underlying)) return null;
  const optionType = isOpt ? (/CE$/i.test(tradingSymbol) ? "CE" : /PE$/i.test(tradingSymbol) ? "PE" : null) : null;
  const strike = isOpt ? toNum(row?.strike) : null;
  if (isOpt && (!optionType || !(strike > 0))) return null;
  const lotSize = toNum(row?.lotsize);
  const tick = toNum(row?.tick_size);
  return {
    token,
    exchange,
    tradingSymbol,
    underlying,
    instrumentType,
    expiry,
    strike,
    optionType,
    lotSize: lotSize > 0 ? lotSize : 1,
    tickSize: tick > 0 ? tick : 0.05,
  };
}

/** Raw master rows (cached daily). Requires a logged-in session. */
export async function getMasterRows(creds) {
  getSession(creds); // refuse before any download when not logged in
  return getCachedOrFetch(
    "mstock:scrip-master:v2",
    async () => {
      const json = await authRequest(creds, "/instruments/OpenAPIScripMaster");
      const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
      if (!rows) throw new Error("mStock scrip master: unexpected response shape");
      return rows;
    },
    ONE_DAY_MS,
  );
}

/** All contract instruments from the master. */
export async function getInstruments(creds) {
  const rows = await getMasterRows(creds);
  const out = [];
  for (const r of rows) {
    const i = toInstrument(r);
    if (i) out.push(i);
  }
  return out;
}

function isOptionOf(inst, symbol) {
  return inst && (inst.instrumentType === "OPTIDX" || inst.instrumentType === "OPTSTK") && inst.underlying === symbol;
}

/** Ascending ISO expiries for an index or stock's options. */
export function listExpiries(instruments, symbol) {
  const want = canonicalUnderlying(symbol);
  const set = new Set();
  for (const i of instruments) if (isOptionOf(i, want)) set.add(i.expiry);
  return [...set].sort();
}

/** Option contracts for one underlying + expiry. */
export function optionContracts(instruments, symbol, expiry) {
  const want = canonicalUnderlying(symbol);
  return instruments.filter((i) => isOptionOf(i, want) && i.expiry === expiry);
}

/** Spot quote ref: Annexure token for an index, the NSE (else BSE) equity row for a stock. */
export function spotRef(instruments, symbol) {
  const want = canonicalUnderlying(symbol);
  if (INDEX_SPOT[want]) return INDEX_SPOT[want];
  const eq = instruments.find((i) => i.instrumentType === "EQ" && i.exchange === "NSE" && i.underlying === want)
    || instruments.find((i) => i.instrumentType === "EQ" && i.exchange === "BSE" && i.underlying === want);
  return eq ? { exchange: eq.exchange, token: eq.token } : null;
}
