/**
 * Zebu (MYNT) symbol masters + index spot tokens.
 *
 * Official docs (https://zebumyntapi.web.app/OAuth/Masters/, checked 2026-10): daily ZIP files
 *   https://go.mynt.in/{NSE|BSE|NFO|BFO|CDS|MCX}_symbols.txt.zip
 * "Master file downloads require OAuth authentication", so the Bearer token is sent (OpenAlgo downloads
 * them without one; the docs are followed). Each ZIP holds one comma-separated text file with a header
 * row and a trailing comma on every line (read from the published files):
 *   NSE: Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize   (Instrument = series: EQ, BE,
 *        ..., and INDEX rows for Nifty 50 26000, Nifty Bank 26009, Nifty Fin Services 26037, India VIX)
 *   NFO: Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize
 *   BFO: Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,Strike,TickSize
 * Expiry is "DD-MON-YYYY"; OptionType CE / PE / XX (futures). In BFO the Symbol column is a product code:
 * BSXOPT = SENSEX, BKXOPT = BANKEX, SX50OPT = SENSEX 50 (a different index), stock codes like ZOMAOPT, so
 * the index is taken from that code and a stock's name from the TradingSymbol prefix.
 *
 * Index spot tokens: NIFTY 26000, BANKNIFTY 26009 (official GetIndexList sample) and FINNIFTY 26037 are in
 * the NSE master. NIFTY MID SELECT 26074, SENSEX 1 and BANKEX 12 are the Noren-family exchange tokens (not
 * in Zebu's files); if a spot quote fails, the nearest index future is used as a proxy.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { brokerFetch, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { HOST, ensureSession } from "./zebuAuth.mjs";
import { unzipFirstEntry } from "./zebuZip.mjs";
import { readBodyCapped } from "../lib/safeArchive.mjs";

export const MASTER_EXCHANGES = ["NSE", "NFO", "BFO"];
export const INDEX_SPOT = Object.freeze({
  NIFTY: { exchange: "NSE", token: "26000" },
  BANKNIFTY: { exchange: "NSE", token: "26009" },
  FINNIFTY: { exchange: "NSE", token: "26037" },
  MIDCPNIFTY: { exchange: "NSE", token: "26074" },
  SENSEX: { exchange: "BSE", token: "1" },
  BANKEX: { exchange: "BSE", token: "12" },
});
const INDEX_DERIV_EXCHANGE = { NIFTY: "NFO", BANKNIFTY: "NFO", FINNIFTY: "NFO", MIDCPNIFTY: "NFO", SENSEX: "BFO", BANKEX: "BFO" };
const BFO_CODES = { BSX: "SENSEX", BKX: "BANKEX", SX50: "SENSEX50" };
const NSE_INDEX_NAMES = { "NIFTY INDEX": "NIFTY", "NIFTY BANK": "BANKNIFTY", FINNIFTY: "FINNIFTY", "NIFTY MID SELECT": "MIDCPNIFTY" };
const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

export const isIndex = (s) => Object.prototype.hasOwnProperty.call(INDEX_DERIV_EXCHANGE, String(s ?? "").toUpperCase());

export function parseExpiry(raw) {
  const m = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/.exec(String(raw ?? "").trim().toUpperCase());
  return m && MONTHS[m[2]] ? `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}` : null;
}

/** The masters have no quoted fields; a plain split is enough. Empty header cells (trailing comma) are skipped. */
export function parseCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row = {};
    header.forEach((h, i) => { if (h) row[h] = (cols[i] ?? "").trim(); });
    return row;
  });
}

const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};

function bfoUnderlying(row) {
  const code = String(row.Symbol ?? "").toUpperCase().replace(/(OPT|FUT)$/, "");
  if (BFO_CODES[code]) return BFO_CODES[code];
  const m = /^([A-Z&-]+?)(?=\d)/.exec(String(row.TradingSymbol ?? "").toUpperCase());
  return m ? m[1] : code;
}

