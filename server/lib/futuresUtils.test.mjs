import { describe, it, expect } from "vitest";
import { classifyBuildup, computeBasis } from "./futuresUtils.mjs";

describe("classifyBuildup", () => {
  it("price up + OI up = Long Buildup", () => {
    expect(classifyBuildup(1.5, 3)).toBe("Long Buildup");
  });
  it("price down + OI up = Short Buildup", () => {
    expect(classifyBuildup(-1.5, 3)).toBe("Short Buildup");
  });
  it("price up + OI down = Short Covering", () => {
    expect(classifyBuildup(1.5, -3)).toBe("Short Covering");
  });
  it("price down + OI down = Long Unwinding", () => {
    expect(classifyBuildup(-1.5, -3)).toBe("Long Unwinding");
  });
  it("sub-threshold moves classify as Neutral, not noise-driven signals", () => {
    expect(classifyBuildup(0.01, 0.1)).toBe("Neutral");
  });
  it("missing data classifies as Neutral rather than throwing", () => {
    expect(classifyBuildup(null, 3)).toBe("Neutral");
    expect(classifyBuildup(1.5, undefined)).toBe("Neutral");
  });
});

describe("computeBasis", () => {
  it("computes a positive basis (futures premium to spot)", () => {
    const { basis, basisPercent } = computeBasis(25100, 25000);
    expect(basis).toBe(100);
    expect(basisPercent).toBeCloseTo(0.4, 5);
  });
  it("computes a negative basis (futures discount to spot)", () => {
    const { basis, basisPercent } = computeBasis(24900, 25000);
    expect(basis).toBe(-100);
    expect(basisPercent).toBeCloseTo(-0.4, 5);
  });
  it("returns nulls instead of NaN/Infinity when inputs are unavailable", () => {
    expect(computeBasis(null, 25000)).toEqual({ basis: null, basisPercent: null });
    expect(computeBasis(25000, 0)).toEqual({ basis: null, basisPercent: null });
  });
});
