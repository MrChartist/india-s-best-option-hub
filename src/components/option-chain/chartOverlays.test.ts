import { describe, expect, it } from "vitest";
import { expectedMoveFromIV, timeToExpiryYears } from "@/lib/options";
import { breakevenLevels, chainChartLevels, expectedMoveCone } from "./chartOverlays";

describe("chainChartLevels", () => {
  it("prefers gamma walls, adds max pain and the flip", () => {
    const levels = chainChartLevels({ maxPain: 24500, maxOiStrike: { ce: 25000, pe: 24000 }, gamma: { callWall: 24900, putWall: 24100, absGamma: 24500, flip: 24380 } });
    expect(levels.map((l) => l.kind)).toEqual(["maxPain", "callWall", "putWall", "flip"]);
    expect(levels.find((l) => l.kind === "callWall")).toMatchObject({ price: 24900, label: "Call wall (GEX)" });
    expect(levels[0].label).toBe("Max pain 24,500");
  });

  it("falls back to OI walls, merges duplicates and skips bad values", () => {
    const levels = chainChartLevels({ maxPain: 25000, maxOiStrike: { ce: 25000, pe: Number.NaN }, gamma: null });
    expect(levels).toHaveLength(1);
    expect(levels[0].label).toBe("Max pain 25,000 · Call wall (OI)");
    expect(chainChartLevels({})).toEqual([]);
  });

  it("labels breakevens", () => {
    expect(breakevenLevels([24200, 24800])).toEqual([
      { price: 24200, label: "BE 1", kind: "breakeven" },
      { price: 24800, label: "BE 2", kind: "breakeven" },
    ]);
    expect(breakevenLevels([0, Number.NaN, 24300])[0].label).toBe("Breakeven");
    expect(breakevenLevels(undefined)).toEqual([]);
  });
});

describe("expectedMoveCone", () => {
  // Thu 15 Oct 2026, 10:30 IST; expiry Tue 20 Oct 2026.
  const now = new Date("2026-10-15T05:00:00Z");
  const anchorTime = Math.floor(new Date("2026-10-14T10:00:00Z").getTime() / 1000);

  it("projects one point per trading day to expiry, widening with time", () => {
    const [one, two] = expectedMoveCone({ anchorTime, anchor: 24500, iv: 0.14, expiry: "2026-10-20", now });
    expect(one.k).toBe(1);
    expect(two.k).toBe(2);
    // Anchor + Thu 15, Fri 16, Mon 19 (weekend skipped) and the expiry itself (Tue 20, a holiday here).
    expect(one.upper).toHaveLength(5);
    expect(one.upper[0]).toEqual({ time: anchorTime, value: 24500 });
    const widths = one.upper.map((p, i) => p.value - one.lower[i].value);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    // The last point equals the IV expected move over the full time to expiry.
    const full = expectedMoveFromIV(24500, 0.14, timeToExpiryYears("2026-10-20", now), 1);
    expect(one.upper[4].value).toBeCloseTo(full.upper, 6);
    expect(two.upper[4].value).toBeGreaterThan(one.upper[4].value);
    const times = one.upper.map((p) => p.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("skips weekends and holidays between now and expiry", () => {
    const [one] = expectedMoveCone({ anchorTime, anchor: 24500, iv: 0.14, expiry: "2026-10-27", now, sigmas: [1] });
    const days = one.upper.slice(1).map((p) => new Date(p.time * 1000).toISOString().slice(0, 10));
    expect(days).toEqual(["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"]);
  });

  it("returns [] for unusable inputs or a past expiry", () => {
    expect(expectedMoveCone({ anchorTime, anchor: 0, iv: 0.14, expiry: "2026-10-20", now })).toEqual([]);
    expect(expectedMoveCone({ anchorTime, anchor: 24500, iv: Number.NaN, expiry: "2026-10-20", now })).toEqual([]);
    expect(expectedMoveCone({ anchorTime, anchor: 24500, iv: 0.14, expiry: "2026-10-01", now })).toEqual([]);
  });
});