/** One master row -> contract Instrument, or null. */
export function toInstrument(row) {
  const exchange = String(row.Exchange ?? "").toUpperCase();
  const token = String(row.Token ?? "").trim();
  const tradingSymbol = String(row.TradingSymbol ?? "").trim();
  if (!token || !tradingSymbol) return null;
  const lot = toNum(row.LotSize);
  const tick = toNum(row.TickSize);
  const base = { token, exchange, tradingSymbol, lotSize: lot > 0 ? lot : 1, tickSize: tick > 0 ? tick : 0.05 };
  if (exchange === "NSE") {
    const series = String(row.Instrument ?? "").toUpperCase();
    if (series === "INDEX") return { ...base, underlying: NSE_INDEX_NAMES[tradingSymbol.toUpperCase()] || tradingSymbol, instrumentType: "INDEX", expiry: null, strike: null, optionType: null };
    if (series !== "EQ") return null;
    return { ...base, underlying: String(row.Symbol || tradingSymbol.replace(/-EQ$/, "")).toUpperCase(), instrumentType: "EQ", expiry: null, strike: null, optionType: null };
  }
  if (exchange !== "NFO" && exchange !== "BFO") return null;
  const instrumentType = String(row.Instrument ?? "").toUpperCase();
  if (!["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].includes(instrumentType)) return null;
  const underlying = exchange === "BFO" ? bfoUnderlying(row) : String(row.Symbol ?? "").toUpperCase();
  if (instrumentType.endsWith("IDX") && !CANONICAL_UNDERLYINGS.includes(underlying)) return null;
  const expiry = parseExpiry(row.Expiry);
  if (!expiry) return null;
  const isOpt = instrumentType.startsWith("OPT");
  const optionType = isOpt ? String(row.OptionType ?? "").toUpperCase() : null;
  const strike = isOpt ? toNum(row.StrikePrice ?? row.Strike) : null;
  if (isOpt && ((optionType !== "CE" && optionType !== "PE") || !(strike > 0))) return null;
  return { ...base, underlying, instrumentType, expiry, strike, optionType };
}

async function download(exchange, accessToken) {
  const res = await brokerFetch(`${HOST}/${exchange}_symbols.txt.zip`, { headers: { Authorization: `Bearer ${accessToken}` } }, { kind: "master" });
  if (!res.ok) throw new Error(`Zebu ${exchange} symbol master download failed (HTTP ${res.status})`);
  return unzipFirstEntry(await readBodyCapped(res, { label: "Zebu symbol master" }));
}

/** Parsed instruments of one exchange master (cached daily; the files are the same for every user). */
export async function getMaster(creds, exchange) {
  const session = await ensureSession(creds);
  return getCachedOrFetch(`zebu:master:${exchange}:v2`, async () => {
    const out = [];
    for (const r of parseCsv(await download(exchange, session.accessToken))) {
      const i = toInstrument(r);
      if (i) out.push(i);
    }
    return out;
  }, ONE_DAY_MS);
}

/** Derivatives that can hold `symbol`'s options (BFO for SENSEX/BANKEX, else NFO). */
export async function derivativesFor(creds, symbol) {
  return getMaster(creds, INDEX_DERIV_EXCHANGE[String(symbol ?? "").toUpperCase()] || "NFO");
}

const isOptionOf = (i, s) => (i.instrumentType === "OPTIDX" || i.instrumentType === "OPTSTK") && i.underlying === s;

export function listExpiries(instruments, symbol) {
  const want = String(symbol ?? "").toUpperCase();
  const set = new Set();
  for (const i of instruments) if (isOptionOf(i, want)) set.add(i.expiry);
  return [...set].sort();
}

export function optionContracts(instruments, symbol, expiry) {
  const want = String(symbol ?? "").toUpperCase();
  return instruments.filter((i) => isOptionOf(i, want) && i.expiry === expiry);
}

/** Nearest-expiry future of an underlying (spot proxy when the index quote is unavailable). */
export function nearestFuture(instruments, symbol, today = new Date().toISOString().slice(0, 10)) {
  const want = String(symbol ?? "").toUpperCase();
  return instruments
    .filter((i) => i.instrumentType.startsWith("FUT") && i.underlying === want && i.expiry >= today)
    .sort((a, b) => (a.expiry < b.expiry ? -1 : 1))[0] || null;
}

/** Spot ref: index token, or the NSE equity row for a stock. */
export async function spotRef(creds, symbol) {
  const want = String(symbol ?? "").toUpperCase();
  if (INDEX_SPOT[want]) return INDEX_SPOT[want];
  const eq = (await getMaster(creds, "NSE")).find((i) => i.instrumentType === "EQ" && i.underlying === want);
  return eq ? { exchange: "NSE", token: eq.token } : null;
}
