/**
 * Implied volatility solvers.
 *
 * Safeguarded Newton on vega inside a shrinking bracket (falls back to bisection
 * steps whenever Newton leaves the bracket or vega vanishes, which gives Brent-like
 * robustness), seeded by the Corrado-Miller approximation.
 * Returns NaN when the price is outside the no-arbitrage bounds; results are
 * clamped to [0.001, 5].
 */
import { black76Price, forwardFromSpot } from "./blackScholes";
import { normPdf } from "./normal";
import type { Black76Input, PricingInput } from "./types";

export const IV_MIN = 0.001;
export const IV_MAX = 5;

export const pctToDec = (ivPct: number): number => ivPct / 100;
export const decToPct = (iv: number): number => iv * 100;

function corradoMillerSeed(undiscCall: number, F: number, K: number, T: number): number {
  const x = F - K;
  const a = undiscCall - x / 2;
  const disc = a * a - (x * x) / Math.PI;
  const s = (Math.sqrt(2 * Math.PI) / (F + K)) * (a + Math.sqrt(Math.max(disc, 0)));
  const sigma = s / Math.sqrt(T);
  return Number.isFinite(sigma) && sigma > 0 ? Math.min(Math.max(sigma, 0.01), 3) : 0.2;
}

function vega76Raw(F: number, K: number, T: number, r: number, sigma: number): number {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  return Math.exp(-r * T) * F * normPdf(d1) * sqrtT;
}

export function impliedVol76(price: number, p: Omit<Black76Input, "sigma">, opts?: { tol?: number; maxIter?: number }): number {
  const { F, K, T, r, type } = p ?? ({} as Omit<Black76Input, "sigma">);
  if ([price, F, K, T, r].some((v) => typeof v !== "number" || !Number.isFinite(v))) return NaN;
  if (F <= 0 || K <= 0 || T <= 0 || price <= 0) return NaN;
  const tol = opts?.tol ?? 1e-12; // on sigma
  const maxIter = opts?.maxIter ?? 100;
  const df = Math.exp(-r * T);
  const lower = df * Math.max(type === "CE" ? F - K : K - F, 0);
  const upper = df * (type === "CE" ? F : K);
  const eps = 1e-12 * Math.max(1, price);
  if (price < lower - eps || price >= upper) return NaN;
  if (price <= lower + eps) return IV_MIN;

  const f = (s: number) => black76Price({ F, K, T, r, sigma: s, type }) - price;
  let lo = IV_MIN;
  let hi = IV_MAX;
  const fLo = f(lo);
  const fHi = f(hi);
  if (fLo >= 0) return IV_MIN;
  if (fHi <= 0) return IV_MAX;

  const undiscCall = (type === "CE" ? price : price + df * (F - K)) / df;
  let s = corradoMillerSeed(undiscCall, F, K, T);
  if (!(s > lo && s < hi)) s = 0.5 * (lo + hi);

  for (let i = 0; i < maxIter; i++) {
    const fs = f(s);
    if (fs === 0 || Math.abs(fs) <= 1e-13 * Math.max(1, price)) return s;
    if (fs > 0) hi = s;
    else lo = s;
    const v = vega76Raw(F, K, T, r, s);
    let next = v > 1e-300 ? s - fs / v : NaN;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (Math.abs(next - s) < tol || hi - lo < tol) return Math.min(Math.max(next, IV_MIN), IV_MAX);
    s = next;
  }
  return Math.min(Math.max(s, IV_MIN), IV_MAX);
}

/** BSM implied vol: solved on the equivalent Black-76 forward F = S·e^{(r−q)T}. */
export function impliedVol(price: number, p: Omit<PricingInput, "sigma">, opts?: { tol?: number; maxIter?: number }): number {
  const { S, K, T, r, type } = p ?? ({} as Omit<PricingInput, "sigma">);
  const q = p?.q ?? 0;
  if ([price, S, K, T, r, q].some((v) => typeof v !== "number" || !Number.isFinite(v)) || S <= 0) return NaN;
  return impliedVol76(price, { F: forwardFromSpot(S, T, r, q), K, T, r, type }, opts);
}
