import { describe, it, expect } from "vitest";
import { getMaxPain, calculatePCR, getATMIV, getStrikePCR, getDeltaOI, getATMZoneAnalysis, getWeightedPCR } from "@/lib/oiUtils";
import type { OptionData } from "@/lib/mockData";

// Helper to build a minimal chain row
function makeRow(strike: number, ceOI: number, peOI: number, overrides?: Partial<{
  ceLTP: number; peLTP: number; ceIV: number; peIV: number;
  ceDelta: number; peDelta: number; ceVol: number; peVol: number;
  ceOIChg: number; peOIChg: number;
}>): OptionData {
  return {
    strikePrice: strike,
    ce: {
      ltp: overrides?.ceLTP ?? 100,
      oi: ceOI,
      oiChange: overrides?.ceOIChg ?? 0,
      volume: overrides?.ceVol ?? 10000,
      iv: overrides?.ceIV ?? 15,
      delta: overrides?.ceDelta ?? 0.5,
      gamma: 0.01,
      theta: -5,
      vega: 10,
      bidPrice: 99,
      askPrice: 101,
    },
    pe: {
      ltp: overrides?.peLTP ?? 100,
      oi: peOI,
      oiChange: overrides?.peOIChg ?? 0,
      volume: overrides?.peVol ?? 10000,
      iv: overrides?.peIV ?? 15,
      delta: overrides?.peDelta ?? -0.5,
      gamma: 0.01,
      theta: -5,
      vega: 10,
      bidPrice: 99,
      askPrice: 101,
    },
  };
}

describe("getMaxPain", () => {
  it("returns 0 for empty chain", () => {
    expect(getMaxPain([])).toBe(0);
  });

  it("returns the strike with minimum total pain", () => {
    // Chain: 24000 (heavy PE OI), 24100 (balanced), 24200 (heavy CE OI)
    // Max pain should gravitate toward the strike where writers lose least
    const chain: OptionData[] = [
      makeRow(24000, 50000, 200000),
      makeRow(24100, 100000, 100000),
      makeRow(24200, 200000, 50000),
    ];
    const mp = getMaxPain(chain);
    expect(mp).toBe(24100); // balanced OI = minimum pain
  });

  it("handles single-strike chain", () => {
    const chain = [makeRow(25000, 100000, 100000)];
    expect(getMaxPain(chain)).toBe(25000);
  });
});

describe("calculatePCR", () => {
  it("returns zeros for empty chain", () => {
    const result = calculatePCR([]);
    expect(result.pcrOI).toBe(0);
    expect(result.pcrVolume).toBe(0);
    expect(result.totalCEOI).toBe(0);
  });

  it("computes correct PCR ratio", () => {
    const chain = [
      makeRow(24000, 100000, 150000),
      makeRow(24100, 200000, 250000),
    ];
    const result = calculatePCR(chain);
    // Total CE OI = 300000, Total PE OI = 400000
    expect(result.totalCEOI).toBe(300000);
    expect(result.totalPEOI).toBe(400000);
    expect(result.pcrOI).toBeCloseTo(1.33, 1);
    expect(result.signal).toBe("Strong Bullish");
  });

  it("returns Bearish signal for low PCR", () => {
    const chain = [
      makeRow(24000, 200000, 80000),
      makeRow(24100, 200000, 80000),
    ];
    const result = calculatePCR(chain);
    expect(result.pcrOI).toBeCloseTo(0.4, 1);
    expect(result.signal).toBe("Strong Bearish");
  });
});

