import { describe, expect, it } from "vitest";
import { bsPrice, forwardFromSpot, greeks, greeks76, greeks76Spot } from "@/lib/options";

const S = 25000;
const r = 0.065;
const q = 0.013;

describe("greeks76Spot", () => {
  for (const [K, days, type] of [
    [25000, 30, "CE"],
    [25000, 30, "PE"],
    [25500, 7, "PE"],
    [24000, 60, "CE"],
  ] as const) {
    it(`matches BSM with dividend yield for ${type} ${K} ${days}d`, () => {
      const T = days / 365;
      const sigma = 0.14;
      const F = forwardFromSpot(S, T, r, q);
      const g = greeks76Spot({ F, K, T, r, sigma, type }, S);
      const b = greeks({ S, K, T, r, q, sigma, type });
      for (const k of ["delta", "gamma", "theta", "thetaTrading", "vega", "rho", "vanna", "charm", "vomma"] as const) {
        expect(g[k]).toBeCloseTo(b[k], 6);
      }
    });
  }

  it("theta holds spot fixed (finite difference) and differs from forward-fixed theta", () => {
    const K = 25000;
    const T = 30 / 365;
    const sigma = 0.14;
    const F = forwardFromSpot(S, T, r, q);
    const g = greeks76Spot({ F, K, T, r, sigma, type: "CE" }, S);
    const h = 1e-5;
    const perYear = (bsPrice({ S, K, T: T - h, r, q, sigma, type: "CE" }) - bsPrice({ S, K, T: T + h, r, q, sigma, type: "CE" })) / (2 * h);
    expect(g.theta).toBeCloseTo(perYear / 365, 3);
    expect(Math.abs(g.theta - greeks76({ F, K, T, r, sigma, type: "CE" }).theta)).toBeGreaterThan(1);
  });

  it("falls back to plain Black-76 for bad spot", () => {
    const p = { F: 25100, K: 25000, T: 0.1, r, sigma: 0.14, type: "CE" as const };
    expect(greeks76Spot(p, NaN)).toEqual(greeks76(p));
  });
});
