/**
 * Rupeezy (Vortex) instrument master.
 *
 * Official docs: https://vortex.rupeezy.in/docs/latest/instrument-list/ (checked 2026-10). The file
 * https://static.rupeezy.in/master.csv is public, refreshed every morning (download after 8:30 AM) and carries:
 *   token, exchange (NSE_EQ | BSE_EQ | NSE_FO | BSE_FO | MCX_FO), symbol, instrument_name (EQIDX, EQUITIES,
 *   OPTIDX, OPTSTK, FUTIDX, FUTSTK, ...), series, expiry_date (YYYYMMDD), option_type, strike_price (rupees),
 *   tick (paise: 5 = Rs 0.05), lot_size, eligibility, security_desc, ..., ticker ("NSE:NIFTY26JUL25000CE").
 * Indices sit on NSE_EQ / BSE_EQ with instrument_name EQIDX: NIFTY 26000, BANKNIFTY 26009, FINNIFTY 26037,
 * MIDCPNIFTY 26074 (NSE_EQ), SENSEX 19000 and BANKEX 19012 (BSE_EQ).
 * Every Vortex call that names an instrument accepts `exchange` + `token`, so that pair is the contract token.
 */

import { BrokerError, BrokerInputError, CANONICAL_UNDERLYINGS, brokerFetch } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { readBodyCapped } from "../lib/safeArchive.mjs";

export const MASTER_URL = "https://static.rupeezy.in/master.csv";

/** Vortex exchange code <-> contract exchange. */
export const CONTRACT_EXCHANGE = Object.freeze({ NSE_EQ: "NSE", BSE_EQ: "BSE", NSE_FO: "NFO", BSE_FO: "BFO" });
export const VORTEX_EXCHANGE = Object.freeze({ NSE: "NSE_EQ", BSE: "BSE_EQ", NFO: "NSE_FO", BFO: "BSE_FO" });

/** Index spot instruments (exchange + token) as listed in the master. */
export const INDEX_SPOT = Object.freeze({
  NIFTY: { exchange: "NSE_EQ", token: "26000" },
  BANKNIFTY: { exchange: "NSE_EQ", token: "26009" },
  FINNIFTY: { exchange: "NSE_EQ", token: "26037" },
  MIDCPNIFTY: { exchange: "NSE_EQ", token: "26074" },
  SENSEX: { exchange: "BSE_EQ", token: "19000" },
  BANKEX: { exchange: "BSE_EQ", token: "19012" },
});
const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
const DERIVATIVES = new Set(["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"]);

/** Plain comma split: the master has no quoted fields. */
export function parseMasterCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const head = (lines.shift() ?? "").split(",").map((h) => h.trim());
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    const cols = line.split(",");
    const row = {};
    head.forEach((h, i) => { row[h] = (cols[i] ?? "").trim(); });
    out.push(row);
  }
  return out;
}

/** "20261027" -> "2026-10-27"; null otherwise. */
export function expiryIso(raw) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(raw ?? "").trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const tickOf = (paise) => {
  const t = Number(paise) / 100;
  return t > 0 ? t : 0.05;
};

/** One master row -> contract Instrument plus `vortexExchange`, or null when it is outside what this adapter serves. */
export function toInstrument(r) {
  const vortexExchange = r.exchange;
  const exchange = CONTRACT_EXCHANGE[vortexExchange];
  const token = String(r.token ?? "");
  const type = String(r.instrument_name ?? "").toUpperCase();
  if (!exchange || !/^\d+$/.test(token)) return null;
  const symbol = String(r.symbol ?? "").toUpperCase();
  const base = { token, vortexExchange, exchange };
  if (type === "EQIDX") {
    if (!CANONICAL.has(symbol) || INDEX_SPOT[symbol].token !== token) return null;
    return { ...base, tradingSymbol: symbol, underlying: symbol, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: tickOf(r.tick) };
  }
  if (type === "EQUITIES") {
    if (vortexExchange !== "NSE_EQ" || !["EQ", "BE"].includes(r.series) || !symbol) return null;
    return { ...base, tradingSymbol: symbol, underlying: symbol, instrumentType: "EQ", expiry: null, strike: null, optionType: null, lotSize: Math.max(1, Number(r.lot_size) || 1), tickSize: tickOf(r.tick) };
  }
  if (!DERIVATIVES.has(type)) return null;
  const isIndex = type.endsWith("IDX");
  if (isIndex && !CANONICAL.has(symbol)) return null; // NIFTYNXT50, SENSEX50, ...
  if (!isIndex && vortexExchange !== "NSE_FO") return null; // BSE stock derivatives are not served
  const expiry = expiryIso(r.expiry_date);
  const lotSize = Number(r.lot_size);
  if (!expiry || !(lotSize > 0)) return null;
  const isOpt = type.startsWith("OPT");
  const optionType = isOpt ? String(r.option_type).toUpperCase() : null;
  const strike = isOpt ? Number(r.strike_price) : null;
  if (isOpt && ((optionType !== "CE" && optionType !== "PE") || !(strike > 0))) return null;
  return { ...base, tradingSymbol: r.security_desc || symbol, underlying: symbol, instrumentType: type, expiry, strike, optionType, lotSize, tickSize: tickOf(r.tick) };
}

async function download() {
  const res = await brokerFetch(MASTER_URL, { redirect: "follow" }, { kind: "master", label: "Rupeezy" });
  if (!res.ok) throw new BrokerError(`Rupeezy instrument master download failed (HTTP ${res.status})`);
  const text = (await readBodyCapped(res, { label: "Rupeezy instrument master" })).toString("utf8");
  return parseMasterCsv(text).map(toInstrument).filter(Boolean);
}

/** Daily-cached master rows (public reference data shared by every user). */
export function getMaster() {
  return getCachedOrFetch("rupeezy:master:v1", download, ONE_DAY_MS);
}

export function optionRows(master, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  return master.filter((m) => m.underlying === u && m.optionType);
}

export function listExpiries(master, symbol) {
  return [...new Set(optionRows(master, symbol).map((m) => m.expiry))].sort();
}

/** Spot { exchange (Vortex), token } for an index or an NSE stock. */
export function spotOf(master, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  if (INDEX_SPOT[u]) return INDEX_SPOT[u];
  const eq = master.find((m) => m.instrumentType === "EQ" && m.underlying === u);
  if (!eq) throw new BrokerInputError(`Rupeezy: no index or NSE stock named ${symbol}`);
  return { exchange: eq.vortexExchange, token: eq.token };
}

/** Contract InstrumentRef -> Vortex { exchange, token }, or a BrokerInputError. */
export function vortexRef(ref) {
  const exchange = VORTEX_EXCHANGE[ref?.exchange];
  const token = String(ref?.token ?? "");
  if (!exchange || !/^\d{1,10}$/.test(token)) throw new BrokerInputError(`Rupeezy: unsupported instrument ${ref?.exchange}:${ref?.token}`);
  return { exchange, token };
}
