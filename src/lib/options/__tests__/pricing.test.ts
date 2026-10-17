import { describe, expect, it } from "vitest";
import {
  black76Price,
  bsPrice,
  d1d2,
  decToPct,
  forwardFromSpot,
  greeks,
  greeks76,
  impliedForward,
  impliedVol,
  impliedVol76,
  normCdf,
  normInv,
  normPdf,
  pctToDec,
  positionGreeks,
  type Greeks,
  type Leg,
  type OptionType,
  type PricingInput,
} from "@/lib/options";

describe("normal distribution", () => {
  it("matches reference CDF values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 15);
    expect(normCdf(1.96)).toBeCloseTo(0.9750021048517795, 14);
    expect(normCdf(-1)).toBeCloseTo(0.15865525393145707, 14);
    expect(normCdf(-5)).toBeCloseTo(2.866515718791939e-7, 18);
    expect(normCdf(-10) / 7.619853024160527e-24).toBeCloseTo(1, 10);
    expect(normCdf(Infinity)).toBe(1);
    expect(Number.isNaN(normCdf(NaN))).toBe(true);
  });

  it("pdf integrates the cdf", () => {
    expect(normPdf(0)).toBeCloseTo(0.3989422804014327, 15);
    const h = 1e-5;
    for (const x of [-3, -1, 0, 0.5, 2]) expect((normCdf(x + h) - normCdf(x - h)) / (2 * h)).toBeCloseTo(normPdf(x), 8);
  });

  it("inverse round-trips", () => {
    for (const p of [1e-10, 0.001, 0.02425, 0.1, 0.5, 0.75, 0.975, 0.999999]) expect(normCdf(normInv(p))).toBeCloseTo(p, 12);
    expect(normInv(0)).toBe(-Infinity);
    expect(Number.isNaN(normInv(1.5))).toBe(true);
  });
});

describe("Black-Scholes / Black-76", () => {
  it("matches Hull's textbook example (S=42, K=40, r=10%, σ=20%, T=0.5)", () => {
    const base = { S: 42, K: 40, r: 0.1, sigma: 0.2, T: 0.5 };
    expect(bsPrice({ ...base, type: "CE" })).toBeCloseTo(4.76, 2);
    expect(bsPrice({ ...base, type: "PE" })).toBeCloseTo(0.81, 2);
    const { d1, d2 } = d1d2(42, 40, 0.5, 0.1, 0, 0.2);
    expect(d1).toBeCloseTo(0.7693, 4);
    expect(d2).toBeCloseTo(0.6278, 4);
  });

  it("satisfies put-call parity to 1e-8 (spot and forward models)", () => {
    for (const S of [80, 100, 125]) {
      for (const T of [1 / 365, 0.25, 1]) {
        const p: Omit<PricingInput, "type"> = { S, K: 100, T, r: 0.065, q: 0.013, sigma: 0.22 };
        const c = bsPrice({ ...p, type: "CE" });
        const put = bsPrice({ ...p, type: "PE" });
        expect(c - put - (S * Math.exp(-0.013 * T) - 100 * Math.exp(-0.065 * T))).toBeCloseTo(0, 8);
        const F = forwardFromSpot(S, T, 0.065, 0.013);
        const c76 = black76Price({ F, K: 100, T, r: 0.065, sigma: 0.22, type: "CE" });
        const p76 = black76Price({ F, K: 100, T, r: 0.065, sigma: 0.22, type: "PE" });
        expect(c76 - c).toBeCloseTo(0, 9);
        expect(impliedForward(100, c76, p76, T, 0.065)).toBeCloseTo(F, 8);
      }
    }
  });

  it("falls back to intrinsic and handles bad input", () => {
    expect(bsPrice({ S: 110, K: 100, T: 0, r: 0.05, sigma: 0.2, type: "CE" })).toBe(10);
    expect(black76Price({ F: 90, K: 100, T: 0.1, r: 0.05, sigma: 0, type: "PE" })).toBe(10);
    expect(Number.isNaN(bsPrice({ S: NaN, K: 100, T: 1, r: 0, sigma: 0.2, type: "CE" }))).toBe(true);
  });
});

