/**
 * RMoney (XTS) instrument master + underlying-index resolution.
 *
 * RMoney/XTS has no native option-chain endpoint, so strikes/expiries/tokens are
 * resolved from the public daily instrument master: POST /instruments/master with
 * {exchangeSegmentList:["NSEFO"|"BSEFO"]}, which returns a newline-separated,
 * pipe-delimited dump (no header row) in the fixed column order below. That column
 * order and the OptionType numeric codes (1=FUT, 3=CE, 4=PE) are taken verbatim from
 * marketcalls/openalgo's production RMoney adapter, which hand-writes this exact
 * header when re-serializing the dump to CSV.
 *
 * ContractExpiration's exact wire format isn't documented anywhere reachable (the
 * Python reference just hands it to pandas.to_datetime, which accepts almost
 * anything) — toIsoDate() below defensively handles the common XTS "DD-Mon-YYYY"
 * style plus ISO-prefixed and native-Date-parseable fallbacks.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { marketDataPublicFetch } from "./rmoneyAuth.mjs";

// Which XTS master file each app symbol's option contracts live in, and the numeric
// ExchangeSegment code (XTS's documented enum: NSECM=1, NSEFO=2, NSECD=3, BSECM=11,
// BSEFO=12, MCXFO=51) used when requesting quotes for that contract's own segment.
export const SEGMENT = {
  NIFTY: { master: "NSEFO", quote: 2 },
  BANKNIFTY: { master: "NSEFO", quote: 2 },
  FINNIFTY: { master: "NSEFO", quote: 2 },
  MIDCPNIFTY: { master: "NSEFO", quote: 2 },
  SENSEX: { master: "BSEFO", quote: 12 },
};

// The underlying index rides the cash/index segment, not the derivatives segment
// (XTS convention confirmed in the reference adapter's exchange_segment_map:
// NSE/NSE_INDEX=1, BSE/BSE_INDEX=11).
const INDEX_QUOTE_SEGMENT = { NSEFO: 1, BSEFO: 11 };

const FO_COLUMNS = [
  "ExchangeSegment", "ExchangeInstrumentID", "InstrumentType", "Name", "Description",
  "Series", "NameWithSeries", "InstrumentID", "PriceBandHigh", "PriceBandLow",
  "FreezeQty", "TickSize", "LotSize", "Multiplier", "UnderlyingInstrumentId",
  "UnderlyingIndexName", "ContractExpiration", "StrikePrice", "OptionType",
  "DisplayName", "PriceNumerator", "PriceDenominator", "DetailedDescription",
];

const OPTION_TYPE = { 3: "CE", 4: "PE" };
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function toIsoDate(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();

  const monthMatch = /^(\d{1,2})[\s-]?([A-Za-z]{3})[\s-]?(\d{4})/.exec(trimmed);
  if (monthMatch) {
    const month = MONTHS[monthMatch[2].toUpperCase()];
    if (month != null) {
      const day = String(Number(monthMatch[1])).padStart(2, "0");
      return `${monthMatch[3]}-${String(month + 1).padStart(2, "0")}-${day}`;
    }
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    // Read back the calendar date in IST (exchange-local), not the host
    // server's own local timezone — the previous getFullYear()/getMonth()/
    // getDate() calls silently depended on the process's OS timezone, which
    // could shift a contract's calendar date by a day on a non-IST server.
    // Matches the IST-safe fallback already used by this registry's
    // jainamxtsInstruments.mjs / wisdomInstruments.mjs siblings.
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
  }
  return null;
}

function parsePipeMaster(resultText) {
  const lines = String(resultText || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const cols = line.split("|");
    if (cols.length < FO_COLUMNS.length) continue;
    const row = {};
    for (let i = 0; i < FO_COLUMNS.length; i++) row[FO_COLUMNS[i]] = cols[i];
    rows.push(row);
  }
  return rows;
}

async function downloadOptionMaster(masterSegment) {
  const json = await marketDataPublicFetch("/instruments/master", {
    method: "POST",
    body: { exchangeSegmentList: [masterSegment] },
  });
  const rows = parsePipeMaster(json.result);
  return rows.filter((r) => r.OptionType === "3" || r.OptionType === "4");
}

/** Cached once/day per master segment (NSEFO/BSEFO) — public reference data, shared across all users' credentials. */
export async function getOptionMaster(masterSegment) {
  return getCachedOrFetch(`rmoney:instruments:${masterSegment}`, () => downloadOptionMaster(masterSegment), ONE_DAY_MS);
}

