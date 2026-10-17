/**
 * Deterministic, clearly labelled sample snapshots for the dashboard and watchlist. Used only when
 * the proxy is offline and nothing is saved locally, so the pages are never empty. Every consumer
 * must show a "Sample data" chip next to these numbers.
 *
 * - Index spots are the same ones the sample option chain uses (positionStore spot map), so the
 *   dashboard, Option Chain and Strategy Builder agree in sample mode.
 * - Day changes, F&O stock prices, volume and OI change come from the screener's seeded sample
 *   generator, so the dashboard, Screener and Watchlist agree with each other too.
 * - India VIX is the sample chain's default NIFTY ATM IV, because VIX is built from NIFTY options.
 */
import { addCalendarDays, classifyBuildup, defaultSampleIv, istDateString, isTradingDay, type Buildup } from "@/lib/options";
import { getSpotPrice } from "@/lib/positionStore";
import { sampleRows, seededRandom } from "@/lib/screener/sample";
import type { ScreenerRow } from "@/lib/screener/metrics";
import type { FnOStockData, SectorSnapshot, VixSnapshot } from "@/lib/marketApi";
import type { IndexData } from "@/lib/mockData";

/** Same default seed as the screener sample, so the pages show the same numbers. */
export const SAMPLE_SEED = 20261017;

export const SAMPLE_REASON = "Proxy offline and nothing saved in this browser. Illustrative sample numbers, not market data.";

const r2 = (x: number) => Math.round(x * 100) / 100;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const rowsCache = new Map<number, ScreenerRow[]>();
function rowsFor(seed: number): ScreenerRow[] {
  let rows = rowsCache.get(seed);
  if (!rows) {
    rows = sampleRows(seed);
    rowsCache.set(seed, rows);
  }
  return rows;
}

// ───────────────────────── Indices ─────────────────────────

export const SAMPLE_INDEX_LIST: ReadonlyArray<{ symbol: string; name: string }> = [
  { symbol: "NIFTY", name: "NIFTY 50" },
  { symbol: "BANKNIFTY", name: "NIFTY BANK" },
  { symbol: "FINNIFTY", name: "NIFTY FIN SERVICE" },
  { symbol: "MIDCPNIFTY", name: "NIFTY MID SELECT" },
];

export interface SampleIndex extends IndexData {
  /** Intraday 5-minute closes from the open to the last price (75 bars = a full session). */
  path: number[];
}

/**
 * A Brownian bridge from `from` to `to` with `n` points. Seeded, so the same symbol always draws
 * the same line. The first and last points are exact.
 */
export function bridgePath(from: number, to: number, n: number, vol: number, rnd: () => number): number[] {
  if (n < 2) return [to];
  const steps = n - 1;
  const walk: number[] = [0];
  for (let i = 1; i <= steps; i++) walk.push(walk[i - 1] + (rnd() - 0.5) * 2);
  const end = walk[steps];
  return walk.map((w, i) => {
    const t = i / steps;
    const bridge = w - t * end; // pinned to 0 at both ends
    return r2(from + (to - from) * t + bridge * vol);
  });
}

/** Sample quotes for the four NSE F&O indices. */
export function sampleIndices(seed = SAMPLE_SEED): SampleIndex[] {
  const rows = rowsFor(seed);
  const pctOf = (symbol: string) => rows.find((r) => r.symbol === symbol)?.changePct ?? 0;
  return SAMPLE_INDEX_LIST.map(({ symbol, name }) => {
    const rnd = seededRandom(hash(`idx|${symbol}`) ^ seed);
    const ltp = getSpotPrice(symbol);
    const changePercent = r2(pctOf(symbol));
    const prevClose = r2(ltp / (1 + changePercent / 100));
    const open = r2(prevClose * (1 + (rnd() - 0.5) * 0.006));
    const path = bridgePath(open, ltp, 75, ltp * 0.0009, rnd);
    return {
      symbol,
      name,
      ltp,
      change: r2(ltp - prevClose),
      changePercent,
      open,
      // The path is 5-minute closes pinned at the open and the last price; the session's
      // extremes trade beyond both ends, so the day closes neither exactly at its low nor its high.
      high: r2(Math.max(Math.max(...path), Math.max(open, ltp) * (1.001 + rnd() * 0.004))),
      low: r2(Math.min(Math.min(...path), Math.min(open, ltp) * (0.999 - rnd() * 0.004))),
      prevClose,
      path,
    };
  });
}

// ───────────────────────── F&O stocks ─────────────────────────

export interface SampleStock extends FnOStockData {
  openInterest: number;
  oiChange: number;
  sector: string;
}

/** Sample quotes for every static F&O stock (no indices), from the screener sample rows. */
export function sampleStocks(seed = SAMPLE_SEED): SampleStock[] {
  return rowsFor(seed)
    .filter((r) => r.kind === "STOCK")
    .map((r) => {
      const rnd = seededRandom(hash(`stk|${r.symbol}`) ^ seed);
      const ltp = r.ltp;
      const previousClose = r2(ltp / (1 + r.changePct / 100));
      const open = r2(previousClose * (1 + (rnd() - 0.5) * 0.012));
      const high = r2(Math.max(open, ltp) * (1 + rnd() * 0.008));
      const low = r2(Math.min(open, ltp) * (1 - rnd() * 0.008));
      // OI in shares, a few times the day's volume, and the change implied by the sample OI change %.
      const openInterest = Math.round(r.volume * (2 + rnd() * 6));
      const oiChange = Math.round(openInterest - openInterest / (1 + (r.oiChangePct ?? 0) / 100));
      return {
        symbol: r.symbol,
        ltp,
        change: r2(ltp - previousClose),
        changePercent: r.changePct,
        open,
        high,
        low,
        previousClose,
        volume: r.volume,
        totalTradedVolume: r.volume,
        openInterest,
        oiChange,
        sector: r.sector,
      };
    });
}

