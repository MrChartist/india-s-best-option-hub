import { describe, it, expect } from "vitest";
import { mapLegsToPendingTrades, mapLegsToBasketLegs } from "@/lib/strategyLegMapper";
import type { StrategyLeg } from "@/lib/mockData";

const legs: StrategyLeg[] = [
  { type: "CE", action: "BUY", strike: 24000, lots: 2, premium: 120.5 },
  { type: "PE", action: "SELL", strike: 23800, lots: 1, premium: 80 },
];

describe("mapLegsToPendingTrades", () => {
  it("maps every leg field to its PendingTrade equivalent, unchanged from the original inline logic", () => {
    const trades = mapLegsToPendingTrades(legs, "NIFTY", 75);
    expect(trades).toEqual([
      { symbol: "NIFTY", strike: 24000, optionType: "CE", action: "BUY", lots: 2, price: 120.5, lotSize: 75 },
      { symbol: "NIFTY", strike: 23800, optionType: "PE", action: "SELL", lots: 1, price: 80, lotSize: 75 },
    ]);
  });

  it("returns an empty array for an empty strategy", () => {
    expect(mapLegsToPendingTrades([], "NIFTY", 75)).toEqual([]);
  });
});

describe("mapLegsToBasketLegs", () => {
  it("gives every leg a unique, stable legId and an absolute strikeSpec", () => {
    const basketLegs = mapLegsToBasketLegs(legs);
    expect(basketLegs).toHaveLength(2);
    expect(new Set(basketLegs.map((l) => l.legId)).size).toBe(2);
    expect(basketLegs[0].strikeSpec).toEqual({ kind: "absolute", strike: 24000 });
    expect(basketLegs[1].strikeSpec).toEqual({ kind: "absolute", strike: 23800 });
  });

  it("defaults every leg to the nearest weekly expiry, since StrategyBuilder has no expiry picker", () => {
    const basketLegs = mapLegsToBasketLegs(legs);
    for (const leg of basketLegs) {
      expect(leg.expirySpec).toEqual({ kind: "nearest", weeksOut: 0 });
    }
  });

  it("carries action/optionType/lots through unchanged", () => {
    const [ce, pe] = mapLegsToBasketLegs(legs);
    expect(ce).toMatchObject({ action: "BUY", optionType: "CE", lots: 2 });
    expect(pe).toMatchObject({ action: "SELL", optionType: "PE", lots: 1 });
  });
});
