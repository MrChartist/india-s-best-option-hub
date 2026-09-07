import { describe, it, expect } from "vitest";
import { legBias, slLevel, tgtLevel, isArmConfigSane } from "@/features/one-cliq/lib/riskLevels";

// Same 4-combination table as 1CLIQ-TRADE-SPEC.md §4 and server/lib/riskMath's
// own test precedent — this file must never drift from that sign convention,
// since it is what a trader eyeballs before arming (spec §13 failure mode #3).
describe("legBias", () => {
  it("is +1 for a BUY CE (profits when spot rises)", () => {
    expect(legBias("BUY", "CE")).toBe(1);
  });
  it("is -1 for a SELL CE (profits when spot falls)", () => {
    expect(legBias("SELL", "CE")).toBe(-1);
  });
  it("is -1 for a BUY PE (profits when spot falls)", () => {
    expect(legBias("BUY", "PE")).toBe(-1);
  });
  it("is +1 for a SELL PE (profits when spot rises)", () => {
    expect(legBias("SELL", "PE")).toBe(1);
  });
});

describe("slLevel / tgtLevel — spec §4's worked example (S0=58090, SL 50, Target 80)", () => {
  const S0 = 58090;

  it("BUY CE: SL below, Target above", () => {
    expect(slLevel(S0, "BUY", "CE", 50)).toBe(58040);
    expect(tgtLevel(S0, "BUY", "CE", 80)).toBe(58170);
  });

  it("SELL CE: SL above, Target below", () => {
    expect(slLevel(S0, "SELL", "CE", 50)).toBe(58140);
    expect(tgtLevel(S0, "SELL", "CE", 80)).toBe(58010);
  });

  it("BUY PE: SL above, Target below", () => {
    expect(slLevel(S0, "BUY", "PE", 50)).toBe(58140);
    expect(tgtLevel(S0, "BUY", "PE", 80)).toBe(58010);
  });

  it("SELL PE: SL below, Target above", () => {
    expect(slLevel(S0, "SELL", "PE", 50)).toBe(58040);
    expect(tgtLevel(S0, "SELL", "PE", 80)).toBe(58170);
  });
});

describe("isArmConfigSane", () => {
  it("accepts positive SL and Target", () => {
    expect(isArmConfigSane("BUY", "CE", 50, 80)).toBe(true);
  });
  it("rejects a zero or negative SL/Target before the server ever sees it", () => {
    expect(isArmConfigSane("BUY", "CE", 0, 80)).toBe(false);
    expect(isArmConfigSane("BUY", "CE", 50, 0)).toBe(false);
    expect(isArmConfigSane("BUY", "CE", -10, 80)).toBe(false);
  });
  it("rejects non-finite input rather than propagating NaN into the UI", () => {
    expect(isArmConfigSane("BUY", "CE", NaN, 80)).toBe(false);
  });
});