const BUILDUP_TEXT: Record<Buildup, string> = {
  LONG_BUILDUP: "Long Buildup",
  SHORT_BUILDUP: "Short Buildup",
  SHORT_COVERING: "Short Covering",
  LONG_UNWINDING: "Long Unwinding",
  NEUTRAL: "Neutral",
};

export interface StockSummary<T extends FnOStockData> {
  gainers: T[];
  losers: T[];
  mostActive: Array<T & { oi: number; oiChange: number; oiInterpretation: string }>;
}

/** Top five gainers and losers and the ten most active by volume (same rules as the live hook). */
export function summariseStocks<T extends FnOStockData>(stocks: readonly T[]): StockSummary<T> {
  const gainers = stocks.filter((s) => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
  const losers = stocks.filter((s) => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
  const mostActive = [...stocks]
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, 10)
    .map((s) => ({ ...s, oi: s.openInterest || 0, oiChange: s.oiChange || 0, oiInterpretation: BUILDUP_TEXT[classifyBuildup(s.changePercent, s.oiChange || 0)] }));
  return { gainers, losers, mostActive };
}

// ───────────────────────── Breadth, VIX and sectors ─────────────────────────

export interface SampleBreadth {
  advances: number;
  declines: number;
  unchanged: number;
}

/** Advance/decline over a stock list. Moves within ±0.05% count as unchanged. */
export function breadthOf(stocks: readonly Pick<FnOStockData, "changePercent">[]): SampleBreadth {
  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  for (const s of stocks) {
    if (!Number.isFinite(s.changePercent)) continue;
    if (s.changePercent > 0.05) advances += 1;
    else if (s.changePercent < -0.05) declines += 1;
    else unchanged += 1;
  }
  return { advances, declines, unchanged };
}

/** Sample India VIX: the sample chain's NIFTY ATM IV, with a seeded day change. */
export function sampleVix(seed = SAMPLE_SEED): VixSnapshot {
  const rnd = seededRandom(hash("vix") ^ seed);
  const value = r2(defaultSampleIv("NIFTY") * 100);
  const changePercent = r2((rnd() - 0.55) * 8);
  const prev = value / (1 + changePercent / 100);
  return { value, change: r2(value - prev), changePercent, high: r2(Math.max(value, prev) * (1 + rnd() * 0.03)), low: r2(Math.min(value, prev) * (1 - rnd() * 0.03)) };
}

/** Average change of the sample stocks in each sector (two or more stocks), best first. */
export function sampleSectors(stocks: readonly SampleStock[]): SectorSnapshot[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const s of stocks) {
    if (!s.sector || s.sector === "Other") continue;
    const e = map.get(s.sector) ?? { total: 0, count: 0 };
    e.total += s.changePercent;
    e.count += 1;
    map.set(s.sector, e);
  }
  return Array.from(map.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([name, v]) => ({ name, fullName: name, change: r2(v.total / v.count), ltp: 0, open: 0, high: 0, low: 0 }))
    .sort((a, b) => b.change - a.change);
}

/**
 * A seeded, mean-reverting daily India VIX history that ends at `current`, one point per NSE trading
 * day going back from `now` (IST). Times are 15:30 IST closes in epoch milliseconds.
 */
export function sampleVixHistory(current: number, now: Date = new Date(), sessions = 63, seed = SAMPLE_SEED): Array<{ time: number; close: number }> {
  if (!(current > 0) || sessions < 2) return [];
  const days: string[] = [];
  let d = istDateString(now);
  for (let guard = 0; days.length < sessions && guard < sessions * 3; guard++) {
    if (isTradingDay(d)) days.push(d);
    d = addCalendarDays(d, -1);
  }
  days.reverse();
  const rnd = seededRandom(hash("vixhist") ^ seed);
  const mean = current * 1.05;
  const values: number[] = new Array(days.length);
  values[days.length - 1] = current;
  // Walk backwards from today's value so the series always ends exactly at `current`.
  for (let i = days.length - 2; i >= 0; i--) {
    const prev = values[i + 1];
    const next = prev + (mean - prev) * 0.08 + (rnd() - 0.5) * current * 0.06;
    values[i] = r2(Math.max(current * 0.6, Math.min(current * 1.6, next)));
  }
  return days.map((day, i) => ({ time: Date.parse(`${day}T10:00:00Z`), close: values[i] }));
}

export interface SampleMarketSnapshot {
  indices: SampleIndex[];
  stocks: SampleStock[];
  vix: VixSnapshot;
  sectors: SectorSnapshot[];
  breadth: SampleBreadth;
}

/** Everything the dashboard needs in sample mode, built once per seed. */
export function sampleMarketSnapshot(seed = SAMPLE_SEED): SampleMarketSnapshot {
  const stocks = sampleStocks(seed);
  return { indices: sampleIndices(seed), stocks, vix: sampleVix(seed), sectors: sampleSectors(stocks), breadth: breadthOf(stocks) };
}
