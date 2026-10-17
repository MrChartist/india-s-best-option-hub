import { describe, expect, it } from "vitest";
import { generateSampleChain, toISTDate } from "@/lib/options";
import { derivePrintsFromSeries, oiPath, simulateSession, tideReading } from "@/lib/flow";

function lcg(seed: number) {
  let a = seed;
  return () => (a = (a * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe("sample session variety", () => {
  const now = toISTDate("2026-10-16", "15:45");
  const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25_000, expiry: "2026-10-20", now, seed: 4 });
  const snaps = simulateSession({ symbol: "NIFTY", expiry: "2026-10-20", spot: 25_000, chain, now });
  const prints = derivePrintsFromSeries(snaps, 65);

  it("spreads prints across the session instead of every contract in every interval", () => {
    const newestFirst = [...prints].sort((a, b) => b.ts - a.ts);
    const firstPage = new Set(newestFirst.slice(0, 50).map((p) => p.ts));
    expect(firstPage.size).toBeGreaterThanOrEqual(4);
    const hours = new Set(prints.map((p) => new Date(p.ts + 330 * 60_000).getUTCHours()));
    expect(hours.size).toBeGreaterThanOrEqual(6);
    // Snapshot times are not all on exact minutes.
    expect(snaps.some((s) => new Date(s.ts).getUTCSeconds() !== 0)).toBe(true);
  });

  it("mixes opening, closing and churn prints", () => {
    const n = { OPENING: 0, CLOSING: 0, UNKNOWN: 0 };
    for (const p of prints) n[p.tag]++;
    const total = prints.length;
    for (const k of Object.keys(n) as Array<keyof typeof n>) expect(n[k] / total).toBeGreaterThan(0.1);
  });

  it("OI path ends exactly at the reported change in OI", () => {
    const w = [0, 1, 0, 2, 0.5, 0, 3];
    for (const target of [1200, -800, 0]) {
      const path = oiPath(w, { volume: 5000, oiChange: target, oi: 10_000 }, lcg(7));
      expect(path).toHaveLength(w.length);
      expect(path[path.length - 1]).toBeCloseTo(target, 6);
      // No OI change in intervals without trades.
      expect(path[2]).toBeCloseTo(path[1], 9);
    }
    // Never takes OI below zero, even with a small starting OI and heavy closing.
    for (let seed = 1; seed < 40; seed++) {
      const path = oiPath(w, { volume: 50_000, oiChange: -900, oi: 100 }, lcg(seed));
      expect(Math.min(...path)).toBeGreaterThanOrEqual(-1000 - 1e-6);
      expect(path[path.length - 1]).toBeCloseTo(-900, 6);
    }
  });
});

describe("tideReading", () => {
  const fmt = (v: number) => `${v}`;
  it("reads the sign of the net line", () => {
    expect(tideReading({ ce: 100, pe: 20, net: 80 }, fmt)).toMatch(/bullish lean/);
    expect(tideReading({ ce: 10, pe: 90, net: -80 }, fmt)).toMatch(/bearish lean/);
    expect(tideReading({ ce: 50, pe: 49, net: 1 }, fmt)).toMatch(/roughly balanced/);
    expect(tideReading(undefined, fmt)).toMatch(/Not enough flow/);
  });
});
