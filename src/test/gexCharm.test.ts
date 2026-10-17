import { describe, expect, it } from "vitest";
import type { OptionData, OptionLegData } from "@/lib/mockData";
import { addTradingDays, black76Price, getMarketParams, greeks, greeks76, greeks76Spot, istDateString, timeToExpiryYears } from "@/lib/options";
import { exposureByStrike } from "@/lib/gexData";

const SPOT = 25000;
const IV = 15;
const LOT = 75;
const EXPIRY = addTradingDays(istDateString(), 5);

describe("greeks76Spot charm", () => {
  it("matches spot-fixed BSM charm and differs in sign from forward-fixed charm near ATM", () => {
    const r = 0.065;
    const T = 7 / 365;
    const F = SPOT * Math.exp(r * T);
    for (const type of ["CE", "PE"] as const) {
      const bsm = greeks({ S: SPOT, K: SPOT, T, r, sigma: IV / 100, type });
      const spot = greeks76Spot({ F, K: SPOT, T, r, sigma: IV / 100, type }, SPOT);
      const fwd = greeks76({ F, K: SPOT, T, r, sigma: IV / 100, type });
      expect(spot.charm).toBeCloseTo(bsm.charm, 9);
      expect(Math.sign(spot.charm)).not.toBe(Math.sign(fwd.charm));
    }
  });
});

describe("gexData: CEX uses spot-held-fixed charm", () => {
  function legAt(K: number, type: "CE" | "PE", F: number, T: number, r: number, oi: number): OptionLegData {
    return {
      ltp: black76Price({ F, K, T, r, sigma: IV / 100, type }),
      oi,
      oiChange: 0,
      volume: 0,
      iv: IV,
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      bidPrice: 0,
      askPrice: 0,
    };
  }

  it("an ATM long call (dealer model) has the BSM charm sign", () => {
    const r = getMarketParams().r;
    const T = timeToExpiryYears(EXPIRY);
    const F = SPOT * Math.exp(r * T);
    const chain: OptionData[] = [];
    for (let i = -10; i <= 10; i++) {
      const K = SPOT + i * 50;
      chain.push({ strikePrice: K, ce: legAt(K, "CE", F, T, r, K === SPOT ? 100_000 : 0), pe: legAt(K, "PE", F, T, r, 0) });
    }
    const rows = exposureByStrike(chain, SPOT, EXPIRY, LOT, { convention: "dealerLongCallShortPut" });
    const atm = rows.find((x) => x.strike === SPOT);
    expect(atm).toBeDefined();
    const bsm = greeks({ S: SPOT, K: SPOT, T, r, sigma: IV / 100, type: "CE" });
    expect(bsm.charm).toBeLessThan(0);
    expect(atm!.cex).toBeLessThan(0);
  });
});
