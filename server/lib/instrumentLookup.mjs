/**
 * Authoritative lot size / tick size lookup, resolved from Dhan's instrument
 * master rather than from a constant in the app.
 *
 * WHY THIS EXISTS — this fixes a live money bug. src/lib/positionStore.ts ships
 * a hardcoded LOT_SIZE_MAP (NIFTY 25, BANKNIFTY 15) that has not tracked NSE's
 * lot-size revisions. buildOrderBody() computes quantity = lots x lotSize, but
 * it was taking lotSize from whatever the browser sent — so a stale constant
 * silently placed the wrong size at market.
 *
 * The rule now: the SERVER resolves lot size from the exchange's own master and
 * REJECTS the order if it cannot. A wrong quantity is worse than a failed order.
 *
 * The master is a multi-MB CSV that changes once a day, so it goes through the
 * shared instrumentCache (disk + memory + in-flight de-dup).
 */

import { getCachedOrFetch, ONE_DAY_MS } from "./instrumentCache.mjs";
import { tickKey } from "./dhanPacketParser.mjs";

const MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master.csv";
const CACHE_KEY = "dhan:lot-size-master";

// CSV exchange+segment code → the segment names the feed and order APIs use.
const SEGMENT_MAP = {
  "NSE:E": "NSE_EQ",
  "NSE:D": "NSE_FNO",
  "NSE:I": "IDX_I",
  "NSE:C": "NSE_CUR",
  "BSE:E": "BSE_EQ",
  "BSE:D": "BSE_FNO",
  "BSE:I": "IDX_I",
  "MCX:M": "MCX_COMM",
};

/** Split one CSV line, honouring double-quoted fields (symbols contain commas). */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function downloadInstrumentIndex() {
  const res = await fetch(MASTER_URL);
  if (!res.ok) throw new Error(`Failed to download Dhan instrument master: ${res.status}`);
  const text = await res.text();

  const lines = text.split("\n");
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name) => header.indexOf(name);

  const iExch = idx("SEM_EXM_EXCH_ID");
  const iSeg = idx("SEM_SEGMENT");
  const iSecId = idx("SEM_SMST_SECURITY_ID");
  const iLot = idx("SEM_LOT_UNITS");
  const iTick = idx("SEM_TICK_SIZE");
  const iSymbol = idx("SEM_TRADING_SYMBOL");
  const iCustom = idx("SEM_CUSTOM_SYMBOL");
  const iExpiry = idx("SEM_EXPIRY_DATE");
  const iStrike = idx("SEM_STRIKE_PRICE");
  const iOptType = idx("SEM_OPTION_TYPE");
  const iInstr = idx("SEM_INSTRUMENT_NAME");
  const iUnderlying = idx("SM_SYMBOL_NAME");

  if (iSecId < 0 || iLot < 0) {
    throw new Error("Dhan instrument master is missing SEM_SMST_SECURITY_ID / SEM_LOT_UNITS");
  }

  // Plain object rather than a Map so instrumentCache can JSON round-trip it.
  const bySecurity = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length < 10) continue;
    const cols = splitCsvLine(line);

    const securityId = cols[iSecId]?.trim();
    if (!securityId) continue;

    const segment = SEGMENT_MAP[`${cols[iExch]?.trim()}:${cols[iSeg]?.trim()}`];
    if (!segment) continue;

    const lotSize = Math.round(parseFloat(cols[iLot]?.trim()) || 0);
    const tickSize = parseFloat(cols[iTick]?.trim()) || 0.05;

    bySecurity[tickKey(segment, securityId)] = {
      securityId,
      exchangeSegment: segment,
      lotSize,
      tickSize,
      tradingSymbol: cols[iSymbol]?.trim() || "",
      customSymbol: iCustom >= 0 ? cols[iCustom]?.trim() || "" : "",
      expiry: iExpiry >= 0 ? cols[iExpiry]?.trim() || "" : "",
      strike: iStrike >= 0 ? parseFloat(cols[iStrike]?.trim()) || 0 : 0,
      optionType: iOptType >= 0 ? cols[iOptType]?.trim() || "" : "",
      instrumentType: iInstr >= 0 ? cols[iInstr]?.trim() || "" : "",
      underlying: iUnderlying >= 0 ? cols[iUnderlying]?.trim() || "" : "",
    };
  }

  const count = Object.keys(bySecurity).length;
  if (count === 0) throw new Error("Dhan instrument master parsed to zero instruments");
  console.log(`  📇 Instrument index built: ${count} instruments`);
  return bySecurity;
}

/** The whole securityId-keyed index, cached for a day. */
export async function getInstrumentIndex() {
  return getCachedOrFetch(CACHE_KEY, downloadInstrumentIndex, ONE_DAY_MS);
}

/**
 * Look up one instrument. Returns null when unknown — callers placing orders
 * MUST treat that as a hard failure, never as "use a default".
 */
export async function lookupInstrument(exchangeSegment, securityId) {
  if (!exchangeSegment || securityId == null) return null;
  const index = await getInstrumentIndex();
  return index[tickKey(exchangeSegment, String(securityId))] || null;
}

/**
 * Resolve the tradable lot size for an instrument.
 *
 * Throws rather than returning a fallback: every caller is on an order path,
 * and a guessed lot size is a wrong-sized real trade.
 */
export async function resolveLotSize(exchangeSegment, securityId) {
  const instrument = await lookupInstrument(exchangeSegment, securityId);
  if (!instrument) {
    throw new Error(
      `Unknown instrument ${exchangeSegment}:${securityId} — refusing to guess lot size. ` +
      `Refresh the instrument master and try again.`,
    );
  }
  if (!Number.isFinite(instrument.lotSize) || instrument.lotSize <= 0) {
    throw new Error(
      `Instrument ${exchangeSegment}:${securityId} (${instrument.tradingSymbol}) reports ` +
      `lot size ${instrument.lotSize} — refusing to place an order on it.`,
    );
  }
  return instrument.lotSize;
}

/** Round a price to the instrument's tick, away from the side that hurts you. */
export function roundToTick(price, tickSize, side) {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) return price;
  // Snap when the division lands a hair off an exact tick: 100.05 / 0.05 is
  // 2000.9999999999998 in binary floating point, and a bare floor() would move
  // an already-valid price a full tick the wrong way.
  const raw = price / tickSize;
  const nearest = Math.round(raw);
  const ticks = Math.abs(raw - nearest) < 1e-9 ? nearest : raw;
  // BUY rounds down and SELL rounds up, so tick rounding never widens the
  // worst-case price you could be filled at.
  const rounded = side === "BUY" ? Math.floor(ticks) : Math.ceil(ticks);
  return Number((rounded * tickSize).toFixed(2));
}
