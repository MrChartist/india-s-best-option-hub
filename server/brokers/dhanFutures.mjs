/**
 * Dhan futures & MCX commodity data — split out of dhan.mjs (which crossed the
 * 300-line limit once this section was added). Re-exported from dhan.mjs so
 * every existing import (`fetchFuturesQuotes`, `fetchRolloverData`,
 * `fetchMCXExpiryList` from "./dhan.mjs", and the `dhan.fetchFuturesQuotes`
 * namespace access the generic /api/broker-proxy path uses via registry.mjs)
 * keeps working unchanged.
 */

import { dhanFetch } from "./dhan.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { classifyBuildup } from "../lib/futuresUtils.mjs";
import { recordSnapshot, getPreviousValue } from "../lib/dailySnapshotStore.mjs";

const INSTRUMENT_CSV_URL = "https://images.dhan.co/api-data/api-scrip-master.csv";

// ── Stock/index futures — resolves FUTSTK/FUTIDX contracts off the same public
// instrument master used by the "instruments" endpoint, then batches real quotes. ──

async function downloadFuturesInstruments() {
  const res = await fetch(INSTRUMENT_CSV_URL);
  if (!res.ok) throw new Error(`Failed to download instrument master: ${res.status}`);
  const csvText = await res.text();
  const lines = csvText.split("\n");
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name) => header.indexOf(name);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 8) continue;
    // NSE + "D" segment code = NSE_FNO (futures & options) — see SEGMENT_MAP in
    // proxy-server.mjs's instrument parsing for the full exchange/segment table.
    if (cols[idx("SEM_EXM_EXCH_ID")]?.trim() !== "NSE" || cols[idx("SEM_SEGMENT")]?.trim() !== "D") continue;
    const instrumentType = cols[idx("SEM_INSTRUMENT_NAME")]?.trim();
    if (instrumentType !== "FUTSTK" && instrumentType !== "FUTIDX") continue;

    const customSymbol = cols[idx("SEM_CUSTOM_SYMBOL")]?.trim();
    const tradingSymbol = cols[idx("SEM_TRADING_SYMBOL")]?.trim();
    // e.g. "RELIANCE SEP FUT" -> "RELIANCE" — the base symbol is always the first token.
    const symbol = (customSymbol || tradingSymbol || "").split(" ")[0];
    const expiryDate = cols[idx("SEM_EXPIRY_DATE")]?.trim();
    if (!symbol || !expiryDate || expiryDate === "0001-01-01") continue;

    rows.push({
      securityId: cols[idx("SEM_SMST_SECURITY_ID")]?.trim(),
      symbol,
      instrumentType,
      expiryDate,
      lotSize: parseInt(parseFloat(cols[idx("SEM_LOT_UNITS")]?.trim()) || "1", 10),
    });
  }
  return rows;
}

async function getFuturesInstruments() {
  return getCachedOrFetch("dhan:futures-instruments", downloadFuturesInstruments, ONE_DAY_MS);
}

// ── MCX commodity expiries — each commodity has its own expiry cycle (crude
// ~19th-21st, gold/silver ~4th-5th, natural gas ~23rd-28th of the month), nothing
// like NSE's single shared weekly/monthly calendar. There is no
// "UnderlyingScrip" concept for MCX in Dhan's option-chain API, so this reads
// the same public instrument master used for stock/index futures above instead
// of approximating a date. The CSV download itself needs no auth token. ──

async function downloadMCXInstruments() {
  const res = await fetch(INSTRUMENT_CSV_URL);
  if (!res.ok) throw new Error(`Failed to download instrument master: ${res.status}`);
  const csvText = await res.text();
  const lines = csvText.split("\n");
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name) => header.indexOf(name);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 8) continue;
    if (cols[idx("SEM_EXM_EXCH_ID")]?.trim() !== "MCX" || cols[idx("SEM_SEGMENT")]?.trim() !== "M") continue;
    if (cols[idx("SEM_INSTRUMENT_NAME")]?.trim() !== "FUTCOM") continue;

    // SM_SYMBOL_NAME is the clean root symbol Dhan itself resolves the contract
    // to (e.g. "GOLD" vs "GOLDM" for the mini contract) — more reliable than
    // splitting the human-readable custom symbol ourselves.
    const symbol = cols[idx("SM_SYMBOL_NAME")]?.trim();
    const expiryDate = cols[idx("SEM_EXPIRY_DATE")]?.trim().split(" ")[0]; // drop time-of-day
    if (!symbol || !expiryDate || expiryDate === "0001-01-01") continue;

    rows.push({ symbol, expiryDate });
  }
  return rows;
}

