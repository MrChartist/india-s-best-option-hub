/**
 * Lognormal probabilities on the forward (risk-neutral, driftless in F).
 * P(S_T > K) = N(d2), d2 = (ln(F/K) − σ²T/2) / (σ√T).
 */
import { black76Price, intrinsic } from "./blackScholes";
import { normCdf, normPdf } from "./normal";
import { breakevens, strategyPayoffAtExpiry } from "./payoff";
import type { Interval, Leg, OptionType } from "./types";
import { isLegEnabled, sideSign } from "./types";

function d2Of(F: number, K: number, T: number, sigma: number): number {
  return (Math.log(F / K) - 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
}

/** P(S_T < x) under a lognormal with mean F. */
export function probBelow(F: number, x: number, T: number, sigma: number): number {
  if (![F, x, T, sigma].every((v) => typeof v === "number" && !Number.isNaN(v))) return NaN;
  if (x === Infinity) return 1;
  if (x <= 0) return 0;
  if (F <= 0) return NaN;
  if (T <= 0 || sigma <= 0) return F < x ? 1 : 0;
  return normCdf(-d2Of(F, x, T, sigma));
}

/** Lognormal density of S_T with mean F (forward), vol sigma and time T in years. 0 outside the support. */
export function lognormalDensity(S: number, F: number, sigma: number, T: number): number {
  if (!(S > 0) || !(F > 0) || !(sigma > 0) || !(T > 0)) return 0;
  const sd = sigma * Math.sqrt(T);
  const z = (Math.log(S / F) + 0.5 * sd * sd) / sd;
  return normPdf(z) / (S * sd);
}

/**
 * Quadrature grid for the lognormal with mean F: n + 1 nodes S at z ∈ [−6, 6] standard deviations,
 * each weighted by the probability mass of its cell (weights sum to 1). E[g(S_T)] ≈ Σ w·g(S).
 */
export function lognormalGrid(F: number, sigma: number, T: number, n = 400): Array<{ S: number; w: number }> {
  if (!(F > 0) || !(sigma > 0) || !(n >= 1)) return [];
  const sd = sigma * Math.sqrt(Math.max(T, 1e-8));
  const mu = Math.log(F) - 0.5 * sd * sd;
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) zs.push(-6 + (12 * i) / n);
  return zs.map((z, i) => {
    const lo = i === 0 ? -Infinity : (zs[i - 1] + z) / 2;
    const hi = i === n ? Infinity : (zs[i + 1] + z) / 2;
    return { S: Math.exp(mu + sd * z), w: normCdf(hi) - normCdf(lo) };
  });
}

/** Probability of finishing in the money: N(d2) for calls, N(−d2) for puts. */
export function probITM(p: { F: number; K: number; T: number; sigma: number; type: OptionType }): number {
  if (!p) return NaN;
  const below = probBelow(p.F, p.K, p.T, p.sigma);
  if (Number.isNaN(below)) return NaN;
  return p.type === "CE" ? 1 - below : below;
}

/**
 * Probability of touching the strike before expiry (reflection approximation):
 * min(1, 2·P(ITM)) for an OTM strike, 1 when already in the money.
 */
export function probTouch(p: { F: number; K: number; T: number; sigma: number; type: OptionType }): number {
  const pItm = probITM(p);
  if (!p || Number.isNaN(pItm)) return NaN;
  const alreadyItm = intrinsic(p.F, p.K, p.type) > 0;
  if (alreadyItm) return 1;
  return Math.min(1, 2 * Math.min(pItm, 1 - pItm));
}

/** P(lo < S_T < hi); hi may be Infinity. */
export function probBetween(F: number, lo: number, hi: number, T: number, sigma: number): number {
  if (!(hi > lo)) return 0;
  const a = probBelow(F, Math.max(lo, 0), T, sigma);
  const b = probBelow(F, hi, T, sigma);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.max(0, Math.min(1, b - a));
}

/** Spot intervals where the expiry payoff is strictly positive. */
export function profitableIntervals(legs: Leg[]): Interval[] {
  const act = (Array.isArray(legs) ? legs : []).filter((l) => l && isLegEnabled(l));
  if (act.length === 0) return [];
  const bes = breakevens(act);
  const bounds = [0, ...bes, Infinity];
  const out: Interval[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const probe = b === Infinity ? Math.max(a * 1.5, a + 1) : (a + b) / 2;
    const v = strategyPayoffAtExpiry(act, probe);
    if (v > 1e-9) {
      const prev = out[out.length - 1];
      if (prev && Math.abs(prev.to - a) < 1e-9) prev.to = b;
      else out.push({ from: a, to: b });
    }
  }
  return out;
}

