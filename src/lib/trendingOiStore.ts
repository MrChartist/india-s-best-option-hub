// Trending OI Store — localStorage-persisted rolling snapshots of the ATM±7
// zone's OI, one series per symbol per trading day. Backs the dedicated
// Trending OI page's history table, which a single live snapshot can't
// express — it needs history.

const STORAGE_KEY = "optionsdesk_trending_oi";
// Raw recording cadence. Deliberately fast (not "one per real trading minute") —
// a brand-new tab needs 3 readings before the table appears at all, and at 60s/reading
// that's a 2+ minute stare at "Collecting readings" on first load. Recording every 10s
// gets there in ~20-30s instead. This doesn't compromise the analysis: the page's own
// "Time Interval" control (resampleTrendingOIRows) buckets these back up to 1/3/5/15min
// for display, so a fast raw cadence just means more real data points to bucket from.
const MIN_INTERVAL_MS = 10_000;
const MAX_SNAPSHOTS = 2400; // ~6.5 trading hours at 1/10s, comfortably covers a full day
// Bump whenever TrendingOISnapshot's shape changes. A browser that recorded
// readings under an older shape (e.g. before ceOI/peOI/netPCR existed) still
// has them sitting in localStorage under today's date — without this check
// they'd be handed to the UI as-is and crash on the missing fields (e.g.
// `r.netPCR.toFixed(2)` on undefined). Version mismatch just means "start
// today's series over," which is a lot cheaper than a crash.
const SCHEMA_VERSION = 2;

export interface TrendingOISnapshot {
  time: number; // epoch ms
  spot: number; // underlying LTP
  ceOI: number; // zone-aggregate absolute CE OI
  peOI: number; // zone-aggregate absolute PE OI
  ceOIChg: number; // zone-aggregate CE OI change
  peOIChg: number; // zone-aggregate PE OI change
  diff: number; // peOIChg - ceOIChg ("Diff in OI")
  netPCR: number; // peOI / ceOI
}

interface StoredDay {
  date: string; // local YYYY-MM-DD
  version: number;
  snapshots: TrendingOISnapshot[];
}

type StoreShape = Record<string, StoredDay>;

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA");
}

function readStore(): StoreShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch { /* ignore parse errors */ }
  return {};
}

function writeStore(store: StoreShape): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* best-effort */ }
}

function currentSeries(store: StoreShape, symbol: string): TrendingOISnapshot[] {
  const day = store[symbol];
  return day?.date === todayKey() && day.version === SCHEMA_VERSION ? day.snapshots : [];
}

/** Snapshots recorded so far today for this symbol (empty if none yet, it's a new day, or an older schema). */
export function getTrendingOIHistory(symbol: string): TrendingOISnapshot[] {
  return currentSeries(readStore(), symbol);
}

/**
 * Appends a reading if at least MIN_INTERVAL_MS has passed since the last one
 * recorded for this symbol today — repeated calls inside that window (e.g. the
 * live chain's 3s refresh) are a no-op. Returns the up-to-date series.
 */
export function recordTrendingOISnapshot(
  symbol: string,
  reading: { spot: number; ceOI: number; peOI: number; ceOIChg: number; peOIChg: number },
  now: number = Date.now(),
): TrendingOISnapshot[] {
  const store = readStore();
  const today = todayKey();
  const existing = currentSeries(store, symbol);

  const last = existing[existing.length - 1];
  if (last && now - last.time < MIN_INTERVAL_MS) return existing;

  const snapshot: TrendingOISnapshot = {
    time: now,
    spot: reading.spot,
    ceOI: reading.ceOI,
    peOI: reading.peOI,
    ceOIChg: reading.ceOIChg,
    peOIChg: reading.peOIChg,
    diff: reading.peOIChg - reading.ceOIChg,
    netPCR: reading.ceOI > 0 ? Math.round((reading.peOI / reading.ceOI) * 100) / 100 : 0,
  };
  const snapshots = [...existing, snapshot].slice(-MAX_SNAPSHOTS);
  store[symbol] = { date: today, version: SCHEMA_VERSION, snapshots };
  writeStore(store);
  return snapshots;
}

export type TrendingOISignalKind = "Bullish" | "Bearish" | "Neutral";

export interface TrendingOISignal {
  signal: TrendingOISignalKind;
  ceUpFrac: number; // share of recent steps where CE OI change rose (bearish ingredient)
  ceDownFrac: number; // share where CE OI change fell (bullish ingredient)
  peUpFrac: number; // share where PE OI change rose (bullish ingredient)
  peDownFrac: number; // share where PE OI change fell (bearish ingredient)
  readingsUsed: number;
}

const TREND_WINDOW = 30; // last 30 readings at the 10s recording cadence (~5min lookback)
const AGREEMENT_THRESHOLD = 0.7; // real OI ticks are noisy — require most steps to agree, not a strict monotonic run

