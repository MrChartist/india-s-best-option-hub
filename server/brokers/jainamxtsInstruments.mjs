/**
 * Jainam (XTS) instrument-master + index-token resolution.
 *
 * XTS has no native option-chain endpoint, so strikes/expiries/tokens are
 * resolved from XTS's own daily instrument-master dump (POST
 * /instruments/master, pipe-delimited text, one segment at a time) plus a
 * separate index-token list (GET /instruments/indexlist) for underlying spot
 * prices. Field layout below (23 pipe-delimited columns for F&O segments) is
 * verified against marketcalls/openalgo's production `jainamxts` adapter,
 * which downloads and parses this exact endpoint successfully; the
 * ContractExpiration column is documented (Symphony Fintech market-data API
 * docs) as ISO 8601, e.g. "2026-02-17T14:30:00".
 *
 * Both endpoints are called anonymously first (openalgo's production code
 * sends no Authorization header for either) with an authenticated retry as a
 * defensive fallback in case a given Jainam deployment enforces it.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { xtsRequest } from "./jainamxtsAuth.mjs";

// XTS numeric exchange-segment codes.
export const SEGMENT = { NSE_CM: 1, NSE_FO: 2, CDS: 3, BSE_CM: 11, BSE_FO: 12, MCX: 51 };

// Which F&O instrument-master segment + numeric quote segment each app symbol lives on.
export const SYMBOL_CONFIG = {
  NIFTY: { masterSegment: "NSEFO", quoteSegment: SEGMENT.NSE_FO, indexSegment: SEGMENT.NSE_CM },
  BANKNIFTY: { masterSegment: "NSEFO", quoteSegment: SEGMENT.NSE_FO, indexSegment: SEGMENT.NSE_CM },
  FINNIFTY: { masterSegment: "NSEFO", quoteSegment: SEGMENT.NSE_FO, indexSegment: SEGMENT.NSE_CM },
  MIDCPNIFTY: { masterSegment: "NSEFO", quoteSegment: SEGMENT.NSE_FO, indexSegment: SEGMENT.NSE_CM },
  SENSEX: { masterSegment: "BSEFO", quoteSegment: SEGMENT.BSE_FO, indexSegment: SEGMENT.BSE_CM },
};

// Raw index-list display names (from /instruments/indexlist) -> our app symbol.
// Verified against openalgo's jainamxts master_contract_db.py nse_index_map.
const INDEX_NAME_MAP = {
  "NIFTY 50": "NIFTY",
  "NIFTY BANK": "BANKNIFTY",
  "NIFTY FIN SERVICE": "FINNIFTY",
  "NIFTY MID SELECT": "MIDCPNIFTY",
  SENSEX: "SENSEX",
};

export function assertKnownSymbol(symbol) {
  if (!SYMBOL_CONFIG[symbol]) throw new Error(`Unknown symbol for Jainam (XTS): ${symbol}`);
}

/** GET/POST the same market-data endpoint anonymously first, authenticated on failure. */
async function fetchAnonThenAuth(creds, path, opts) {
  try {
    return await xtsRequest(creds, path, { ...opts, auth: false });
  } catch {
    return await xtsRequest(creds, path, { ...opts, auth: true });
  }
}

/** "2026-02-17T14:30:00" (or any parseable date-ish string) -> "2026-02-17", IST-safe. */
function toIsoDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * F&O master row layout (23 pipe-delimited columns), confirmed against
 * openalgo's headers_fo: ExchangeSegment|ExchangeInstrumentID|InstrumentType|
 * Name|Description|Series|NameWithSeries|InstrumentID|PriceBand.High|
 * PriceBand.Low|FreezeQty|TickSize|LotSize|Multiplier|UnderlyingInstrumentId|
 * UnderlyingIndexName|ContractExpiration|StrikePrice|OptionType|DisplayName|
 * PriceNumerator|PriceDenominator|DetailedDescription
 */
