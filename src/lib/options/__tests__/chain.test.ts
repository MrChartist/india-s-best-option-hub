import { describe, expect, it } from "vitest";
import type { OptionData } from "@/lib/mockData";
import {
  atmIV,
  atmStraddle,
  black76Price,
  chainForward,
  classifyBuildup,
  enrichChain,
  findATMStrike,
  generateSampleChain,
  legIV,
  maxPain,
  maxPainCurve,
  modalStrikeStep,
  syntheticFuture,
  timeToExpiryYears,
  toISTDate,
} from "@/lib/options";

const now = toISTDate("2026-10-20", "11:00");
const EXP = "2026-10-27";

describe("sample chain", () => {
  const a = generateSampleChain({ symbol: "NIFTY", spot: 25012, expiry: EXP, now, seed: 3 });
  const b = generateSampleChain({ symbol: "NIFTY", spot: 25012, expiry: EXP, now, seed: 3 });

  it("is deterministic, labelled and well formed", () => {
    expect(a.source).toBe("sample");
    expect(a).toEqual(b);
    expect(a.chain).toHaveLength(41);
    expect(modalStrikeStep(a.chain, 25012)).toBe(50);
    for (const r of a.chain) {
      expect(r.ce.bidPrice).toBeLessThanOrEqual(r.ce.askPrice);
      expect(r.ce.ltp).toBeGreaterThan(0);
      expect(r.pe.iv).toBeGreaterThan(0);
    }
  });

  it("has a put skew and an OI hump near ATM", () => {
    const low = a.chain[5];
    const high = a.chain[35];
    expect(low.pe.iv).toBeGreaterThan(high.ce.iv);
    const atmRow = a.chain[20];
    expect(atmRow.ce.oi + atmRow.pe.oi).toBeGreaterThan(a.chain[0].ce.oi + a.chain[40].pe.oi);
  });

  it("returns an empty chain for bad spot", () => {
    expect(generateSampleChain({ symbol: "NIFTY", spot: 0, expiry: EXP }).chain).toEqual([]);
  });
});

describe("chain helpers", () => {
  const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25012, expiry: EXP, now, seed: 9 });
  const T = timeToExpiryYears(EXP, now);
  const r = 0.065;

  it("finds ATM, forward, straddle and synthetic", () => {
    expect(findATMStrike(chain, 25012)).toBe(25000);
    expect(findATMStrike(chain, 25012, "minStraddleDiff")).toBeGreaterThanOrEqual(24950);
    expect(Number.isNaN(findATMStrike([], 25000))).toBe(true);
    const F = chainForward(chain, 25012, T, r);
    expect(Math.abs(F - 25012) / 25012).toBeLessThan(0.005);
    const s = atmStraddle(chain, 25012);
    expect(s.strike).toBe(25000);
    expect(s.straddle).toBeCloseTo(s.ce + s.pe, 10);
    expect(s.upper - s.lower).toBeCloseTo(2 * s.straddle, 8);
    expect(Math.abs(syntheticFuture(chain, 25012) - F)).toBeLessThan(5);
    expect(chainForward([], 25000, T, r)).toBeCloseTo(25000 * Math.exp(r * T), 8);
  });

  it("legIV ignores zeros and prefers the OTM side; atmIV interpolates", () => {
    const row: OptionData = { ...chain[20], ce: { ...chain[20].ce, iv: 0 }, pe: { ...chain[20].pe, iv: 13 } };
    expect(legIV(row, 24900)).toBe(13); // call side preferred but zero → put
    const both: OptionData = { ...chain[20], ce: { ...chain[20].ce, iv: 12 }, pe: { ...chain[20].pe, iv: 14 } };
    expect(legIV(both, 24900)).toBe(12);
    expect(legIV(both, 25100)).toBe(14);
    const iv = atmIV(chain, 25025);
    const lo = legIV(chain.find((x) => x.strikePrice === 25000) as OptionData, 25025);
    const hi = legIV(chain.find((x) => x.strikePrice === 25050) as OptionData, 25025);
    expect(iv).toBeCloseTo((lo + hi) / 2, 8);
  });

  it("enrichChain fills zero IV/Greeks without mutating input", () => {
    const F = 25050;
    const K = 25000;
    const ce = black76Price({ F, K, T, r, sigma: 0.14, type: "CE" });
    const blank = { ltp: ce, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
    const input: OptionData[] = [{ strikePrice: K, ce: { ...blank }, pe: { ...blank, ltp: 0 } }];
    const snapshot = JSON.stringify(input);
    const out = enrichChain(input, { spot: 25000, expiry: EXP, now, r, forward: F });
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0].ce.iv).toBeCloseTo(14, 3);
    expect(out[0].ce.delta).toBeGreaterThan(0.5);
    expect(out[0].ce.theta).toBeLessThan(0);
    expect(out[0].pe.iv).toBe(0); // no price → left alone
    const kept = enrichChain([{ strikePrice: K, ce: { ...blank, iv: 20 }, pe: { ...blank } }], { spot: 25000, expiry: EXP, now, r, forward: F });
    expect(kept[0].ce.iv).toBe(20);
    const forced = enrichChain([{ strikePrice: K, ce: { ...blank, iv: 20, delta: 0.1 }, pe: { ...blank } }], { spot: 25000, expiry: EXP, now, r, forward: F, overwrite: true });
    expect(forced[0].ce.iv).toBeCloseTo(14, 3);
    expect(forced[0].ce.delta).toBeGreaterThan(0.5);
  });

  it("max pain", () => {
    const leg = (oi: number) => ({ ltp: 1, oi, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 });
    const c: OptionData[] = [
      { strikePrice: 100, ce: leg(10), pe: leg(100) },
      { strikePrice: 110, ce: leg(50), pe: leg(50) },
      { strikePrice: 120, ce: leg(100), pe: leg(10) },
    ];
    const curve = maxPainCurve(c);
    expect(curve[1]).toEqual({ strike: 110, cePayout: 100, pePayout: 100, total: 200 });
    expect(maxPain(c)).toBe(110);
    expect(Number.isNaN(maxPain([]))).toBe(true);
  });

  it("classifies OI build-up", () => {
    expect(classifyBuildup(5, 1000)).toBe("LONG_BUILDUP");
    expect(classifyBuildup(-5, 1000)).toBe("SHORT_BUILDUP");
    expect(classifyBuildup(5, -1000)).toBe("SHORT_COVERING");
    expect(classifyBuildup(-5, -1000)).toBe("LONG_UNWINDING");
    expect(classifyBuildup(0.01, 1000, 0.05)).toBe("NEUTRAL");
  });
});
