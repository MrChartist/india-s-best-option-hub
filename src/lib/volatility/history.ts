/**
 * IV and HV history helpers (pure, node-safe).
 *
 * IV history comes from three places, merged per date:
 *   1. "bhavcopy": constant-maturity 30-day ATM IV solved with Black-76 on NSE F&O bhavcopy prices.
 *   2. "snapshot": end-of-day ATM IV saved by the local snapshot recorder (dailyStats).
 *   3. "vix":      India VIX closes (a 30-day NIFTY implied vol index). Used for NIFTY only.
 *   4. "sample":   a seeded, clearly labelled illustration (see sampleHistory.ts). Never market data.
 *
 * All IV values here are in PERCENT (14.2 means 14.2%). HV helpers return PERCENT as well, so the
 * page can compare IV and HV directly. Raw maths comes from "@/lib/options".
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import type { DailyStat } from "@/lib/snapshotStore";
import type { BhavcopyFoRow, ColumnarCandlesDTO, VixHistoryRow } from "@/lib/types/market";
import {
  addCalendarDays,
  atmIV,
  calendarDaysBetween,
  chainForward,
  constantMaturityIV,
  emHitRate,
  enrichChain,
  expectedMoveFromIV,
  hvCloseToClose,
  hvParkinson,
  hvYangZhang,
  isTradingDay,
  ivPercentile,
  ivRank,
  nowIST,
  previousTradingDay,
  rollingHV,
  timeToExpiryYears,
  toISTDate,
  type OHLC,
} from "@/lib/options";

export type IvSource = "bhavcopy" | "snapshot" | "vix" | "sample";

export interface IvPoint {
  /** ISO date (IST trading day). */
  date: string;
  /** Implied vol in percent. */
  iv: number;
  source: IvSource;
}

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const r2 = (x: number) => Math.round(x * 100) / 100;

// ── Merging ──

