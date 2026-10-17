/**
 * India VIX analytics (pure, node-safe). VIX values are in PERCENT (13.4 means 13.4%).
 *
 *  - percentile bands of the last year of VIX;
 *  - VIX against NIFTY realised vol: trailing HV20 (what has happened) and the realised vol of
 *    the following 21 sessions (what then happened), so the volatility risk premium can be read;
 *  - how often the VIX-implied daily and weekly moves held (emHitRate via ivMoveHitRate);
 *  - regime statistics by VIX bucket: forward NIFTY returns and a model short ATM straddle;
 *  - a weekly-vs-monthly ATM IV term proxy from a term structure.
 */
import {
  black76Price,
  calendarDaysBetween,
  expectedMoveFromIV,
  isMonthlyExpiry,
  nowIST,
  percentileSorted,
  rollingHV,
  type OHLC,
} from "@/lib/options";
import { barDate, ivMoveHitRate, type IvPoint, type SpotIvRow } from "./history";

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

// ── Percentile bands ──

export interface VixBands {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
  n: number;
  /** Percentile (0–100) of the latest value within the window; NaN when empty. */
  latestPct: number;
}

/** Percentile levels of the last `lookback` points. Fields are NaN when there is no data. */
export function vixBands(points: IvPoint[], lookback = 252): VixBands {
  const xs = (points ?? []).filter((p) => p && finitePos(p.iv)).slice(-Math.max(1, Math.floor(lookback))).map((p) => p.iv);
  const sorted = xs.slice().sort((a, b) => a - b);
  const q = (p: number) => (sorted.length ? r2(percentileSorted(sorted, p)) : NaN);
  const last = xs[xs.length - 1];
  return {
    p10: q(0.1),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    min: sorted.length ? sorted[0] : NaN,
    max: sorted.length ? sorted[sorted.length - 1] : NaN,
    n: xs.length,
    latestPct: xs.length ? r2((xs.filter((x) => x < last).length / xs.length) * 100) : NaN,
  };
}

export type VixZone = "very-low" | "low" | "normal" | "high" | "very-high" | "unknown";

/** Where a VIX value sits against the bands. */
export function vixZone(v: number, b: VixBands): VixZone {
  if (!finitePos(v) || !(b.n > 0)) return "unknown";
  if (v < b.p10) return "very-low";
  if (v < b.p25) return "low";
  if (v <= b.p75) return "normal";
  if (v <= b.p90) return "high";
  return "very-high";
}

export const VIX_ZONE_LABEL: Record<VixZone, string> = {
  "very-low": "Below the 10th percentile",
  low: "10th to 25th percentile",
  normal: "Middle half of the year",
  high: "75th to 90th percentile",
  "very-high": "Above the 90th percentile",
  unknown: "Not enough history",
};

// ── VIX vs NIFTY realised vol ──

export interface VixVrpRow {
  date: string;
  vix: number;
  /** Trailing 20-session close-to-close realised vol, percent. */
  hv20: number | null;
  /** Realised vol of the next 21 sessions, percent (null for the most recent month). */
  fwd21: number | null;
  /** vix − hv20 in vol points. */
  vrp: number | null;
}

function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i] / closes[i - 1]));
  return out;
}

