/**
 * Pure data prep for the payoff chart: the spot grid, the target-date (T+n) curve and the
 * at-expiry curve. Kept out of the component so it is unit-tested without Recharts.
 */
import { payoffDateKey, payoffSeries, type Leg } from "@/lib/options";

export interface PayoffRow {
  spot: number;
  /** P&L on the target date (T+0 when the date is now). */
  target: number;
  /** P&L at expiry (front expiry for calendars, later legs at model value). */
  expiry: number;
}

export interface PayoffRowsInput {
  legs: Leg[];
  spot: number;
  /** Half-width of the spot range as a fraction of spot (0.06 = ±6%). */
  zoom: number;
  breakevens: number[];
  multiExpiry: boolean;
  frontAt: Date | null;
  targetAt: Date;
  ivShift: number;
  now: Date;
  r: number;
  q: number;
  /** Grid steps across the range (default 200). */
  steps?: number;
}

/** Round tick positions (1, 2, 2.5, 5 × 10^n) between lo and hi. */
export function niceTicks(lo: number, hi: number, target = 6): number[] {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export function buildPayoffRows({ legs, spot, zoom, breakevens, multiExpiry, frontAt, targetAt, ivShift, now, r, q, steps = 200 }: PayoffRowsInput): PayoffRow[] {
  if (legs.length === 0 || !(spot > 0) || !(zoom > 0)) return [];
  const lo = spot * (1 - zoom);
  const hi = spot * (1 + zoom);
  const grid: number[] = [];
  for (let i = 0; i <= steps; i++) grid.push(Math.round((lo + ((hi - lo) * i) / steps) * 100) / 100);
  for (const k of [spot, ...breakevens, ...legs.filter((l) => l.type !== "FUT").map((l) => l.strike)]) if (k >= lo && k <= hi) grid.push(Math.round(k * 100) / 100);
  const sortedGrid = Array.from(new Set(grid)).sort((a, b) => a - b);
  const dates = multiExpiry && frontAt ? [targetAt, frontAt] : [targetAt];
  const rows = payoffSeries(legs, sortedGrid, { dates, ivShift, now, spot, r, q });
  const tKey = payoffDateKey(targetAt);
  const eKey = multiExpiry && frontAt ? payoffDateKey(frontAt) : "expiry";
  return rows.map((row) => ({ spot: row.spot, target: Math.round(row[tKey] ?? NaN), expiry: Math.round(row[eKey] ?? NaN) }));
}
