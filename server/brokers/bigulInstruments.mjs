/**
 * Bigul instrument master.
 *
 * Official source: https://connect.bigul.co/docs#master_download_main (checked 2026-10). The docs link one public
 * archive, https://bigul.s3.ap-south-1.amazonaws.com/BigulMasters/Bigulmastercsv.zip, refreshed daily before the open,
 * holding one CSV per segment: nse_cm.csv, bse_cm.csv, nse_fo.csv, bse_fo.csv, cde_fo.csv, mcx.csv. (The same data is
 * also served per segment by GET /bo/nse-equity, /bo/nse-deriv ... with the app key and secret; the anonymous archive is
 * used so no secret is sent for public data and one cached copy serves every user.) Only the four NSE/BSE files are
 * read.
 *  - Cash files: Exch,ScripCode,Name,Desc,TradingSymbol,TickSize,SERIES,MinimumLotQty,ISIN,... SERIES "EQ" rows are
 *    NSE equities (TradingSymbol "RELIANCE-EQ"); SERIES "INDEX" rows are indices, Name being the feed name
 *    ("Nifty 50" 26000, "Nifty Bank" 26009, "Nifty Fin Service" 26037, "NIFTY MID SELECT" 26074, "SENSEX" 1,
 *    "BANKEX" 12).
 *  - Derivative files: Exch,ScripCode,...,Name,ULToken,...,StrikePrice,...,TradingSymbol,PrevOI,SERIES,OPTION_TYPE,
 *    EXPIRY_DATE,...,LOTSIZE,...,TickSize. SERIES OPTIDX/FUTIDX/OPTSTK/FUTSTK on NSE and IO/IF/SO/SF on BSE ("SP-"
 *    rows are calendar spreads and are skipped). Index derivatives are named after the index ("NIFTY 50"), so the
 *    canonical underlying comes from ULToken. EXPIRY_DATE is "2026-10-27 14:30:00" (NSE) or "2026-10-29" (BSE); the
 *    docs' samples show it as seconds since 1980-01-01 instead, which is read too. TickSize is in paise.
 *  - Feed segments: nse_cm, bse_cm, nse_fo, bse_fo.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { listZipEntries, MAX_INFLATED_BYTES, readBodyCapped, readZipEntry } from "../lib/safeArchive.mjs";
import { brokerFetch, BrokerError, BrokerInputError, CANONICAL_UNDERLYINGS } from "./contract.mjs";

export const MASTER_URL = "https://bigul.s3.ap-south-1.amazonaws.com/BigulMasters/Bigulmastercsv.zip";
const LABEL = "Bigul instrument master";
const FILES = ["nse_cm.csv", "bse_cm.csv", "nse_fo.csv", "bse_fo.csv"];

export const SEGMENT_OF = { NSE: "nse_cm", BSE: "bse_cm", NFO: "nse_fo", BFO: "bse_fo" };
const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
const INDEX_BY_TOKEN = { "NSE|26000": "NIFTY", "NSE|26009": "BANKNIFTY", "NSE|26037": "FINNIFTY", "NSE|26074": "MIDCPNIFTY", "BSE|1": "SENSEX", "BSE|12": "BANKEX" };
const DERIV_TYPE = { OPTIDX: "OPTIDX", FUTIDX: "FUTIDX", OPTSTK: "OPTSTK", FUTSTK: "FUTSTK", IO: "OPTIDX", IF: "FUTIDX", SO: "OPTSTK", SF: "FUTSTK" };
const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
const EPOCH_1980_S = 315_532_800;
const IST_MS = 5.5 * 3600_000;

/** CSV text -> row objects keyed by the header names. Copes with quoted cells. */
export function parseCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const split = (line) => {
    const out = [];
    let cell = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { out.push(cell.trim()); cell = ""; }
      else cell += ch;
    }
    out.push(cell.trim());
    return out;
  };
  const head = split(lines[0] ?? "");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = split(lines[i]);
    const row = {};
    head.forEach((h, j) => { row[h] = cells[j] ?? ""; });
    rows.push(row);
  }
  return rows;
}

/** EXPIRY_DATE / ExpiryDate / Desc -> "YYYY-MM-DD", or null. */
export function bigulExpiryToIso(expiryDate, epochField, desc) {
  const s = String(expiryDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const secs = Number(/^\d{9,10}$/.test(s) ? s : epochField);
  if (Number.isFinite(secs) && secs > 1e8) return new Date((secs + EPOCH_1980_S) * 1000 + IST_MS).toISOString().slice(0, 10);
  const m = /\b(\d{2})([A-Z]{3})(\d{2})\b/.exec(String(desc ?? "").toUpperCase());
  return m && MONTHS[m[2]] ? `20${m[3]}-${MONTHS[m[2]]}-${m[1]}` : null;
}

const positive = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback);
const tickOf = (paise) => (Number(paise) > 0 ? Math.round(Number(paise)) / 100 : 0.05);

/** One cash-file row -> Instrument (+ segment and feed name), or null. */
export function cashRow(row, exchange) {
  const token = String(row.ScripCode ?? "").trim();
  if (!/^\d+$/.test(token)) return null;
  const series = String(row.SERIES ?? "").toUpperCase();
  const segment = SEGMENT_OF[exchange];
  if (series === "INDEX") {
    const underlying = INDEX_BY_TOKEN[`${exchange}|${token}`];
    if (!underlying) return null;
    const name = String(row.Name ?? "").trim();
    return { token, exchange, segment, feedName: name, tradingSymbol: name, underlying, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05 };
  }
  if (exchange !== "NSE" || series !== "EQ") return null;
  const tradingSymbol = String(row.TradingSymbol ?? "").trim();
  const underlying = String(row.Name ?? "").trim().toUpperCase() || tradingSymbol.replace(/-EQ$/, "");
  if (!tradingSymbol) return null;
  return { token, exchange, segment, tradingSymbol, underlying, instrumentType: "EQ", expiry: null, strike: null, optionType: null, lotSize: positive(row.MinimumLotQty, 1), tickSize: tickOf(row.TickSize) };
}

