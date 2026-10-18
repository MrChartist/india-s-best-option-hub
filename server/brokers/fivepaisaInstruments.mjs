/**
 * 5paisa scrip master: daily CSV download, a compact parsed form, and lookups for chains, quotes and orders.
 *
 * Official doc: https://xstream.5paisa.com/dev-docs/docFundamentals/scrip-master
 *   GET https://Openapi.5paisa.com/VendorsAPI/Service1.svc/ScripMaster/segment/{segment}
 *   segment: all | nse_eq | bse_eq | nse_fo | bse_fo | ncd_fo | mcx_fo
 *   Columns used: Exch (N/B/M), ExchType (C cash, D derivatives, U currency), ScripCode, Name, Expiry,
 *   ScripType (CE / PE / EQ "for NSE indices" / XX other), StrikeRate, LotSize, TickSize ("in rupees"),
 *   SymbolRoot (underlying for derivatives), Series (EQ for equity, XX for derivatives).
 *
 * Index cash rows carry ScripCodes above 999900 (e.g. NIFTY 999920000, SENSEX 999901) and their SymbolRoot is
 * the exchange's display name ("NIFTY 50", "BSE BANKEX"), so it is normalised onto the canonical underlyings.
 * The "all" segment is used because index rows and both F&O segments are needed together; 5paisa documents
 * an occasional transient "Cache not available" reply for it, absorbed by a short retry.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { sleep } from "../lib/batch.mjs";
import { brokerFetch, BrokerInputError, CANONICAL_UNDERLYINGS } from "./contract.mjs";

export const SCRIP_MASTER_URL = "https://Openapi.5paisa.com/VendorsAPI/Service1.svc/ScripMaster/segment/all";

const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
// Index display names (upper-cased, spaces and hyphens removed) -> canonical underlying.
const INDEX_ALIASES = {
  NIFTY: "NIFTY", NIFTY50: "NIFTY",
  BANKNIFTY: "BANKNIFTY", NIFTYBANK: "BANKNIFTY",
  FINNIFTY: "FINNIFTY", NIFTYFINSERVICE: "FINNIFTY", NIFTYFINANCIALSERVICES: "FINNIFTY", NIFTYFIN: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY", NIFTYMIDSELECT: "MIDCPNIFTY", NIFTYMIDCAPSELECT: "MIDCPNIFTY",
  SENSEX: "SENSEX", BSESENSEX: "SENSEX",
  BANKEX: "BANKEX", BSEBANKEX: "BANKEX",
};
// Index derivative roots that are not canonical underlyings (dropped from the instrument list).
const OTHER_INDEX_ROOTS = new Set(["NIFTYNXT50", "SENSEX50", "BSESENSEX50", "NIFTYIT", "NIFTYPSE"]);
const EXCHANGE_OF = { "N|C": "NSE", "B|C": "BSE", "N|D": "NFO", "B|D": "BFO" };
const STOCK_RE = /^[A-Z0-9&-]{1,20}$/;

const squash = (s) => String(s ?? "").toUpperCase().replace(/[\s-]+/g, "");

/** The canonical underlying for an index display name, or null. */
export function canonicalIndexName(raw) {
  return INDEX_ALIASES[squash(raw)] ?? null;
}

/** Validate an app symbol: a canonical index or an NSE/BSE stock symbol. */
export function assertSymbol(symbol) {
  const s = String(symbol ?? "").toUpperCase();
  if (!CANONICAL.has(s) && !STOCK_RE.test(s)) throw new BrokerInputError(`Unknown symbol for 5paisa: ${symbol}`);
  return s;
}

/** Quote-aware CSV line splitter. */
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
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = f[j] === undefined ? "" : f[j].trim();
    rows.push(row);
  }
  return rows;
}

