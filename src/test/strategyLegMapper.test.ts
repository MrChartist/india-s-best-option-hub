import { describe, it, expect } from "vitest";
import { mapLegsToBasketLegs, type BuilderLegLike } from "@/lib/strategyLegMapper";

const legs: BuilderLegLike[] = [
  { type: "CE", side: "BUY", strike: 24000, lots: 2, expiry: "2026-10-27" },
  { type: "PE", side: "SELL", strike: 23800, lots: 1, expiry: "" },
];

describe("mapLegsToBasketLegs", () => {
  it("gives every leg a unique, stable legId and an absolute strikeSpec", () => {
    const basketLegs = mapLegsToBasketLegs(legs);
    expect(basketLegs).toHaveLength(2);
    expect(new Set(basketLegs.map((l) => l.legId)).size).toBe(2);
    expect(basketLegs[0].strikeSpec).toEqual({ kind: "absolute", strike: 24000 });
    expect(basketLegs[1].strikeSpec).toEqual({ kind: "absolute", strike: 23800 });
  });

  it("keeps a leg's ISO expiry and falls back to the nearest weekly without one", () => {
    const [ce, pe] = mapLegsToBasketLegs(legs);
    expect(ce.expirySpec).toEqual({ kind: "absolute", date: "2026-10-27" });
    expect(pe.expirySpec).toEqual({ kind: "nearest", weeksOut: 0 });
  });

  it("carries side/type/lots through as action/optionType/lots", () => {
    const [ce, pe] = mapLegsToBasketLegs(legs);
    expect(ce).toMatchObject({ action: "BUY", optionType: "CE", lots: 2 });
    expect(pe).toMatchObject({ action: "SELL", optionType: "PE", lots: 1 });
  });

  it("skips disabled legs and futures", () => {
    const out = mapLegsToBasketLegs([
      ...legs,
      { type: "FUT", side: "BUY", strike: 0, lots: 1, expiry: "2026-10-27" },
      { type: "CE", side: "SELL", strike: 24500, lots: 1, enabled: false },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.legId)).toEqual(["leg-1", "leg-2"]);
  });

  it("returns an empty array for an empty strategy", () => {
    expect(mapLegsToBasketLegs([])).toEqual([]);
  });
});
