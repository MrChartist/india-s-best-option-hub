/**
 * Zebu (Mynt) daily instrument-master resolution.
 *
 * Zebu publishes per-exchange contract masters as public, unauthenticated ZIP
 * downloads (no auth needed) — confirmed against openalgo's
 * broker/zebu/database/master_contract_db.py, which lists the exact URLs:
 *   https://go.mynt.in/NSE_symbols.txt.zip
 *   https://go.mynt.in/NFO_symbols.txt.zip
 *   https://go.mynt.in/BFO_symbols.txt.zip
 * (CDS/MCX/BSE are also published but irrelevant to index options here.)
 * Each ZIP holds one plain-CSV-with-header .txt file. Columns confirmed live
 * (real header row, 2026-09):
 *   NSE: Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize
 *   NFO: Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize
 *   BFO: Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,Strike,TickSize
 * (openalgo's own `usecols=[...]` list omits OptionType for BFO, implying
 * they didn't trust/use it — but a live download confirms the column exists
 * and is populated, so it's used directly here.)
 *
 * NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY option contracts live in NFO with
 * Symbol exactly "NIFTY"/"BANKNIFTY"/"FINNIFTY"/"MIDCPNIFTY" (Instrument
 * "OPTIDX") — verified live. SENSEX lives in BFO, but its Symbol column is
 * NOT "SENSEX" — it's the internal product code "BSXOPT" (TradingSymbol
 * "SENSEX26SEP91000PE" etc, strikes matching real ~85-91k Sensex levels).
 * BFO also carries a DIFFERENT, unrelated index under Symbol "SX50OPT"
 * (TradingSymbol "SENSEX50…", strikes ~26-27k) — the BSE SENSEX50 index, a
 * different product from plain SENSEX. Naively extracting the alphabetic
 * prefix of "SENSEX5026SEP26900PE" would wrongly yield "SENSEX" too and
 * silently mix SENSEX50 strikes into the SENSEX chain, so BFO rows are
 * matched by the exact Symbol code "BSXOPT", not a TradingSymbol regex.
 * Expiry is "DD-MON-YYYY" (e.g. "24-SEP-2026") in both NFO and BFO.
 *
 * Index (spot) tokens for the NIFTY family are rows in the *same* NSE ZIP
 * with Instrument=="INDEX" — verified live TradingSymbol strings: "NIFTY
 * INDEX", "NIFTY BANK", "FINNIFTY". MIDCPNIFTY has NO index row in Zebu's
 * NSE feed at all (verified live — absent, not just misnamed), so its spot
 * falls back to the nearest-expiry MIDCPNIFTY future (NFO, OptionType=="XX")
 * as a best-effort proxy — this carries a futures cost-of-carry premium over
 * true spot, unlike the other four symbols. SENSEX's spot token is the
 * well-known BSE index token "1" (Zebu's own BSE cash-segment feed omits
 * index rows too — confirmed via openalgo's process_zebu_bse_data(), which
 * hardcodes instrumenttype="EQ" for every BSE row with the comment "no BSE
 * index symbols available from Zebu"); token "1" is the same value already
 * verified live for a sibling broker (server/brokers/definedgeInstruments.mjs)
 * and used broadly across NSE/BSE reference data, but NOT independently
 * confirmed against a live Zebu GetQuotes call for SENSEX specifically.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { unzipFirstEntry } from "./zebuZip.mjs";

const MASTER_URLS = {
  NSE: "https://go.mynt.in/NSE_symbols.txt.zip",
  NFO: "https://go.mynt.in/NFO_symbols.txt.zip",
  BFO: "https://go.mynt.in/BFO_symbols.txt.zip",
};

// Which master file each app symbol's option contracts live in.
export const UNDERLYING_EXCHANGE = {
  NIFTY: "NFO",
  BANKNIFTY: "NFO",
  FINNIFTY: "NFO",
  MIDCPNIFTY: "NFO",
  SENSEX: "BFO",
};

// BFO's Symbol column uses internal product codes, not the plain index name —
// verified live (see file header). Only SENSEX needs this; NFO's Symbol
// column already matches the app symbol name exactly.
const BFO_SYMBOL_CODE = { SENSEX: "BSXOPT" };

// Candidate NSE-master TradingSymbol strings (Instrument=="INDEX") per app
// symbol — "FINNIFTY" confirmed live; "NIFTY FIN SERVICE"/"NIFTY MIDCAP
// SELECT" kept as fallback candidates in case Zebu's feed naming changes.
const NSE_INDEX_CANDIDATES = {
  NIFTY: ["NIFTY INDEX"],
  BANKNIFTY: ["NIFTY BANK"],
  FINNIFTY: ["FINNIFTY", "NIFTY FIN SERVICE"],
  MIDCPNIFTY: ["NIFTY MIDCAP SELECT", "MIDCPNIFTY"],
};

// Best-effort, cross-broker-verified BSE index token — see file header.
const SENSEX_FALLBACK = { exch: "BSE", token: "1" };

const MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function parseExpiryToIso(raw) {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(String(raw || "").trim().toUpperCase());
  if (!m) return null;
  const [, dd, mon, yyyy] = m;
  const mm = MONTHS[mon];
  return mm ? `${yyyy}-${mm}-${dd}` : null;
}

/** Zebu's symbol masters have no embedded commas/quotes in their columns — plain split is safe. */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < headers.length) continue;
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = cols[c]?.trim();
    rows.push(row);
  }
  return rows;
}

