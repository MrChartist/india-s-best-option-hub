/**
 * Samco scrip master — the public CSV linked from the official docs home page
 * (https://docs-tradeapi.samco.in/ → "ScripMaster.csv"): https://developers.stocknote.com/doc/ScripMaster.csv
 *
 * Columns (header row of the live file, 2026-10):
 *   exchange,exchangeSegment,symbolCode,tradingSymbol,name,lastPrice,instrument,lotSize,strikePrice,expiryDate,tickSize
 *  - expiryDate is DD/MM/YY; strikePrice is blank for non-options; no field is quoted.
 *  - symbolCode is "<scripCode>_<exchange>" (e.g. "58534_NFO"); the quote APIs echo it back as `symbol`.
 *  - NFO uses instrument codes OPTIDX/FUTIDX/OPTSTK/FUTSTK; BFO uses IO (index options), IF (index futures),
 *    SO (stock options) and SF (stock futures). Index rows are NOT in the file: indices are quoted by name
 *    through /quote/indexQuote (names from the official index list, e.g. "NIFTY 50", "NIFTY BANK").
 *  - Place Order docs: symbolName is the `name` for cash equities and the `tradingSymbol` for every F&O contract.
 *
 * The file is public market data, so it is cached once a day and shared by every user (instrumentCache.mjs).
 * Only the rows this terminal can use are kept: NSE equities and every NFO/BFO derivative.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { brokerFetch, BrokerInputError } from "./contract.mjs";

export const SCRIP_MASTER_URL = "https://developers.stocknote.com/doc/ScripMaster.csv";

/** Canonical index -> where its derivatives live and the indexQuote name for its spot. */
export const INDEX = {
  NIFTY: { exchange: "NFO", name: "NIFTY", indexName: "NIFTY 50" },
  BANKNIFTY: { exchange: "NFO", name: "BANKNIFTY", indexName: "NIFTY BANK" },
  FINNIFTY: { exchange: "NFO", name: "FINNIFTY", indexName: "NIFTY FIN SERVICE" },
  MIDCPNIFTY: { exchange: "NFO", name: "MIDCPNIFTY", indexName: "NIFTY MID SELECT" },
  SENSEX: { exchange: "BFO", name: "SENSEX", indexName: "SENSEX" },
  BANKEX: { exchange: "BFO", name: "BANKEX", indexName: "BANKEX" },
};
const INDEX_BY_NAME = new Map(Object.entries(INDEX).map(([k, v]) => [`${v.exchange}|${v.name}`, k]));

const TYPE_OF = {
  "NFO|OPTIDX": "OPTIDX", "NFO|FUTIDX": "FUTIDX", "NFO|OPTSTK": "OPTSTK", "NFO|FUTSTK": "FUTSTK",
  "BFO|IO": "OPTIDX", "BFO|IF": "FUTIDX", "BFO|SO": "OPTSTK", "BFO|SF": "FUTSTK",
  "NSE|EQ": "EQ",
};

/** "27/10/26" -> "2026-10-27". */
export function samcoExpiryToIso(raw) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(raw ?? "").trim());
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
}

/** One CSV line -> contract Instrument (plus `symbolCode` and `name`), or null for rows we do not use. */
export function toInstrument(line) {
  const c = line.split(",");
  if (c.length < 11) return null;
  const [exchange, , symbolCode, tradingSymbol, name, , instrument, lotSize, strikePrice, expiryDate, tickSize] = c.map((s) => s.trim());
  const instrumentType = TYPE_OF[`${exchange}|${instrument}`];
  if (!instrumentType || !symbolCode || !tradingSymbol) return null;
  const isOpt = instrumentType === "OPTIDX" || instrumentType === "OPTSTK";
  const isDeriv = instrumentType !== "EQ";
  const isIndex = instrumentType === "OPTIDX" || instrumentType === "FUTIDX";
  const underlying = isIndex ? INDEX_BY_NAME.get(`${exchange}|${name}`) : name;
  if (!underlying) return null; // index derivative on an index we do not map (e.g. NIFTYNXT50 on NFO)
  const expiry = isDeriv ? samcoExpiryToIso(expiryDate) : null;
  if (isDeriv && !expiry) return null;
  const optionType = isOpt ? (tradingSymbol.endsWith("CE") ? "CE" : tradingSymbol.endsWith("PE") ? "PE" : null) : null;
  const strike = isOpt ? Number(strikePrice) : null;
  if (isOpt && (!optionType || !(strike > 0))) return null;
  return {
    token: symbolCode,
    exchange,
    tradingSymbol,
    underlying,
    instrumentType,
    expiry,
    strike,
    optionType,
    lotSize: Number(lotSize) > 0 ? Number(lotSize) : 1,
    tickSize: Number(tickSize) > 0 ? Number(tickSize) : 0.05,
    symbolCode,
    name,
  };
}

export function parseScripMaster(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const row = toInstrument(lines[i]);
    if (row) out.push(row);
  }
  return out;
}

async function download() {
  const res = await brokerFetch(SCRIP_MASTER_URL, { redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`Samco scrip master download failed (HTTP ${res.status})`);
  return parseScripMaster(await res.text());
}

/** Cached once a day, shared by every user: public market data. */
export function getInstruments() {
  return getCachedOrFetch("samco:scripmaster:v2", download, ONE_DAY_MS);
}

/** "nifty" / "NIFTY" -> { symbol, isIndex, exchange }. Stocks are any plain NSE symbol with NFO options. */
export function resolveUnderlying(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (INDEX[s]) return { symbol: s, isIndex: true, exchange: INDEX[s].exchange, indexName: INDEX[s].indexName };
  if (/^[A-Z0-9&-]{1,20}$/.test(s)) return { symbol: s, isIndex: false, exchange: "NFO", indexName: null };
  throw new BrokerInputError(`Samco: unknown symbol ${symbol}`);
}

/** Option rows for one underlying (all expiries). */
export async function optionRows(symbol) {
  const u = resolveUnderlying(symbol);
  const rows = await getInstruments();
  return rows.filter((r) => r.underlying === u.symbol && r.exchange === u.exchange && (r.instrumentType === "OPTIDX" || r.instrumentType === "OPTSTK"));
}

export function distinctExpiries(rows) {
  return Array.from(new Set(rows.map((r) => r.expiry))).sort();
}

/** Look an instrument up by its token (symbolCode). */
export async function findByToken(token) {
  const rows = await getInstruments();
  return rows.find((r) => r.token === String(token)) || null;
}