const greekKeys: Array<keyof Greeks> = ["delta", "gamma", "theta", "vega", "rho", "vanna", "charm", "vomma"];

describe("Greeks vs finite differences", () => {
  const cases: Array<{ S: number; K: number; T: number; sigma: number; type: OptionType }> = [
    { S: 100, K: 100, T: 0.25, sigma: 0.2, type: "CE" },
    { S: 100, K: 110, T: 0.5, sigma: 0.3, type: "PE" },
    { S: 24800, K: 25000, T: 7 / 365, sigma: 0.13, type: "CE" },
    { S: 24800, K: 24500, T: 30 / 365, sigma: 0.16, type: "PE" },
  ];
  const r = 0.065;
  const q = 0.012;

  it.each(cases)("BSM %o", (c) => {
    const g = greeks({ ...c, r, q });
    const price = (o: Partial<PricingInput>) => bsPrice({ ...c, r, q, ...o });
    const hS = c.S * 1e-4;
    const hV = 1e-4;
    const hT = 1e-5;
    const scale = Math.max(1, c.S / 100);
    const fd: Partial<Greeks> = {
      delta: (price({ S: c.S + hS }) - price({ S: c.S - hS })) / (2 * hS),
      gamma: (price({ S: c.S + hS }) - 2 * price({}) + price({ S: c.S - hS })) / (hS * hS),
      theta: -(price({ T: c.T + hT }) - price({ T: c.T - hT })) / (2 * hT) / 365,
      vega: (price({ sigma: c.sigma + hV }) - price({ sigma: c.sigma - hV })) / (2 * hV) / 100,
      rho: (price({ r: r + hV }) - price({ r: r - hV })) / (2 * hV) / 100,
    };
    const dDelta = (o: Partial<PricingInput>) => greeks({ ...c, r, q, ...o }).delta;
    const vegaAt = (o: Partial<PricingInput>) => greeks({ ...c, r, q, ...o }).vega;
    fd.vanna = (dDelta({ sigma: c.sigma + hV }) - dDelta({ sigma: c.sigma - hV })) / (2 * hV) / 100;
    fd.charm = -(dDelta({ T: c.T + hT }) - dDelta({ T: c.T - hT })) / (2 * hT) / 365;
    fd.vomma = (vegaAt({ sigma: c.sigma + hV }) - vegaAt({ sigma: c.sigma - hV })) / (2 * hV) / 100;
    for (const k of greekKeys) {
      const tol = k === "gamma" ? 1e-4 / scale : 1e-4 * scale;
      expect(Math.abs((g[k] as number) - (fd[k] as number)), k).toBeLessThan(tol);
    }
    expect(g.thetaTrading).toBeCloseTo((g.theta * 365) / 252, 12);
  });

  it.each(cases)("Black-76 %o", (c) => {
    const F = forwardFromSpot(c.S, c.T, r, q);
    const g = greeks76({ F, K: c.K, T: c.T, r, sigma: c.sigma, type: c.type });
    const price = (o: Partial<{ F: number; T: number; sigma: number; r: number }>) =>
      black76Price({ F, K: c.K, T: c.T, r, sigma: c.sigma, type: c.type, ...o });
    const hF = F * 1e-4;
    const hV = 1e-4;
    const hT = 1e-5;
    const scale = Math.max(1, F / 100);
    const d = (o: Partial<{ F: number; T: number; sigma: number }>) => greeks76({ F, K: c.K, T: c.T, r, sigma: c.sigma, type: c.type, ...o });
    const fd: Partial<Greeks> = {
      delta: (price({ F: F + hF }) - price({ F: F - hF })) / (2 * hF),
      gamma: (price({ F: F + hF }) - 2 * price({}) + price({ F: F - hF })) / (hF * hF),
      theta: -(price({ T: c.T + hT }) - price({ T: c.T - hT })) / (2 * hT) / 365,
      vega: (price({ sigma: c.sigma + hV }) - price({ sigma: c.sigma - hV })) / (2 * hV) / 100,
      rho: (price({ r: r + hV }) - price({ r: r - hV })) / (2 * hV) / 100,
      vanna: (d({ sigma: c.sigma + hV }).delta - d({ sigma: c.sigma - hV }).delta) / (2 * hV) / 100,
      charm: -(d({ T: c.T + hT }).delta - d({ T: c.T - hT }).delta) / (2 * hT) / 365,
      vomma: (d({ sigma: c.sigma + hV }).vega - d({ sigma: c.sigma - hV }).vega) / (2 * hV) / 100,
    };
    for (const k of greekKeys) {
      const tol = k === "gamma" ? 1e-4 / scale : 1e-4 * scale;
      expect(Math.abs((g[k] as number) - (fd[k] as number)), k).toBeLessThan(tol);
    }
  });

  it("position Greeks are signed (short straddle is short gamma)", () => {
    const g = greeks({ S: 100, K: 100, T: 0.1, r: 0.05, sigma: 0.2, type: "CE" });
    const gp = greeks({ S: 100, K: 100, T: 0.1, r: 0.05, sigma: 0.2, type: "PE" });
    const legs: Array<Leg & { greeks: Greeks }> = [
      { symbol: "NIFTY", type: "CE", side: "SELL", strike: 100, expiry: "2026-10-27", lots: 2, lotSize: 65, premium: 3, greeks: g },
      { symbol: "NIFTY", type: "PE", side: "SELL", strike: 100, expiry: "2026-10-27", lots: 2, lotSize: 65, premium: 3, greeks: gp },
    ];
    const pos = positionGreeks(legs);
    expect(pos.gamma).toBeLessThan(0);
    expect(pos.vega).toBeLessThan(0);
    expect(pos.theta).toBeGreaterThan(0);
    expect(pos.gamma).toBeCloseTo(-130 * (g.gamma + gp.gamma), 10);
  });
});