/**
 * Lognormal probability of profit at expiry, integrated over the profitable intervals.
 * sigma may be a function of strike (skew): each interval edge uses its own vol.
 */
export function probabilityOfProfit(legs: Leg[], o: { F: number; T: number; sigma: number | ((K: number) => number) }): number {
  if (!o || !(o.F > 0) || !(o.T >= 0)) return NaN;
  const sig = typeof o.sigma === "function" ? o.sigma : () => o.sigma as number;
  const below = (x: number) => (x === Infinity ? 1 : x <= 0 ? 0 : probBelow(o.F, x, o.T, sig(x)));
  let p = 0;
  for (const iv of profitableIntervals(legs)) {
    const v = below(iv.to) - below(iv.from);
    if (Number.isNaN(v)) return NaN;
    p += v;
  }
  return Math.max(0, Math.min(1, p));
}

/** Expected expiry P&L (rupees, undiscounted) under the lognormal with mean F — exact, leg by leg. */
export function expectedValue(legs: Leg[], o: { F: number; T: number; sigma: number }): number {
  if (!o || !(o.F > 0)) return NaN;
  let ev = 0;
  for (const l of (Array.isArray(legs) ? legs : []).filter((x) => x && isLegEnabled(x))) {
    const qty = (Number(l.lots) || 0) * (Number(l.lotSize) || 0);
    const sigma = o.sigma > 0 ? o.sigma : (l.iv ?? NaN);
    const expected = l.type === "FUT" ? o.F : black76Price({ F: o.F, K: l.strike, T: o.T, r: 0, sigma, type: l.type });
    ev += sideSign(l.side) * (expected - (Number(l.premium) || 0)) * qty;
  }
  return ev;
}

/** Deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws via Box-Muller from a uniform source. */
export function gaussianSource(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u <= 1e-300) u = rand();
    const v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

/**
 * Monte-Carlo probability that the position's mark-to-model P&L reaches `target` rupees at
 * any daily step before expiry (e.g. 50% of max profit for "P50"). Deterministic for a seed.
 * Each leg uses its own iv when present, else sigma; all legs are taken to expire at T.
 * Spot follows GBM with drift r − q, and legs are repriced on F = S·e^{(r−q)·tLeft}, matching
 * how the builder priced them. Pass the index dividend yield as q (getDividendYield(symbol)),
 * otherwise the t≈0 model mark differs from the entry premium and biases the result.
 */
export function probOfReachingProfit(
  legs: Leg[],
  o: { S: number; T: number; sigma: number; target: number; paths?: number; seed?: number; r?: number; q?: number },
): number {
  const act = (Array.isArray(legs) ? legs : []).filter((l) => l && isLegEnabled(l));
  if (!o || !(o.S > 0) || !(o.T > 0) || !(o.sigma > 0) || !Number.isFinite(o.target) || act.length === 0) return NaN;
  const paths = Math.max(100, Math.min(20000, Math.round(o.paths ?? 2000)));
  const r = Number.isFinite(o.r) ? (o.r as number) : 0;
  const q = Number.isFinite(o.q) ? (o.q as number) : 0;
  const steps = Math.max(1, Math.min(60, Math.round(o.T * 252)));
  const dt = o.T / steps;
  const gauss = gaussianSource(mulberry32(o.seed ?? 42));
  const drift = (r - q - 0.5 * o.sigma * o.sigma) * dt;
  const vol = o.sigma * Math.sqrt(dt);
  const legData = act.map((l) => ({
    sign: sideSign(l.side),
    qty: (Number(l.lots) || 0) * (Number(l.lotSize) || 0),
    sigma: typeof l.iv === "number" && l.iv > 0 ? l.iv : o.sigma,
    l,
  }));
  const valueAt = (S: number, tLeft: number) => {
    let v = 0;
    const F = S * Math.exp((r - q) * Math.max(tLeft, 0));
    for (const d of legData) {
      const px =
        d.l.type === "FUT"
          ? F
          : tLeft > 0
            ? black76Price({ F, K: d.l.strike, T: tLeft, r, sigma: d.sigma, type: d.l.type })
            : intrinsic(S, d.l.strike, d.l.type);
      v += d.sign * (px - (Number(d.l.premium) || 0)) * d.qty;
    }
    return v;
  };
  let hits = 0;
  for (let p = 0; p < paths; p++) {
    let S = o.S;
    for (let k = 1; k <= steps; k++) {
      S *= Math.exp(drift + vol * gauss());
      if (valueAt(S, o.T - k * dt) >= o.target) {
        hits++;
        break;
      }
    }
  }
  return hits / paths;
}
