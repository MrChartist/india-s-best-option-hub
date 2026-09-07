import { describe, it, expect } from "vitest";
import {
  simulateFill, slippageTicks, syntheticSpread, roundToTick, marketProtectionPrice, TICK_SIZE,
} from "@/features/one-cliq/lib/fillModel";
import type { OrderIntent } from "@/features/one-cliq/types";

function intent(over: Partial<OrderIntent> = {}): OrderIntent {
  return {
    intentId: "test-intent-1",
    symbol: "BANKNIFTY",
    optionType: "CE",
    strike: 58000,
    side: "BUY",
    lots: 1,
    exchangeSegment: "NSE_FNO",
    variant: "MARKET",
    refPrice: 590.25,
    bid: 590,
    ask: 590.5,
    expiry: "2026-09-29",
    ...over,
  };
}

const NO_RANDOM = { allowRandomRejects: false as const };

describe("roundToTick", () => {
  it("rounds a BUY up and a SELL down, so a simulated fill never flatters reality", () => {
    expect(roundToTick(100.02, "BUY")).toBe(100.05);
    expect(roundToTick(100.02, "SELL")).toBe(100.0);
  });

  it("leaves an exact tick alone", () => {
    expect(roundToTick(100.05, "BUY")).toBe(100.05);
    expect(roundToTick(100.05, "SELL")).toBe(100.05);
  });
});

describe("syntheticSpread", () => {
  it("widens for far-OTM strikes", () => {
    const atm = syntheticSpread(100, 0.5);
    const otm = syntheticSpread(100, 0.05);
    expect(otm).toBeGreaterThan(atm);
  });

  it("widens for cheap options, where real spreads blow out", () => {
    expect(syntheticSpread(5, 0.5) / 5).toBeGreaterThan(syntheticSpread(500, 0.5) / 500);
  });

  it("never goes below one tick", () => {
    expect(syntheticSpread(0.5, 0.5)).toBeGreaterThanOrEqual(TICK_SIZE);
  });
});

describe("slippageTicks", () => {
  it("grows with the spread", () => {
    expect(slippageTicks(2, 1, {})).toBeGreaterThan(slippageTicks(0.1, 1, {}));
  });

  it("penalises illiquid strikes", () => {
    const liquid = slippageTicks(1, 1, { openInterest: 1e6, volume: 1e6 });
    const illiquid = slippageTicks(1, 1, { openInterest: 100, volume: 10 });
    expect(illiquid).toBeGreaterThan(liquid);
  });

  it("charges a tick per lot beyond what is quoted at the touch", () => {
    const within = slippageTicks(1, 2, { lotsAtTouch: 5 });
    const beyond = slippageTicks(1, 8, { lotsAtTouch: 5 });
    expect(beyond).toBe(within + 3);
  });

  it("is never negative", () => {
    expect(slippageTicks(0, 1, { lotsAtTouch: 100 })).toBeGreaterThanOrEqual(0);
  });
});

describe("simulateFill — crosses the spread, never fills at LTP", () => {
  it("fills a BUY at or above the ask", () => {
    const fill = simulateFill(intent({ side: "BUY" }), { bid: 590, ask: 590.5, ...NO_RANDOM });
    expect(fill.status).toBe("FILLED");
    expect(fill.price).toBeGreaterThanOrEqual(590.5);
  });

  it("fills a SELL at or below the bid", () => {
    const fill = simulateFill(intent({ side: "SELL" }), { bid: 590, ask: 590.5, ...NO_RANDOM });
    expect(fill.price).toBeLessThanOrEqual(590);
  });

  it("costs the buyer more than the seller receives — the spread is real", () => {
    const buy = simulateFill(intent({ side: "BUY" }), { bid: 590, ask: 590.5, ...NO_RANDOM });
    const sell = simulateFill(intent({ intentId: "x", side: "SELL" }), { bid: 590, ask: 590.5, ...NO_RANDOM });
    expect(buy.price).toBeGreaterThan(sell.price);
  });

  it("never fills at exactly LTP when a spread exists", () => {
    const fill = simulateFill(intent(), { bid: 590, ask: 590.5, ...NO_RANDOM });
    expect(fill.price).not.toBe(590.25);
  });

  it("synthesises a spread when the feed gives no depth", () => {
    const fill = simulateFill(intent(), { bid: null, ask: null, ...NO_RANDOM });
    expect(fill.status).toBe("FILLED");
    expect(fill.price).toBeGreaterThan(590.25);
  });

  it("never returns a price at or below zero", () => {
    const fill = simulateFill(intent({ side: "SELL", refPrice: 0.05 }), { ...NO_RANDOM });
    expect(fill.price).toBeGreaterThan(0);
  });

  it("takes a realistic amount of time, so a keypress does not resolve instantly", () => {
    const fill = simulateFill(intent(), NO_RANDOM);
    expect(fill.latencyMs).toBeGreaterThanOrEqual(80);
    expect(fill.latencyMs).toBeLessThanOrEqual(250);
  });
});

