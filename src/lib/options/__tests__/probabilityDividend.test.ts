import { describe, expect, it } from "vitest";
import { black76Price, forwardFromSpot, probOfReachingProfit, type Leg } from "@/lib/options";

const S = 25000;
const T = 30 / 365;
const r = 0.065;
const sigma = 0.14;

function shortCall(q: number): Leg {
  const F = forwardFromSpot(S, T, r, q);
  const premium = black76Price({ F, K: 25000, T, r, sigma, type: "CE" });
  return { type: "CE", side: "SELL", strike: 25000, premium, lots: 1, lotSize: 75, iv: sigma, expiry: "", enabled: true } as unknown as Leg;
}

describe("probOfReachingProfit with dividend yield", () => {
  it("treats a missing q as zero", () => {
    const legs = [shortCall(0)];
    const base = { S, T, sigma, target: 1000, paths: 400, seed: 7, r };
    expect(probOfReachingProfit(legs, base)).toBe(probOfReachingProfit(legs, { ...base, q: 0 }));
  });

  it("starts at the entry premium when q matches the pricing yield", () => {
    // A leg priced with q = 5% and simulated with the same q should not show an instant
    // mark-to-model gain; simulating it with q = 0 inflates the call value and biases P50.
    const q = 0.05;
    const legs = [shortCall(q)];
    const tiny = { S, T, sigma, target: 1, paths: 600, seed: 11, r };
    const withQ = probOfReachingProfit(legs, { ...tiny, q });
    const withoutQ = probOfReachingProfit(legs, tiny);
    expect(withQ).toBeGreaterThan(withoutQ);
  });
});
