import { describe, expect, it } from "vitest";
import {
  black76Price,
  breakevens,
  breakevensAfterCharges,
  expectedValue,
  maxProfitLoss,
  netPremium,
  payoffDateKey,
  payoffSeries,
  pnlMatrix,
  probabilityOfProfit,
  probBetween,
  probITM,
  probOfReachingProfit,
  probTouch,
  profitableIntervals,
  spotGrid,
  strategyPayoffAtExpiry,
  strategyValueAt,
  toISTDate,
  timeToExpiryYears,
  forwardFromSpot,
  type Leg,
} from "@/lib/options";

const EXP = "2026-10-27";
const leg = (p: Partial<Leg> & Pick<Leg, "type" | "side" | "strike" | "premium">): Leg => ({
  symbol: "NIFTY",
  expiry: EXP,
  lots: 1,
  lotSize: 65,
  ...p,
});

const longCall = [leg({ type: "CE", side: "BUY", strike: 25000, premium: 200 })];
const shortPut = [leg({ type: "PE", side: "SELL", strike: 25000, premium: 150 })];
const ironCondor = [
  leg({ type: "PE", side: "BUY", strike: 24300, premium: 40 }),
  leg({ type: "PE", side: "SELL", strike: 24500, premium: 80 }),
  leg({ type: "CE", side: "SELL", strike: 25500, premium: 70 }),
  leg({ type: "CE", side: "BUY", strike: 25700, premium: 30 }),
];
const ratioSpread = [
  leg({ type: "CE", side: "BUY", strike: 25000, premium: 200 }),
  leg({ type: "CE", side: "SELL", strike: 25200, premium: 110, lots: 2 }),
];

describe("expiry payoff, breakevens and limits", () => {
  it("long call", () => {
    expect(breakevens(longCall)).toEqual([25200]);
    const m = maxProfitLoss(longCall);
    expect(m.unlimitedProfit).toBe(true);
    expect(m.unlimitedLoss).toBe(false);
    expect(m.maxProfit).toBe(Infinity);
    expect(m.maxLoss).toBeCloseTo(-13000, 8);
    expect(netPremium(longCall)).toEqual({ net: -13000, type: "DEBIT" });
  });

  it("short put (loss is large but bounded at S = 0)", () => {
    expect(breakevens(shortPut)).toEqual([24850]);
    const m = maxProfitLoss(shortPut);
    expect(m.unlimitedLoss).toBe(false);
    expect(m.unlimitedProfit).toBe(false);
    expect(m.maxProfit).toBeCloseTo(9750, 8);
    expect(m.maxLoss).toBeCloseTo(-24850 * 65, 6);
  });

  it("iron condor", () => {
    expect(breakevens(ironCondor)).toEqual([24420, 25580]);
    const m = maxProfitLoss(ironCondor);
    expect(m.unlimitedLoss || m.unlimitedProfit).toBe(false);
    expect(m.maxProfit).toBeCloseTo(80 * 65, 8);
    expect(m.maxLoss).toBeCloseTo(-120 * 65, 8);
    expect(netPremium(ironCondor).type).toBe("CREDIT");
    expect(profitableIntervals(ironCondor)).toEqual([{ from: 24420, to: 25580 }]);
  });

  it("1x2 call ratio spread: upper tail breakeven, unlimited loss", () => {
    expect(breakevens(ratioSpread)).toEqual([25420]);
    const m = maxProfitLoss(ratioSpread);
    expect(m.unlimitedLoss).toBe(true);
    expect(m.maxLoss).toBe(-Infinity);
    expect(m.maxProfit).toBeCloseTo(220 * 65, 8);
    expect(strategyPayoffAtExpiry(ratioSpread, 20000)).toBeCloseTo(20 * 65, 8);
  });

  it("futures and disabled legs", () => {
    const fut = [leg({ type: "FUT", side: "BUY", strike: 0, premium: 25000 })];
    expect(breakevens(fut)).toEqual([25000]);
    expect(maxProfitLoss(fut).unlimitedProfit).toBe(true);
    expect(breakevens([{ ...longCall[0], enabled: false }])).toEqual([]);
  });

  it("spot grid contains strikes, breakevens and spot", () => {
    const g = spotGrid(ironCondor, 25010, { pctRange: 0.05, points: 51 });
    for (const k of [24300, 24420, 24500, 25500, 25580, 25700, 25010]) expect(g).toContain(k);
    expect([...g].sort((a, b) => a - b)).toEqual(g);
  });
});

