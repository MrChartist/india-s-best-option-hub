/**
 * Axis Direct security master.
 *
 * Official source: the "Security Master" folder of the RAPID APIs Postman collection, which points at the public
 * file https://invest-static-assets.axisdirect.in/TELESCOPE/security_master_web/SecurityMaster.csv. Layout read
 * from the live file on 18 Oct 2026 (about 69 MB, ~193k rows, header row, RFC 4180 quoting in a few text
 * columns). Columns used:
 *   scriptid           the `scriptId` every trading and quote API takes (used as the contract token)
 *   exchange, segment  NSE/BSE + FO for derivatives, NSE + EQ for cash
 *   instrumenttype     OPTIDX, FUTIDX, OPTSTK, FUTSTK, Equity, Underlying (index spot rows)
 *   exchange_symbol    the root (NIFTY, SENSEX, RELIANCE ...)
 *   underlying         for derivatives, the scriptId of the underlying (9926000 = Nifty 50 spot)
 *   expirydate (YYYY-MM-DD), strikeprice, optiontype (CE/PE/XX), lotsize, ticksize, coname, exchange_series
 * Served: NSE + BSE index derivatives on the six canonical indices, their spot rows, NSE stock derivatives
 * and NSE cash (EQ series). BSE cash, debt, MCX and other indices are left out.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { readBodyCapped } from "../lib/safeArchive.mjs";
import { BrokerError, CANONICAL_UNDERLYINGS, brokerFetch } from "./contract.mjs";

export const MASTER_URL = "https://invest-static-assets.axisdirect.in/TELESCOPE/security_master_web/SecurityMaster.csv";

const INDEX_TYPES = new Set(["OPTIDX", "FUTIDX"]);
const STOCK_TYPES = new Set(["OPTSTK", "FUTSTK"]);
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Split one CSV line, honouring double-quoted fields ("" is an escaped quote). */
export function splitCsvLine(line) {
  if (!line.includes("\"")) return line.split(",");
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === "\"" && line[i + 1] === "\"") { cur += "\""; i++; }
      else if (ch === "\"") quoted = false;
      else cur += ch;
    } else if (ch === "\"") quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function exchangeOf(row) {
  const ex = String(row.exchange ?? "").toUpperCase();
  const seg = String(row.segment ?? "").toUpperCase();
  if (seg === "FO") return ex === "NSE" ? "NFO" : ex === "BSE" ? "BFO" : null;
  if (seg === "EQ" && ex === "NSE") return "NSE";
  if (seg === "EQ" && ex === "BSE" && String(row.instrumenttype ?? "").trim() === "Underlying") return "BSE"; // SENSEX / BANKEX spot
  return null;
}

/**
 * One raw master row -> contract Instrument, or null. Index spot rows ("Underlying") are returned with
 * instrumentType "INDEX" for the canonical indices only.
 */
export function toInstrument(row) {
  const exchange = exchangeOf(row);
  const token = String(row.scriptid ?? "").trim();
  if (!exchange || !token) return null;
  const type = String(row.instrumenttype ?? "").trim();
  const root = String(row.exchange_symbol ?? "").trim().toUpperCase();
  const lotSize = num(row.lotsize) || 1;
  const tickSize = num(row.ticksize) || 0.05;
  const name = String(row.coname ?? "").trim();
  if (exchange === "NSE" || exchange === "BSE") {
    if (type === "Underlying") {
      if (!CANONICAL_UNDERLYINGS.includes(root)) return null;
      return { token, exchange, tradingSymbol: name || root, underlying: root, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize };
    }
    if (exchange !== "NSE" || type !== "Equity" || String(row.exchange_series ?? "").trim().toUpperCase() !== "EQ") return null;
    return { token, exchange, tradingSymbol: root, underlying: root, instrumentType: "EQ", expiry: null, strike: null, optionType: null, lotSize, tickSize };
  }
  const isIndex = INDEX_TYPES.has(type);
  if (!isIndex && !STOCK_TYPES.has(type)) return null;
  if (isIndex && !CANONICAL_UNDERLYINGS.includes(root)) return null;
  if (!isIndex && exchange === "BFO") return null;
  const expiry = String(row.expirydate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const isOption = type.startsWith("OPT");
  const optionType = isOption ? String(row.optiontype ?? "").trim().toUpperCase() : null;
  const strike = isOption ? num(row.strikeprice) : null;
  if (isOption && ((optionType !== "CE" && optionType !== "PE") || !(strike > 0))) return null;
  return { token, exchange, tradingSymbol: name || root, underlying: root, instrumentType: type, expiry, strike, optionType, lotSize, tickSize };
}

/**
 * Parse the whole master into { instruments, spot } where spot maps an underlying (NIFTY, RELIANCE ...) to the
 * scriptId of its spot quote: the `underlying` column of its derivatives, else its NSE cash row.
 */
export function parseMaster(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.trim());
  if (headerAt < 0) return { instruments: [], spot: {} };
  const headers = splitCsvLine(lines[headerAt]).map((h) => h.trim().toLowerCase());
  const want = ["scriptid", "exchange", "segment", "instrumenttype", "exchange_symbol", "underlying", "expirydate", "strikeprice", "optiontype", "lotsize", "ticksize", "coname", "exchange_series"];
  const at = Object.fromEntries(want.map((k) => [k, headers.indexOf(k)]));
  if (at.scriptid < 0 || at.exchange < 0 || at.instrumenttype < 0) throw new BrokerError("Axis Direct security master: unexpected column layout.");
  const instruments = [];
  const spot = {};
  for (let i = headerAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = splitCsvLine(line);
    const row = {};
    for (const k of want) row[k] = at[k] >= 0 ? cols[at[k]] ?? "" : "";
    const inst = toInstrument(row);
    if (!inst) continue;
    instruments.push(inst);
    const und = String(row.underlying ?? "").trim();
    if (inst.instrumentType !== "EQ" && inst.instrumentType !== "INDEX" && und && !spot[inst.underlying]) spot[inst.underlying] = und;
  }
  for (const r of instruments) {
    if ((r.instrumentType === "INDEX" || r.instrumentType === "EQ") && !spot[r.underlying]) spot[r.underlying] = r.token;
  }
  return { instruments, spot };
}

/** The parsed master, cached for a day (shared download; public file, no session needed). */
export function loadMaster() {
  return getCachedOrFetch("axisdirect:master:v1", async () => {
    const res = await brokerFetch(MASTER_URL, { redirect: "follow" }, { kind: "master", label: "Axis Direct" });
    if (!res.ok) throw new BrokerError(`Axis Direct security master download failed (HTTP ${res.status}).`);
    return parseMaster((await readBodyCapped(res, { label: "Axis Direct security master" })).toString("utf8"));
  }, ONE_DAY_MS);
}
