/**
 * Tradejini scrip master (official docs, checked 2026-10: https://developer.tradejini.com/docs/symbol-details/versionDetails
 * and /docs/symbol-details/getSymbolDetails).
 *  - GET /api/mkt-data/scrips/symbol-store?version=0 -> d.symbolStore[] { name, idFormat }. Groups include Securities
 *    (instrument_symbol_series_exchange), FutureContracts (instrument_symbol_exchange_expiry), NSEOptions and
 *    BSEOptions (instrument_symbol_exchange_expiry_strike_optType) and Index (instrument_excToken_exchange).
 *  - GET /api/mkt-data/scrips/symbol-store/{group} with Accept: text/plain -> CSV. Live headers (2026-10):
 *      options/futures: id,dispName,excToken,lot,tick,asset,freezeQty,weekly,undId
 *      Index:           id,dispName,excToken,asset,symbol,availFlag
 *      Securities:      id,dispName,excToken,lot,tick,asset,freezeQty,isin,desc
 *    The `id` (symId, e.g. OPTIDX_NIFTY_NFO_2026-10-20_25000_CE) is what orders and chart data take; expiry inside it is
 *    ISO. The stream symbol is "<excToken>_<last id segment>" (WebSocket SDK docs, "Building Stream Symbols"), and index
 *    tokens are negative (IDX_-1_NSE -> "-1_NSE").
 * Both endpoints are public; the data changes once a day (BOD), so it is cached for a day and shared by every user.
 *
 * Contract Instrument.token is the symId (unique, and what orders need); `streamKey` carries the feed symbol.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { brokerFetch, BrokerInputError } from "./contract.mjs";
import { BASE_URL } from "./tradejiniAuth.mjs";

const GROUPS_URL = `${BASE_URL}/api/mkt-data/scrips/symbol-store`;
const DEFAULT_ID_FORMAT = {
  Securities: "instrument_symbol_series_exchange",
  FutureContracts: "instrument_symbol_exchange_expiry",
  NSEOptions: "instrument_symbol_exchange_expiry_strike_optType",
  BSEOptions: "instrument_symbol_exchange_expiry_strike_optType",
  Index: "instrument_excToken_exchange",
};
const GROUPS = Object.keys(DEFAULT_ID_FORMAT);
export const CANONICAL = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"]);
const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO"]);
const TYPES = new Set(["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"]);

export function parseCsv(text) {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const v = lines[i].split(",");
    if (v.length < headers.length) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = (v[j] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

/** Split a symId by its group's idFormat. */
export function splitId(id, idFormat) {
  const parts = String(id ?? "").split("_");
  const names = String(idFormat ?? "").split("_").filter(Boolean);
  if (!names.length || parts.length < names.length) return null;
  const out = {};
  names.forEach((n, i) => { out[n] = i === names.length - 1 ? parts.slice(i).join("_") : parts[i]; });
  return out;
}

/** One CSV row of a group -> contract Instrument (+ streamKey), or null. */
export function toInstrument(group, row, idFormat = DEFAULT_ID_FORMAT[group]) {
  const c = splitId(row.id, idFormat);
  if (!c || !row.excToken) return null;
  const exchange = String(c.exchange ?? "").toUpperCase();
  if (!EXCHANGES.has(exchange)) return null;
  const streamKey = `${row.excToken}_${exchange}`;
  const base = { token: row.id, exchange, lotSize: Number(row.lot) > 0 ? Number(row.lot) : 1, tickSize: Number(row.tick) > 0 ? Number(row.tick) : 0.05, streamKey };
  if (group === "Index") {
    const underlying = String(row.symbol || row.dispName || "").toUpperCase();
    return { ...base, tradingSymbol: row.dispName || underlying, underlying, instrumentType: "INDEX", expiry: null, strike: null, optionType: null };
  }
  if (group === "Securities") {
    if (c.instrument !== "EQT" || exchange !== "NSE" || c.series !== "EQ") return null;
    return { ...base, tradingSymbol: c.symbol, underlying: c.symbol, instrumentType: "EQ", expiry: null, strike: null, optionType: null };
  }
  const instrumentType = c.instrument;
  if (!TYPES.has(instrumentType) || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.expiry))) return null;
  const isIndex = instrumentType.endsWith("IDX");
  if (isIndex && !CANONICAL.has(c.symbol)) return null;
  const isOpt = instrumentType.startsWith("OPT");
  const strike = isOpt ? Number(c.strike) : null;
  const optionType = isOpt ? c.optType : null;
  if (isOpt && (!(strike > 0) || (optionType !== "CE" && optionType !== "PE"))) return null;
  return { ...base, tradingSymbol: row.dispName || row.id, underlying: c.symbol, instrumentType, expiry: c.expiry, strike, optionType };
}

async function fetchIdFormats() {
  const res = await brokerFetch(`${GROUPS_URL}?version=0`, { headers: { Accept: "application/json" }, redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`Tradejini scrip groups fetch failed: HTTP ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const map = { ...DEFAULT_ID_FORMAT };
  for (const g of json?.d?.symbolStore || []) if (g?.name && g.idFormat) map[g.name] = g.idFormat;
  return map;
}

async function fetchGroup(group, idFormat) {
  const res = await brokerFetch(`${GROUPS_URL}/${encodeURIComponent(group)}`, { headers: { Accept: "text/plain" }, redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`Tradejini scrip data fetch failed for ${group}: HTTP ${res.status}`);
  return parseCsv(await res.text()).map((r) => toInstrument(group, r, idFormat)).filter(Boolean);
}

async function downloadAll() {
  const formats = await fetchIdFormats();
  const out = [];
  for (const g of GROUPS) out.push(...(await fetchGroup(g, formats[g])));
  return out;
}

/** Every usable instrument (indices, NSE equities, NFO/BFO futures and options). Cached once a day. */
export function getInstruments() {
  return getCachedOrFetch("tradejini:instruments:v2", downloadAll, ONE_DAY_MS);
}

export function resolveUnderlying(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (CANONICAL.has(s)) return { symbol: s, isIndex: true };
  if (/^[A-Z0-9&-]{1,20}$/.test(s)) return { symbol: s, isIndex: false };
  throw new BrokerInputError(`Tradejini: unknown symbol ${symbol}`);
}

export async function optionRows(symbol) {
  const u = resolveUnderlying(symbol);
  const rows = await getInstruments();
  return rows.filter((r) => r.underlying === u.symbol && (r.instrumentType === "OPTIDX" || r.instrumentType === "OPTSTK"));
}

export function distinctExpiries(rows) {
  return Array.from(new Set(rows.map((r) => r.expiry))).sort();
}

/** The spot row for an index (Index group) or a stock (NSE EQ). */
export async function spotRow(symbol) {
  const u = resolveUnderlying(symbol);
  const rows = await getInstruments();
  const hit = rows.find((r) => r.underlying === u.symbol && r.instrumentType === (u.isIndex ? "INDEX" : "EQ"));
  if (!hit) throw new BrokerInputError(`Tradejini: no spot instrument for ${u.symbol}`);
  return hit;
}

export async function findByToken(token) {
  const rows = await getInstruments();
  return rows.find((r) => r.token === String(token)) || null;
}
