/**
 * IIFL Securities (XTS) instrument-master + quote helpers.
 *
 * IIFL's Market Data API has no native option-chain endpoint, so strikes,
 * expiries and instrument tokens are resolved from XTS's daily pipe-delimited
 * instrument master (POST /instruments/master), cached once/day like
 * Zerodha's and Angel One's CSV masters. Quotes are fetched in batches of 50
 * instruments via POST /instruments/quotes — the exact cap openalgo's IIFL
 * plugin documents ("XTS API limit: only 50 instruments allowed per
 * request"). Open Interest comes from a second batched call with
 * xtsMessageCode 1510 (the Touchline call, code 1502, doesn't carry OI).
 *
 * Field layout for Options rows in the master dump (verified against a real
 * XTS Market Data API sample response):
 *   ExchangeSegment|ExchangeInstrumentID|InstrumentType|Name|Description|Series|
 *   NameWithSeries|InstrumentID|PriceBand.High|PriceBand.Low|FreezeQty|TickSize|
 *   LotSize|Multiplier|UnderlyingInstrumentId|UnderlyingIndexName|
 *   ContractExpiration|StrikePrice|OptionType|DisplayName|PriceNumerator|
 *   PriceDenominator|DetailedDescription
 * InstrumentType "2" = Options. OptionType 3 = CE, 4 = PE (confirmed against
 * openalgo's `{1: "FUT", 3: "CE", 4: "PE"}` mapping). ContractExpiration is
 * ISO-ish ("2026-02-17T14:30:00"). The `Name` column is NOT reliable as the
 * underlying key — IIFL's feed labels NIFTY's own option rows "INIFTY" while
 * its future rows say "NIFTY" — so underlying matching uses the
 * human-readable `UnderlyingIndexName` column ("Nifty 50") instead, which is
 * consistent across instrument types.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { xtsGet, xtsPost } from "./iiflAuth.mjs";

// XTS numeric exchange segment codes (confirmed via openalgo's exchange_segment_map).
export const SEGMENT = { NSECM: 1, NSEFO: 2, NSECD: 3, BSECM: 11, BSEFO: 12, MCXFO: 51 };

// Which /instruments/master exchangeSegmentList entry holds each symbol's option chain.
const OPTION_MASTER_SEGMENT = {
  NIFTY: "NSEFO",
  BANKNIFTY: "NSEFO",
  FINNIFTY: "NSEFO",
  MIDCPNIFTY: "NSEFO",
  SENSEX: "BSEFO",
};

// Which /instruments/indexlist exchangeSegment (1=NSE, 11=BSE) holds each symbol's spot index.
const INDEX_LIST_SEGMENT = {
  NIFTY: SEGMENT.NSECM,
  BANKNIFTY: SEGMENT.NSECM,
  FINNIFTY: SEGMENT.NSECM,
  MIDCPNIFTY: SEGMENT.NSECM,
  SENSEX: SEGMENT.BSECM,
};

// Normalized (uppercase, alnum-only) aliases matched against UnderlyingIndexName /
// indexlist entries. NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY confirmed against a real
// XTS indexlist sample ("NIFTY 50", "NIFTY BANK", "NIFTY FIN SERVICE",
// "NIFTY MID SELECT"). SENSEX's exact BSE index-list label is unverified —
// several plausible variants are matched defensively.
const SYMBOL_ALIASES = {
  NIFTY: ["NIFTY50"],
  BANKNIFTY: ["NIFTYBANK"],
  FINNIFTY: ["NIFTYFINSERVICE"],
  MIDCPNIFTY: ["NIFTYMIDSELECT"],
  SENSEX: ["SENSEX", "SPBSESENSEX", "BSESENSEX"], // unverified alias set
};

export function normalize(str) {
  return String(str || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function matchesSymbol(name, symbol) {
  const n = normalize(name);
  return (SYMBOL_ALIASES[symbol] || []).some((alias) => n === alias);
}

/** Parses one pipe-delimited Options row into our shared shape; returns null for non-option rows. */
function parseOptionRow(fields) {
  if (fields[2] !== "2") return null; // InstrumentType 2 = Options
  const optionType = fields[18];
  if (optionType !== "3" && optionType !== "4") return null;
  const expiryIso = fields[16];
  const expiryDate = expiryIso ? expiryIso.slice(0, 10) : null; // "YYYY-MM-DD"
  if (!expiryDate) return null;
  return {
    token: fields[1],
    segment: SEGMENT[fields[0]] ?? null,
    underlyingIndexName: fields[15],
    expiry: expiryDate,
    strike: Number(fields[17]),
    type: optionType === "3" ? "CE" : "PE",
    displayName: fields[19],
  };
}