/** All CE/PE rows for a given app symbol, across all expiries. */
export async function getOptionRows(symbol) {
  const seg = SEGMENT[symbol];
  if (!seg) throw new Error(`Unknown symbol for RMoney: ${symbol}`);
  const rows = await getOptionMaster(seg.master);
  return rows.filter((r) => r.Name === symbol);
}

/** Distinct ISO "YYYY-MM-DD" expiry dates, ascending. */
export function distinctExpiriesAscending(rows) {
  const set = new Set();
  for (const r of rows) {
    const iso = toIsoDate(r.ContractExpiration);
    if (iso) set.add(iso);
  }
  return Array.from(set).sort();
}

/** Map of strike (string) -> { ce?: {exchangeSegment, exchangeInstrumentID}, pe?: {...} } for one symbol+expiry. */
export function strikeMapForExpiry(symbol, rows, expiryIso) {
  const quoteSegment = SEGMENT[symbol].quote;
  const map = new Map();
  for (const r of rows) {
    if (toIsoDate(r.ContractExpiration) !== expiryIso) continue;
    const side = OPTION_TYPE[Number(r.OptionType)];
    if (!side) continue;
    const strikeNum = Number(r.StrikePrice);
    if (!Number.isFinite(strikeNum)) continue;
    const strikeKey = String(strikeNum);
    if (!map.has(strikeKey)) map.set(strikeKey, {});
    map.get(strikeKey)[side.toLowerCase()] = {
      exchangeSegment: quoteSegment,
      exchangeInstrumentID: Number(r.ExchangeInstrumentID),
    };
  }
  return map;
}

async function fetchIndexList(segmentNum) {
  const json = await marketDataPublicFetch("/instruments/indexlist", { params: { exchangeSegment: String(segmentNum) } });
  const list = json?.result?.indexList || [];
  const entries = [];
  for (const item of list) {
    const idx = String(item).lastIndexOf("_");
    if (idx === -1) continue;
    entries.push({ name: item.slice(0, idx).trim().toUpperCase(), token: item.slice(idx + 1) });
  }
  return entries;
}

/** Cached once/day per numeric segment — same public-reference-data reasoning as the option master. */
async function getIndexList(segmentNum) {
  return getCachedOrFetch(`rmoney:indexlist:${segmentNum}`, () => fetchIndexList(segmentNum), ONE_DAY_MS);
}

/**
 * The underlying index's own quote instrument for a symbol — { exchangeSegment,
 * exchangeInstrumentID } — or null if it can't be resolved from the cached master.
 *
 * Primary path: every option row carries `UnderlyingInstrumentId`, which (per XTS
 * convention used across its broker family) IS the underlying's own
 * exchangeInstrumentID on the cash/index segment — no extra lookup needed.
 * Fallback (if that column is ever blank/zero): match the row's
 * `UnderlyingIndexName` text against /instruments/indexlist.
 */
export async function resolveUnderlyingInstrument(symbol, rows) {
  const seg = SEGMENT[symbol];
  if (!seg) return null;
  const quoteSegment = INDEX_QUOTE_SEGMENT[seg.master];

  const withUnderlying = rows.find((r) => r.UnderlyingInstrumentId && Number(r.UnderlyingInstrumentId) > 0);
  if (withUnderlying) {
    return { exchangeSegment: quoteSegment, exchangeInstrumentID: Number(withUnderlying.UnderlyingInstrumentId) };
  }

  const underlyingName = (rows.find((r) => r.UnderlyingIndexName)?.UnderlyingIndexName || "").trim().toUpperCase();
  if (!underlyingName) return null;
  const list = await getIndexList(quoteSegment);
  const hit = list.find((e) => e.name === underlyingName);
  if (!hit) return null;
  return { exchangeSegment: quoteSegment, exchangeInstrumentID: Number(hit.token) };
}