async function downloadRawRows(exchange) {
  const url = MASTER_URLS[exchange];
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Zebu symbol master download failed [${exchange}] (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const text = unzipFirstEntry(buf);
  return parseCsv(text);
}

/** Cached once/day per master file (raw rows, untransformed), shared across all users' credentials. */
async function getRawMaster(exchange) {
  return getCachedOrFetch(`zebu:rawmaster:${exchange}`, () => downloadRawRows(exchange), ONE_DAY_MS);
}

function toOptionRow(r, { exch, underlying, strikeField }) {
  const optionType = r.OptionType;
  if (optionType !== "CE" && optionType !== "PE") return null;
  const expiryIso = parseExpiryToIso(r.Expiry);
  const strike = Number(r[strikeField]);
  if (!expiryIso || !Number.isFinite(strike)) return null;
  return {
    exch: r.Exchange || exch,
    token: r.Token,
    underlying,
    expiryIso,
    strike,
    optionType,
  };
}

/** All CE/PE option rows for a given app symbol, across all expiries. */
export async function getOptionRows(symbol) {
  const exchange = UNDERLYING_EXCHANGE[symbol];
  if (!exchange) throw new Error(`Unknown symbol for Zebu: ${symbol}`);
  const raw = await getRawMaster(exchange);

  if (exchange === "NFO") {
    return raw
      .filter((r) => r.Symbol === symbol)
      .map((r) => toOptionRow(r, { exch: "NFO", underlying: symbol, strikeField: "StrikePrice" }))
      .filter(Boolean);
  }

  // BFO — matched by internal product code, not the Symbol column (see file header).
  const code = BFO_SYMBOL_CODE[symbol];
  if (!code) throw new Error(`Unknown symbol for Zebu BFO: ${symbol}`);
  return raw
    .filter((r) => r.Symbol === code)
    .map((r) => toOptionRow(r, { exch: "BFO", underlying: symbol, strikeField: "Strike" }))
    .filter(Boolean);
}

/** Distinct ISO ("YYYY-MM-DD") expiry dates, ascending. */
export function distinctExpiriesAscending(rows) {
  return Array.from(new Set(rows.map((r) => r.expiryIso))).sort();
}

/** Nearest-expiry future contract (OptionType=="XX") for a symbol in NFO — spot proxy fallback. */
async function resolveNearestFuture(symbol) {
  const raw = await getRawMaster("NFO");
  const futures = raw
    .filter((r) => r.Symbol === symbol && r.OptionType === "XX")
    .map((r) => ({ exch: r.Exchange || "NFO", token: r.Token, expiryIso: parseExpiryToIso(r.Expiry) }))
    .filter((r) => r.expiryIso)
    .sort((a, b) => (a.expiryIso < b.expiryIso ? -1 : 1));

  if (futures.length === 0) {
    throw new Error(`Zebu has no INDEX spot row or futures fallback for ${symbol} — cannot resolve a spot proxy`);
  }
  return { exch: futures[0].exch, token: futures[0].token };
}

/** Resolves an app symbol to its GetQuotes-ready { exch, token } spot (or best-effort proxy) contract. */
export async function resolveIndexToken(symbol) {
  if (symbol === "SENSEX") return SENSEX_FALLBACK;

  const candidates = NSE_INDEX_CANDIDATES[symbol];
  if (!candidates) throw new Error(`Unknown symbol for Zebu: ${symbol}`);

  const nseRows = await getRawMaster("NSE");
  const match = nseRows.find(
    (r) => r.Instrument === "INDEX" && candidates.includes(String(r.TradingSymbol || "").trim().toUpperCase())
  );
  if (match) return { exch: "NSE", token: match.Token };

  // No index row published (confirmed live for MIDCPNIFTY) — fall back to
  // the nearest future's LTP as a best-effort spot proxy.
  return resolveNearestFuture(symbol);
}
