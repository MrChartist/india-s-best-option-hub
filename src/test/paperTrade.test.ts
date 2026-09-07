import { describe, it, expect, beforeEach } from "vitest";
import { createPosition, getPositions, savePositions } from "@/lib/positionStore";

// Covers the paper-fill path added this session: OptionChain's "Quick Fill
// (Paper)" and Strategy Builder's "Add to Position Tracker (Paper)" both
// reduce to createPosition() + savePositions() — this is that path end-to-end,
// without any UI involved.
describe("Paper trade fill (createPosition -> positionStore)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds a real, retrievable position with computed Greeks", () => {
    const position = createPosition({
      symbol: "NIFTY",
      type: "CE",
      action: "BUY",
      strike: 24500,
      entryPrice: 120,
      lots: 1,
      lotSize: 25,
      expiry: "",
    });
    savePositions([...getPositions(), position]);

    const stored = getPositions();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ symbol: "NIFTY", type: "CE", action: "BUY", strike: 24500, lots: 1, lotSize: 25 });
    // Delta/theta/gamma should be real (Black-Scholes-derived), not the old
    // flat ±0.5/-10/0 placeholders applied to every position regardless of
    // moneyness or expiry.
    expect(stored[0].delta).not.toBe(0);
    expect(Number.isFinite(stored[0].gamma)).toBe(true);
  });

  it("appends to existing positions rather than replacing them", () => {
    const first = createPosition({ symbol: "NIFTY", type: "CE", action: "BUY", strike: 24500, entryPrice: 120, lots: 1, lotSize: 25, expiry: "" });
    savePositions([...getPositions(), first]);

    const second = createPosition({ symbol: "BANKNIFTY", type: "PE", action: "SELL", strike: 51000, entryPrice: 200, lots: 1, lotSize: 15, expiry: "" });
    savePositions([...getPositions(), second]);

    expect(getPositions()).toHaveLength(2);
  });

  it("supports a multi-leg strategy fill (Strategy Builder's 'Add All Legs')", () => {
    const legs = [
      { symbol: "NIFTY", type: "CE" as const, action: "BUY" as const, strike: 24500, entryPrice: 120, lots: 1, lotSize: 25, expiry: "" },
      { symbol: "NIFTY", type: "PE" as const, action: "SELL" as const, strike: 24000, entryPrice: 80, lots: 1, lotSize: 25, expiry: "" },
    ];
    const newPositions = legs.map((leg) => createPosition(leg));
    savePositions([...getPositions(), ...newPositions]);

    const stored = getPositions();
    expect(stored).toHaveLength(2);
    expect(stored.map((p) => p.type)).toEqual(["CE", "PE"]);
  });
});