function annualisedSd(rets: number[]): number {
  if (rets.length < 2) return NaN;
  const m = mean(rets);
  const v = rets.reduce((a, r) => a + (r - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}

/** Date-aligned VIX, trailing HV20 and forward 21-session realised vol of NIFTY (all percent). */
export function vixVrpSeries(vix: IvPoint[], bars: OHLC[], o?: { window?: number; forward?: number }): VixVrpRow[] {
  const w = Math.max(2, Math.floor(o?.window ?? 20));
  const f = Math.max(2, Math.floor(o?.forward ?? 21));
  const sortedBars = [...(bars ?? [])].filter((b) => finitePos(b.c)).sort((a, b) => a.t - b.t);
  const dates = sortedBars.map(barDate);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const hv = new Map(rollingHV(sortedBars, w, "c2c").map((x) => [nowIST(new Date(x.t)).date, x.hv]));
  const rets = logReturns(sortedBars.map((b) => b.c));
  const out: VixVrpRow[] = [];
  for (const p of vix ?? []) {
    if (!p || !finitePos(p.iv)) continue;
    const i = idx.get(p.date);
    if (i === undefined) continue;
    const h = hv.get(p.date);
    const hv20 = h !== undefined && Number.isFinite(h) ? r2(h * 100) : null;
    // rets[k] is the return from bar k to k+1, so the next f sessions are rets[i .. i+f-1].
    const fwd = i + f <= rets.length ? annualisedSd(rets.slice(i, i + f)) : NaN;
    out.push({ date: p.date, vix: p.iv, hv20, fwd21: Number.isFinite(fwd) ? r2(fwd * 100) : null, vrp: hv20 === null ? null : r2(p.iv - hv20) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface VrpSummary {
  /** Average VIX − HV20, vol points. */
  meanVrp: number;
  /** Average VIX − forward 21-session realised vol, vol points. */
  meanFwdGap: number;
  /** Share (0–1) of days when VIX was above the realised vol that followed. */
  overShare: number;
  /** Rows with a forward value. */
  n: number;
  latest: VixVrpRow | null;
}

export function vrpSummary(rows: VixVrpRow[]): VrpSummary {
  const withHv = (rows ?? []).filter((r) => r.vrp !== null);
  const withFwd = (rows ?? []).filter((r) => r.fwd21 !== null);
  return {
    meanVrp: withHv.length ? r2(mean(withHv.map((r) => r.vrp as number))) : NaN,
    meanFwdGap: withFwd.length ? r2(mean(withFwd.map((r) => r.vix - (r.fwd21 as number)))) : NaN,
    overShare: withFwd.length ? withFwd.filter((r) => r.vix > (r.fwd21 as number)).length / withFwd.length : NaN,
    n: withFwd.length,
    latest: rows?.length ? rows[rows.length - 1] : null,
  };
}

// ── Implied move vs actual ──

export interface ImpliedMove {
  days: number;
  move: number;
  pct: number;
}

/** 1σ move implied by a VIX level over `calendarDays` (log-space bounds, calendar-day annualisation). */
export function vixImpliedMove(spot: number, vixPct: number, calendarDays: number): ImpliedMove {
  const em = expectedMoveFromIV(spot, vixPct / 100, Math.max(0, calendarDays) / 365, 1);
  return { days: calendarDays, move: em.move, pct: em.pct };
}

export interface MoveHitStats {
  daily: { rate: number; n: number };
  weekly: { rate: number; n: number };
}

/** How often NIFTY stayed inside the VIX 1σ move over 1 and 5 sessions. A calibrated 1σ band holds ≈ 68%. */
export function vixMoveHitStats(rows: SpotIvRow[]): MoveHitStats {
  return { daily: ivMoveHitRate(rows, 1), weekly: ivMoveHitRate(rows, 5) };
}

// ── Regime statistics ──

export interface VixBucket {
  key: string;
  label: string;
  lo: number;
  hi: number;
}

export const VIX_BUCKETS: VixBucket[] = [
  { key: "lt12", label: "Below 12", lo: 0, hi: 12 },
  { key: "12-15", label: "12 to 15", lo: 12, hi: 15 },
  { key: "15-20", label: "15 to 20", lo: 15, hi: 20 },
  { key: "20-25", label: "20 to 25", lo: 20, hi: 25 },
  { key: "ge25", label: "25 and above", lo: 25, hi: Infinity },
];

export interface RegimeRow extends VixBucket {
  /** Days that started in this bucket and have a full forward window. */
  n: number;
  /** Share (0–1) of all such days. */
  share: number;
  /** Average next-session NIFTY return, percent. */
  avgRet1d: number;
  /** Average absolute next-session move, percent. */
  avgAbs1d: number;
  /** Average return over the horizon, percent. */
  avgRetH: number;
  /** Share (0–1) of horizons that ended higher. */
  upShare: number;
  /** Average short ATM straddle P&L over the horizon, percent of spot (seller view). */
  straddlePnl: number;
  /** Share (0–1) of short straddles that made money. */
  straddleWin: number;
}

/**
 * Forward NIFTY returns and a model short ATM straddle by the VIX level on the starting day.
 * The straddle is priced with Black-76 at the VIX (as ATM IV, r = 0, forward = spot) for the
 * calendar days of the horizon and settled at intrinsic. It ignores skew, the weekly-vs-30-day
 * IV gap, costs and slippage, so read it as a relative comparison between buckets.
 */
export function vixRegimeStats(rows: SpotIvRow[], horizon = 5, buckets: VixBucket[] = VIX_BUCKETS): RegimeRow[] {
  const h = Math.max(1, Math.floor(horizon));
  const sorted = [...(rows ?? [])].filter((r) => r && finitePos(r.spot) && finitePos(r.iv)).sort((a, b) => (a.date < b.date ? -1 : 1));
  type Acc = { r1: number[]; a1: number[]; rh: number[]; pnl: number[] };
  const acc = new Map<string, Acc>(buckets.map((b) => [b.key, { r1: [], a1: [], rh: [], pnl: [] }]));
  let total = 0;
  for (let i = 0; i + h < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + h];
    const days = calendarDaysBetween(a.date, b.date);
    if (!(days > 0) || days > Math.ceil(h * 1.6) + 5) continue;
    const bucket = buckets.find((k) => a.iv >= k.lo && a.iv < k.hi);
    if (!bucket) continue;
    const s = acc.get(bucket.key) as Acc;
    const next = sorted[i + 1];
    s.r1.push((next.spot / a.spot - 1) * 100);
    s.a1.push(Math.abs(next.spot / a.spot - 1) * 100);
    s.rh.push((b.spot / a.spot - 1) * 100);
    const T = days / 365;
    const sigma = a.iv / 100;
    const premium =
      black76Price({ F: a.spot, K: a.spot, T, r: 0, sigma, type: "CE" }) + black76Price({ F: a.spot, K: a.spot, T, r: 0, sigma, type: "PE" });
    if (Number.isFinite(premium)) s.pnl.push(((premium - Math.abs(b.spot - a.spot)) / a.spot) * 100);
    total++;
  }
  return buckets.map((b) => {
    const s = acc.get(b.key) as Acc;
    const n = s.rh.length;
    return {
      ...b,
      n,
      share: total ? n / total : NaN,
      avgRet1d: n ? r4(mean(s.r1)) : NaN,
      avgAbs1d: n ? r4(mean(s.a1)) : NaN,
      avgRetH: n ? r4(mean(s.rh)) : NaN,
      upShare: n ? s.rh.filter((x) => x > 0).length / n : NaN,
      straddlePnl: s.pnl.length ? r4(mean(s.pnl)) : NaN,
      straddleWin: s.pnl.length ? s.pnl.filter((x) => x > 0).length / s.pnl.length : NaN,
    };
  });
}

/** Join VIX points with NIFTY closes on date (iv = VIX). */
export function vixSpotRows(vix: IvPoint[], bars: OHLC[]): SpotIvRow[] {
  const close = new Map((bars ?? []).map((b) => [barDate(b), b.c]));
  const out: SpotIvRow[] = [];
  for (const p of vix ?? []) {
    const c = close.get(p.date);
    if (finitePos(c) && finitePos(p.iv)) out.push({ date: p.date, spot: c, iv: p.iv });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ── Weekly vs monthly ATM IV ──

export interface TermLeg {
  expiry: string;
  dte: number;
  atmIv: number;
}

export interface WeeklyMonthly {
  weekly: TermLeg;
  monthly: TermLeg;
  /** weekly − monthly, vol points. Positive means near-term stress or an event inside the week. */
  spread: number;
  ratio: number;
  /**
   * True when the front expiry was itself a monthly (the monthly-expiry week), so the weekly leg is
   * the next weekly after it rather than the front expiry.
   */
  frontIsMonthly: boolean;
  /** True when the "weekly" leg is really a monthly (symbols without weeklies): front vs next monthly. */
  monthlyOnly: boolean;
}

/**
 * Weekly expiry vs the next monthly expiry after it. Expiries under `minDte` calendar days are
 * skipped (expiry-day IV is noisy). The weekly leg is the first non-monthly expiry: in the
 * monthly-expiry week the front expiry is the monthly itself, and comparing it with the next
 * monthly would be month 1 vs month 2 under a "weekly" label, so the next weekly is used instead.
 * For symbols without weeklies the front monthly is compared with the next monthly (`monthlyOnly`).
 * Null when two distinct expiries are not available.
 */
export function weeklyVsMonthly(symbol: string, term: TermLeg[], minDte = 1): WeeklyMonthly | null {
  const pts = (term ?? []).filter((t) => t && finitePos(t.atmIv) && Number.isFinite(t.dte) && t.dte >= minDte).sort((a, b) => a.dte - b.dte);
  const front = pts[0];
  if (!front) return null;
  const frontIsMonthly = isMonthlyExpiry(symbol, front.expiry);
  const nextWeekly = frontIsMonthly ? pts.find((t) => !isMonthlyExpiry(symbol, t.expiry)) : front;
  const weekly = nextWeekly ?? front;
  const monthlyOnly = !nextWeekly;
  const monthly = pts.find((t) => t.expiry !== weekly.expiry && t.dte > weekly.dte && isMonthlyExpiry(symbol, t.expiry));
  if (!monthly) return null;
  return {
    weekly,
    monthly,
    spread: r2(weekly.atmIv - monthly.atmIv),
    ratio: r2(weekly.atmIv / monthly.atmIv),
    frontIsMonthly: frontIsMonthly && !monthlyOnly,
    monthlyOnly,
  };
}