/** Merge IV layers into one series sorted by date. Earlier layers win when two share a date. */
export function mergeIvPoints(...layers: IvPoint[][]): IvPoint[] {
  const byDate = new Map<string, IvPoint>();
  for (const layer of layers) {
    for (const p of layer ?? []) {
      if (!p || !p.date || !finitePos(p.iv)) continue;
      if (!byDate.has(p.date)) byDate.set(p.date, p);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function vixRowsToPoints(rows: VixHistoryRow[] | null | undefined): IvPoint[] {
  return (rows ?? []).filter((r) => r && r.date && finitePos(r.close)).map((r) => ({ date: r.date, iv: r.close, source: "vix" as const }));
}

/** dailyStats atmIv is already in percent. */
export function dailyStatsToPoints(stats: DailyStat[] | null | undefined): IvPoint[] {
  return (stats ?? []).filter((s) => s && s.date && finitePos(s.atmIv)).map((s) => ({ date: s.date, iv: s.atmIv, source: "snapshot" as const }));
}

export function countBySource(points: IvPoint[]): Record<IvSource, number> {
  const out: Record<IvSource, number> = { bhavcopy: 0, snapshot: 0, vix: 0, sample: 0 };
  for (const p of points) out[p.source]++;
  return out;
}

// ── IV rank, percentile and regime ──

export const MIN_HISTORY_DAYS = 20;
export const DEFAULT_LOOKBACK = 252;

export interface IvStats {
  current: number;
  /** Number of history points used (after the lookback cut). */
  n: number;
  ivRank: number | null;
  ivPercentile: number | null;
  high: number;
  low: number;
  insufficient: boolean;
  /** First and last dates of the history window. */
  from: string | null;
  to: string | null;
}

/** IV rank and percentile over the last `lookback` points. Uses ivRank/ivPercentile from the math core. */
export function computeIvStats(current: number, points: IvPoint[], lookback = DEFAULT_LOOKBACK): IvStats {
  const window = (points ?? []).filter((p) => p && finitePos(p.iv)).slice(-Math.max(1, Math.floor(lookback)));
  const hist = window.map((p) => p.iv);
  const rank = finitePos(current) ? ivRank(current, hist) : null;
  const pct = finitePos(current) ? ivPercentile(current, hist) : null;
  return {
    current,
    n: hist.length,
    ivRank: rank,
    ivPercentile: pct,
    high: hist.length ? Math.max(...hist) : NaN,
    low: hist.length ? Math.min(...hist) : NaN,
    insufficient: hist.length < MIN_HISTORY_DAYS || rank === null,
    from: window[0]?.date ?? null,
    to: window[window.length - 1]?.date ?? null,
  };
}

export type IvRegime = "premium-selling" | "premium-buying" | "neutral" | "unknown";

/** Educational regime label: IVR above 50 favours selling premium, below 20 favours buying. */
export function ivRegime(ivr: number | null | undefined): IvRegime {
  if (ivr === null || ivr === undefined || !Number.isFinite(ivr)) return "unknown";
  if (ivr > 50) return "premium-selling";
  if (ivr < 20) return "premium-buying";
  return "neutral";
}

export const REGIME_LABEL: Record<IvRegime, string> = {
  "premium-selling": "Premium-selling regime",
  "premium-buying": "Premium-buying regime",
  neutral: "Neutral regime",
  unknown: "Regime unknown",
};

// ── Bhavcopy → IV ──

export interface BhavExpiryChain {
  expiry: string;
  underlying: number;
  chain: OptionData[];
}

const blankLeg = (): OptionLegData => ({ ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 });

/** Group bhavcopy option rows of one symbol into chains per expiry (prices = close, else settle). */
export function bhavcopyChains(rows: BhavcopyFoRow[] | null | undefined, symbol: string): BhavExpiryChain[] {
  const sym = String(symbol || "").toUpperCase();
  const byExp = new Map<string, { underlying: number; rows: Map<number, OptionData> }>();
  for (const r of rows ?? []) {
    if (!r || r.symbol !== sym || (r.type !== "CE" && r.type !== "PE") || !finitePos(r.strike) || !r.expiry) continue;
    const price = finitePos(r.close) ? r.close : finitePos(r.settle) ? r.settle : 0;
    if (!(price > 0)) continue;
    let e = byExp.get(r.expiry);
    if (!e) {
      e = { underlying: 0, rows: new Map() };
      byExp.set(r.expiry, e);
    }
    if (finitePos(r.underlyingClose)) e.underlying = r.underlyingClose;
    let row = e.rows.get(r.strike);
    if (!row) {
      row = { strikePrice: r.strike, ce: blankLeg(), pe: blankLeg() };
      e.rows.set(r.strike, row);
    }
    const leg: OptionLegData = { ...blankLeg(), ltp: price, oi: Number.isFinite(r.oi) ? r.oi : 0, oiChange: Number.isFinite(r.chgOi) ? r.chgOi : 0, volume: Number.isFinite(r.volume) ? r.volume : 0 };
    if (r.type === "CE") row.ce = leg;
    else row.pe = leg;
  }
  return [...byExp.entries()]
    .map(([expiry, e]) => ({ expiry, underlying: e.underlying, chain: [...e.rows.values()].sort((a, b) => a.strikePrice - b.strikePrice) }))
    .filter((e) => e.chain.length > 0 && e.underlying > 0)
    .sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
}

export interface ExpiryAtm {
  expiry: string;
  /** Years to expiry measured from 15:30 IST on the bhavcopy date. */
  T: number;
  F: number;
  /** Percent. */
  atmIv: number;
}

export interface BhavcopyIv {
  date: string;
  /** Constant-maturity 30-day ATM IV in percent (NaN when it cannot be solved). */
  iv30: number;
  /** Underlying close on that date. */
  spot: number;
  term: ExpiryAtm[];
}

/**
 * Solve ATM IV per expiry from a bhavcopy date and interpolate a 30-day constant-maturity IV.
 * Expiries closer than `minDays` calendar days are skipped (expiry-week IV is noisy).
 */
export function ivFromBhavChains(chains: BhavExpiryChain[], date: string, r: number, minDays = 2): BhavcopyIv {
  const now = toISTDate(date, "15:30");
  const term: ExpiryAtm[] = [];
  let spot = NaN;
  for (const c of chains) {
    const T = timeToExpiryYears(c.expiry, now);
    if (!(T > 0) || T > 1.2) continue;
    if (!Number.isFinite(spot)) spot = c.underlying;
    if (T * 365 < minDays) continue;
    const band = c.chain.filter((row) => Math.abs(row.strikePrice / c.underlying - 1) <= 0.2);
    if (band.length < 2) continue;
    const F = chainForward(band, c.underlying, T, r);
    const enriched = enrichChain(band, { spot: c.underlying, expiry: c.expiry, now, r, forward: F, overwrite: true });
    const iv = atmIV(enriched, F);
    if (finitePos(iv)) term.push({ expiry: c.expiry, T, F, atmIv: r2(iv) });
  }
  const cm = constantMaturityIV(term.map((t) => ({ T: t.T, iv: t.atmIv / 100 })), 30 / 365);
  return { date, iv30: finitePos(cm) ? r2(cm * 100) : NaN, spot, term };
}

// ── Trading-day bookkeeping ──

function minutesIST(now: Date): number {
  const t = nowIST(now);
  return t.hh * 60 + t.mm;
}

/** The session the latest chain belongs to: today from 09:15 IST on a trading day, else the previous trading day. */
export function lastSessionDate(now: Date = new Date()): string {
  const t = nowIST(now);
  if (isTradingDay(t.date) && minutesIST(now) >= 9 * 60 + 15) return t.date;
  return previousTradingDay(t.date);
}

/** The newest date whose F&O bhavcopy should be published (NSE posts it in the evening). */
export function latestBhavcopyDate(now: Date = new Date()): string {
  const t = nowIST(now);
  if (isTradingDay(t.date) && minutesIST(now) >= 19 * 60) return t.date;
  return previousTradingDay(t.date);
}

/** The last `n` trading days ending at (and including) `end`, newest first. */
export function recentTradingDays(end: string, n: number): string[] {
  const out: string[] = [];
  let d = isTradingDay(end) ? end : previousTradingDay(end);
  for (let i = 0; i < 400 && out.length < Math.max(0, Math.floor(n)) && d; i++) {
    out.push(d);
    d = previousTradingDay(d);
  }
  return out;
}

// ── HV ──

/** Daily OHLC bars from a columnar candle payload (Yahoo / Dhan). Rows with gaps are dropped. */
export function candlesToBars(dto: ColumnarCandlesDTO | null | undefined): OHLC[] {
  if (!dto) return [];
  const ts = dto.timestamp ?? dto.start_Time ?? [];
  const out: OHLC[] = [];
  for (let i = 0; i < ts.length; i++) {
    const raw = ts[i];
    const t = typeof raw === "number" ? raw : Number(raw);
    const o = dto.open?.[i];
    const h = dto.high?.[i];
    const l = dto.low?.[i];
    const c = dto.close?.[i];
    if (!Number.isFinite(t) || !finitePos(o) || !finitePos(h) || !finitePos(l) || !finitePos(c)) continue;
    // Seconds or milliseconds → milliseconds.
    out.push({ t: t < 1e12 ? t * 1000 : t, o, h, l, c });
  }
  out.sort((a, b) => a.t - b.t);
  // One bar per IST date (Yahoo sometimes repeats the live bar).
  const byDate = new Map<string, OHLC>();
  for (const b of out) byDate.set(nowIST(new Date(b.t)).date, b);
  return [...byDate.values()];
}

export function barDate(b: OHLC): string {
  return nowIST(new Date(b.t)).date;
}

export interface HvSnapshot {
  hv10: number;
  hv20: number;
  hv60: number;
  parkinson20: number;
  yangZhang20: number;
}

const pct = (x: number) => (Number.isFinite(x) ? r2(x * 100) : NaN);

/** Current realised vol in percent from daily bars. */
export function hvSnapshot(bars: OHLC[]): HvSnapshot {
  const closes = bars.map((b) => b.c);
  return {
    hv10: pct(hvCloseToClose(closes, 10)),
    hv20: pct(hvCloseToClose(closes, 20)),
    hv60: pct(hvCloseToClose(closes, 60)),
    parkinson20: pct(hvParkinson(bars, 20)),
    yangZhang20: pct(hvYangZhang(bars, 20)),
  };
}

export interface IvHvRow {
  date: string;
  iv: number | null;
  hv20: number | null;
  hv60: number | null;
}

/** Date-aligned IV and rolling HV (percent) for charting. Rows are restricted to the IV window when IV exists. */
export function ivHvSeries(points: IvPoint[], bars: OHLC[], maxRows = 260): IvHvRow[] {
  const hv20 = new Map(rollingHV(bars, 20, "c2c").map((x) => [nowIST(new Date(x.t)).date, pct(x.hv)]));
  const hv60 = new Map(rollingHV(bars, 60, "c2c").map((x) => [nowIST(new Date(x.t)).date, pct(x.hv)]));
  const ivMap = new Map(points.map((p) => [p.date, p.iv]));
  const dates = new Set<string>([...ivMap.keys(), ...hv20.keys()]);
  const firstIv = points[0]?.date;
  const rows = [...dates]
    .filter((d) => !firstIv || d >= addCalendarDays(firstIv, -30))
    .sort()
    .map((date) => ({ date, iv: ivMap.get(date) ?? null, hv20: hv20.get(date) ?? null, hv60: hv60.get(date) ?? null }));
  return rows.slice(-maxRows);
}

// ── Expected-move hit rate ──

export interface SpotIvRow {
  date: string;
  spot: number;
  /** Percent. */
  iv: number;
}

/** Join an IV series and daily bars on date. */
export function joinSpotIv(points: IvPoint[], bars: OHLC[]): SpotIvRow[] {
  const closeByDate = new Map(bars.map((b) => [barDate(b), b.c]));
  const out: SpotIvRow[] = [];
  for (const p of points) {
    const spot = closeByDate.get(p.date);
    if (finitePos(spot) && finitePos(p.iv)) out.push({ date: p.date, spot, iv: p.iv });
  }
  return out;
}

/** Spot/IV rows straight from dailyStats (both recorded by the snapshot recorder). */
export function dailyStatsSpotIv(stats: DailyStat[] | null | undefined): SpotIvRow[] {
  return (stats ?? [])
    .filter((s) => s && s.date && finitePos(s.spot) && finitePos(s.atmIv))
    .map((s) => ({ date: s.date, spot: s.spot, iv: s.atmIv }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Share of past windows of `horizon` rows (trading days) whose close stayed inside the 1σ IV move
 * set at the start. T uses calendar days between the two dates, matching how IV is annualised.
 */
export function ivMoveHitRate(rows: SpotIvRow[], horizon: number, k = 1): { rate: number; n: number } {
  const h = Math.max(1, Math.floor(horizon));
  const sorted = [...(rows ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const samples: Array<{ spotAtStart: number; move: number; close: number }> = [];
  for (let i = 0; i + h < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + h];
    const days = calendarDaysBetween(a.date, b.date);
    if (!(days > 0)) continue;
    // Skip windows that straddle a data gap (more than ~2x the expected calendar span).
    if (days > Math.ceil(h * 1.6) + 5) continue;
    const em = expectedMoveFromIV(a.spot, a.iv / 100, days / 365, k);
    if (!Number.isFinite(em.upper)) continue;
    samples.push({ spotAtStart: a.spot, move: em.move, close: b.spot });
  }
  return { rate: emHitRate(samples), n: samples.length };
}