async function getMCXInstruments() {
  return getCachedOrFetch("dhan:mcx-instruments", downloadMCXInstruments, ONE_DAY_MS);
}

/** Real MCX commodity expiry calendar for an exact symbol (CRUDEOIL, GOLD,
 * SILVER, NATURALGAS, ...), ascending, unexpired only — matches the shape
 * `optionchain/expirylist` returns for NSE indices. */
export async function fetchMCXExpiryList(symbol) {
  const instruments = await getMCXInstruments();
  const now = Date.now();
  const dates = [...new Set(
    instruments
      .filter((i) => i.symbol === symbol && new Date(i.expiryDate).getTime() > now)
      .map((i) => i.expiryDate)
  )].sort();
  return { status: "success", data: dates };
}

/** Nearest unexpired FUTSTK/FUTIDX contract for an EXACT base-symbol match — a
 * prefix match would also catch unrelated instruments (e.g. "NIFTY" prefix-matching
 * "NIFTYFPI" or "NIFTYNXT50", which are different underlyings entirely). */
function resolveNearestFuture(instruments, symbol) {
  const now = Date.now();
  return instruments
    .filter((i) => i.symbol === symbol && new Date(i.expiryDate).getTime() > now)
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))[0] || null;
}

/** Nearest AND next-nearest unexpired contracts, for rollover analysis
 * (comparing the expiring series against the one traders are shifting into). */
function resolveNearAndNextFuture(instruments, symbol) {
  const now = Date.now();
  const sorted = instruments
    .filter((i) => i.symbol === symbol && new Date(i.expiryDate).getTime() > now)
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
  return { near: sorted[0] || null, next: sorted[1] || null };
}

/**
 * Real futures LTP/OI/volume for a batch of symbols (stock or index). Not part
 * of the shared registry.mjs contract (optional — only Dhan implements it today);
 * OI change is derived from our own daily snapshot history, not Dhan's response,
 * since the REST quote endpoint doesn't carry yesterday's closing OI.
 */
export async function fetchFuturesQuotes(creds, symbols) {
  const instruments = await getFuturesInstruments();
  const resolved = symbols
    .map((symbol) => ({ symbol, contract: resolveNearestFuture(instruments, symbol) }))
    .filter((r) => r.contract);
  if (resolved.length === 0) return { status: "success", data: [] };

  const bySecId = new Map(resolved.map((r) => [String(r.contract.securityId), r]));
  const allSecIds = resolved.map((r) => parseInt(r.contract.securityId, 10));

  // Conservative chunk size — this batches far more instruments per call than the
  // option-chain path ever has, and Dhan's real per-call ceiling isn't verified yet.
  const chunkResults = await batchWithDelay(allSecIds, 100, 1500, async (chunk) => {
    const quote = await dhanFetch("/marketfeed/quote", { NSE_FNO: chunk }, "POST", creds?.clientId, creds?.accessToken);
    return quote?.data?.NSE_FNO || {};
  });

  const results = [];
  for (const chunkData of chunkResults) {
    for (const [secId, q] of Object.entries(chunkData || {})) {
      const r = bySecId.get(secId);
      if (!r || !q) continue;

      const ltp = q.last_price;
      const prevClose = q.ohlc?.close;
      const oi = q.oi;
      const priceChangePercent = Number.isFinite(ltp) && Number.isFinite(prevClose) && prevClose !== 0
        ? Math.round(((ltp - prevClose) / prevClose) * 10000) / 100
        : null;

      const prevOI = getPreviousValue("futuresOI", secId);
      const oiChangePercent = Number.isFinite(oi) && Number.isFinite(prevOI) && prevOI !== 0
        ? Math.round(((oi - prevOI) / prevOI) * 10000) / 100
        : null;
      if (Number.isFinite(oi)) recordSnapshot("futuresOI", secId, oi);

      results.push({
        symbol: r.symbol,
        securityId: String(r.contract.securityId),
        instrumentType: r.contract.instrumentType,
        expiryDate: r.contract.expiryDate,
        lotSize: r.contract.lotSize,
        futuresLtp: Number.isFinite(ltp) ? ltp : null,
        priceChangePercent,
        oi: Number.isFinite(oi) ? oi : null,
        oiChangePercent,
        volume: Number.isFinite(q.volume) ? q.volume : null,
        buildupSignal: classifyBuildup(priceChangePercent, oiChangePercent),
      });
    }
  }
  return { status: "success", data: results };
}

