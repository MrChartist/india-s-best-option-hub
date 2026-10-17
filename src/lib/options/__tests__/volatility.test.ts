import { describe, expect, it } from "vitest";
import {
  constantMaturityIV,
  emHitRate,
  expectedMoveFromIV,
  expectedMoveFromStraddle,
  forwardVol,
  gaussianSource,
  hvCloseToClose,
  hvParkinson,
  hvYangZhang,
  ivPercentile,
  ivRank,
  mulberry32,
  rollingHV,
  skewMetrics,
  volCone,
  type OHLC,
} from "@/lib/options";

function simulate(n: number, sigma: number, seed = 1): OHLC[] {
  const g = gaussianSource(mulberry32(seed));
  const dt = 1 / 252;
  const bars: OHLC[] = [];
  let c = 100;
  for (let i = 0; i < n; i++) {
    const o = c;
    // intraday path of 24 steps to build H/L
    let p = o;
    let h = o;
    let l = o;
    for (let k = 0; k < 24; k++) {
      p *= Math.exp(sigma * Math.sqrt(dt / 24) * g() - 0.5 * sigma * sigma * (dt / 24));
      h = Math.max(h, p);
      l = Math.min(l, p);
    }
    c = p;
    bars.push({ t: i, o, h, l, c });
  }
  return bars;
}

describe("historical volatility", () => {
  const bars = simulate(600, 0.2, 5);
  const closes = bars.map((b) => b.c);

  it("estimators recover the simulated vol", () => {
    expect(hvCloseToClose(closes, 500)).toBeGreaterThan(0.17);
    expect(hvCloseToClose(closes, 500)).toBeLessThan(0.23);
    // discrete H/L sampling biases range estimators low; still in the right neighbourhood
    expect(hvParkinson(bars, 500)).toBeGreaterThan(0.14);
    expect(hvParkinson(bars, 500)).toBeLessThan(0.23);
    expect(hvYangZhang(bars, 500)).toBeGreaterThan(0.14);
    expect(hvYangZhang(bars, 500)).toBeLessThan(0.24);
  });

  it("handles short input and rolling windows", () => {
    expect(Number.isNaN(hvCloseToClose([100, 101], 20))).toBe(true);
    expect(hvCloseToClose([100, 110, 100, 110], 3)).toBeGreaterThan(0);
    const roll = rollingHV(bars, 20, "yz");
    expect(roll).toHaveLength(600 - 20);
    expect(rollingHV(bars, 20, "parkinson")).toHaveLength(600 - 19);
  });

  it("vol cone", () => {
    const cone = volCone(closes, [10, 30, 60]);
    expect(cone).toHaveLength(3);
    for (const c of cone) {
      expect(c.min).toBeLessThanOrEqual(c.p25);
      expect(c.p25).toBeLessThanOrEqual(c.median);
      expect(c.median).toBeLessThanOrEqual(c.p75);
      expect(c.p75).toBeLessThanOrEqual(c.max);
    }
  });
});

describe("implied volatility analytics", () => {
  it("IV rank and percentile", () => {
    const hist = Array.from({ length: 30 }, (_, i) => 10 + i); // 10..39
    expect(ivRank(24.5, hist)).toBeCloseTo(50, 10);
    expect(ivPercentile(25, hist)).toBeCloseTo(50, 10);
    expect(ivRank(20, hist.slice(0, 10))).toBeNull();
    expect(ivPercentile(20, [])).toBeNull();
  });

  it("forward vol and constant maturity", () => {
    expect(forwardVol(0.2, 0.25, 0.2, 0.5)).toBeCloseTo(0.2, 12);
    expect(forwardVol(0.15, 0.1, 0.2, 0.2)).toBeCloseTo(Math.sqrt((0.04 * 0.2 - 0.0225 * 0.1) / 0.1), 12);
    expect(Number.isNaN(forwardVol(0.3, 0.25, 0.1, 0.5))).toBe(true);
    const pts = [
      { T: 7 / 365, iv: 0.12 },
      { T: 35 / 365, iv: 0.14 },
    ];
    const cm = constantMaturityIV(pts, 30 / 365);
    const w = 0.12 ** 2 * (7 / 365) + ((0.14 ** 2 * (35 / 365) - 0.12 ** 2 * (7 / 365)) * (23 / 365)) / (28 / 365);
    expect(cm).toBeCloseTo(Math.sqrt(w / (30 / 365)), 12);
    expect(constantMaturityIV(pts, 1 / 365)).toBe(0.12);
  });

  it("25-delta skew metrics", () => {
    const smile = [
      { delta: -0.1, iv: 19 },
      { delta: -0.25, iv: 16 },
      { delta: -0.4, iv: 14 },
      { delta: 0.4, iv: 13 },
      { delta: 0.3, iv: 12.6 },
      { delta: 0.2, iv: 12.4 },
    ];
    const m = skewMetrics(smile, 13.5);
    expect(m.iv25p).toBeCloseTo(16, 10);
    expect(m.iv25c).toBeCloseTo(12.5, 10);
    expect(m.rr25).toBeCloseTo(-3.5, 10);
    expect(m.bf25).toBeCloseTo(0.75, 10);
  });
});

describe("expected move", () => {
  it("from IV in log space", () => {
    const em = expectedMoveFromIV(25000, 0.15, 30 / 365);
    const sd = 0.15 * Math.sqrt(30 / 365);
    expect(em.upper).toBeCloseTo(25000 * Math.exp(sd), 8);
    expect(em.lower).toBeCloseTo(25000 * Math.exp(-sd), 8);
    expect(em.upper - 25000).toBeGreaterThan(25000 - em.lower);
    expect(em.pct).toBeCloseTo((em.move / 25000) * 100, 10);
    expect(expectedMoveFromIV(25000, 0.15, 30 / 365, 2).move).toBeGreaterThan(em.move * 1.9);
  });

  it("from straddle and hit rate", () => {
    const em = expectedMoveFromStraddle(400, 25000);
    expect(em.move).toBeCloseTo(340, 10);
    expect(em.upper).toBeCloseTo(25340, 10);
    expect(emHitRate([
      { spotAtStart: 100, move: 5, close: 103 },
      { spotAtStart: 100, move: 5, close: 94 },
    ])).toBe(0.5);
    expect(Number.isNaN(emHitRate([]))).toBe(true);
  });
});
