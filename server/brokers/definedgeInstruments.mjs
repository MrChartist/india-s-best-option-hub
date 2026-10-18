/**
 * Definedge Securities (Integrate API) instrument masters and symbol mapping.
 *
 * Masters are public daily ZIPs (no auth): https://app.definedgesecurities.com/public/<segment>.zip
 * (allmaster.zip in Definedge's pyintegrate client; per-segment nsefno.zip, bsefno.zip, nsecash.zip, bsecash.zip).
 * Each holds one headerless CSV, columns (pyintegrate connect.py `symbols`):
 *   0 Exchange(segment) 1 Token 2 Symbol 3 TradingSymbol 4 InstrumentType 5 Expiry(DDMMYYYY) 6 TickSize
 *   7 LotSize 8 OptionType 9 Strike 10 PricePrecision 11 Multiplier 12 ISIN 13 PriceMult 14 Company
 * Strike in rupees = Strike / (Multiplier * 10^PricePrecision) (pyintegrate). TickSize is in paise
 * (OpenAlgo divides by 100; pyintegrate leaves it raw), converted here as TickSize / 10^PricePrecision.
 * Segment codes: NSE, BSE, NFO, BFO, CDS, MCX. Instrument types: OPTIDX, OPTSTK, FUTIDX, FUTSTK, EQ, ...
 *
 * Index spot tokens are the exchanges' own index tokens (Nifty 50 26000, Nifty Bank 26009, Nifty Fin Service
 * 26037, NIFTY MID SELECT 26074 on NSE; SENSEX 1 and BANKEX 12 on BSE), as listed in nsecash/bsecash.
 */

import { BrokerError, brokerFetch, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { listZipEntries, readBodyCapped, readZipEntry } from "../lib/safeArchive.mjs";

export const MASTER_URLS = Object.freeze({
  NFO: "https://app.definedgesecurities.com/public/nsefno.zip",
  BFO: "https://app.definedgesecurities.com/public/bsefno.zip",
  NSE: "https://app.definedgesecurities.com/public/nsecash.zip",
});

export const SPOT_INDEX = Object.freeze({
  NIFTY: { exchange: "NSE", token: "26000" },
  BANKNIFTY: { exchange: "NSE", token: "26009" },
  FINNIFTY: { exchange: "NSE", token: "26037" },
  MIDCPNIFTY: { exchange: "NSE", token: "26074" },
  SENSEX: { exchange: "BSE", token: "1" },
  BANKEX: { exchange: "BSE", token: "12" },
});

const BSE_UNDERLYINGS = new Set(["SENSEX", "BANKEX"]);
const DERIVATIVE_TYPES = new Set(["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"]);

/** Which derivative segment an app symbol's contracts live in. */
export const optionSegment = (symbol) => (BSE_UNDERLYINGS.has(String(symbol).toUpperCase()) ? "BFO" : "NFO");

/** The first file in a ZIP archive, as text (stored or deflated; bounds-checked and size-capped in safeArchive). */
export function unzipFirstFile(buf) {
  const [first] = listZipEntries(buf, { label: "Definedge master" });
  if (!first) throw new BrokerError("Definedge master: ZIP archive has no entries");
  return readZipEntry(buf, first, { label: "Definedge master" }).toString("utf-8");
}

/** Master bytes -> CSV text (a ZIP starts with "PK"; a plain CSV is accepted too). */
export function masterText(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b ? unzipFirstFile(b) : b.toString("utf-8");
}

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** "20102026" -> "2026-10-20". */
export function ddmmyyyyToIso(raw) {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(String(raw ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** One CSV line -> a compact row, or null when not usable. */
export function parseMasterLine(line) {
  const c = line.split(",");
  if (c.length < 12) return null;
  const prec = Number.isFinite(toNum(c[10])) ? toNum(c[10]) : 2;
  const mult = toNum(c[11]) > 0 ? toNum(c[11]) : 1;
  const rawTick = toNum(c[6]);
  return {
    exchange: c[0].trim(),
    token: c[1].trim(),
    symbol: c[2].trim().toUpperCase(),
    tradingSymbol: c[3].trim(),
    instrumentType: c[4].trim().toUpperCase(),
    expiry: ddmmyyyyToIso(c[5]),
    tickSize: rawTick > 0 ? (String(c[6]).includes(".") ? rawTick : rawTick / 10 ** prec) : 0.05,
    lotSize: toNum(c[7]) > 0 ? toNum(c[7]) : 1,
    optionType: c[8].trim().toUpperCase(),
    strike: toNum(c[9]) / (mult * 10 ** prec),
    isin: (c[12] || "").trim(),
  };
}

/** Derivative rows from an NFO/BFO master text. */
export function parseDerivativeMaster(text) {
  const out = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line) continue;
    const r = parseMasterLine(line);
    if (!r || !DERIVATIVE_TYPES.has(r.instrumentType) || !r.expiry || !r.token) continue;
    if (r.instrumentType.startsWith("OPT") && (!(r.strike > 0) || (r.optionType !== "CE" && r.optionType !== "PE"))) continue;
    out.push(r);
  }
  return out;
}

/** "<SYMBOL>-EQ" token map from the NSE cash master. */
export function parseCashMaster(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line) continue;
    const r = parseMasterLine(line);
    if (r && /-EQ$/.test(r.tradingSymbol)) out[r.tradingSymbol] = r.token;
  }
  return out;
}

