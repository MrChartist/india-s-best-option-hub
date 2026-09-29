import { describe, it, expect } from "vitest";
import {
  conditionMet,
  shouldFire,
  distanceToTrigger,
  describeAlert,
  metricKey,
  toneFor,
  REPEAT_COOLDOWN_MS,
  type PriceAlert,
} from "@/lib/alerts";

const base: PriceAlert = {
  id: "a1",
  symbol: "NIFTY",
  metric: "price",
  operator: "above",
  value: 24500,
  mode: "once",
  sound: true,
  active: true,
  createdAt: 0,
  triggerCount: 0,
};

describe("conditionMet", () => {
  it("handles level operators", () => {
    expect(conditionMet("above", 24501, 24500)).toBe(true);
    expect(conditionMet("above", 24500, 24500)).toBe(false);
    expect(conditionMet("below", 24499, 24500)).toBe(true);
  });

  it("cross operators need a previous reading on the other side", () => {
    expect(conditionMet("crosses_above", 24501, 24500)).toBe(false);
    expect(conditionMet("crosses_above", 24501, 24500, 24490)).toBe(true);
    expect(conditionMet("crosses_above", 24510, 24500, 24505)).toBe(false);
    expect(conditionMet("crosses_below", 24490, 24500, 24510)).toBe(true);
  });
});

describe("shouldFire", () => {
  it("fires a brand-new level alert that is already true", () => {
    expect(shouldFire(base, 24600, undefined, undefined, 1_000).fire).toBe(true);
  });

  it("does not replay an already-fired level alert after a reload", () => {
    const fired = { ...base, triggerCount: 1, lastTriggeredAt: 1 };
    expect(shouldFire(fired, 24600, undefined, undefined, 10 * REPEAT_COOLDOWN_MS).fire).toBe(false);
  });

  it("fires on the false→true edge only, not on every tick", () => {
    expect(shouldFire(base, 24400, undefined, undefined, 1).fire).toBe(false);
    expect(shouldFire(base, 24550, 24400, false, 2).fire).toBe(true);
    expect(shouldFire(base, 24560, 24550, true, 3).fire).toBe(false);
  });

  it("repeat alerts re-fire after the level resets, honouring cooldown", () => {
    const repeat = { ...base, mode: "repeat" as const, triggerCount: 1, lastTriggeredAt: 0 };
    expect(shouldFire(repeat, 24550, 24400, false, REPEAT_COOLDOWN_MS - 1).fire).toBe(false);
    expect(shouldFire(repeat, 24550, 24400, false, REPEAT_COOLDOWN_MS).fire).toBe(true);
  });

  it("fires cross alerts only on the crossing tick", () => {
    const cross = { ...base, operator: "crosses_above" as const };
    expect(shouldFire(cross, 24600, undefined, undefined, 1).fire).toBe(false);
    expect(shouldFire(cross, 24501, 24499, false, 2).fire).toBe(true);
  });
});

describe("helpers", () => {
  it("computes distance in the direction the alert needs", () => {
    expect(distanceToTrigger({ operator: "above", value: 25000 }, 24500)).toBeCloseTo(2, 5);
    expect(distanceToTrigger({ operator: "below", value: 24000 }, 24500)).toBeCloseTo(2.0833, 3);
    expect(distanceToTrigger({ operator: "above", value: 24000 }, 24500)).toBeLessThan(0);
  });

  it("describes alerts readably", () => {
    expect(describeAlert(base)).toBe("NIFTY price is above 24,500.00");
    expect(describeAlert({ ...base, metric: "vix", symbol: "INDIAVIX", value: 18 })).toBe("India VIX is above 18.00");
  });

  it("normalises metric keys and tones", () => {
    expect(metricKey(" nifty ", "price")).toBe("NIFTY|price");
    expect(metricKey("anything", "vix")).toBe("INDIAVIX|vix");
    expect(toneFor(base)).toBe("bullish");
    expect(toneFor({ ...base, operator: "below" })).toBe("bearish");
    expect(toneFor({ ...base, metric: "vix" })).toBe("warning");
  });
});
