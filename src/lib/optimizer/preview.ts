/**
 * Small pure helpers for the Optimizer UI: payoff previews, sentiment targets, basket legs and the
 * lognormal density used by the target-price chart.
 */
import { getDividendYield, strategyPayoffAtExpiry, strategyValueAt, type OptionType, type Side } from "@/lib/options";
import { isMultiExpiry, toLegs } from "./score";
import type { Candidate, ScoredCandidate } from "./types";

export interface PreviewPoint {
  spot: number;
  /** P&L at the front expiry (rupees). */
  expiry: number;
  /** P&L at the target date (rupees). */
  target: number;
}

/**
 * P&L curve for a scored candidate across [lo, hi], at expiry and at the valuation instant.
 * `q` is the carry yield the scorer used (ScoreContext.q, implied from the parity forward); without
 * it the static dividend table for the symbol is used, never 0, so the curve stays close to the
 * forward the leg IVs were solved on.
 */
export function payoffPreview(
  c: Pick<ScoredCandidate, "legs" | "lots" | "lotSize">,
  o: { symbol: string; lo: number; hi: number; points?: number; nowMs: number; atDateMs: number; frontExpiryMs: number; r: number; q?: number },
): PreviewPoint[] {
  const n = Math.max(8, Math.min(240, o.points ?? 64));
  if (!(o.hi > o.lo) || !(o.lo > 0)) return [];
  const legs = toLegs(c, c.lots, o.symbol, c.lotSize);
  const multi = isMultiExpiry(c);
  const now = new Date(o.nowMs);
  const at = new Date(o.atDateMs);
  const front = new Date(o.frontExpiryMs);
  const q = Number.isFinite(o.q) ? (o.q as number) : getDividendYield(o.symbol);
  const strikes = c.legs.map((l) => l.strike).filter((k) => k > o.lo && k < o.hi);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(o.lo + ((o.hi - o.lo) * i) / (n - 1));
  const all = Array.from(new Set([...xs, ...strikes])).sort((a, b) => a - b);
  return all.map((S) => ({
    spot: S,
    expiry: multi ? strategyValueAt(legs, S, { now, atDate: front, r: o.r, q }) : strategyPayoffAtExpiry(legs, S),
    target: strategyValueAt(legs, S, { now, atDate: at, r: o.r, q }),
  }));
}

export type Sentiment = "very_bearish" | "bearish" | "neutral" | "bullish" | "very_bullish";

export const SENTIMENTS: Array<{ id: Sentiment; label: string; sigmas: number }> = [
  { id: "very_bearish", label: "Very bearish", sigmas: -1 },
  { id: "bearish", label: "Bearish", sigmas: -0.5 },
  { id: "neutral", label: "Neutral", sigmas: 0 },
  { id: "bullish", label: "Bullish", sigmas: 0.5 },
  { id: "very_bullish", label: "Very bullish", sigmas: 1 },
];

/** Target price for a sentiment: spot · e^{k·σ√T}, rounded to the tick. */
export function sentimentTarget(spot: number, sigma: number, T: number, k: number, tick = 0.05): number {
  if (!(spot > 0)) return NaN;
  const sd = Math.max(sigma, 0) * Math.sqrt(Math.max(T, 0));
  const raw = spot * Math.exp(k * sd);
  return roundTo(raw, tick);
}

export function roundTo(v: number, step: number): number {
  if (!(step > 0)) return v;
  return Math.round(Math.round(v / step) * step * 100) / 100;
}

/** Lognormal density of S_T with mean F (for the target chart); lives in @/lib/options/probability. */
export { lognormalDensity } from "@/lib/options";

/** Shared basket leg shape (see src/components/option-chain/basket.ts): iv is a decimal or null. */
export interface BasketLegShape {
  symbol: string;
  expiry: string;
  strike: number;
  type: OptionType;
  side: Side;
  lots: number;
  premium: number;
  iv: number | null;
}

export function toBasketLegs(c: Pick<Candidate, "legs">, units: number, symbol: string): BasketLegShape[] {
  return c.legs.map((l) => ({
    symbol,
    expiry: l.expiry,
    strike: l.strike,
    type: l.type,
    side: l.side,
    lots: l.ratio * units,
    premium: Math.round(l.premium * 100) / 100,
    iv: l.iv !== null && Number.isFinite(l.iv) ? Math.round(l.iv * 10000) / 10000 : null,
  }));
}
