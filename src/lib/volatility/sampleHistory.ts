/**
 * Seeded SAMPLE volatility history (pure, node-safe).
 *
 * Used only when no real IV history exists and the live chain is unavailable, so IV rank, IV
 * percentile, the volatility cone, VRP and the India VIX analytics can still be demonstrated.
 * Every point carries source "sample" and every screen that shows it must say so.
 *
 * Model (daily steps over NSE trading days):
 *  - log IV follows a mean-reverting (Ornstein-Uhlenbeck) walk with rare volatility spikes, then a
 *    linear bridge in log space pins the last point to the sample chain's ATM IV;
 *  - the index or stock closes follow a GBM whose daily vol is a fraction of IV (a positive
 *    volatility risk premium) with returns negatively correlated to IV changes (the leverage
 *    effect), and a gap-down on spike days; the path is rescaled so the last close equals spot.
 * IV values are in PERCENT.
 */
import {
  calendarDaysBetween,
  gaussianSource,
  mulberry32,
  sampleSeed,
  toISTDate,
  type OHLC,
} from "@/lib/options";
import { lastSessionDate, recentTradingDays, type IvPoint } from "./history";
import type { ExpiryIvPoint } from "./atmHistory";
import type { SurfaceRow } from "./surface";

export interface SampleVolOptions {
  symbol: string;
  /** Last close of the sample path. */
  spot: number;
  /** IV (percent) on the last day, normally the sample chain's ATM IV30. */
  atmIv: number;
  /** Last date (ISO, IST). Default: the latest session. */
  end?: string;
  /** Number of trading days. Default 252 (one year). */
  days?: number;
  seed?: number;
  /**
   * Follow another IV series (e.g. BANKNIFTY following NIFTY): log IV = log(base) + log(ratio) + a
   * small mean-reverting idiosyncratic term. Dates missing from the base fall back to the walk.
   */
  coupleTo?: IvPoint[];
  /** Realised vol as a share of IV. Default 0.82 (options usually price more than is delivered). */
  vrpRatio?: number;
}

export interface SampleVolHistory {
  iv: IvPoint[];
  bars: OHLC[];
  seed: number;
}

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const roundTick = (x: number) => Math.round(x * 20) / 20;

/** A labelled one-year sample IV series plus matching daily bars. Empty when inputs are unusable. */
export function sampleVolHistory(o: SampleVolOptions): SampleVolHistory {
  const seed = Number.isFinite(o.seed) ? (o.seed as number) >>> 0 : sampleSeed(o.symbol || "NIFTY", "vol-history");
  const empty: SampleVolHistory = { iv: [], bars: [], seed };
  if (!finitePos(o.spot) || !finitePos(o.atmIv)) return empty;
  const n = Math.max(30, Math.min(390, Math.floor(o.days ?? 252)));
  const dates = recentTradingDays(o.end ?? lastSessionDate(), n).reverse();
  if (dates.length < 2) return empty;

  const rand = mulberry32(seed);
  const gauss = gaussianSource(rand);
  const target = Math.log(o.atmIv);
  // Where the long-run mean sits relative to today: today can be cheap or rich versus the year.
  const mu = target + Math.log(0.88 + 0.26 * rand());
  const kappa = 0.04;
  const volOfVol = 0.055;
  const base = new Map((o.coupleTo ?? []).filter((p) => p && finitePos(p.iv)).map((p) => [p.date, p.iv]));
  const coupled = base.size > 0;
  const lastBase = coupled ? base.get(dates[dates.length - 1]) : undefined;
  const ratio = coupled && finitePos(lastBase) ? o.atmIv / lastBase : 1;

  // 1. Log-IV path.
  const x: number[] = [];
  const shocks: number[] = [];
  const spikes: boolean[] = [];
  let idio = 0;
  let prev = mu + 0.15 * gauss();
  for (let i = 0; i < dates.length; i++) {
    const z = gauss();
    const spike = !coupled && i > 0 && rand() < 0.012;
    let v: number;
    const b = base.get(dates[i]);
    if (coupled && finitePos(b)) {
      idio = idio * 0.93 + 0.025 * z;
      v = Math.log(b) + Math.log(ratio) + idio;
    } else {
      v = i === 0 ? prev : prev + kappa * (mu - prev) + volOfVol * z + (spike ? 0.22 + 0.2 * rand() : 0);
    }
    x.push(v);
    shocks.push(z);
    spikes.push(spike);
    prev = v;
  }
  // Pin the last point to today's IV with a linear bridge (keeps the path's shape).
  const gap = target - x[x.length - 1];
  const lo = Math.log(Math.max(4, o.atmIv * 0.45));
  const hi = Math.log(Math.min(150, o.atmIv * 3));
  const ivs = x.map((v, i) => Math.exp(Math.min(hi, Math.max(lo, v + (gap * i) / (x.length - 1)))));
  ivs[ivs.length - 1] = o.atmIv;

  // 2. Price path with realised vol below IV and negative correlation to IV shocks.
  const vrpRatio = finitePos(o.vrpRatio) ? (o.vrpRatio as number) : 0.82;
  const rho = -0.6;
  const closes: number[] = [100];
  const dailyVol: number[] = [ivs[0] / 100 / Math.sqrt(252)];
  for (let i = 1; i < dates.length; i++) {
    const sd = ((ivs[i - 1] / 100) * vrpRatio * (0.8 + 0.4 * rand())) / Math.sqrt(252);
    const e = gauss();
    const zs = rho * shocks[i] + Math.sqrt(1 - rho * rho) * e;
    const jump = spikes[i] ? -2.2 * sd : 0;
    closes.push(closes[i - 1] * Math.exp(-0.5 * sd * sd + sd * zs + jump));
    dailyVol.push(sd);
  }
  const scale = o.spot / closes[closes.length - 1];

  const bars: OHLC[] = [];
  for (let i = 0; i < dates.length; i++) {
    const c = closes[i] * scale;
    const prevClose = i === 0 ? c : closes[i - 1] * scale;
    const sd = dailyVol[i];
    const open = prevClose * Math.exp(0.35 * sd * gauss());
    const high = Math.max(open, c) * Math.exp(Math.abs(gauss()) * 0.45 * sd);
    const low = Math.min(open, c) * Math.exp(-Math.abs(gauss()) * 0.45 * sd);
    bars.push({ t: toISTDate(dates[i], "15:30").getTime(), o: roundTick(open), h: roundTick(high), l: roundTick(low), c: i === dates.length - 1 ? o.spot : roundTick(c) });
  }
  const iv = dates.map((date, i) => ({ date, iv: r2(ivs[i]), source: "sample" as const }));
  return { iv, bars, seed };
}