describe("getWeightedPCR", () => {
  it("returns all zeros for empty chain", () => {
    const result = getWeightedPCR([], 24000, 100);
    expect(result.weightedPcrOI).toBe(0);
    expect(result.plainPcrOI).toBe(0);
    expect(result.weightedTotalCEOI).toBe(0);
    expect(result.weightedTotalPEOI).toBe(0);
  });

  it("pulls PCR closer to 1.0 than the plain PCR when only far-from-spot strikes are imbalanced", () => {
    // 23800/24200 are 2 steps from ATM (24000) and heavily PE-skewed; 23900/24000/24100
    // are balanced. Weighting down the far strikes should soften that skew.
    const chain = [
      makeRow(23800, 20000, 200000),
      makeRow(23900, 100000, 100000),
      makeRow(24000, 150000, 150000),
      makeRow(24100, 100000, 100000),
      makeRow(24200, 20000, 200000),
    ];
    const result = getWeightedPCR(chain, 24000, 100);
    expect(result.plainPcrOI).toBeCloseTo(1.92, 2);
    expect(result.weightedPcrOI).toBeCloseTo(1.46, 2);
    expect(Math.abs(result.weightedPcrOI - 1)).toBeLessThan(Math.abs(result.plainPcrOI - 1));
  });

  it("produces a different ratio than the plain PCR when skew sits away from ATM", () => {
    const chain = [
      makeRow(24000, 100000, 100000),
      makeRow(24100, 100000, 150000),
      makeRow(24300, 300000, 60000),
    ];
    const result = getWeightedPCR(chain, 24000, 100);
    expect(result.weightedTotalCEOI).toBe(225000);
    expect(result.weightedTotalPEOI).toBe(190000);
    expect(result.plainPcrOI).toBeCloseTo(0.62, 2);
    expect(result.weightedPcrOI).toBeCloseTo(0.84, 2);
    expect(result.weightedPcrOI).not.toBe(result.plainPcrOI);
  });
});

describe("getATMIV", () => {
  it("returns 0 for empty chain", () => {
    expect(getATMIV([], 24000).atmIV).toBe(0);
  });

  it("finds the ATM strike closest to spot and averages CE/PE IV", () => {
    const chain = [
      makeRow(23900, 100000, 100000, { ceIV: 12, peIV: 14 }),
      makeRow(24000, 100000, 100000, { ceIV: 16, peIV: 18 }),
      makeRow(24100, 100000, 100000, { ceIV: 20, peIV: 22 }),
    ];
    const result = getATMIV(chain, 24050);
    expect(result.atmStrike).toBe(24000); // closest to 24050
    expect(result.atmIV).toBe(17); // (16+18)/2
  });
});

describe("getStrikePCR", () => {
  it("filters strikes below OI threshold", () => {
    const chain = [
      makeRow(24000, 5000, 5000),    // below 10000 threshold
      makeRow(24100, 100000, 200000), // above threshold
    ];
    const result = getStrikePCR(chain, 24050);
    expect(result).toHaveLength(1);
    expect(result[0].pcr).toBe(2);
  });
});

describe("getDeltaOI", () => {
  it("filters low OI strikes and computes delta exposure", () => {
    const chain = [
      makeRow(24000, 10000, 10000, { ceDelta: 0.7, peDelta: -0.3 }),  // below 30000 threshold
      makeRow(24100, 50000, 80000, { ceDelta: 0.5, peDelta: -0.5 }),
    ];
    const result = getDeltaOI(chain, 24050, 100);
    expect(result).toHaveLength(1);
    expect(result[0].strike).toBe(24100);
    expect(result[0].ceDeltaOI).toBe(25); // 50000 * 0.5 / 1000 = 25
    expect(result[0].peDeltaOI).toBe(-40); // 80000 * -0.5 / 1000 = -40
  });
});

describe("getATMZoneAnalysis", () => {
  it("analyzes the zone around ATM", () => {
    const chain = [
      makeRow(23900, 100000, 120000, { ceOIChg: 5000, peOIChg: 8000 }),
      makeRow(24000, 150000, 180000, { ceOIChg: 10000, peOIChg: 12000 }),
      makeRow(24100, 130000, 110000, { ceOIChg: 7000, peOIChg: 6000 }),
    ];
    const result = getATMZoneAnalysis(chain, 24000, 100, 3);
    expect(result.strikes).toBe(3);
    expect(result.totalCEOI).toBe(380000);
    expect(result.totalPEOI).toBe(410000);
    expect(result.pcr).toBeCloseTo(1.08, 1);
  });
});
