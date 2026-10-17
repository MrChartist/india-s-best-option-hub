import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, sampleWindow, toConfig, tradeToBasketLegs } from "../config";
import { SAMPLE_RANGE } from "../sampleData";
import type { Trade } from "../types";

describe("settings", () => {
  it("falls back to defaults for junk", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("x")).toEqual(DEFAULT_SETTINGS);
  });
  it("validates and clamps each field", () => {
    const s = parseSettings({ symbol: "BANKNIFTY", templateId: "missing", lots: 9999, dte: 0, weekdays: [1, 1, 7, "2"], delta: 3, profitPct: null, stopPct: "abc", months: 6, data: "bhavcopy", brokerId: "nobody" });
    expect(s.symbol).toBe("BANKNIFTY");
    expect(s.templateId).toBe(DEFAULT_SETTINGS.templateId);
    expect(s.lots).toBe(500);
    expect(s.dte).toBe(1);
    expect(s.weekdays).toEqual([1, 2]);
    expect(s.delta).toBe(0.9);
    expect(s.profitPct).toBeNull();
    expect(s.stopPct).toBeNull();
    expect(s.months).toBe(6);
    expect(s.data).toBe("bhavcopy");
    expect(s.brokerId).toBe("zerodha");
    expect(parseSettings({ months: 5 }).months).toBe(DEFAULT_SETTINGS.months);
  });
  it("builds the engine config with a window", () => {
    const c = toConfig(DEFAULT_SETTINGS, { from: "2026-01-01", to: "2026-02-01" });
    expect(c.from).toBe("2026-01-01");
    expect("months" in c).toBe(false);
  });
  it("sample window ends at the end of the sample and never starts before it", () => {
    expect(sampleWindow(3)).toEqual({ from: "2026-06-30", to: SAMPLE_RANGE.to });
    expect(sampleWindow(24).from).toBe(SAMPLE_RANGE.from);
  });
});

describe("builder hand-off", () => {
  it("sends option legs at the entry fill and drops futures", () => {
    const t = {
      legs: [
        { type: "FUT", side: "BUY", strike: 0, expiry: "2026-02-24", lots: 1, lotSize: 65, entry: 25_100, exit: 25_200 },
        { type: "CE", side: "SELL", strike: 25_500, expiry: "2026-02-24", lots: 2, lotSize: 65, entry: 80.5, exit: 10, iv: 0.14 },
      ],
    } as unknown as Trade;
    const { legs, droppedFutures } = tradeToBasketLegs(t, "NIFTY");
    expect(droppedFutures).toBe(1);
    expect(legs).toEqual([{ symbol: "NIFTY", expiry: "2026-02-24", strike: 25_500, type: "CE", side: "SELL", lots: 2, premium: 80.5, iv: 0.14 }]);
  });
});
