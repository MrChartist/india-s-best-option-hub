import { describe, it, expect } from "vitest";
import { checkAlerts, type AlertCondition } from "@/hooks/useAlertEngine";

function makeAlert(overrides: Partial<AlertCondition> = {}): AlertCondition {
  return {
    id: "1",
    symbol: "NIFTY",
    type: "price",
    condition: "above",
    value: 24500,
    active: true,
    triggered: false,
    tone: "bullish",
    ...overrides,
  };
}

describe("checkAlerts — price alerts use the alert's OWN symbol", () => {
  it("triggers when the alert's symbol crosses its threshold", () => {
    const alert = makeAlert({ symbol: "BANKNIFTY", condition: "above", value: 51000 });
    const result = checkAlerts([alert], { spotBySymbol: { NIFTY: 24000, BANKNIFTY: 51200 } });
    expect(result[0].triggered).toBe(true);
  });

  it("does NOT trigger on another symbol's price crossing the threshold", () => {
    // Regression test: this used to read a single shared `spotPrice` regardless
    // of which symbol the alert was actually for, so a BANKNIFTY alert could
    // fire off NIFTY's price (or never fire at all).
    const alert = makeAlert({ symbol: "BANKNIFTY", condition: "above", value: 51000 });
    const result = checkAlerts([alert], { spotBySymbol: { NIFTY: 99999, BANKNIFTY: 50000 } });
    expect(result[0].triggered).toBe(false);
  });

  it("does not trigger when its own symbol has no live price yet", () => {
    const alert = makeAlert({ symbol: "FINNIFTY", value: 23000 });
    const result = checkAlerts([alert], { spotBySymbol: { NIFTY: 24000 } });
    expect(result[0].triggered).toBe(false);
  });

  it("resets `triggered` once the condition is no longer met", () => {
    const alert = makeAlert({ symbol: "NIFTY", condition: "above", value: 24500, triggered: true });
    const result = checkAlerts([alert], { spotBySymbol: { NIFTY: 24000 } });
    expect(result[0].triggered).toBe(false);
  });
});
