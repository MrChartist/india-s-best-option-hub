/**
 * Strategy Optimizer: plain-language insights for ranked results.
 *
 *  - profitZonesFromGrid: the price intervals where a P&L curve is above zero.
 *  - payoffTag: "Profits if NIFTY stays below 24,373" — what has to happen for the trade to pay,
 *    described against today's spot, instead of a generic bull/bear label.
 *  - viewFromTarget / matchesView: whether a structure fits the reader's market view; with a
 *    Neutral view, delta-neutral structures whose profit zone contains spot get a ranking boost.
 *  - stepTarget: keyboard steps for the target-price slider (one strike, 1σ, Home/End).
 */
import { expectedMoveSigma, formatStrike, type Interval } from "@/lib/options";
import type { Sentiment } from "./preview";

export type PayoffTone = "bullish" | "bearish" | "neutral" | "volatile";

export interface PayoffTag {
  /** Full sentence, e.g. "Profits if NIFTY stays below 24,373". */
  text: string;
  /** Direction the trade needs, for colour. */
  tone: PayoffTone;
}

/** |net delta per strategy unit| at or below this counts as delta neutral. */
export const DELTA_NEUTRAL_BAND = 0.1;
/** Net delta per unit beyond this counts as directional for the bullish/bearish views. */
export const DIRECTIONAL_DELTA = 0.05;
/** Utility added to delta-neutral structures that match a Neutral view. */
export const NEUTRAL_VIEW_BOOST = 0.1;

/**
 * Intervals where `values` (P&L on the ascending price `grid`) is strictly positive, with zero
 * crossings found by linear interpolation. A zone touching the left edge starts at 0; one touching
 * the right edge runs to Infinity (the grid is assumed to span the plausible range).
 */
export function profitZonesFromGrid(grid: number[], values: number[]): Interval[] {
  if (!Array.isArray(grid) || !Array.isArray(values) || grid.length < 2 || grid.length !== values.length) return [];
  const out: Interval[] = [];
  let start: number | null = values[0] > 0 ? 0 : null;
  for (let i = 1; i < grid.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if (a > 0 !== b > 0) {
      const x = grid[i - 1] + ((0 - a) * (grid[i] - grid[i - 1])) / (b - a);
      if (b > 0) start = x;
      else if (start !== null) {
        out.push({ from: start, to: x });
        start = null;
      }
    }
  }
  if (start !== null) out.push({ from: start, to: Infinity });
  return out;
}

/** True when `x` lies inside one of the zones. */
export function inZones(zones: Interval[], x: number): boolean {
  return Number.isFinite(x) && zones.some((z) => x >= z.from && x <= z.to);
}

const LOW_EDGE = 1e-6;
const px = (v: number) => formatStrike(Math.round(v));

function describeZone(z: Interval, sym: string, spot: number): PayoffTag {
  const lowOpen = z.from <= LOW_EDGE;
  const highOpen = z.to === Infinity;
  if (lowOpen && highOpen) return { text: "Profits at any price", tone: "neutral" };
  if (lowOpen) {
    return { text: `Profits if ${sym} ${spot < z.to ? "stays below" : "falls below"} ${px(z.to)}`, tone: "bearish" };
  }
  if (highOpen) {
    return { text: `Profits if ${sym} ${spot > z.from ? "stays above" : "rises above"} ${px(z.from)}`, tone: "bullish" };
  }
  if (spot >= z.from && spot <= z.to) return { text: `Profits if ${sym} stays between ${px(z.from)} and ${px(z.to)}`, tone: "neutral" };
  if (spot < z.from) return { text: `Profits if ${sym} rises to between ${px(z.from)} and ${px(z.to)}`, tone: "bullish" };
  return { text: `Profits if ${sym} falls to between ${px(z.from)} and ${px(z.to)}`, tone: "bearish" };
}

/**
 * Describe a payoff by its profit zones relative to spot. With several zones, a "below a or above b"
 * pair reads as a move either way; otherwise the zone holding the target (or nearest to it) is used.
 * `on` (e.g. "20 Oct 2026") is appended when the valuation date is before expiry.
 */