/** One derivative-file row -> Instrument (+ segment and previous OI), or null. */
export function derivRow(row, exchange) {
  const token = String(row.ScripCode ?? "").trim();
  const instrumentType = DERIV_TYPE[String(row.SERIES ?? "").toUpperCase()];
  if (!/^\d+$/.test(token) || !instrumentType) return null;
  const cash = exchange === "NFO" ? "NSE" : "BSE";
  const isIndex = instrumentType.endsWith("IDX");
  const underlying = isIndex ? INDEX_BY_TOKEN[`${cash}|${String(row.ULToken ?? "").trim()}`] : String(row.Name ?? "").trim().toUpperCase();
  if (!underlying || (isIndex && !CANONICAL.has(underlying))) return null;
  const expiry = bigulExpiryToIso(row.EXPIRY_DATE, row.ExpiryDate, row.Desc);
  if (!expiry) return null;
  const isOpt = instrumentType.startsWith("OPT");
  const optionType = isOpt ? String(row.OPTION_TYPE ?? "").toUpperCase() : null;
  const strike = isOpt ? Number(row.StrikePrice) : null;
  if (isOpt && (!(strike > 0) || (optionType !== "CE" && optionType !== "PE"))) return null;
  const prevOi = Number(row.PrevOI ?? row.OI_PREV);
  return {
    token, exchange, segment: SEGMENT_OF[exchange], tradingSymbol: String(row.TradingSymbol ?? "").trim() || token,
    underlying, instrumentType, expiry, strike, optionType,
    lotSize: positive(row.LOTSIZE, positive(row.MinimumLotQuantity, 1)), tickSize: tickOf(row.TickSize),
    ...(prevOi > 0 ? { prevOi } : {}),
  };
}

/** The four NSE/BSE CSVs of the master archive, keyed by file name. Only those entries are inflated. */
export function readMasterArchive(buf) {
  const out = new Map();
  let budget = MAX_INFLATED_BYTES;
  for (const entry of listZipEntries(buf, { label: LABEL })) {
    const name = entry.name.toLowerCase().split("/").pop();
    if (!FILES.includes(name)) continue;
    const bytes = readZipEntry(buf, entry, { label: LABEL, maxBytes: budget });
    budget -= bytes.length;
    out.set(name, bytes.toString("utf8"));
  }
  return out;
}

/** Archive buffer -> Instrument rows. */
export function parseMaster(buf) {
  const files = readMasterArchive(buf);
  if (!files.has("nse_fo.csv")) throw new BrokerError(`${LABEL}: nse_fo.csv is missing from the archive`);
  const out = [];
  const add = (file, fn, exchange) => {
    for (const row of parseCsv(files.get(file) || "")) {
      const inst = fn(row, exchange);
      if (inst) out.push(inst);
    }
  };
  add("nse_cm.csv", cashRow, "NSE");
  add("bse_cm.csv", cashRow, "BSE");
  add("nse_fo.csv", derivRow, "NFO");
  add("bse_fo.csv", derivRow, "BFO");
  return out;
}

async function download() {
  const res = await brokerFetch(MASTER_URL, { redirect: "follow" }, { kind: "master", label: "Bigul" });
  if (!res.ok) throw new BrokerError(`Bigul instrument master download failed (HTTP ${res.status})`);
  return parseMaster(await readBodyCapped(res, { label: LABEL }));
}

/** Cached once a day and shared by every user (public data, no credentials involved). */
export function getInstruments() {
  return getCachedOrFetch("bigul:master:v1", download, ONE_DAY_MS);
}

export function resolveUnderlying(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (CANONICAL.has(s)) return { symbol: s, isIndex: true };
  if (/^[A-Z0-9&-]{1,20}$/.test(s)) return { symbol: s, isIndex: false };
  throw new BrokerInputError(`Bigul: unknown symbol ${symbol}`);
}

export async function optionRows(symbol) {
  const u = resolveUnderlying(symbol);
  const exchange = u.symbol === "SENSEX" || u.symbol === "BANKEX" ? "BFO" : "NFO";
  return (await getInstruments()).filter((r) => r.underlying === u.symbol && r.exchange === exchange && r.optionType);
}

export const distinctExpiries = (rows) => [...new Set(rows.map((r) => r.expiry))].sort();

/** Index row for the six canonical indices, the NSE equity row otherwise. */
export async function spotRow(symbol) {
  const u = resolveUnderlying(symbol);
  const hit = (await getInstruments()).find((r) => r.underlying === u.symbol && r.instrumentType === (u.isIndex ? "INDEX" : "EQ"));
  if (!hit) throw new BrokerInputError(`Bigul: no spot instrument for ${u.symbol}`);
  return hit;
}

export async function findByRef(ref) {
  const token = String(ref?.token ?? "");
  const exchange = String(ref?.exchange ?? "").toUpperCase();
  return (await getInstruments()).find((r) => r.token === token && (!exchange || r.exchange === exchange)) || null;
}

/** Master row for a broker trading symbol in a feed segment ("nse_fo"), or null. */
export async function findBySymbol(segment, tradingSymbol) {
  const sym = String(tradingSymbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  return (await getInstruments()).find((r) => r.segment === segment && r.tradingSymbol.toUpperCase() === sym) || null;
}

/** Strip the internal fields before handing rows out as contract Instruments. */
export const toContractInstrument = ({ segment: _s, feedName: _f, prevOi: _p, ...r }) => r;