function parseFOMaster(resultText) {
  const rows = [];
  const lines = String(resultText || "").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const f = line.split("|");
    if (f.length < 19) continue;
    const optionType = f[18];
    if (optionType !== "3" && optionType !== "4") continue; // skip futures (1) / malformed rows
    const expiryIso = toIsoDate(f[16]);
    const strike = Number(f[17]);
    if (!expiryIso || !Number.isFinite(strike)) continue;
    rows.push({
      token: f[1],
      name: (f[3] || "").trim().toUpperCase(),
      expiryIso,
      strike,
      side: optionType === "3" ? "ce" : "pe",
    });
  }
  return rows;
}

async function downloadSegmentMaster(creds, masterSegment) {
  const result = await fetchAnonThenAuth(creds, "/instruments/master", {
    method: "POST",
    body: { exchangeSegmentList: [masterSegment] },
  });
  if (!result) throw new Error(`Jainam (XTS) instrument master returned no data for ${masterSegment}`);
  return parseFOMaster(result);
}

/** Cached once/day per segment (NSEFO/BSEFO), shared across all users' credentials. */
export async function getSegmentMaster(creds, masterSegment) {
  return getCachedOrFetch(`jainamxts:master:${masterSegment}`, () => downloadSegmentMaster(creds, masterSegment), ONE_DAY_MS);
}

/** Distinct ascending ISO expiry dates for one app symbol's option contracts. */
export function listExpiries(rows, symbol) {
  const name = symbol;
  const set = new Set();
  for (const r of rows) if (r.name === name) set.add(r.expiryIso);
  return Array.from(set).sort();
}

/** Map<strikeString, { ce?: { token, exchangeSegment }, pe?: { token, exchangeSegment } }> */
export function strikeMapForExpiry(rows, symbol, expiryIso, quoteSegment) {
  const map = new Map();
  for (const r of rows) {
    if (r.name !== symbol || r.expiryIso !== expiryIso) continue;
    const key = String(r.strike);
    if (!map.has(key)) map.set(key, {});
    map.get(key)[r.side] = { token: r.token, exchangeSegment: quoteSegment };
  }
  return map;
}

// Plain object, NOT a Map — this return value is round-tripped through
// instrumentCache.mjs's JSON disk cache (JSON.stringify(new Map(...)) silently
// serializes to "{}", so a Map here would come back empty — and .get()-less
// after any process restart within the 1-day TTL). Keyed by app symbol, same
// as every other XTS-family sibling's index-token lookup shape (ibulls'
// getIndexList/rmoney's fetchIndexList/compositedge's getIndexList all cache
// a plain array/object for the same reason).
async function downloadIndexList(creds) {
  const map = {};
  for (const [segment, exchangeSegment] of [[SEGMENT.NSE_CM, SEGMENT.NSE_CM], [SEGMENT.BSE_CM, SEGMENT.BSE_CM]]) {
    let result;
    try {
      result = await fetchAnonThenAuth(creds, "/instruments/indexlist", { params: { exchangeSegment: segment } });
    } catch {
      continue; // best-effort — a missing segment shouldn't break the whole index list
    }
    for (const entry of result?.indexList || []) {
      const idx = entry.lastIndexOf("_");
      if (idx < 0) continue;
      const rawName = entry.slice(0, idx).toUpperCase().trim().replace(/\s+/g, " ");
      const token = entry.slice(idx + 1);
      const symbol = INDEX_NAME_MAP[rawName];
      if (!symbol) continue;
      map[symbol] = { token, exchangeSegment };
    }
  }
  return map;
}

/** Cached once/day — index tokens essentially never change intraday. Returns a plain { [symbol]: {token, exchangeSegment} } object, not a Map (see downloadIndexList). */
export async function getIndexTokenMap(creds) {
  return getCachedOrFetch("jainamxts:indexlist", () => downloadIndexList(creds), ONE_DAY_MS);
}