/**
 * Rollover analysis — near-month vs next-month OI, the standard read on how
 * much of the market has already shifted into the next series ahead of
 * expiry. Real Dhan quotes for BOTH contracts per symbol, not an estimate.
 */
export async function fetchRolloverData(creds, symbols) {
  const instruments = await getFuturesInstruments();
  const resolved = symbols
    .map((symbol) => ({ symbol, ...resolveNearAndNextFuture(instruments, symbol) }))
    .filter((r) => r.near && r.next); // rollover needs both series to exist

  if (resolved.length === 0) return { status: "success", data: [] };

  // One combined batch for near + next contracts together, tagged so each
  // resolved quote can be routed back to the right symbol/leg.
  const secIdTag = new Map();
  const allSecIds = [];
  for (const r of resolved) {
    secIdTag.set(String(r.near.securityId), { symbol: r.symbol, leg: "near" });
    secIdTag.set(String(r.next.securityId), { symbol: r.symbol, leg: "next" });
    allSecIds.push(parseInt(r.near.securityId, 10), parseInt(r.next.securityId, 10));
  }

  const chunkResults = await batchWithDelay(allSecIds, 100, 1500, async (chunk) => {
    const quote = await dhanFetch("/marketfeed/quote", { NSE_FNO: chunk }, "POST", creds?.clientId, creds?.accessToken);
    return quote?.data?.NSE_FNO || {};
  });

  const bySymbol = new Map(resolved.map((r) => [r.symbol, { ...r, nearQuote: null, nextQuote: null }]));
  for (const chunkData of chunkResults) {
    for (const [secId, q] of Object.entries(chunkData || {})) {
      const tag = secIdTag.get(secId);
      if (!tag || !q) continue;
      const entry = bySymbol.get(tag.symbol);
      if (!entry) continue;
      if (tag.leg === "near") entry.nearQuote = q;
      else entry.nextQuote = q;
    }
  }

  const now = Date.now();
  const results = [];
  for (const entry of bySymbol.values()) {
    const nearOI = entry.nearQuote?.oi;
    const nextOI = entry.nextQuote?.oi;
    if (!Number.isFinite(nearOI) || !Number.isFinite(nextOI)) continue; // both required, no partial guess
    const totalOI = nearOI + nextOI;
    results.push({
      symbol: entry.symbol,
      instrumentType: entry.near.instrumentType,
      nearExpiry: entry.near.expiryDate,
      nextExpiry: entry.next.expiryDate,
      daysToNearExpiry: Math.max(0, Math.ceil((new Date(entry.near.expiryDate).getTime() - now) / (1000 * 60 * 60 * 24))),
      nearOI,
      nextOI,
      nearVolume: Number.isFinite(entry.nearQuote?.volume) ? entry.nearQuote.volume : null,
      nextVolume: Number.isFinite(entry.nextQuote?.volume) ? entry.nextQuote.volume : null,
      rolloverPercent: totalOI > 0 ? Math.round((nextOI / totalOI) * 10000) / 100 : 0,
    });
  }
  return { status: "success", data: results };
}
