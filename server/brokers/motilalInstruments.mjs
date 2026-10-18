/**
 * Motilal Oswal instrument masters (public CSVs) and lookups.
 *
 * Official docs: https://invest.motilaloswal.com/moAPI/APIDocumentation/Introduction, sections "Scrip/Instrument (CSV
 * Format)" and "INDEX DATA (CSV Format)" (checked 2026-10):
 *   GET https://openapi.motilaloswal.com/getscripmastercsv?name=<exchangename>   (NSE, BSE, NSEFO, BSEFO, NSECD, MCX)
 *     columns: exchange, exchangename, scripcode, scripname, marketlot, scripshortname, issuspended, instrumentname,
 *     expirydate, strikeprice, optiontype, markettype, foexposurepercent, ticksize, scripisinno, indicesidentifier,
 *     isbanscrip, scripfullname, facevalue, calevel, maxqtyperorder
 *     scripname embeds the expiry as DD-Mon-YYYY ("BANKNIFTY 03-Feb-2022 PE 32300"); expirydate is seconds from
 *     1980-01-01 IST (1328365800 -> 03-Feb-2022 14:30 IST), so the scripname date is used.
 *   GET https://openapi.motilaloswal.com/getindexdatacsv?name=NSE|BSE  -> exchangename, indexcode, indexname
 *     ("BSE BANKEX" 999912 in the doc sample).
 * BSEFO lists SENSEX and BANKEX derivatives under the house codes BSX and BKX (OpenAlgo documents this; the official
 * page shows NSEFO samples only).
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { BrokerError, brokerFetch, BrokerInputError, CANONICAL_UNDERLYINGS } from "./contract.mjs";

const OPTION_MASTER_URL = "https://openapi.motilaloswal.com/getscripmastercsv";
const INDEX_MASTER_URL = "https://openapi.motilaloswal.com/getindexdatacsv";

const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
const STOCK_RE = /^[A-Z0-9&-]{1,20}$/;
/** F&O file + Motilal scripshortname for each canonical index. Stocks use NSEFO with their own symbol. */
const INDEX_FO = {
  NIFTY: { foName: "NSEFO", short: "NIFTY" },
  BANKNIFTY: { foName: "NSEFO", short: "BANKNIFTY" },
  FINNIFTY: { foName: "NSEFO", short: "FINNIFTY" },
  MIDCPNIFTY: { foName: "NSEFO", short: "MIDCPNIFTY" },
  SENSEX: { foName: "BSEFO", short: "BSX" },
  BANKEX: { foName: "BSEFO", short: "BKX" },
};
const SHORT_TO_CANONICAL = { BSX: "SENSEX", BKX: "BANKEX" };
/** Index-master names (upper-cased, whitespace removed) for each canonical index. */
const INDEX_ALIASES = {
  NIFTY: { csv: "NSE", aliases: ["NIFTY50", "NIFTY"] },
  BANKNIFTY: { csv: "NSE", aliases: ["NIFTYBANK", "BANKNIFTY"] },
  FINNIFTY: { csv: "NSE", aliases: ["NIFTYFINSERVICE", "NIFTYFINSERV", "FINNIFTY"] },
  MIDCPNIFTY: { csv: "NSE", aliases: ["NIFTYMIDSELECT", "NIFTYMIDCAPSELECT", "MIDCPNIFTY"] },
  SENSEX: { csv: "BSE", aliases: ["SENSEX", "BSESENSEX"] },
  BANKEX: { csv: "BSE", aliases: ["BSEBANKEX", "BANKEX"] },
};

export function assertSymbol(symbol) {
  const s = String(symbol ?? "").toUpperCase();
  if (!CANONICAL.has(s) && !STOCK_RE.test(s)) throw new BrokerInputError(`Unknown symbol for Motilal Oswal: ${symbol}`);
  return s;
}

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "NIFTY 20-Oct-2026 CE 25000" -> "2026-10-20". */
export function expiryFromScripname(scripname) {
  for (const part of String(scripname ?? "").split(/\s+/)) {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(part);
    if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function splitCsvLine(line) {
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
  const lines = String(text).split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const f = splitCsvLine(line);
    const row = {};
    header.forEach((h, j) => { row[h] = (f[j] ?? "").trim(); });
    return row;
  });
}

async function downloadCsv(url) {
  const res = await brokerFetch(url, { redirect: "follow" }, { kind: "master" });
  const text = await res.text();
  if (!res.ok) throw new BrokerError(`Motilal Oswal CSV download failed [HTTP ${res.status}] (${url})`);
  return parseCsv(text);
}