describe("T+x valuation", () => {
  const now = toISTDate("2026-10-20", "10:00");
  const r = 0.065;

  it("equals the expiry payoff after expiry and the model value before", () => {
    const after = toISTDate("2026-10-28", "10:00");
    for (const S of [24000, 25000, 26000]) {
      expect(strategyValueAt(ironCondor, S, { now, atDate: after, r })).toBeCloseTo(strategyPayoffAtExpiry(ironCondor, S), 8);
    }
    const ivLeg = [{ ...longCall[0], iv: 0.15 }];
    const T = timeToExpiryYears(EXP, now);
    const model = black76Price({ F: forwardFromSpot(25000, T, r, 0), K: 25000, T, r, sigma: 0.15, type: "CE" });
    expect(strategyValueAt(ivLeg, 25000, { now, r })).toBeCloseTo((model - 200) * 65, 8);
  });

  it("back-solves IV from premium so T+0 P&L is ~0 at the current spot", () => {
    const v = strategyValueAt(longCall, 25000, { now, r, spot: 25000 });
    expect(Math.abs(v)).toBeLessThan(1e-4);
  });

  it("builds series and matrices", () => {
    const dates = [now, toISTDate("2026-10-23", "10:00")];
    const rows = payoffSeries(ironCondor, [24000, 25000], { dates, now, spot: 25000 });
    expect(rows).toHaveLength(2);
    expect(rows[1][payoffDateKey(dates[0])]).toBeTypeOf("number");
    expect(rows[1].expiry).toBeCloseTo(80 * 65, 8);
    const m = pnlMatrix(ironCondor, [24000, 25000, 26000], dates, { now, spot: 25000 });
    expect(m).toHaveLength(3);
    expect(m[0]).toHaveLength(2);
    // short vega: higher IV lowers P&L
    const up = strategyValueAt(ironCondor, 25000, { now, spot: 25000, ivShift: 0.05 });
    const base = strategyValueAt(ironCondor, 25000, { now, spot: 25000 });
    expect(up).toBeLessThan(base);
  });
});

describe("probability", () => {
  const F = 25000;
  const T = 30 / 365;
  const sigma = 0.2;

  it("POP of a long call equals N(d2) at the breakeven", () => {
    const pop = probabilityOfProfit(longCall, { F, T, sigma });
    expect(pop).toBeCloseTo(probITM({ F, K: 25200, T, sigma, type: "CE" }), 12);
  });

  it("short straddle sold at ±0.5σ breakevens has POP ≈ 38%", () => {
    const halfSd = 0.5 * sigma * Math.sqrt(T) * F; // ≈ 716.8
    const prem = halfSd / 2;
    const straddle = [
      leg({ type: "CE", side: "SELL", strike: 25000, premium: prem }),
      leg({ type: "PE", side: "SELL", strike: 25000, premium: prem }),
    ];
    const pop = probabilityOfProfit(straddle, { F, T, sigma });
    expect(pop).toBeGreaterThan(0.37);
    expect(pop).toBeLessThan(0.395);
  });

  it("supports a per-strike vol function (skew)", () => {
    const skew = (K: number) => 0.2 + 0.5 * Math.max(0, (F - K) / F);
    const flat = probabilityOfProfit(shortPut, { F, T, sigma: 0.2 });
    const skewed = probabilityOfProfit(shortPut, { F, T, sigma: skew });
    expect(skewed).toBeLessThan(flat);
  });

  it("probBetween / probTouch / EV", () => {
    expect(probBetween(F, 0, Infinity, T, sigma)).toBeCloseTo(1, 12);
    expect(probBetween(F, 24000, 26000, T, sigma)).toBeGreaterThan(0.5);
    const pItm = probITM({ F, K: 26000, T, sigma, type: "CE" });
    expect(probTouch({ F, K: 26000, T, sigma, type: "CE" })).toBeCloseTo(2 * pItm, 12);
    expect(probTouch({ F, K: 24000, T, sigma, type: "CE" })).toBe(1);
    const fair = black76Price({ F, K: 25000, T, r: 0, sigma, type: "CE" });
    const fairCall = [leg({ type: "CE", side: "BUY", strike: 25000, premium: fair })];
    expect(expectedValue(fairCall, { F, T, sigma })).toBeCloseTo(0, 6);
  });

  it("Monte-Carlo P50 is deterministic for a seed", () => {
    const o = { S: F, T, sigma, target: 0.5 * 80 * 65, paths: 400, seed: 11, r: 0 };
    const a = probOfReachingProfit(ironCondor, o);
    const b = probOfReachingProfit(ironCondor, o);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(Number.isNaN(probOfReachingProfit([], o))).toBe(true);
  });
});

describe("breakevens after charges", () => {
  it("push a long call's breakeven higher", () => {
    const be = breakevensAfterCharges(longCall);
    expect(be).toHaveLength(1);
    expect(be[0]).toBeGreaterThan(25200);
    expect(be[0]).toBeLessThan(25202);
  });
});