export function payoffTag(zones: Interval[], o: { symbol: string; spot: number; target: number; on?: string }): PayoffTag {
  const sym = o.symbol || "the underlying";
  const valid = (Array.isArray(zones) ? zones : []).filter((z) => z && z.to > z.from);
  const suffix = o.on ? ` on ${o.on}` : "";
  if (valid.length === 0) return { text: `No profit zone for ${sym}${suffix}`, tone: "neutral" };
  let tag: PayoffTag;
  const first = valid[0];
  const last = valid[valid.length - 1];
  if (valid.length === 2 && first.from <= LOW_EDGE && last.to === Infinity) {
    tag = { text: `Profits if ${sym} moves below ${px(first.to)} or above ${px(last.from)}`, tone: "volatile" };
  } else if (valid.length === 1) {
    tag = describeZone(first, sym, o.spot);
  } else {
    const dist = (z: Interval) => (o.target >= z.from && o.target <= z.to ? 0 : Math.min(Math.abs(o.target - z.from), Math.abs(o.target - z.to)));
    const best = valid.reduce((a, z) => (dist(z) < dist(a) ? z : a));
    tag = describeZone(best, sym, o.spot);
  }
  return { ...tag, text: `${tag.text}${suffix}` };
}

/** View implied by a target: k = ln(target/spot)/(σ√T); |k| ≤ 0.25 neutral, ≤ 0.75 (very) bullish/bearish beyond. */
export function viewFromTarget(spot: number, target: number, sigma: number, T: number): Sentiment {
  if (!(spot > 0) || !(target > 0)) return "neutral";
  const sd = expectedMoveSigma(sigma, T, { minSigma: 0.01 });
  const k = Math.log(target / spot) / sd;
  if (k <= -0.75) return "very_bearish";
  if (k < -0.25) return "bearish";
  if (k <= 0.25) return "neutral";
  if (k < 0.75) return "bullish";
  return "very_bullish";
}

/**
 * Does a structure fit the view?
 *  - Neutral: delta neutral (|Δ per unit| ≤ DELTA_NEUTRAL_BAND) and spot already inside a profit zone.
 *  - Bullish / very bullish: net delta above +DIRECTIONAL_DELTA. Bearish: below −DIRECTIONAL_DELTA.
 */
export function matchesView(c: { deltaPerSet: number; spotInProfitZone: boolean }, view: Sentiment | null | undefined): boolean {
  if (!view || !Number.isFinite(c.deltaPerSet)) return false;
  if (view === "neutral") return Math.abs(c.deltaPerSet) <= DELTA_NEUTRAL_BAND && c.spotInProfitZone;
  if (view === "bullish" || view === "very_bullish") return c.deltaPerSet > DIRECTIONAL_DELTA;
  return c.deltaPerSet < -DIRECTIONAL_DELTA;
}

export type SliderKey = "ArrowRight" | "ArrowUp" | "ArrowLeft" | "ArrowDown" | "PageUp" | "PageDown" | "Home" | "End";

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Next target-price value for a slider key, or null for other keys. Arrows move to the next listed
 * strike in that direction (off-grid values snap to the neighbouring strike); PageUp/PageDown move
 * by 1σ (in points) and snap to the strike grid; Home/End jump to min/max. Clamped to [min, max].
 */
export function stepTarget(current: number, key: string, o: { step: number; sigmaPts: number; min: number; max: number }): number | null {
  const step = o.step > 0 ? o.step : 1;
  const cur = Number.isFinite(current) && current > 0 ? current : o.min;
  const eps = step * 1e-6;
  let next: number;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      next = Math.floor((cur + eps) / step) * step + step;
      break;
    case "ArrowLeft":
    case "ArrowDown":
      next = Math.ceil((cur - eps) / step) * step - step;
      break;
    case "PageUp":
    case "PageDown": {
      const jump = o.sigmaPts > 0 ? o.sigmaPts : step * 5;
      const raw = cur + (key === "PageUp" ? jump : -jump);
      next = Math.round(raw / step) * step;
      if (next === Math.round(cur / step) * step) next += key === "PageUp" ? step : -step;
      break;
    }
    case "Home":
      next = o.min;
      break;
    case "End":
      next = o.max;
      break;
    default:
      return null;
  }
  const lo = Math.min(o.min, o.max);
  const hi = Math.max(o.min, o.max);
  return round2(Math.min(hi, Math.max(lo, next)));
}