/** Compact F&O rows (options + futures) of one F&O master. */
export function compactFo(rows, foName) {
  const out = [];
  for (const r of rows) {
    const inst = String(r.instrumentname || "").toUpperCase();
    if (!["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].includes(inst)) continue;
    const opt = inst.startsWith("OPT");
    const optType = String(r.optiontype || "").toUpperCase();
    if (opt && optType !== "CE" && optType !== "PE") continue;
    const expiry = expiryFromScripname(r.scripname);
    const token = String(r.scripcode || "");
    const short = String(r.scripshortname || "").toUpperCase();
    const strike = opt ? Number(r.strikeprice) : null;
    if (!expiry || !/^\d+$/.test(token) || !short || (opt && !(strike > 0))) continue;
    out.push({
      token, short, root: SHORT_TO_CANONICAL[short] ?? short, instType: inst, expiry, strike,
      optType: opt ? optType : null, exchangename: r.exchangename || foName, scripname: r.scripname,
      lotSize: Number(r.marketlot) || 1, tickSize: Number(r.ticksize) || 0.05,
    });
  }
  return out;
}

/** Cached once a day per F&O file (NSEFO / BSEFO); public CSV shared by every user. */
export async function getFoMaster(foName) {
  return getCachedOrFetch(`motilal:fomaster:v2:${foName}`, async () => compactFo(await downloadCsv(`${OPTION_MASTER_URL}?name=${foName}`), foName), ONE_DAY_MS);
}

export const foNameFor = (symbol) => INDEX_FO[symbol]?.foName ?? "NSEFO";

/** Option rows for an app symbol. */
export async function getOptionMaster(symbol) {
  const rows = await getFoMaster(foNameFor(symbol));
  return rows.filter((r) => r.root === symbol && r.optType);
}

export function listExpiries(rows) {
  return [...new Set(rows.map((r) => r.expiry))].sort();
}

/** strike (string) -> { ce?: { token, exchangename, lotSize }, pe?: {...} } for one expiry. */
export function strikeMapForExpiry(rows, expiryIso) {
  const map = new Map();
  for (const r of rows) {
    if (r.expiry !== expiryIso) continue;
    const key = String(r.strike);
    if (!map.has(key)) map.set(key, {});
    map.get(key)[r.optType === "CE" ? "ce" : "pe"] = { token: r.token, exchangename: r.exchangename, lotSize: r.lotSize };
  }
  return map;
}

async function getIndexMaster(csvName) {
  return getCachedOrFetch(`motilal:indexmaster:v2:${csvName}`, async () => (await downloadCsv(`${INDEX_MASTER_URL}?name=${csvName}`)).map((r) => ({
    token: r.indexcode, name: r.indexname, exchangename: r.exchangename || csvName,
  })), ONE_DAY_MS);
}

/** Index spot { token, exchangename: "NSE"|"BSE" } for a canonical index, or null. */
export async function resolveIndexInfo(symbol) {
  const cfg = INDEX_ALIASES[symbol];
  if (!cfg) return null;
  const aliases = new Set(cfg.aliases);
  const row = (await getIndexMaster(cfg.csv)).find((r) => aliases.has(String(r.name).toUpperCase().replace(/\s+/g, "")));
  return row?.token ? { token: String(row.token), exchangename: cfg.csv } : null;
}

/** NSE cash scripcode for a stock (from the NSE scrip master), or null. */
export async function resolveStockSpot(symbol) {
  const rows = await getCachedOrFetch("motilal:nsecash:v2", async () => (await downloadCsv(`${OPTION_MASTER_URL}?name=NSE`))
    .filter((r) => /^\d+$/.test(r.scripcode || ""))
    .map((r) => ({ token: r.scripcode, short: String(r.scripshortname || "").toUpperCase(), name: String(r.scripname || "").toUpperCase() })), ONE_DAY_MS);
  const hits = rows.filter((r) => r.short === symbol);
  const eq = hits.find((r) => r.name === `${symbol} EQ` || r.name.endsWith(" EQ")) ?? hits[0];
  return eq ? { token: eq.token, exchangename: "NSE" } : null;
}

const EXCHANGE_OF = { NSE: "NSE", BSE: "BSE", NSEFO: "NFO", BSEFO: "BFO", NSECD: "CDS", BSECD: "CDS", MCX: "MCX", NSECASH: "NSE", BSECASH: "BSE" };
const MO_EXCHANGE = { NSE: "NSE", BSE: "BSE", NFO: "NSEFO", BFO: "BSEFO", CDS: "NSECD", MCX: "MCX" };
export const contractExchange = (mo) => EXCHANGE_OF[String(mo || "").toUpperCase().replace(/\s+/g, "")] ?? "NSE";
export function motilalExchange(exchange) {
  const mo = MO_EXCHANGE[exchange];
  if (!mo) throw new BrokerInputError(`Unsupported exchange for Motilal Oswal: ${exchange}`);
  return mo;
}

/** Contract Instrument for a compact F&O row, or null for a non-canonical index derivative. */
export function toInstrument(r) {
  const index = r.instType.endsWith("IDX");
  if (index && !CANONICAL.has(r.root)) return null;
  const opt = r.instType.startsWith("OPT");
  return {
    token: r.token, exchange: contractExchange(r.exchangename), tradingSymbol: r.scripname || r.token, underlying: r.root,
    instrumentType: r.instType, expiry: r.expiry, strike: opt ? r.strike : null, optionType: opt ? r.optType : null,
    lotSize: r.lotSize, tickSize: r.tickSize,
  };
}
