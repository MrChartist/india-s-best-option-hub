import { describe, it, expect } from "vitest";
import { calculateStrikeGEX, getGexLevels } from "@/lib/gexLevels";
import type { OptionData } from "@/lib/mockData";

function makeRow(
  strike: number,
  opts: { ceOI?: number; peOI?: number; ceGamma?: number; peGamma?: number }
): OptionData {
  return {
    strikePrice: strike,
    ce: {
      ltp: 100,
      oi: opts.ceOI ?? 0,
      oiChange: 0,
      volume: 0,
      iv: 15,
      delta: 0.5,
      gamma: opts.ceGamma ?? 0,
      theta: -5,
      vega: 10,
      bidPrice: 99,
      askPrice: 101,
    },
    pe: {
      ltp: 100,
      oi: opts.peOI ?? 0,
      oiChange: 0,
      volume: 0,
      iv: 15,
      delta: -0.5,
      gamma: opts.peGamma ?? 0,
      theta: -5,
      vega: 10,
      bidPrice: 99,
      askPrice: 101,
    },
  };
}

describe("calculateStrikeGEX", () => {
  it("computes per-strike call/put/net GEX from real gamma × OI", () => {
    const chain = [makeRow(100, { ceOI: 1000, ceGamma: 0.01, peOI: 500, peGamma: 0.02 })];
    const result = calculateStrikeGEX(chain, 100, 50);
    expect(result).toHaveLength(1);
    expect(result[0].callGEX).toBeGreaterThan(0);
    expect(result[0].putGEX).toBeLessThan(0);
    expect(result[0].netGEX).toBeCloseTo(result[0].callGEX + result[0].putGEX);
  });

  it("sorts output ascending by strike regardless of input order", () => {
    const chain = [makeRow(200, { ceGamma: 0.01, ceOI: 100 }), makeRow(100, { ceGamma: 0.01, ceOI: 100 })];
    const result = calculateStrikeGEX(chain, 150, 50);
    expect(result.map((r) => r.strike)).toEqual([100, 200]);
  });
});

describe("getGexLevels", () => {
  it("returns null for an empty chain", () => {
    expect(getGexLevels([], 100, 50)).toBeNull();
  });

  it("returns null for a non-positive spot price", () => {
    const chain = [makeRow(100, { ceGamma: 0.01, ceOI: 100 })];
    expect(getGexLevels(chain, 0, 50)).toBeNull();
  });

  it("returns null when every strike has zero gamma (NSE fallback chain)", () => {
    const chain = [
      makeRow(100, { ceOI: 1000, peOI: 1000, ceGamma: 0, peGamma: 0 }),
      makeRow(110, { ceOI: 2000, peOI: 500, ceGamma: 0, peGamma: 0 }),
    ];
    expect(getGexLevels(chain, 105, 50)).toBeNull();
  });

  it("picks the strike with the highest callGEX as callWall and highest |putGEX| as putWall", () => {
    const chain = [
      makeRow(90, { peOI: 5000, peGamma: 0.02, ceOI: 100, ceGamma: 0.001 }),
      makeRow(100, { ceOI: 500, ceGamma: 0.01, peOI: 500, peGamma: 0.01 }),
      makeRow(110, { ceOI: 8000, ceGamma: 0.02, peOI: 100, peGamma: 0.001 }),
    ];
    const levels = getGexLevels(chain, 100, 50);
    expect(levels).not.toBeNull();
    expect(levels!.callWall).toBe(110);
    expect(levels!.putWall).toBe(90);
  });

  it("interpolates zeroGamma between the two strikes where net GEX changes sign", () => {
    const chain = [
      makeRow(100, { peOI: 4000, peGamma: 0.02, ceOI: 100, ceGamma: 0.001 }),
      makeRow(110, { ceOI: 4000, ceGamma: 0.02, peOI: 100, peGamma: 0.001 }),
    ];
    const levels = getGexLevels(chain, 105, 50);
    expect(levels).not.toBeNull();
    expect(levels!.zeroGamma).not.toBeNull();
    expect(levels!.zeroGamma!).toBeGreaterThan(100);
    expect(levels!.zeroGamma!).toBeLessThan(110);
  });

  it("returns null zeroGamma when the chain never crosses sign", () => {
    const chain = [
      makeRow(100, { ceOI: 1000, ceGamma: 0.01, peOI: 100, peGamma: 0.001 }),
      makeRow(110, { ceOI: 1000, ceGamma: 0.01, peOI: 100, peGamma: 0.001 }),
    ];
    const levels = getGexLevels(chain, 105, 50);
    expect(levels).not.toBeNull();
    expect(levels!.zeroGamma).toBeNull();
  });

  it("excludes callWall/putWall strikes from secondaryLevels and caps at 4", () => {
    const chain = [90, 95, 100, 105, 110, 115, 120].map((strike, i) =>
      makeRow(strike, { ceOI: 1000 + i * 100, ceGamma: 0.01, peOI: 200, peGamma: 0.005 })
    );
    const levels = getGexLevels(chain, 105, 50);
    expect(levels).not.toBeNull();
    expect(levels!.secondaryLevels.length).toBeLessThanOrEqual(4);
    expect(levels!.secondaryLevels.some((s) => s.strike === levels!.callWall)).toBe(false);
    expect(levels!.secondaryLevels.some((s) => s.strike === levels!.putWall)).toBe(false);
  });
});
