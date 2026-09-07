/**
 * Shoonya instrument-master + index-token resolution.
 *
 * Shoonya publishes daily contract-master ZIPs (public, no auth needed) per
 * exchange segment at https://api.shoonya.com/<SEG>_symbols.txt.zip — each a
 * single-entry ZIP wrapping one comma-separated .txt file. Confirmed via a
 * live download (2026-09-05):
 *   NFO/BFO: Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize
 *   NSE/BSE: Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize
 * (each row also carries one trailing empty column from a trailing comma in
 * the header — parsed away harmlessly by the by-name CSV reader below).
 *
 * NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY option contracts live in the NFO file
 * (Instrument=OPTIDX, `Symbol` already equals the plain root name); SENSEX's
 * live in the BFO file, but there `Symbol` is a generic bucket ("SX50OPT")
 * rather than the root name, so the root is derived from the leading letters
 * of `TradingSymbol` instead (e.g. "SENSEX5026SEP26900PE" -> "SENSEX") —
 * confirmed live, mirrors openalgo's own BFO handling for the same reason.
 *
 * Index (spot) tokens for the NIFTY family are resolved from the NSE file's
 * Instrument=INDEX rows (confirmed live: Nifty 50=26000, Nifty Bank=26009,
 * Nifty Fin Services=26037, NIFTY MID SELECT=26074). SENSEX has NO index row
 * in the real BSE file at all (verified live — only SENSEX-branded ETF
 * tickers appear, instrument type "B"); Shoonya's own SENSEX spot token is
 * the well-known hardcoded value 1 on exchange BSE, which openalgo's master
 * contract builder also injects manually for exactly this reason.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { unzipFirstEntry } from "./shoonyaZip.mjs";

const SYMBOL_ZIP_URLS = {
  NFO: "https://api.shoonya.com/NFO_symbols.txt.zip",
  BFO: "https://api.shoonya.com/BFO_symbols.txt.zip",
  NSE: "https://api.shoonya.com/NSE_symbols.txt.zip",
};

// Which derivatives file each app symbol's option contracts live in.
export const UNDERLYING_SEGMENT = {
  NIFTY: "NFO",
  BANKNIFTY: "NFO",
  FINNIFTY: "NFO",
  MIDCPNIFTY: "NFO",
  SENSEX: "BFO",
};

// Hardcoded because SENSEX has no INDEX row in Shoonya's own BSE_symbols.txt
// (verified live) — this is Shoonya's documented/well-known spot token.
const SENSEX_INDEX_TOKEN = { exch: "BSE", token: "1" };

// Candidate `Symbol`/`TradingSymbol` strings (normalized: uppercased,
// non-alphanumerics stripped) for each NIFTY-family index row in NSE_symbols.txt.
const NSE_INDEX_CANDIDATES = {
  NIFTY: ["NIFTY50", "NIFTYINDEX"],
  BANKNIFTY: ["NIFTYBANK"],
  FINNIFTY: ["NIFTYFINSERVICES", "FINNIFTY"],
  MIDCPNIFTY: ["NIFTYMIDSELECT", "MIDCPNIFTY"],
};

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

/** Shoonya's symbol files have no embedded commas/quotes in any column — plain split, mapped by header name. */
function parseCsvByHeader(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) row[headers[c]] = cols[c]?.trim() ?? "";
    }
    rows.push(row);
  }
  return rows;
}

async function downloadSegment(segment) {
  const url = SYMBOL_ZIP_URLS[segment];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Shoonya symbol master download failed [${segment}] (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = unzipFirstEntry(buf, ".txt");
  return parseCsvByHeader(text);
}

/** Cached once/day per exchange segment, shared across all users' credentials. */
function getSegmentRows(segment) {
  return getCachedOrFetch(`shoonya:instruments:${segment}`, () => downloadSegment(segment), ONE_DAY_MS);
}

function rootNameFromTradingSymbol(tradingSymbol) {
  const m = /^[A-Za-z]+/.exec(String(tradingSymbol || ""));
  return m ? m[0].toUpperCase() : "";
}

/** All CE/PE option rows for a given app symbol, across all expiries. */
export async function getOptionRows(symbol) {
  const segment = UNDERLYING_SEGMENT[symbol];
  if (!segment) throw new Error(`Unknown symbol for Shoonya: ${symbol}`);

  const rows = await getSegmentRows(segment);
  const out = [];
  for (const r of rows) {
    if (r.Instrument !== "OPTIDX") continue;
    if (r.OptionType !== "CE" && r.OptionType !== "PE") continue;

    const root = segment === "BFO" ? rootNameFromTradingSymbol(r.TradingSymbol) : String(r.Symbol || "").toUpperCase();
    if (root !== symbol) continue;

    const expiryIso = parseExpiryToIso(r.Expiry);
    const strike = Number(r.StrikePrice);
    if (!expiryIso || !Number.isFinite(strike)) continue;

    out.push({
      exch: r.Exchange,
      token: r.Token,
      tradingsymbol: r.TradingSymbol,
      expiryIso,
      strike,
      optionType: r.OptionType,
      lotsize: Number(r.LotSize) || 0,
    });
  }
  return out;
}

/** Distinct ISO ("YYYY-MM-DD") expiry dates, ascending. */
export function distinctExpiriesAscending(rows) {
  return Array.from(new Set(rows.map((r) => r.expiryIso))).sort();
}

function normalize(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Resolves an app symbol to its GetQuotes-ready { exch, token } spot index contract. */
export async function resolveIndexToken(symbol) {
  if (symbol === "SENSEX") return SENSEX_INDEX_TOKEN;

  const candidates = NSE_INDEX_CANDIDATES[symbol];
  if (!candidates) throw new Error(`Unknown symbol for Shoonya: ${symbol}`);

  const rows = await getSegmentRows("NSE");
  const normalizedCandidates = candidates.map(normalize);
  const match = rows.find(
    (r) => r.Instrument === "INDEX" && (normalizedCandidates.includes(normalize(r.Symbol)) || normalizedCandidates.includes(normalize(r.TradingSymbol)))
  );
  if (!match) {
    throw new Error(
      `Shoonya NSE_symbols.txt did not contain an INDEX row for ${symbol} (looked for: ${candidates.join(", ")})`
    );
  }
  return { exch: "NSE", token: match.Token };
}
