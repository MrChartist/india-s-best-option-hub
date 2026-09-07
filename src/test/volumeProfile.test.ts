import { describe, it, expect } from "vitest";
import { getVolumeProfile } from "@/lib/volumeProfile";
import type { OHLCVCandle } from "@/hooks/useChartData";

function makeCandle(time: number, low: number, high: number, volume: number): OHLCVCandle {
  return { time, open: (low + high) / 2, high, low, close: (low + high) / 2, volume };
}

describe("getVolumeProfile", () => {
  it("returns null for an empty candle list", () => {
    expect(getVolumeProfile([])).toBeNull();
  });

  it("returns null when every candle has zero/undefined volume", () => {
    const candles = [makeCandle(1, 100, 110, 0), makeCandle(2, 105, 115, 0)];
    expect(getVolumeProfile(candles)).toBeNull();
  });

  it("returns null when the price range is degenerate (min === max)", () => {
    const candles = [makeCandle(1, 100, 100, 500), makeCandle(2, 100, 100, 500)];
    expect(getVolumeProfile(candles)).toBeNull();
  });

  it("places POC near the price with the most concentrated real volume", () => {
    const candles: OHLCVCandle[] = [
      makeCandle(1, 104, 106, 100000), // heavy volume, tight range around 105
      makeCandle(2, 104, 106, 100000),
      makeCandle(3, 50, 160, 100), // tiny volume, spread across the whole range
    ];
    const profile = getVolumeProfile(candles, 22);
    expect(profile).not.toBeNull();
    expect(profile!.poc).toBeGreaterThanOrEqual(100);
    expect(profile!.poc).toBeLessThanOrEqual(110);
  });

  it("keeps VAH >= POC >= VAL by construction", () => {
    const candles: OHLCVCandle[] = Array.from({ length: 20 }, (_, i) => makeCandle(i, 100 + i, 102 + i, 1000));
    const profile = getVolumeProfile(candles, 24);
    expect(profile).not.toBeNull();
    expect(profile!.vah).toBeGreaterThanOrEqual(profile!.poc);
    expect(profile!.val).toBeLessThanOrEqual(profile!.poc);
  });
});
