import { describe, expect, it } from "vitest";
import { generateSampleChain, toISTDate } from "@/lib/options";
import { simulateSession } from "@/lib/flow";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import {
  baseTickStep,
  crDecimals,
  flatValues,
  formatCrCell,
  heatRamp,
  latestSession,
  levelsChangedSinceOpen,
  levelsHistory,
  parseGexConvention,
  priceTickStep,
  priceTicks,
  roundTicks,
  strikeAxisTicks,
  thinEvenly,
  wallMoves,
  type LevelsPoint,
} from "@/lib/gex";

describe("parseGexConvention", () => {
  it("accepts the two conventions and defaults to the India seller view", () => {
    expect(parseGexConvention("dealerLongCallShortPut")).toBe("dealerLongCallShortPut");
    expect(parseGexConvention("sellerShortBoth")).toBe("sellerShortBoth");
    expect(parseGexConvention(null)).toBe("sellerShortBoth");
    expect(parseGexConvention("garbage")).toBe("sellerShortBoth");
  });
});

describe("price ticks", () => {
  it("uses 250 for NIFTY and 500 for BANKNIFTY", () => {
    expect(baseTickStep("NIFTY", 0, 1)).toBe(250);
    expect(baseTickStep("banknifty", 0, 1)).toBe(500);
    expect(priceTicks("NIFTY", 24_760, 25_640)).toEqual([25_000, 25_250, 25_500]);
    // A 2,500-point span would need 10 labels at 250, so the step doubles to 500.
    expect(priceTicks("NIFTY", 23_760, 26_260)).toEqual([24_000, 24_500, 25_000, 25_500, 26_000]);
  });

  it("doubles the step until the axis fits", () => {
    expect(priceTickStep("NIFTY", 24_000, 26_000, 9)).toBe(250);
    expect(priceTickStep("NIFTY", 20_000, 30_000, 9)).toBe(2000);
    expect(priceTickStep("BANKNIFTY", 53_200, 58_800, 9)).toBe(1000);
  });

  it("builds round multiples inside the range", () => {
    expect(roundTicks(24_910, 25_640, 250)).toEqual([25_000, 25_250, 25_500]);
    expect(roundTicks(1, 0, 0)).toEqual([]);
    expect(roundTicks(NaN, 10, 1)).toEqual([]);
  });

  it("falls back to a 1-2-5 step for unknown symbols", () => {
    expect(baseTickStep("RELIANCE", 2_400, 2_800)).toBe(50);
  });

  it("picks round strikes for a categorical axis", () => {
    const strikes = Array.from({ length: 41 }, (_, i) => 24_000 + i * 50);
    const ticks = strikeAxisTicks("NIFTY", strikes);
    expect(ticks.every((k) => k % 250 === 0)).toBe(true);
    expect(ticks[0]).toBe(24_000);
    expect(ticks.length).toBeLessThanOrEqual(9);
    // Odd grids with no round multiple still get evenly spaced ticks.
    expect(strikeAxisTicks("NIFTY", [24_010, 24_060, 24_110, 24_160]).length).toBeGreaterThan(1);
  });
});

describe("heat scale", () => {
  it("fixes decimals by the largest value", () => {
    expect(crDecimals(1234)).toBe(0);
    expect(crDecimals(-150)).toBe(0);
    expect(crDecimals(42)).toBe(1);
    expect(crDecimals(NaN)).toBe(1);
  });

  it("formats cells in one unit with '<0.1' for tiny values", () => {
    expect(formatCrCell(1234.5, 0)).toBe("1,235");
    expect(formatCrCell(-2.34, 1)).toBe("−2.3");
    expect(formatCrCell(0.04, 1)).toBe("<0.1");
    expect(formatCrCell(-0.04, 0)).toBe("<0.1");
    expect(formatCrCell(0.6, 0)).toBe("0.6");
    expect(formatCrCell(0, 1)).toBe("0");
    expect(formatCrCell(NaN, 1)).toBe("");
    expect(formatCrCell(123456, 0)).toBe("1,23,456");
  });

  it("uses a sequential ramp when all values share a sign", () => {
    expect(heatRamp([-1, -2, NaN, 0, -0.5])).toBe("sequential");
    expect(heatRamp([1, 2, 3])).toBe("sequential");
    expect(heatRamp([1, -2])).toBe("diverging");
    expect(heatRamp([])).toBe("sequential");
    expect(flatValues([[1, 2], [3]])).toEqual([1, 2, 3]);
  });
});