/**
 * Session-level bias: Bullish when Put OI change continuously rises while
 * Call OI change continuously falls (writers betting the market rises).
 * Bearish is the mirror image. "Continuous" is relaxed to >=70% step-agreement
 * over the window rather than strict monotonicity, which real OI data would
 * almost never satisfy exactly. This is a smoothed complement to the per-row
 * `sentiment` in TrendingOIRow, which just reads the current diff's sign.
 */
export function classifyTrendingOI(history: TrendingOISnapshot[], windowSize: number = TREND_WINDOW): TrendingOISignal {
  const window = history.slice(-windowSize);
  if (window.length < 3) {
    return { signal: "Neutral", ceUpFrac: 0, ceDownFrac: 0, peUpFrac: 0, peDownFrac: 0, readingsUsed: window.length };
  }

  let ceUp = 0, ceDown = 0, peUp = 0, peDown = 0;
  for (let i = 1; i < window.length; i++) {
    const ceDelta = window[i].ceOIChg - window[i - 1].ceOIChg;
    const peDelta = window[i].peOIChg - window[i - 1].peOIChg;
    if (ceDelta > 0) ceUp++; else if (ceDelta < 0) ceDown++;
    if (peDelta > 0) peUp++; else if (peDelta < 0) peDown++;
  }

  const steps = window.length - 1;
  const round2 = (n: number) => Math.round((n / steps) * 100) / 100;
  const ceUpFrac = round2(ceUp);
  const ceDownFrac = round2(ceDown);
  const peUpFrac = round2(peUp);
  const peDownFrac = round2(peDown);

  const bullish = peUpFrac >= AGREEMENT_THRESHOLD && ceDownFrac >= AGREEMENT_THRESHOLD;
  const bearish = ceUpFrac >= AGREEMENT_THRESHOLD && peDownFrac >= AGREEMENT_THRESHOLD;

  return {
    signal: bullish ? "Bullish" : bearish ? "Bearish" : "Neutral",
    ceUpFrac, ceDownFrac, peUpFrac, peDownFrac,
    readingsUsed: window.length,
  };
}

export interface TrendingOIRow extends TrendingOISnapshot {
  dayHighBreak: boolean; // spot made a new intraday high at this reading
  dayLowBreak: boolean; // spot made a new intraday low at this reading
  diffDayHighBreak: boolean; // "Diff in OI" made a new intraday high
  diffDayLowBreak: boolean; // "Diff in OI" made a new intraday low
  directionOfChange: "up" | "down" | "flat"; // diff rising or falling vs the prior reading
  changeInDirection: number; // diff[i] - diff[i-1]
  directionChangePercent: number | null; // % move of diff vs the prior reading
  sentiment: TrendingOISignalKind; // this reading's own diff sign — Bullish (PE chg > CE chg) or Bearish
}

/**
 * Per-row annotations matching the reference "Trending OI" table: day high/low
 * breaks (on both price and the OI diff itself), the row-over-row direction of
 * the diff, and a per-row sentiment tag from the diff's sign alone. Always run
 * on the full-resolution history — resample the *result* for display so day
 * high/low detection doesn't miss anything a coarser interval would skip.
 */
export function annotateTrendingOIRows(history: TrendingOISnapshot[]): TrendingOIRow[] {
  let runningHigh = -Infinity, runningLow = Infinity;
  let diffHigh = -Infinity, diffLow = Infinity;

  return history.map((s, i) => {
    const prev = history[i - 1];

    const dayHighBreak = i > 0 && s.spot > runningHigh;
    const dayLowBreak = i > 0 && s.spot < runningLow;
    runningHigh = Math.max(runningHigh, s.spot);
    runningLow = Math.min(runningLow, s.spot);

    const diffDayHighBreak = i > 0 && s.diff > diffHigh;
    const diffDayLowBreak = i > 0 && s.diff < diffLow;
    diffHigh = Math.max(diffHigh, s.diff);
    diffLow = Math.min(diffLow, s.diff);

    const changeInDirection = prev ? s.diff - prev.diff : 0;
    const directionOfChange: "up" | "down" | "flat" = changeInDirection > 0 ? "up" : changeInDirection < 0 ? "down" : "flat";
    const directionChangePercent = prev && prev.diff !== 0
      ? Math.round((changeInDirection / Math.abs(prev.diff)) * 10000) / 100
      : null;
    const sentiment: TrendingOISignalKind = s.diff > 0 ? "Bullish" : s.diff < 0 ? "Bearish" : "Neutral";

    return { ...s, dayHighBreak, dayLowBreak, diffDayHighBreak, diffDayLowBreak, directionOfChange, changeInDirection, directionChangePercent, sentiment };
  });
}

/** Buckets rows into `intervalMinutes`-wide windows, keeping the latest row per bucket — mirrors the reference table's "Time Interval" control. */
export function resampleTrendingOIRows<T extends { time: number }>(rows: T[], intervalMinutes: number): T[] {
  if (intervalMinutes <= 1) return rows;
  const bucketMs = intervalMinutes * 60_000;
  const buckets = new Map<number, T>();
  for (const row of rows) {
    buckets.set(Math.floor(row.time / bucketMs), row);
  }
  return Array.from(buckets.values());
}