describe("simulateFill — determinism", () => {
  it("is reproducible for the same intent", () => {
    const a = simulateFill(intent(), NO_RANDOM);
    const b = simulateFill(intent(), NO_RANDOM);
    expect(a).toEqual(b);
  });

  it("differs across intents, so consecutive orders are not identical", () => {
    const a = simulateFill(intent({ intentId: "one" }), NO_RANDOM);
    const b = simulateFill(intent({ intentId: "two" }), NO_RANDOM);
    expect(a.latencyMs).not.toBe(b.latencyMs);
  });
});

describe("simulateFill — partials and rejections", () => {
  it("partially fills when size exceeds what is quoted at the touch", () => {
    const fill = simulateFill(intent({ lots: 10 }), { lotsAtTouch: 3, ...NO_RANDOM });
    expect(fill.status).toBe("PARTIAL");
    expect(fill.lots).toBe(3);
    expect(fill.reason).toMatch(/3 of 10/);
  });

  it("fully fills when the touch can absorb the size", () => {
    const fill = simulateFill(intent({ lots: 2 }), { lotsAtTouch: 10, ...NO_RANDOM });
    expect(fill.status).toBe("FILLED");
    expect(fill.lots).toBe(2);
  });

  it("rejects rather than inventing a price when there is no reference", () => {
    const fill = simulateFill(intent({ refPrice: 0 }), NO_RANDOM);
    expect(fill.status).toBe("REJECTED");
    expect(fill.lots).toBe(0);
  });

  it("produces occasional rejections when they are enabled", () => {
    const rejects = Array.from({ length: 400 }, (_, i) =>
      simulateFill(intent({ intentId: `seed-${i}` }))).filter((f) => f.status === "REJECTED");
    // ~1% expected; assert it happens at all but is not common.
    expect(rejects.length).toBeGreaterThan(0);
    expect(rejects.length).toBeLessThan(40);
  });
});

describe("marketProtectionPrice", () => {
  it("prices a BUY above LTP and a SELL below it", () => {
    expect(marketProtectionPrice(100, "BUY", 10)).toBeGreaterThan(100);
    expect(marketProtectionPrice(100, "SELL", 10)).toBeLessThan(100);
  });

  it("rounds so the band never widens the worst case you accept", () => {
    // BUY floors (pays no more than intended), SELL ceils (receives no less).
    expect(marketProtectionPrice(100.03, "BUY", 0)).toBeLessThanOrEqual(100.03);
    expect(marketProtectionPrice(100.03, "SELL", 0)).toBeGreaterThanOrEqual(100.03);
  });

  it("lands on a valid tick", () => {
    const p = marketProtectionPrice(587.37, "BUY", 10);
    expect(Math.round((p / TICK_SIZE) * 1000) % 1000).toBe(0);
  });

  it("returns 0 for an unusable LTP rather than a nonsense band", () => {
    expect(marketProtectionPrice(0, "BUY", 10)).toBe(0);
    expect(marketProtectionPrice(NaN, "BUY", 10)).toBe(0);
  });
});