describe("levels history", () => {
  const now = toISTDate("2026-10-16", "15:45");
  const chain = generateSampleChain({ symbol: "NIFTY", spot: 25_000, expiry: "2026-10-20", now, seed: 3 }).chain;
  const snaps = simulateSession({ symbol: "NIFTY", expiry: "2026-10-20", spot: 25_000, chain, now });

  it("thins evenly keeping both ends", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i);
    const t = thinEvenly(xs, 10);
    expect(t).toHaveLength(10);
    expect(t[0]).toBe(0);
    expect(t[9]).toBe(99);
    expect(thinEvenly([1, 2], 10)).toEqual([1, 2]);
  });

  it("keeps only the latest IST session", () => {
    const old: ChainSnapshot = { ...snaps[0], ts: toISTDate("2026-10-15", "12:00").getTime() };
    expect(latestSession([old, ...snaps])).toHaveLength(snaps.length);
    expect(latestSession([])).toEqual([]);
  });

  it("computes walls, dealer flip and total GEX per snapshot", () => {
    const pts = levelsHistory(snaps, 65, { convention: "sellerShortBoth", maxPoints: 12 });
    expect(pts.length).toBe(12);
    expect(pts[0].ts).toBe(snaps[0].ts);
    expect(pts[pts.length - 1].ts).toBe(snaps[snaps.length - 1].ts);
    const strikes = new Set(chain.map((r) => r.strikePrice));
    for (const p of pts) {
      expect(strikes.has(p.callWall as number)).toBe(true);
      expect(strikes.has(p.putWall as number)).toBe(true);
      // Seller view: writers short gamma everywhere, so total GEX is never positive.
      expect(p.totalGex).toBeLessThanOrEqual(0);
    }
    const dealer = levelsHistory(snaps, 65, { convention: "dealerLongCallShortPut", maxPoints: 12 });
    expect(dealer.map((p) => p.callWall)).toEqual(pts.map((p) => p.callWall));
    expect(dealer.map((p) => p.flip)).toEqual(pts.map((p) => p.flip));
  });

  it("reports what changed since the open", () => {
    const mk = (o: Partial<LevelsPoint>): LevelsPoint => ({
      ts: 0,
      spot: 25_000,
      callWall: 25_500,
      putWall: 24_500,
      flip: 24_800,
      totalGex: -100,
      ...o,
    });
    const pts = [
      mk({ ts: 1 }),
      mk({ ts: 2, callWall: 25_600 }),
      mk({ ts: 3, callWall: 25_500, putWall: 24_700, flip: 24_810, totalGex: -120, spot: 25_100 }),
    ];
    const ch = Object.fromEntries(levelsChangedSinceOpen(pts).map((c) => [c.key, c]));
    expect(ch.callWall.changed).toBe(false);
    expect(ch.putWall).toMatchObject({ from: 24_500, to: 24_700, delta: 200, changed: true });
    expect(ch.flip.changed).toBe(false); // 10 pts < 0.1% of spot
    expect(ch.totalGex.delta).toBe(-20);
    expect(ch.spot.delta).toBe(100);
    expect(wallMoves(pts, "callWall")).toBe(2);
    expect(wallMoves(pts, "putWall")).toBe(1);
    const gone = levelsChangedSinceOpen([mk({ flip: 24_800 }), mk({ flip: null })]);
    expect(gone.find((c) => c.key === "flip")?.changed).toBe(true);
    expect(levelsChangedSinceOpen([])).toEqual([]);
  });
});