async function downloadMasterSegment(creds, segmentName) {
  const json = await xtsPost(creds, "/instruments/master", { exchangeSegmentList: [segmentName] });
  if (typeof json?.result !== "string") {
    throw new Error(`IIFL Securities instrument master download returned an unexpected shape for ${segmentName}`);
  }

  const rows = [];
  for (const line of json.result.split("\n")) {
    if (!line.trim()) continue;
    const row = parseOptionRow(line.split("|"));
    if (row) rows.push(row);
  }
  return rows;
}

/** Full day's Options rows for one XTS exchange segment (NSEFO/BSEFO), cached once/day. */
async function getMasterOptionRows(creds, segmentName) {
  return getCachedOrFetch(`iifl:master:${segmentName}`, () => downloadMasterSegment(creds, segmentName), ONE_DAY_MS);
}

/** All CE/PE rows for a given app symbol, across every expiry. */
export async function getOptionRows(creds, symbol) {
  const segmentName = OPTION_MASTER_SEGMENT[symbol];
  if (!segmentName) throw new Error(`Unknown symbol: ${symbol}`);
  const rows = await getMasterOptionRows(creds, segmentName);
  return rows.filter((r) => matchesSymbol(r.underlyingIndexName, symbol));
}

export function distinctExpiriesAscending(rows) {
  const set = new Set(rows.map((r) => r.expiry).filter(Boolean));
  return Array.from(set).sort();
}

async function downloadIndexList(creds, exchangeSegment) {
  const json = await xtsGet(creds, "/instruments/indexlist", { exchangeSegment: String(exchangeSegment) });
  const list = json?.result?.indexList || [];
  return list.map((entry) => {
    const idx = entry.lastIndexOf("_");
    return { name: idx === -1 ? entry : entry.slice(0, idx), token: idx === -1 ? null : entry.slice(idx + 1) };
  });
}

async function getIndexList(creds, exchangeSegment) {
  return getCachedOrFetch(`iifl:indexlist:${exchangeSegment}`, () => downloadIndexList(creds, exchangeSegment), ONE_DAY_MS);
}

/**
 * Resolves a symbol's spot-index {segment, token} via the daily-cached index
 * list, or null if the symbol's index-list entry can't be matched (e.g. the
 * unverified SENSEX alias set above misses the live label). Returns null
 * rather than throwing — matches every other XTS-family sibling's
 * (ibulls/rmoney/jainamxts/wisdom/compositedge) graceful-degrade convention
 * for this exact failure mode, so a single unresolved index token degrades
 * the option chain's last_price to 0 instead of failing the whole request.
 */
export async function getIndexToken(creds, symbol) {
  const segment = INDEX_LIST_SEGMENT[symbol];
  if (!segment) throw new Error(`Unknown symbol: ${symbol}`);
  const list = await getIndexList(creds, segment);
  const match = list.find((e) => matchesSymbol(e.name, symbol));
  if (!match) return null;
  return { segment, token: match.token };
}

// XTS message codes for /instruments/quotes.
const MSG_TOUCHLINE = 1502;
const MSG_OPEN_INTEREST = 1510;
const QUOTE_BATCH_SIZE = 50; // documented XTS per-request instrument cap
const QUOTE_BATCH_DELAY_MS = 150;

function instrumentKey(segment, token) {
  return `${segment}_${token}`;
}

async function fetchQuoteBatch(creds, instruments, xtsMessageCode) {
  const json = await xtsPost(creds, "/instruments/quotes", {
    instruments,
    xtsMessageCode,
    publishFormat: "JSON",
  });
  const listQuotes = json?.result?.listQuotes || [];
  const out = new Map();
  for (const raw of listQuotes) {
    let q;
    try { q = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { continue; }
    if (!q) continue;
    out.set(instrumentKey(q.ExchangeSegment, q.ExchangeInstrumentID), q);
  }
  return out;
}

/** Batched Touchline (LTP/OHLC/bid/ask/volume) quotes for a list of {segment, token} instruments. */
export async function fetchTouchlineQuotes(creds, instruments) {
  const xtsInstruments = instruments.map((i) => ({ exchangeSegment: i.segment, exchangeInstrumentID: i.token }));
  const batches = await batchWithDelay(xtsInstruments, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, (chunk) =>
    fetchQuoteBatch(creds, chunk, MSG_TOUCHLINE)
  );
  const merged = new Map();
  for (const m of batches) for (const [k, v] of m) merged.set(k, v);
  return merged;
}

/** Batched Open Interest quotes. Best-effort — callers should tolerate a failed/empty map. */
export async function fetchOpenInterestQuotes(creds, instruments) {
  const xtsInstruments = instruments.map((i) => ({ exchangeSegment: i.segment, exchangeInstrumentID: i.token }));
  const batches = await batchWithDelay(xtsInstruments, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, (chunk) =>
    fetchQuoteBatch(creds, chunk, MSG_OPEN_INTEREST)
  );
  const merged = new Map();
  for (const m of batches) for (const [k, v] of m) merged.set(k, v);
  return merged;
}

export { instrumentKey };
