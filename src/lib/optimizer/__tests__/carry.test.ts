import { describe, expect, it } from "vitest";
import { impliedCarryYield } from "@/lib/optimizer/score";
import { getDividendYield, lognormalDensity, lognormalGrid } from "@/lib/options";

describe("impliedCarryYield", () => {
  it("recovers q from F = S·e^{(r−q)T}", () => {
    const S = 25000;
    const r = 0.065;
    const q = 0.013;
    const T = 38 / 365;
    const F = S * Math.exp((r - q) * T);
    expect(impliedCarryYield(S, F, T, r, "NIFTY")).toBeCloseTo(q, 10);
  });

  it("falls back to the dividend table for unusable inputs and clamps extremes", () => {
    expect(impliedCarryYield(25000, NaN, 0.1, 0.065, "NIFTY")).toBe(getDividendYield("NIFTY"));
    expect(impliedCarryYield(25000, 25100, 0, 0.065, "NIFTY")).toBe(getDividendYield("NIFTY"));
    expect(impliedCarryYield(25000, 20000, 0.01, 0.065, "NIFTY")).toBe(0.1);
  });
});

describe("lognormal helpers", () => {
  it("grid weights sum to 1 with mean F", () => {
    const F = 25000;
    const g = lognormalGrid(F, 0.15, 30 / 365);
    const w = g.reduce((s, p) => s + p.w, 0);
    const mean = g.reduce((s, p) => s + p.w * p.S, 0);
    expect(w).toBeCloseTo(1, 6);
    expect(mean / F).toBeCloseTo(1, 3);
  });

  it("density integrates to 1", () => {
    const F = 100;
    let area = 0;
    for (let x = 1; x < 300; x += 0.05) area += lognormalDensity(x, F, 0.2, 0.5) * 0.05;
    expect(area).toBeCloseTo(1, 3);
  });
});
