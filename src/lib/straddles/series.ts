/**
 * Intraday straddle series built from chain snapshots: the combined premium with its VWAP, the CE
 * and PE legs, premium against spot, a multi-strike comparison, and a summary for the KPI row.
 * Prices are mids where the quote is tight, otherwise LTP (see snapMid in the expiry maths).
 */
import { expectedMoveFromStraddle } from "@/lib/options";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { straddleSeries, vwapSeries, type StraddlePoint } from "@/components/expiry/expiryMath";

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export interface PremiumSummary {
  open: StraddlePoint | null;
  last: StraddlePoint | null;
  high: number;
  low: number;
  /** last − open, ₹ per unit. */
  change: number;
  /** Percent of the opening premium. */
  changePct: number;
  vwap: number;
  vwapBasis: "volume" | "time";
  /** last − VWAP, ₹ per unit (negative = trading below VWAP). */
  vsVwap: number;
  /** CE share of the combined premium now, 0..1 (0.5 = balanced). */
  ceShare: number;
  /** Straddle-implied move (0.85 × premium) around spot now, for same-strike pairs. */
  impliedMove: number;
  impliedMovePct: number;
  /** Times the rolling ATM strike changed. */
  strikeChanges: number;
}

export const EMPTY_SUMMARY: PremiumSummary = {
  open: null,
  last: null,
  high: NaN,
  low: NaN,
  change: NaN,
  changePct: NaN,
  vwap: NaN,
  vwapBasis: "time",
  vsVwap: NaN,
  ceShare: NaN,
  impliedMove: NaN,
  impliedMovePct: NaN,
  strikeChanges: 0,
};

/** Summary of a premium series and its running VWAP. */
export function summarisePremium(points: StraddlePoint[], vwap?: { values: number[]; basis: "volume" | "time" }): PremiumSummary {
  if (!Array.isArray(points) || points.length === 0) return EMPTY_SUMMARY;
  const v = vwap ?? vwapSeries(points);
  const open = points[0];
  const last = points[points.length - 1];
  let high = -Infinity;
  let low = Infinity;
  for (const p of points) {
    if (p.straddle > high) high = p.straddle;
    if (p.straddle < low) low = p.straddle;
  }
  const vw = v.values[v.values.length - 1];
  const change = last.straddle - open.straddle;
  const sameStrike = last.strike === last.peStrike;
  const em = sameStrike ? expectedMoveFromStraddle(last.straddle, last.spot) : { move: NaN, pct: NaN };
  let strikeChanges = 0;
  for (let i = 1; i < points.length; i++) if (points[i].strike !== points[i - 1].strike || points[i].peStrike !== points[i - 1].peStrike) strikeChanges++;
  return {
    open,
    last,
    high,
    low,
    change,
    changePct: open.straddle > 0 ? (change / open.straddle) * 100 : NaN,
    vwap: finite(vw) ? vw : NaN,
    vwapBasis: v.basis,
    vsVwap: finite(vw) ? last.straddle - vw : NaN,
    ceShare: last.straddle > 0 ? last.ce / last.straddle : NaN,
    impliedMove: em.move,
    impliedMovePct: em.pct,
    strikeChanges,
  };
}

export interface LegRow {
  ts: number;
  ce: number;
  pe: number;
  combined: number;
  spot: number;
}

/** CE, PE and combined premium per snapshot, scaled by `mult` (1 = per unit, lot size = per lot). */
export function legRows(points: StraddlePoint[], mult = 1): LegRow[] {
  const m = finite(mult) && mult > 0 ? mult : 1;
  return (points ?? []).map((p) => ({ ts: p.ts, ce: p.ce * m, pe: p.pe * m, combined: p.straddle * m, spot: p.spot }));
}

export interface SpotPremiumPoint {
  spot: number;
  premium: number;
  ts: number;
  /** Position in the session, 0 (first point) to 1 (last point). */
  t: number;
}

/** Premium against spot (one point per snapshot) for a scatter. */
export function premiumVsSpot(points: StraddlePoint[], mult = 1): SpotPremiumPoint[] {
  const m = finite(mult) && mult > 0 ? mult : 1;
  const n = (points ?? []).length;
  return (points ?? []).filter((p) => finite(p.spot) && p.spot > 0).map((p, i) => ({ spot: p.spot, premium: p.straddle * m, ts: p.ts, t: n > 1 ? i / (n - 1) : 1 }));
}

/**
 * Value of the pair at expiry across a spot range (intrinsic CE + PE), scaled by `mult`. With a
 * fixed pair this is the V (or flat-bottomed V for a strangle) the premium decays towards.
 */
export function expiryValueLine(ceStrike: number, peStrike: number, lo: number, hi: number, mult = 1, steps = 40): Array<{ spot: number; expiry: number }> {
  if (![ceStrike, peStrike, lo, hi].every(finite) || !(hi > lo) || ceStrike <= 0 || peStrike <= 0) return [];
  const m = finite(mult) && mult > 0 ? mult : 1;
  const xs = new Set<number>();
  const n = Math.max(2, Math.floor(steps));
  for (let i = 0; i <= n; i++) xs.add(lo + ((hi - lo) * i) / n);
  for (const k of [ceStrike, peStrike]) if (k > lo && k < hi) xs.add(k);
  return [...xs].sort((a, b) => a - b).map((s) => ({ spot: s, expiry: (Math.max(0, s - ceStrike) + Math.max(0, peStrike - s)) * m }));
}

export interface MultiStrikeSeries {
  strike: number;
  first: number;
  last: number;
  high: number;
  low: number;
  /** last − first as a percent of first. */
  changePct: number;
  points: number;
}

/**
 * Straddles at several fixed strikes across a snapshot list, merged into chart rows keyed `k<strike>`.
 * view "rupees" scales by mult; "pct" rebases each strike to 100 at its first point.
 */
export function multiStrikeRows(
  snaps: ChainSnapshot[],
  strikes: number[],
  o: { view?: "rupees" | "pct"; mult?: number } = {},
): { rows: Array<Record<string, number>>; series: MultiStrikeSeries[] } {
  const view = o.view ?? "rupees";
  const m = finite(o.mult) && (o.mult as number) > 0 ? (o.mult as number) : 1;
  const byTs = new Map<number, Record<string, number>>();
  const series: MultiStrikeSeries[] = [];
  for (const k of strikes ?? []) {
    const pts = straddleSeries(snaps, { kind: "fixed", strike: k });
    if (pts.length === 0) continue;
    const first = pts[0].straddle;
    const last = pts[pts.length - 1].straddle;
    let high = -Infinity;
    let low = Infinity;
    for (const p of pts) {
      high = Math.max(high, p.straddle);
      low = Math.min(low, p.straddle);
      const row = byTs.get(p.ts) ?? { ts: p.ts };
      row[`k${k}`] = view === "pct" ? (first > 0 ? (p.straddle / first) * 100 : NaN) : p.straddle * m;
      byTs.set(p.ts, row);
    }
    series.push({ strike: k, first, last, high, low, changePct: first > 0 ? ((last - first) / first) * 100 : NaN, points: pts.length });
  }
  return { rows: [...byTs.values()].sort((a, b) => a.ts - b.ts), series };
}

/** Points for the selected pair plus its VWAP, in one call. */
export function premiumSeries(snaps: ChainSnapshot[], mode: Parameters<typeof straddleSeries>[1]) {
  const points = straddleSeries(snaps, mode);
  const vwap = vwapSeries(points);
  return { points, vwap, summary: summarisePremium(points, vwap) };
}
