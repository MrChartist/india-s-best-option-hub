import { describe, expect, it } from "vitest";
import { black76Price, forwardFromSpot, getDividendYield, greeks, timeToExpiryYears, toISTDate } from "@/lib/options";
import { createPosition } from "@/lib/positionStore";
import { livePosition } from "@/components/positions/analytics";
import { analyseStrategy } from "@/components/strategy/strategyAnalysis";
import { toBuilderLegs } from "@/components/strategy/strategyState";

// Positions and Strategy Builder must report spot-held Greeks (theta included), the same as the
// option chain (enrichChain → greeks76Spot) and BSM with the dividend yield.
const EXPIRY = "2026-11-24";
const NOW = toISTDate("2026-10-20", "11:00");
const SPOT = 25000;
const R = 0.065;

describe("spot-held theta consistency", () => {
  it("Position Tracker theta matches BSM spot-held theta for calls and puts", () => {
    const q = getDividendYield("NIFTY");
    const T = timeToExpiryYears(EXPIRY, NOW);
    const F = forwardFromSpot(SPOT, T, R, q);
    for (const type of ["CE", "PE"] as const) {
      const fair = black76Price({ F, K: SPOT, T, r: R, sigma: 0.13, type });
      const p = createPosition({ symbol: "NIFTY", type, action: "BUY", strike: SPOT, entryPrice: fair, currentPrice: fair, expiry: EXPIRY, lots: 1, lotSize: 75 });
      const live = livePosition(p, { spot: SPOT, now: NOW, r: R });
      expect(live.ivSource).toBe("solved");
      const ref = greeks({ S: SPOT, K: SPOT, T, r: R, q, sigma: live.iv, type });
      expect(live.theta / live.qty).toBeCloseTo(ref.theta, 4);
      expect(live.deltaUnit).toBeCloseTo(ref.delta, 6);
    }
  });

  it("Strategy Builder per-leg theta, charm and rho match BSM spot-held Greeks", () => {
    const T = timeToExpiryYears(EXPIRY, NOW);
    for (const type of ["CE", "PE"] as const) {
      const a = analyseStrategy({
        legs: toBuilderLegs([{ symbol: "NIFTY", type, side: "BUY", strike: SPOT, expiry: EXPIRY, lots: 1, lotSize: 75, premium: 300, iv: 0.13 }]),
        spot: SPOT,
        now: NOW,
        r: R,
        q: 0.013,
        atmIv: 0.13,
        smile: () => 0.13,
        roundTrip: true,
      });
      const unit = a.legGreeks[0].unit;
      const ref = greeks({ S: SPOT, K: SPOT, T, r: R, q: 0.013, sigma: 0.13, type });
      expect(unit.theta).toBeCloseTo(ref.theta, 4);
      expect(unit.delta).toBeCloseTo(ref.delta, 6);
      expect(unit.rho).toBeCloseTo(ref.rho, 4);
    }
  });
});
