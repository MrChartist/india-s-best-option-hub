/**
 * Per-expiry ATM IV over time (pure, node-safe). IV values are in PERCENT.
 *
 * Layers, merged per expiry and date (earlier layers win):
 *   1. "bhavcopy": ATM IV per expiry solved from NSE F&O bhavcopy closes (cached term structure);
 *   2. "snapshot": ATM IV from the last chain snapshot recorded in this browser each day;
 *   3. "sample":   seeded illustration (sampleHistory.ts), only when the chain itself is sample.
 */
import { ivPercentile, ivRank } from "@/lib/options";
import type { BhavcopyIv } from "./history";

export interface ExpiryIvPoint {
  date: string;
  /** Percent. */
  iv: number;
  source: "bhavcopy" | "snapshot" | "sample";
}

export type ExpiryHistory = Record<string, ExpiryIvPoint[]>;

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

/** Regroup cached bhavcopy term structures (one per date) by expiry. Restrict to `expiries` when given. */
export function bhavTermByExpiry(entries: BhavcopyIv[], expiries?: string[]): ExpiryHistory {
  const want = expiries && expiries.length ? new Set(expiries) : null;
  const out: ExpiryHistory = {};
  for (const e of entries ?? []) {
    if (!e || !e.date) continue;
    for (const t of e.term ?? []) {
      if (!t || !t.expiry || !finitePos(t.atmIv) || (want && !want.has(t.expiry))) continue;
      if (t.expiry < e.date) continue;
      (out[t.expiry] ??= []).push({ date: e.date, iv: t.atmIv, source: "bhavcopy" });
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/** Merge per-expiry layers; for a shared expiry and date the earlier layer wins. */
export function mergeExpiryHistories(...layers: ExpiryHistory[]): ExpiryHistory {
  const out: ExpiryHistory = {};
  for (const layer of layers) {
    for (const [expiry, pts] of Object.entries(layer ?? {})) {
      const have = new Map((out[expiry] ?? []).map((p) => [p.date, p]));
      for (const p of pts ?? []) if (p && p.date && finitePos(p.iv) && !have.has(p.date)) have.set(p.date, p);
      out[expiry] = [...have.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    }
  }
  return out;
}

export interface ExpiryMarkers {
  n: number;
  latest: number;
  high: number;
  highDate: string | null;
  low: number;
  lowDate: string | null;
  /** IV rank and percentile of the latest value within this expiry's own history (null under 20 points, as in the math core). */
  ivRank: number | null;
  ivPercentile: number | null;
}

/** High, low and where the latest ATM IV sits in this expiry's own life. */
export function expiryMarkers(points: ExpiryIvPoint[]): ExpiryMarkers {
  const pts = (points ?? []).filter((p) => p && finitePos(p.iv));
  if (pts.length === 0) return { n: 0, latest: NaN, high: NaN, highDate: null, low: NaN, lowDate: null, ivRank: null, ivPercentile: null };
  let hi = pts[0];
  let lo = pts[0];
  for (const p of pts) {
    if (p.iv > hi.iv) hi = p;
    if (p.iv < lo.iv) lo = p;
  }
  const latest = pts[pts.length - 1].iv;
  const hist = pts.map((p) => p.iv);
  return {
    n: pts.length,
    latest,
    high: hi.iv,
    highDate: hi.date,
    low: lo.iv,
    lowDate: lo.date,
    ivRank: ivRank(latest, hist),
    ivPercentile: ivPercentile(latest, hist),
  };
}

/** Wide chart rows: one row per date with a column per expiry (missing values left undefined). */
export function expiryChartRows(hist: ExpiryHistory, expiries: string[]): Array<Record<string, number | string>> {
  const byDate = new Map<string, Record<string, number | string>>();
  for (const e of expiries) {
    for (const p of hist[e] ?? []) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[e] = p.iv;
      byDate.set(p.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
}

/** Count points by source across all expiries. */
export function expirySourceCounts(hist: ExpiryHistory): Record<ExpiryIvPoint["source"], number> {
  const out = { bhavcopy: 0, snapshot: 0, sample: 0 };
  for (const pts of Object.values(hist ?? {})) for (const p of pts) out[p.source]++;
  return out;
}