/** ISO date from "2026-10-20 14:30:00", "/Date(1792486800000+0530)/" or "20 Oct 2026" (IST calendar date). */
export function expiryToIso(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const dotNet = /\/Date\((\d+)/.exec(t);
  if (dotNet) return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Number(dotNet[1])));
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{4})/.exec(t);
  if (dmy) {
    const m = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(dmy[2].toUpperCase());
    if (m >= 0) return `${dmy[3]}-${String(m + 1).padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return null;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Reduce raw CSV rows to the compact master: { indices, equities, derivatives }.
 *  - indices:     canonical index cash rows (spot quotes)
 *  - equities:    NSE EQ rows for stocks that have derivatives (stock spot)
 *  - derivatives: NSE/BSE F&O options and futures
 */
export function compactMaster(rows) {
  const indices = [];
  const derivatives = [];
  const fnoRoots = new Set();
  const eqRows = [];
  for (const r of rows) {
    const exch = r.Exch;
    const exchType = r.ExchType;
    if ((exch !== "N" && exch !== "B") || (exchType !== "C" && exchType !== "D")) continue;
    const scripCode = String(r.ScripCode ?? "").trim();
    if (!/^\d+$/.test(scripCode)) continue;
    if (exchType === "C") {
      if (Number(scripCode) > 999900) {
        const underlying = canonicalIndexName(r.SymbolRoot) || canonicalIndexName(r.Name);
        if (underlying && !indices.some((i) => i.underlying === underlying)) indices.push({ underlying, exch, scripCode, name: r.Name || r.SymbolRoot });
      } else if (exch === "N" && (r.Series === "EQ" || r.Series === "BE")) {
        eqRows.push({ root: String(r.SymbolRoot || "").toUpperCase(), scripCode, tickSize: num(r.TickSize) || 0.05 });
      }
      continue;
    }
    const type = r.ScripType === "CE" || r.ScripType === "PE" ? r.ScripType : r.ScripType === "XX" ? "FUT" : null;
    if (!type) continue;
    const root = String(r.SymbolRoot || "").trim().toUpperCase();
    const expiry = expiryToIso(r.Expiry);
    if (!root || !expiry) continue;
    const strike = type === "FUT" ? null : num(r.StrikeRate);
    if (type !== "FUT" && !(strike > 0)) continue;
    derivatives.push({
      exch, scripCode, root, type, expiry, strike,
      lotSize: num(r.LotSize) || 1, tickSize: num(r.TickSize) || 0.05, name: r.Name || "",
    });
    fnoRoots.add(root);
  }
  const equities = eqRows.filter((e) => fnoRoots.has(e.root));
  return { indices, equities, derivatives };
}

async function downloadScripMaster() {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await brokerFetch(SCRIP_MASTER_URL, { redirect: "follow" }, { kind: "master" });
      const text = await res.text();
      if (!res.ok) throw new Error(`5paisa ScripMaster download failed (HTTP ${res.status}): ${text.slice(0, 160)}`);
      return text;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await sleep(2000);
    }
  }
  throw lastErr;
}

/** Cached once a day and shared by every user (the master is public; callers check the session first). */
export async function getInstrumentMaster() {
  return getCachedOrFetch("fivepaisa:scripmaster:v2", async () => compactMaster(parseCsv(await downloadScripMaster())), ONE_DAY_MS);
}

const isIndexRoot = (root) => CANONICAL.has(root);

/** Distinct ascending ISO expiries of a symbol's options. */
export function listExpiries(master, symbol) {
  const set = new Set();
  for (const d of master.derivatives) if (d.root === symbol && d.type !== "FUT") set.add(d.expiry);
  return [...set].sort();
}

/** Map strike (string) -> { ce?, pe? } of { scripCode, exch } for one symbol + expiry. */
export function strikeMapForExpiry(master, symbol, expiryIso) {
  const map = new Map();
  for (const d of master.derivatives) {
    if (d.root !== symbol || d.expiry !== expiryIso || d.type === "FUT") continue;
    const key = String(d.strike);
    if (!map.has(key)) map.set(key, {});
    map.get(key)[d.type === "CE" ? "ce" : "pe"] = { scripCode: d.scripCode, exch: d.exch, exchType: "D", lotSize: d.lotSize };
  }
  return map;
}

/** The spot instrument (index or NSE stock) for a symbol, as a MarketSnapshot item, or null. */
export function spotScripInfo(master, symbol) {
  if (isIndexRoot(symbol)) {
    const row = master.indices.find((i) => i.underlying === symbol);
    return row ? { scripCode: row.scripCode, exch: row.exch, exchType: "C" } : null;
  }
  const eq = master.equities.find((e) => e.root === symbol);
  return eq ? { scripCode: eq.scripCode, exch: "N", exchType: "C" } : null;
}

/** Contract Instrument for one compact derivative row, or null for a non-canonical index derivative. */
export function toInstrument(d) {
  const index = isIndexRoot(d.root);
  if (!index && (OTHER_INDEX_ROOTS.has(d.root) || canonicalIndexName(d.root))) return null;
  const opt = d.type !== "FUT";
  return {
    token: d.scripCode,
    exchange: EXCHANGE_OF[`${d.exch}|D`],
    tradingSymbol: d.name || `${d.root} ${d.expiry} ${opt ? `${d.type} ${d.strike}` : "FUT"}`,
    underlying: d.root,
    instrumentType: opt ? (index ? "OPTIDX" : "OPTSTK") : (index ? "FUTIDX" : "FUTSTK"),
    expiry: d.expiry,
    strike: opt ? d.strike : null,
    optionType: opt ? d.type : null,
    lotSize: d.lotSize,
    tickSize: d.tickSize,
  };
}

export function indexInstrument(i) {
  return {
    token: i.scripCode, exchange: EXCHANGE_OF[`${i.exch}|C`], tradingSymbol: i.underlying, underlying: i.underlying,
    instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05,
  };
}

/** Find a derivative by ScripCode (for resolving lot size from the master, never from the client). */
export function findDerivative(master, scripCode) {
  return master.derivatives.find((d) => d.scripCode === String(scripCode)) || null;
}

/** Contract exchange -> 5paisa { Exch, ExchType }. */
export function brokerSegment(exchange) {
  switch (exchange) {
    case "NSE": return { exch: "N", exchType: "C" };
    case "BSE": return { exch: "B", exchType: "C" };
    case "NFO": return { exch: "N", exchType: "D" };
    case "BFO": return { exch: "B", exchType: "D" };
    case "MCX": return { exch: "M", exchType: "D" };
    case "CDS": return { exch: "N", exchType: "U" };
    default: throw new BrokerInputError(`Unsupported exchange for 5paisa: ${exchange}`);
  }
}

/** 5paisa Exch + ExchType -> contract exchange. */
export function contractExchange(exch, exchType) {
  if (exch === "M") return "MCX";
  if (exchType === "U") return "CDS";
  return EXCHANGE_OF[`${exch}|${exchType}`] || (exch === "B" ? "BSE" : "NSE");
}