// ── Per-expiry ATM IV history (sample) ──

/**
 * Sample ATM IV history for each listed expiry over the last `days` points of a (sample) IV30
 * series: a mild upward term slope, extra event premium in the final week, and seeded noise.
 * Points after an expiry has expired are omitted.
 */
export function sampleExpiryAtmHistory(expiries: string[], iv30: IvPoint[], o?: { days?: number; seed?: number }): Record<string, ExpiryIvPoint[]> {
  const days = Math.max(5, Math.floor(o?.days ?? 40));
  const tail = (iv30 ?? []).filter((p) => p && finitePos(p.iv)).slice(-days);
  const out: Record<string, ExpiryIvPoint[]> = {};
  (expiries ?? []).forEach((expiry, k) => {
    const rand = mulberry32(((o?.seed ?? 7) * 7919 + k * 104729) >>> 0);
    const gauss = gaussianSource(rand);
    let noise = 0;
    const pts: ExpiryIvPoint[] = [];
    for (const p of tail) {
      const dte = calendarDaysBetween(p.date, expiry);
      if (!(dte > 0)) continue;
      noise = noise * 0.8 + 0.012 * gauss();
      const slope = 1 + 0.035 * Math.log(Math.max(dte, 1) / 30);
      const weekBump = dte <= 6 ? 1 + 0.04 * (7 - dte) / 7 : 1;
      pts.push({ date: p.date, iv: r2(p.iv * slope * weekBump * (1 + noise)), source: "sample" });
    }
    out[expiry] = pts;
  });
  return out;
}

/** Sample weekly vs monthly ATM IV around a (sample) IV30 series. */
export function sampleWeeklyMonthly(iv30: IvPoint[], o?: { days?: number; seed?: number }): Array<{ date: string; weekly: number; monthly: number }> {
  const rand = mulberry32(((o?.seed ?? 11) * 2654435761) >>> 0);
  const gauss = gaussianSource(rand);
  let w = 0;
  return (iv30 ?? [])
    .filter((p) => p && finitePos(p.iv))
    .slice(-Math.max(10, Math.floor(o?.days ?? 120)))
    .map((p) => {
      w = w * 0.85 + 0.02 * gauss();
      return { date: p.date, weekly: r2(p.iv * (0.98 + w)), monthly: r2(p.iv * 1.01) };
    });
}

/**
 * A sample "yesterday" surface derived from today's: a seeded parallel shift plus a small skew
 * change, so the change-vs-yesterday view can be demonstrated. Never use with real rows.
 */
export function sampleYesterdaySurface(rows: SurfaceRow[], seed = 3): SurfaceRow[] {
  const rand = mulberry32(seed >>> 0);
  const shift = -0.9 + 1.4 * rand();
  const skew = -0.25 + 0.5 * rand();
  return (rows ?? []).map((r, i) => {
    const cells: Record<string, number | null> = {};
    const keys = Object.keys(r.cells);
    keys.forEach((k, j) => {
      const v = r.cells[k];
      const pos = keys.length > 1 ? (j / (keys.length - 1)) * 2 - 1 : 0; // −1 (put wing) … +1 (call wing)
      cells[k] = v === null || !Number.isFinite(v) ? null : r2(v - shift * (1 - i * 0.08) - skew * -pos);
    });
    return { ...r, cells };
  });
}
