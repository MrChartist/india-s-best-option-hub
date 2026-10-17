/**
 * Black-Scholes-Merton (spot, dividend yield q) and Black-76 (forward) pricing.
 * Pure functions; bad input returns NaN, never throws.
 */
import { normCdf } from "./normal";
import type { Black76Input, OptionType, PricingInput } from "./types";

function bad(...xs: number[]): boolean {
  return xs.some((x) => typeof x !== "number" || Number.isNaN(x));
}

export function d1d2(S: number, K: number, T: number, r: number, q: number, sigma: number): { d1: number; d2: number } {
  if (bad(S, K, T, r, q, sigma) || S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return { d1: NaN, d2: NaN };
  const sqrtT = Math.sqrt(T);
  const vs = sigma * sqrtT;
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vs;
  return { d1, d2: d1 - vs };
}

export function intrinsic(S: number, K: number, type: OptionType): number {
  if (bad(S, K)) return NaN;
  return type === "CE" ? Math.max(S - K, 0) : Math.max(K - S, 0);
}

export function forwardFromSpot(S: number, T: number, r: number, q = 0): number {
  if (bad(S, T, r, q)) return NaN;
  return S * Math.exp((r - q) * Math.max(T, 0));
}

/** F = K + e^{rT}(C - P) from put-call parity. */
export function impliedForward(K: number, callPrice: number, putPrice: number, T: number, r: number): number {
  if (bad(K, callPrice, putPrice, T, r)) return NaN;
  return K + Math.exp(r * Math.max(T, 0)) * (callPrice - putPrice);
}

/** BSM price. T<=0 or sigma<=0 returns discounted-free intrinsic (on spot). */
export function bsPrice(p: PricingInput): number {
  const { S, K, T, r, sigma, type } = p ?? ({} as PricingInput);
  const q = p?.q ?? 0;
  if (bad(S, K, T, r, q, sigma) || S < 0 || K < 0) return NaN;
  if (T <= 0 || sigma <= 0) return intrinsic(S, K, type);
  if (S === 0) return type === "CE" ? 0 : K * Math.exp(-r * T);
  if (K === 0) return type === "CE" ? S * Math.exp(-q * T) : 0;
  const { d1, d2 } = d1d2(S, K, T, r, q, sigma);
  const dfR = Math.exp(-r * T);
  const dfQ = Math.exp(-q * T);
  if (type === "CE") return S * dfQ * normCdf(d1) - K * dfR * normCdf(d2);
  return K * dfR * normCdf(-d2) - S * dfQ * normCdf(-d1);
}

/** Black-76 price on the forward F. T<=0 or sigma<=0 returns intrinsic on F. */
export function black76Price(p: Black76Input): number {
  const { F, K, T, r, sigma, type } = p ?? ({} as Black76Input);
  if (bad(F, K, T, r, sigma) || F < 0 || K < 0) return NaN;
  if (T <= 0 || sigma <= 0) return intrinsic(F, K, type);
  const df = Math.exp(-r * T);
  if (F === 0) return type === "CE" ? 0 : df * K;
  if (K === 0) return type === "CE" ? df * F : 0;
  const { d1, d2 } = d1d2(F, K, T, 0, 0, sigma);
  if (type === "CE") return df * (F * normCdf(d1) - K * normCdf(d2));
  return df * (K * normCdf(-d2) - F * normCdf(-d1));
}
