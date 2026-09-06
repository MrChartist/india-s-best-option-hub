/**
 * Samco StockNote scrip master — a public, unauthenticated CSV covering every
 * exchange segment (NSE/BSE/NFO/BFO/CDS/MCX/MFO). Samco's REST API has no
 * native option-chain endpoint, so this resolves each app symbol's
 * strikes/expiries/symbolCodes from the CSV; samco.mjs fills prices in via
 * batched /quote/multiQuote calls.
 *
 * Columns verified against a live download (2026-09):
 *   exchange,exchangeSegment,symbolCode,tradingSymbol,name,lastPrice,instrument,lotSize,strikePrice,expiryDate,tickSize
 * No field is quoted/comma-containing in the live file, so a plain split(",")
 * per line is safe and much faster than a general CSV parser for this ~15MB/
 * ~180k-row file.
 *
 * symbolCode is Samco's own "<scripCode>_<segment>" token (e.g. "51278_NFO").
 * This is the one field /quote/multiQuote always echoes back verbatim as its
 * `symbol` field on every quote item, so it is used as the join key for quote
 * responses instead of tradingSymbol (multiQuote reformats trading symbols
 * into a different compact date form on the way back out).
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

export const SCRIP_MASTER_URL = "https://developers.stocknote.com/doc/ScripMaster.csv";

// Each index's option contracts: the exchange segment + `instrument` code
// they're filed under in the CSV, the CSV `name` value, and the exact
// indexName Samco's /quote/indexQuote endpoint expects for the underlying
// spot price (confirmed against Samco's documented index-name list).
export const UNDERLYING = {
  NIFTY: { exchange: "NFO", instrument: "OPTIDX", name: "NIFTY", indexName: "NIFTY 50" },
  BANKNIFTY: { exchange: "NFO", instrument: "OPTIDX", name: "BANKNIFTY", indexName: "NIFTY BANK" },
  FINNIFTY: { exchange: "NFO", instrument: "OPTIDX", name: "FINNIFTY", indexName: "NIFTY FIN SERVICE" },
  MIDCPNIFTY: { exchange: "NFO", instrument: "OPTIDX", name: "MIDCPNIFTY", indexName: "NIFTY MID SELECT" },
  // SENSEX index options are filed under BFO with instrument code "IO" (index
  // options) rather than NFO's "OPTIDX" — verified against a live scrip master row.
  SENSEX: { exchange: "BFO", instrument: "IO", name: "SENSEX", indexName: "SENSEX" },
};

const UNDERLYING_LOOKUP = new Map(
  Object.entries(UNDERLYING).map(([symbol, u]) => [`${u.exchange}|${u.instrument}|${u.name}`, symbol])
);

/** Samco's expiryDate wire format "DD/MM/YY" -> ISO "YYYY-MM-DD". */
function expiryToIso(raw) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(raw || "").trim());
  if (!m) return null;
  const [, dd, mm, yy] = m;
  return `20${yy}-${mm}-${dd}`;
}

async function downloadAndFilter() {
  const res = await fetch(SCRIP_MASTER_URL);
  if (!res.ok) {
    throw new Error(`Samco ScripMaster download failed (HTTP ${res.status})`);
  }
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const filtered = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    if (cols.length < 11) continue;

    const exchange = cols[0];
    const symbolCode = cols[2];
    const tradingSymbol = cols[3];
    const name = cols[4];
    const instrument = cols[6];
    const strikePrice = cols[8];
    const expiryDate = cols[9];

    const symbol = UNDERLYING_LOOKUP.get(`${exchange}|${instrument}|${name}`);
    if (!symbol) continue;

    const side = tradingSymbol.endsWith("CE") ? "ce" : tradingSymbol.endsWith("PE") ? "pe" : null;
    if (!side) continue;

    const expiry = expiryToIso(expiryDate);
    const strike = Number(strikePrice);
    if (!expiry || !Number.isFinite(strike) || strike <= 0) continue;

    filtered.push({ symbol, symbolCode, tradingSymbol, strike, expiry, side, exchange });
  }

  return filtered;
}

/** Cached once/day, shared across all users' credentials — this file is public market data. */
export async function getInstrumentMaster() {
  return getCachedOrFetch("samco:scripmaster", downloadAndFilter, ONE_DAY_MS);
}

/** All CE/PE rows for one app symbol, across every expiry. */
export async function getOptionRows(symbol) {
  if (!UNDERLYING[symbol]) throw new Error(`Unknown symbol for Samco: ${symbol}`);
  const master = await getInstrumentMaster();
  return master.filter((r) => r.symbol === symbol);
}

/** Distinct ascending ISO expiry dates for a set of option rows. */
export function distinctExpiriesAscending(rows) {
  return Array.from(new Set(rows.map((r) => r.expiry))).sort();
}