async function download(segment) {
  let res;
  try {
    res = await brokerFetch(MASTER_URLS[segment], { redirect: "follow" }, { kind: "master" });
  } catch (e) {
    throw new BrokerError(`Definedge ${segment} master download failed: ${e?.message || e}`);
  }
  if (!res.ok) throw new BrokerError(`Definedge ${segment} master download failed (HTTP ${res.status})`);
  return masterText(await readBodyCapped(res, { label: `Definedge ${segment} master` }));
}

/** Derivative rows of one segment (NFO | BFO), cached a day for every user (public file). */
export function getDerivativeRows(segment) {
  return getCachedOrFetch(`definedge:master:${segment}:v2`, async () => parseDerivativeMaster(await download(segment)), ONE_DAY_MS);
}

/** NSE "<SYM>-EQ" -> token, cached a day. */
export function getCashTokens() {
  return getCachedOrFetch("definedge:master:NSE-EQ:v2", async () => parseCashMaster(await download("NSE")), ONE_DAY_MS);
}

/** Option rows of one underlying, across expiries. */
export async function getOptionRows(symbol) {
  const s = String(symbol || "").toUpperCase();
  const rows = await getDerivativeRows(optionSegment(s));
  return rows.filter((r) => r.symbol === s && r.instrumentType.startsWith("OPT"));
}

/** Distinct ISO expiries, ascending. */
export function distinctExpiriesAscending(rows) {
  return [...new Set(rows.map((r) => r.expiry).filter(Boolean))].sort();
}

/** Where to read an underlying's spot: index token, or the NSE cash "<SYM>-EQ" token. */
export async function spotRef(symbol) {
  const s = String(symbol || "").toUpperCase();
  if (SPOT_INDEX[s]) return SPOT_INDEX[s];
  const tokens = await getCashTokens();
  const token = tokens[`${s}-EQ`];
  return token ? { exchange: "NSE", token: String(token) } : null;
}

/** Master row -> contract Instrument, or null (non-canonical index derivatives). */
export function toInstrument(r) {
  const isIndex = r.instrumentType === "OPTIDX" || r.instrumentType === "FUTIDX";
  if (isIndex && !CANONICAL_UNDERLYINGS.includes(r.symbol)) return null;
  if (r.exchange !== "NFO" && r.exchange !== "BFO") return null;
  const isOpt = r.instrumentType.startsWith("OPT");
  return {
    token: r.token,
    exchange: r.exchange,
    tradingSymbol: r.tradingSymbol,
    underlying: r.symbol,
    instrumentType: r.instrumentType,
    expiry: r.expiry,
    strike: isOpt ? r.strike : null,
    optionType: isOpt ? r.optionType : null,
    lotSize: r.lotSize,
    tickSize: r.tickSize,
  };
}

/** The canonical index spots as contract Instruments. */
export function indexInstruments() {
  return Object.entries(SPOT_INDEX).map(([name, s]) => ({
    token: s.token, exchange: s.exchange, tradingSymbol: name, underlying: name, instrumentType: "INDEX",
    expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05,
  }));
}
