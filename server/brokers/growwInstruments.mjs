/**
 * Groww instrument master (official docs: https://groww.in/trade-api/docs/curl/instruments).
 *
 * Public CSV, no auth: https://growwapi-assets.groww.in/instruments/instrument.csv
 * Documented columns: exchange, exchange_token, trading_symbol, groww_symbol, name, instrument_type
 * (EQ | IDX | FUT | CE | PE), segment (CASH | FNO; the live file also carries COMMODITY, which the
 * API does not trade), series, isin, underlying_symbol, underlying_exchange_token, expiry_date
 * (YYYY-MM-DD), strike_price, lot_size, tick_size, freeze_quantity, is_reserved, buy_allowed, sell_allowed.
 * Columns are read by header name, so extra columns are ignored.
 *
 * Index rows (instrument_type IDX, segment CASH) use the index name as trading_symbol: NIFTY, BANKNIFTY,
 * FINNIFTY, NIFTYMIDSELECT (Nifty Midcap Select), SENSEX, BANKEX. Index options use underlying_symbol
 * NIFTY / BANKNIFTY / FINNIFTY / MIDCPNIFTY / SENSEX / BANKEX. Groww symbols look like NSE-NIFTY,
 * NSE-NIFTY-27Oct26-25000-CE (Backtesting page), used by the historical-candles endpoint.
 */

import { brokerFetch, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

export const INSTRUMENTS_CSV_URL = "https://growwapi-assets.groww.in/instruments/instrument.csv";

/** Index trading_symbol in the CASH segment for each canonical underlying (the spot quote). */
export const INDEX_SPOT_SYMBOL = {
  NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY", MIDCPNIFTY: "NIFTYMIDSELECT", SENSEX: "SENSEX", BANKEX: "BANKEX",
};
export const INDEX_EXCHANGE = { NIFTY: "NSE", BANKNIFTY: "NSE", FINNIFTY: "NSE", MIDCPNIFTY: "NSE", SENSEX: "BSE", BANKEX: "BSE" };
const CANONICAL_OF_INDEX_SYMBOL = Object.fromEntries(Object.entries(INDEX_SPOT_SYMBOL).map(([k, v]) => [v, k]));
const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
// Index derivatives outside the six canonical underlyings (e.g. NIFTYNXT50, SENSEX50) are left out.
const OTHER_INDEX_UNDERLYING = /^(NIFTY|SENSEX|BANKEX|FINNIFTY|MIDCPNIFTY)/;

/** RFC 4180-ish line splitter (quoted fields may hold commas). */
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    head.forEach((h, i) => { row[h] = (cols[i] ?? "").trim(); });
    return row;
  });
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * One CSV row -> a compact master row, or null when it is outside what this adapter trades.
 * { exchange (contract), growwExchange, segment, token, tradingSymbol, growwSymbol, instrumentType,
 *   underlying, expiry, strike, optionType, lotSize, tickSize, isin }
 */
export function toMasterRow(r) {
  const growwExchange = r.exchange;
  if (growwExchange !== "NSE" && growwExchange !== "BSE") return null;
  const type = r.instrument_type;
  const base = {
    growwExchange,
    token: r.exchange_token,
    tradingSymbol: r.trading_symbol,
    growwSymbol: r.groww_symbol || null,
    isin: r.isin && r.isin !== "NaN" ? r.isin : null,
  };
  if (!base.token || !base.tradingSymbol) return null;
  const lot = num(r.lot_size);
  const tick = num(r.tick_size);
  if (r.segment === "CASH" && type === "IDX") {
    return { ...base, exchange: growwExchange, segment: "CASH", instrumentType: "INDEX",
      underlying: CANONICAL_OF_INDEX_SYMBOL[r.trading_symbol] ?? r.trading_symbol, expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05 };
  }
  if (r.segment === "CASH" && type === "EQ") {
    return { ...base, exchange: growwExchange, segment: "CASH", instrumentType: "EQ", underlying: r.trading_symbol,
      expiry: null, strike: null, optionType: null, lotSize: lot > 0 ? lot : 1, tickSize: tick > 0 ? tick : 0.05 };
  }
  if (r.segment !== "FNO" || !["CE", "PE", "FUT"].includes(type)) return null;
  const underlying = r.underlying_symbol;
  const isIndex = CANONICAL.has(underlying);
  if (!isIndex && OTHER_INDEX_UNDERLYING.test(underlying)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.expiry_date) || !(lot > 0)) return null;
  const isOpt = type !== "FUT";
  const strike = num(r.strike_price);
  if (isOpt && !(strike > 0)) return null;
  return {
    ...base,
    exchange: growwExchange === "NSE" ? "NFO" : "BFO",
    segment: "FNO",
    instrumentType: isOpt ? (isIndex ? "OPTIDX" : "OPTSTK") : (isIndex ? "FUTIDX" : "FUTSTK"),
    underlying,
    expiry: r.expiry_date,
    strike: isOpt ? strike : null,
    optionType: isOpt ? type : null,
    lotSize: lot,
    tickSize: tick > 0 ? tick : 0.05,
  };
}

/** Contract Instrument from a master row. */
export function toInstrument(m) {
  return {
    token: String(m.token), exchange: m.exchange, tradingSymbol: m.tradingSymbol, underlying: m.underlying,
    instrumentType: m.instrumentType, expiry: m.expiry, strike: m.strike, optionType: m.optionType, lotSize: m.lotSize, tickSize: m.tickSize,
  };
}

async function download() {
  const res = await brokerFetch(INSTRUMENTS_CSV_URL, { redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`Groww instrument master download failed (HTTP ${res.status})`);
  const rows = parseCsv(await res.text()).map(toMasterRow).filter(Boolean);
  if (!rows.length) throw new Error("Groww instrument master had no usable rows");
  return rows;
}

/** Daily-cached master rows (public data, shared by every user). */
export function getMaster() {
  return getCachedOrFetch("groww:master:v2", download, ONE_DAY_MS);
}

/** Option rows of one underlying (canonical index or stock symbol), all expiries. */
export function optionRows(master, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  return master.filter((m) => m.underlying === u && (m.instrumentType === "OPTIDX" || m.instrumentType === "OPTSTK"));
}

export function listExpiries(master, symbol) {
  return [...new Set(optionRows(master, symbol).map((m) => m.expiry))].sort();
}

/** The CASH row to quote for a symbol's spot (index or stock), or null. */
export function spotRow(master, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  if (INDEX_SPOT_SYMBOL[u]) {
    return master.find((m) => m.instrumentType === "INDEX" && m.growwExchange === INDEX_EXCHANGE[u] && m.tradingSymbol === INDEX_SPOT_SYMBOL[u]) || null;
  }
  return master.find((m) => m.instrumentType === "EQ" && m.growwExchange === "NSE" && m.tradingSymbol === u) || null;
}

/** Master row for a contract InstrumentRef { token, exchange }. */
export function findByRef(master, ref) {
  const token = String(ref?.token ?? "");
  return master.find((m) => m.exchange === ref?.exchange && String(m.token) === token)
    // An index ref may arrive with exchange NSE/BSE and the index name as token.
    || master.find((m) => m.instrumentType === "INDEX" && m.growwExchange === ref?.exchange && String(m.token) === token)
    || null;
}

export function findBySymbol(master, exchange, tradingSymbol) {
  return master.find((m) => m.exchange === exchange && m.tradingSymbol === tradingSymbol) || null;
}
