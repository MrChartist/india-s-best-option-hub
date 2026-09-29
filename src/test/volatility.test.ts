import { describe, it, expect } from "vitest";
import { calculateExpectedMove, computeVolRank, volRankLabel } from "@/lib/volatility";

describe("calculateExpectedMove", () => {
  it("scales with IV and √time", () => {
    const m = calculateExpectedMove(24000, 15, 7);
    // 24000 × 0.15 × √(7/365) ≈ 498.5
    expect(m.expectedMove).toBeCloseTo(498.5, 0);
    expect(m.upperBound1SD - m.spotPrice).toBeCloseTo(m.expectedMove, 1);
    expect(m.upperBound2SD - m.spotPrice).toBeCloseTo(m.expectedMove * 2, 1);
  });

  it("is zero on expiry day and never NaN for negative DTE", () => {
    expect(calculateExpectedMove(24000, 15, 0).expectedMove).toBe(0);
    expect(calculateExpectedMove(24000, 15, -1).expectedMove).toBe(0);
  });
});

describe("computeVolRank", () => {
  const history = Array.from({ length: 100 }, (_, i) => 10 + i * 0.1); // 10.0 → 19.9

  it("ranks mid-range values", () => {
    const r = computeVolRank(15, history)!;
    expect(r.rank).toBeGreaterThan(40);
    expect(r.rank).toBeLessThan(60);
    expect(r.percentile).toBeGreaterThan(40);
    expect(r.samples).toBe(100);
  });

  it("caps at 100 / 0 when today sets a new extreme", () => {
    expect(computeVolRank(25, history)!.rank).toBe(100);
    expect(computeVolRank(5, history)!.rank).toBe(0);
  });

  it("refuses to rank without enough real history", () => {
    expect(computeVolRank(15, [12, 13, 14])).toBeNull();
    expect(computeVolRank(0, history)).toBeNull();
  });

  it("ignores junk points", () => {
    const r = computeVolRank(15, [...history, NaN, 0, -3])!;
    expect(r.samples).toBe(100);
  });

  it("labels rank bands", () => {
    expect(volRankLabel(80).tone).toBe("bearish");
    expect(volRankLabel(10).tone).toBe("bullish");
    expect(volRankLabel(50).tone).toBe("warning");
  });
});
