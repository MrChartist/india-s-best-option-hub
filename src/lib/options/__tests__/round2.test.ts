import { describe, expect, it } from "vitest";
import {
  EM_METHOD_LABEL,
  defaultSampleIv,
  estimateMargin,
  expectedMoveFromIV,
  expectedMoveFromStraddle,
  expectedMoves,
  generateSampleChain,
  getExpiries,
  istDateString,
  marginFundsRequired,
  maxPain,
  ordinal,
  sampleSeed,
  type Leg,
  type MarginEstimate,
} from "@/lib/options";

// Thursday 15 Oct 2026, 10:00 IST.
const NOW = new Date("2026-10-15T04:30:00Z");
const EXP = "2026-10-20";

function leg(p: Partial<Leg>): Leg {
  return { symbol: "NIFTY", type: "PE", side: "BUY", strike: 24500, expiry: EXP, lots: 1, lotSize: 65, premium: 100, iv: 0.14, ...p };
}

describe("margin: funds required", () => {
  // Bear put debit spread: buy the 24550 PE, sell the 24250 PE.
  const bearPut = [leg({ side: "BUY", strike: 24550, premium: 180 }), leg({ side: "SELL", strike: 24250, premium: 70 })];
  const m = estimateMargin(bearPut, { spot: 24400, now: NOW });

  it("counts the net debit, not the gross long premium", () => {
    const paid = 180 * 65;
    const received = 70 * 65;
    expect(m.premiumPaid).toBeCloseTo(paid, 6);
    expect(m.premiumReceived).toBeCloseTo(received, 6);
    expect(m.fundsRequired).toBeCloseTo(m.span + m.exposure + m.elmExpiryDay + (paid - received), 6);
    // The legacy total still carries the gross long premium.
    expect(m.total).toBeCloseTo(m.span + m.exposure + m.elmExpiryDay + paid, 6);
    expect(m.total - m.fundsRequired).toBeCloseTo(received, 6);
    // A debit spread's whole risk is its debit: no span on top.
    expect(m.method).toBe("defined-risk");
    expect(m.span).toBeCloseTo(0, 6);
    expect(m.fundsRequired).toBeCloseTo(m.exposure + (paid - received), 6);
    expect(m.fundsRequired).toBeLessThan(m.exposure + paid);
    expect(marginFundsRequired(m)).toBe(m.fundsRequired);
  });

  it("a credit spread blocks span and exposure only", () => {
    const bullPut = [leg({ side: "SELL", strike: 24400, premium: 120 }), leg({ side: "BUY", strike: 24200, premium: 60 })];
    const c = estimateMargin(bullPut, { spot: 24400, now: NOW });
    expect(c.premiumReceived).toBeGreaterThan(c.premiumPaid);
    expect(c.fundsRequired).toBeCloseTo(c.span + c.exposure + c.elmExpiryDay, 6);
    expect(c.span).toBeGreaterThan(0);
  });

  it("long-only positions need just the premium", () => {
    const l = estimateMargin([leg({ side: "BUY", premium: 50, type: "CE", strike: 24600 })], { spot: 24400, now: NOW });
    expect(l.method).toBe("long-only");
    expect(l.fundsRequired).toBeCloseTo(50 * 65, 6);
    expect(l.premiumPaid).toBeCloseTo(50 * 65, 6);
  });

  it("includes expiry-day ELM for a short index option expiring today", () => {
    const today = istDateString(NOW);
    const e = estimateMargin([leg({ side: "SELL", type: "CE", strike: 24600, premium: 40, expiry: today })], { spot: 24400, now: NOW });
    expect(e.elmExpiryDay).toBeCloseTo(0.02 * 24400 * 65, 6);
    expect(e.fundsRequired).toBeCloseTo(e.span + e.exposure + e.elmExpiryDay, 6);
  });

  it("empty input and hand-built estimates", () => {
    const z = estimateMargin([], { spot: 24400 });
    expect(z.fundsRequired).toBe(0);
    expect(z.premiumPaid).toBe(0);
    const legacy: MarginEstimate = { span: 1, exposure: 2, elmExpiryDay: 0, premiumReceived: 0, total: 30, hedgeBenefit: 0, nakedTotal: 30, definedRisk: false, method: "scenario-approx", isEstimate: true };
    expect(marginFundsRequired(legacy)).toBe(30);
    expect(marginFundsRequired(null)).toBe(0);
    expect(marginFundsRequired({ ...legacy, fundsRequired: Number.NaN })).toBe(30);
  });
});

describe("expectedMoves", () => {
  it("returns the IV band around the forward and the straddle band around spot", () => {
    const r = expectedMoves({ spot: 25000, forward: 25040, atmIv: 0.14, tYears: 7 / 365, straddle: 420 });
    expect(r.iv).toEqual(expectedMoveFromIV(25040, 0.14, 7 / 365));
    expect(r.straddle).toEqual(expectedMoveFromStraddle(420, 25000));
    expect(r.straddle!.move).toBeCloseTo(357, 6);
  });
  it("falls back to spot without a forward and drops a missing straddle", () => {
    const r = expectedMoves({ spot: 25000, atmIv: 0.14, tYears: 7 / 365 });
    expect(r.iv).toEqual(expectedMoveFromIV(25000, 0.14, 7 / 365));
    expect(r.straddle).toBeNull();
    expect(expectedMoves({ spot: 25000, forward: -1, atmIv: 0.14, tYears: 0.02, straddle: 0 }).straddle).toBeNull();
    expect(expectedMoves({ spot: 0, atmIv: 0.14, tYears: 0.02, straddle: 100 }).straddle).toBeNull();
    expect(Number.isNaN(expectedMoves({ spot: Number.NaN, atmIv: 0.14, tYears: 0.02 }).iv.move)).toBe(true);
  });
  it("labels each method", () => {
    expect(EM_METHOD_LABEL).toEqual({ iv: "IV 1σ", straddle: "Straddle ×0.85" });
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [101, "101st"],
    [111, "111th"],
    [112, "112th"],
    [0, "0th"],
    [2.6, "3rd"],
    [-1, "−1st"],
  ])("%s → %s", (n, out) => {
    expect(ordinal(n)).toBe(out);
  });
  it("dashes non-finite input", () => {
    expect(ordinal(Number.NaN)).toBe("—");
    expect(ordinal(Infinity)).toBe("—");
  });
});

