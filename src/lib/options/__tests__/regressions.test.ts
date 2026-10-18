import { describe, expect, it } from "vitest";
import {
  black76Price,
  estimateMargin,
  expectedValue,
  normalizeExpiry,
  positionSize,
  probITM,
  probTouch,
  type Leg,
} from "@/lib/options";

describe("probTouch", () => {
  it("judges 'already in the money' on spot, not on the forward", () => {
    const p = { F: 25100, K: 25050, T: 30 / 365, sigma: 0.13, type: "CE" as const };
    const touch = probTouch({ ...p, S: 25000 });
    expect(touch).toBeLessThan(1);
    expect(touch).toBeCloseTo(Math.min(1, 2 * Math.min(probITM(p), 1 - probITM(p))), 12);
    // Without spot it still falls back to F.
    expect(probTouch(p)).toBe(1);
    // Spot through the strike is a touch.
    expect(probTouch({ ...p, S: 25060 })).toBe(1);
  });
});

describe("expectedValue", () => {
  it("values each leg at its own IV so a skewed spread at fair value shows no edge", () => {
    const F = 25000;
    const T = 14 / 365;
    const px = (K: number, iv: number) => black76Price({ F, K, T, r: 0, sigma: iv, type: "PE" });
    const legs: Leg[] = [
      { symbol: "NIFTY", type: "PE", side: "SELL", strike: 24000, expiry: "2026-11-03", lots: 1, lotSize: 65, premium: px(24000, 0.19), iv: 0.19 },
      { symbol: "NIFTY", type: "PE", side: "BUY", strike: 23800, expiry: "2026-11-03", lots: 1, lotSize: 65, premium: px(23800, 0.202), iv: 0.202 },
    ];
    expect(expectedValue(legs, { F, T, sigma: 0.13 })).toBeCloseTo(0, 6);
    // Legs without an IV still use the scalar sigma.
    const noIv = legs.map(({ iv: _iv, ...l }) => l as Leg);
    expect(Math.abs(expectedValue(noIv, { F, T, sigma: 0.13 }))).toBeGreaterThan(100);
  });
});

describe("estimateMargin", () => {
  it("does not apply the defined-risk cap when a short leg outlives the long leg", () => {
    const now = new Date("2026-10-19T05:00:00Z");
    const near: Leg = { symbol: "NIFTY", type: "CE", side: "BUY", strike: 25000, expiry: "2026-10-27", lots: 1, lotSize: 65, premium: 150, iv: 0.12 };
    const far: Leg = { symbol: "NIFTY", type: "CE", side: "SELL", strike: 25000, expiry: "2026-11-24", lots: 1, lotSize: 65, premium: 400, iv: 0.13 };
    const book = estimateMargin([near, far], { spot: 25000, now });
    expect(book.method).not.toBe("defined-risk");
    expect(book.definedRisk).toBe(false);
    expect(book.span).toBeGreaterThan(0);
  });

  it("still caps a single-expiry spread at its max loss", () => {
    const now = new Date("2026-10-19T05:00:00Z");
    const exp = "2026-10-27";
    const m = estimateMargin(
      [
        { symbol: "NIFTY", type: "CE", side: "SELL", strike: 25000, expiry: exp, lots: 1, lotSize: 65, premium: 150, iv: 0.12 },
        { symbol: "NIFTY", type: "CE", side: "BUY", strike: 25200, expiry: exp, lots: 1, lotSize: 65, premium: 70, iv: 0.12 },
      ],
      { spot: 25000, now },
    );
    expect(m.method).toBe("defined-risk");
  });
});

describe("normalizeExpiry", () => {
  it("maps a late-December expiry read in early January to the previous year", () => {
    const jan3 = new Date("2027-01-03T06:00:00Z");
    expect(normalizeExpiry("28 Dec", jan3)).toBe("2026-12-28");
    expect(normalizeExpiry("28DEC", jan3)).toBe("2026-12-28");
    expect(normalizeExpiry("27 Jan", jan3)).toBe("2027-01-27");
  });

  it("keeps the existing this-year / next-year inference", () => {
    const oct18 = new Date("2026-10-18T06:00:00Z");
    expect(normalizeExpiry("20 Oct", oct18)).toBe("2026-10-20");
    expect(normalizeExpiry("20 Jan", oct18)).toBe("2027-01-20");
    expect(normalizeExpiry("1 Sep", oct18)).toBe("2026-09-01");
  });
});

describe("positionSize", () => {
  it("rejects a risk budget above 100% of capital", () => {
    expect(positionSize({ capital: 5_00_000, riskPct: 500, maxLossPerLot: 3000, lotSize: 65 }).lots).toBe(0);
    expect(positionSize({ capital: 5_00_000, riskPct: 100, maxLossPerLot: 3000, lotSize: 65 }).lots).toBe(166);
  });
});
