import { afterEach, describe, expect, it } from "vitest";
import {
  estimateMargin,
  generateSampleChain,
  getBrokerPreset,
  getLotSize,
  getMarketParams,
  isMonthlyExpiry,
  lognormalDensity,
  lognormalGrid,
  lotsToQty,
  positionSize,
  probBelow,
  registerContractSpecs,
  setMarketParams,
  DEFAULT_MARKET_PARAMS,
  type Leg,
} from "@/lib/options";

const NOW = new Date("2026-10-12T05:00:00Z"); // Mon 12 Oct 2026, 10:30 IST
const EXP = "2026-10-27";

const leg = (p: Partial<Leg>): Leg => ({
  symbol: "NIFTY",
  type: "CE",
  side: "BUY",
  strike: 25000,
  expiry: EXP,
  lots: 1,
  lotSize: 65,
  premium: 100,
  iv: 0.14,
  ...p,
});

describe("estimateMargin edge cases", () => {
  it("returns an empty estimate without legs or spot", () => {
    expect(estimateMargin([], { spot: 25000, now: NOW }).total).toBe(0);
    expect(estimateMargin([leg({})], { spot: 0, now: NOW }).total).toBe(0);
  });

  it("charges only the premium for long-only positions", () => {
    const m = estimateMargin([leg({ side: "BUY", premium: 120 })], { spot: 25000, now: NOW });
    expect(m.method).toBe("long-only");
    expect(m.total).toBeCloseTo(120 * 65, 6);
    expect(m.span).toBe(0);
  });

  it("margins a futures leg with exposure and no defined risk", () => {
    const m = estimateMargin([leg({ type: "FUT", side: "BUY", strike: 0, premium: 0, iv: undefined })], { spot: 25000, now: NOW, sigma: 0.15 });
    expect(m.definedRisk).toBe(false);
    expect(m.exposure).toBeGreaterThan(0);
    expect(m.span).toBeGreaterThan(0);
  });

  it("adds expiry-day ELM for a short index option expiring today", () => {
    const today = "2026-10-12";
    const onExpiry = estimateMargin([leg({ side: "SELL", expiry: today, iv: undefined })], { spot: 25000, now: NOW, sigma: 0.12 });
    const notExpiry = estimateMargin([leg({ side: "SELL", iv: undefined })], { spot: 25000, now: NOW, sigma: 0.12 });
    expect(onExpiry.elmExpiryDay).toBeGreaterThan(0);
    expect(notExpiry.elmExpiryDay).toBe(0);
  });

  it("gives a hedge benefit to a credit spread versus naked legs", () => {
    const spread = [leg({ side: "SELL", strike: 25000, premium: 150 }), leg({ side: "BUY", strike: 25200, premium: 70 })];
    const m = estimateMargin(spread, { spot: 25000, now: NOW, priceScanPct: 0.06, volScan: 0.04 });
    expect(m.definedRisk).toBe(true);
    expect(m.hedgeBenefit).toBeGreaterThan(0);
    expect(m.span).toBeLessThanOrEqual((200 - 80) * 65 + 1e-6);
  });
});

describe("generateSampleChain edge cases", () => {
  it("returns an empty chain for a missing or bad spot", () => {
    expect(generateSampleChain({ spot: 0, expiry: EXP }).chain).toEqual([]);
    expect(generateSampleChain({ spot: Number.NaN, expiry: EXP }).chain).toEqual([]);
  });

  it("builds a stock chain and an expired chain without NaNs", () => {
    const stock = generateSampleChain({ symbol: "RELIANCE", spot: 1400, expiry: EXP, now: NOW, strikes: 11 });
    expect(stock.chain.length).toBeGreaterThan(0);
    const expired = generateSampleChain({ symbol: "UNKNOWNSYM", spot: 500, expiry: "2020-01-30", now: NOW, atmIv: -1, strikes: 2 });
    expect(expired.chain.length).toBeGreaterThanOrEqual(5);
    for (const row of [...stock.chain, ...expired.chain]) {
      expect(Number.isFinite(row.ce.ltp)).toBe(true);
      expect(Number.isFinite(row.pe.ltp)).toBe(true);
    }
  });
});

describe("market params storage", () => {
  afterEach(() => localStorage.removeItem("mc_market_params"));

  it("falls back to defaults on corrupt storage and round-trips valid values", () => {
    localStorage.setItem("mc_market_params", "{not json");
    expect(getMarketParams()).toEqual(DEFAULT_MARKET_PARAMS);
    const next = setMarketParams({ r: 0.07 });
    expect(next.r).toBeCloseTo(0.07);
    expect(getMarketParams().r).toBeCloseTo(0.07);
  });
});

describe("small helpers", () => {
  it("handles broker presets, lots and sizing edge inputs", () => {
    expect(getBrokerPreset("zerodha")?.perOrder).toBe(20);
    expect(getBrokerPreset("nope")).toBeUndefined();
    expect(lotsToQty(2.7, 65)).toBe(130);
    expect(lotsToQty(Number.NaN, 65)).toBe(0);
    expect(positionSize({ capital: 100000, riskPct: 2, maxLossPerLot: 0, lotSize: 65 })).toEqual({ lots: 0, riskAmount: 2000, capitalAtRisk: 0 });
    expect(positionSize({ capital: -1, riskPct: 2, maxLossPerLot: 500, lotSize: 65 }).lots).toBe(0);
  });

  it("handles degenerate lognormal inputs", () => {
    expect(probBelow(0, 100, 1, 0.2)).toBeNaN();
    expect(probBelow(100, 110, 0, 0.2)).toBe(1);
    expect(probBelow(120, 110, 0, 0.2)).toBe(0);
    expect(lognormalDensity(0, 100, 0.2, 1)).toBe(0);
    expect(lognormalDensity(100, 100, 0.2, 1)).toBeGreaterThan(0);
    expect(lognormalGrid(0, 0.2, 1)).toEqual([]);
    const grid = lognormalGrid(100, 0.2, 1, 50);
    expect(grid.reduce((s, g) => s + g.w, 0)).toBeCloseTo(1, 8);
  });

  it("isMonthlyExpiry rejects invalid dates", () => {
    expect(isMonthlyExpiry("NIFTY", "not-a-date")).toBe(false);
  });
});

describe("registerContractSpecs", () => {
  it("keeps lot-size history when a newer lot is registered and ignores unusable specs", () => {
    registerContractSpecs([{ symbol: "ZZTESTSTOCK", lotSize: 100, effectiveFrom: "2025-01-01", strikeStep: 5, tickSize: 0.05, freezeQty: 1000, weekly: false, expiryWeekday: 2, verify: true }]);
    registerContractSpecs([{ symbol: "ZZTESTSTOCK", lotSize: 150, effectiveFrom: "2026-01-01" }]);
    registerContractSpecs([{ symbol: "ZZBAD", lotSize: 0 }]);
    expect(getLotSize("ZZTESTSTOCK", "2025-06-30")).toBe(100);
    expect(getLotSize("ZZTESTSTOCK", "2026-06-30")).toBe(150);
    expect(getLotSize("ZZBAD")).toBeUndefined();
  });
});