describe("implied volatility", () => {
  it("round-trips across moneyness 0.7-1.3 and T from 1 day to 1 year", () => {
    const r = 0.065;
    let checked = 0;
    for (const m of [0.7, 0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.2, 1.3]) {
      for (const days of [1, 7, 30, 90, 182, 365]) {
        for (const sigma of [0.08, 0.15, 0.3, 0.6]) {
          for (const type of ["CE", "PE"] as const) {
            const T = days / 365;
            const F = 100;
            const K = F * m;
            const price = black76Price({ F, K, T, r, sigma, type });
            if (price < 1e-6) continue; // below quotable precision
            const iv = impliedVol76(price, { F, K, T, r, type });
            const repriced = black76Price({ F, K, T, r, sigma: iv, type });
            expect(Math.abs(repriced - price)).toBeLessThan(1e-8);
            const timeValue = price - Math.exp(-r * T) * Math.max(type === "CE" ? F - K : K - F, 0);
            if (timeValue > 1e-3) expect(iv).toBeCloseTo(sigma, 5);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(250);
  });

  it("BSM wrapper and bounds", () => {
    const p = { S: 42, K: 40, T: 0.5, r: 0.1, type: "CE" as const };
    const c = bsPrice({ ...p, sigma: 0.2 });
    expect(impliedVol(c, p)).toBeCloseTo(0.2, 8);
    expect(Number.isNaN(impliedVol(1, p))).toBe(true); // below intrinsic
    expect(Number.isNaN(impliedVol(50, p))).toBe(true); // above spot
    expect(Number.isNaN(impliedVol76(-1, { F: 100, K: 100, T: 0.1, r: 0, type: "CE" }))).toBe(true);
    expect(pctToDec(14)).toBeCloseTo(0.14, 12);
    expect(decToPct(0.14)).toBeCloseTo(14, 12);
  });
});