describe("sample chain seeding", () => {
  const CASES: Array<[string, number]> = [
    ["NIFTY", 25000],
    ["BANKNIFTY", 56000],
    ["SENSEX", 82000],
    ["FINNIFTY", 26500],
    ["RELIANCE", 1400],
    ["HDFCBANK", 1000],
    ["INFY", 1500],
  ];
  const combos = CASES.flatMap(([sym, spot]) => getExpiries(sym, NOW, 3).map((e) => ({ sym, spot, expiry: e.date })));

  const stats = combos.map(({ sym, spot, expiry }) => {
    const { chain } = generateSampleChain({ symbol: sym, spot, expiry, now: NOW });
    const ce = chain.reduce((a, r) => a + r.ce.oi, 0);
    const pe = chain.reduce((a, r) => a + r.pe.oi, 0);
    const ceWall = chain.reduce((a, r) => (r.ce.oi > a.ce.oi ? r : a)).strikePrice;
    const peWall = chain.reduce((a, r) => (r.pe.oi > a.pe.oi ? r : a)).strikePrice;
    const step = chain[1].strikePrice - chain[0].strikePrice;
    const atm = Math.round(spot / step) * step;
    return { sym, expiry, pcr: pe / ce, mp: maxPain(chain), atm, ceWall, peWall };
  });

  it("covers several symbols and expiries", () => {
    expect(combos.length).toBeGreaterThanOrEqual(15);
  });

  it("keeps PCR within 0.6–1.4 and spreads it out", () => {
    for (const s of stats) {
      expect(s.pcr).toBeGreaterThanOrEqual(0.59);
      expect(s.pcr).toBeLessThanOrEqual(1.41);
    }
    const pcrs = stats.map((s) => s.pcr);
    expect(Math.max(...pcrs) - Math.min(...pcrs)).toBeGreaterThan(0.4);
  });

  it("puts max pain away from spot and the call wall above the put wall", () => {
    for (const s of stats) {
      expect(s.mp).not.toBe(s.atm);
      expect(s.ceWall).toBeGreaterThan(s.peWall);
    }
    // Both directions occur.
    expect(stats.some((s) => s.mp > s.atm)).toBe(true);
    expect(stats.some((s) => s.mp < s.atm)).toBe(true);
  });

  it("is stable per symbol and expiry and differs across them", () => {
    const a = generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry: EXP, now: NOW });
    const b = generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry: EXP, now: NOW });
    const c = generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry: "2026-10-27", now: NOW });
    const d = generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry: EXP, now: NOW, seed: 5 });
    expect(a).toEqual(b);
    expect(a.chain.map((r) => r.ce.oi)).not.toEqual(c.chain.map((r) => r.ce.oi));
    expect(a.chain.map((r) => r.ce.oi)).not.toEqual(d.chain.map((r) => r.ce.oi));
    expect(sampleSeed("nifty", EXP)).toBe(sampleSeed("NIFTY", EXP));
    expect(sampleSeed("NIFTY", EXP)).not.toBe(sampleSeed("BANKNIFTY", EXP));
    expect(sampleSeed("NIFTY", EXP, 1)).not.toBe(sampleSeed("NIFTY", EXP));
    expect(sampleSeed("", "")).toBe(sampleSeed("NIFTY", ""));
    expect(sampleSeed("NIFTY", EXP, Number.NaN)).toBe(sampleSeed("NIFTY", EXP));
  });
});

describe("defaultSampleIv", () => {
  it("uses 13–15% for indices and 20–30% for stocks, fixed per symbol", () => {
    for (const s of ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"]) {
      const v = defaultSampleIv(s);
      expect(v).toBeGreaterThanOrEqual(0.13);
      expect(v).toBeLessThanOrEqual(0.15);
    }
    for (const s of ["RELIANCE", "HDFCBANK", "INFY", "TCS", "SBIN", "UNKNOWNCO"]) {
      const v = defaultSampleIv(s);
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(0.3);
    }
    expect(defaultSampleIv("nifty")).toBe(defaultSampleIv("NIFTY"));
    expect(defaultSampleIv("")).toBe(defaultSampleIv("NIFTY"));
  });

  it("drives the chain's ATM IV when none is passed", () => {
    const { chain } = generateSampleChain({ symbol: "RELIANCE", spot: 1400, expiry: "2026-10-27", now: NOW });
    const atm = chain.find((r) => r.strikePrice === 1400)!;
    // The smile is centred on the forward, so the ATM strike sits within a point of the base level.
    expect(Math.abs(atm.ce.iv - defaultSampleIv("RELIANCE") * 100)).toBeLessThan(1);
  });
});
