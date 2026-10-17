import { describe, expect, it } from "vitest";
import { estimateMargin, generateSampleChain } from "@/lib/options";
import {
  DELTA_NEUTRAL_BAND,
  NEUTRAL_VIEW_BOOST,
  buildScoreContext,
  deltaPerSet,
  inZones,
  matchesView,
  optimize,
  parseOptimizerParams,
  payoffTag,
  popFromGrid,
  popFromZones,
  profitZonesFromGrid,
  rankResults,
  stepTarget,
  toLegs,
  viewFromTarget,
  type Candidate,
  type OptimizerInput,
  type ScoredCandidate,
} from "@/lib/optimizer";

const NOW = new Date("2026-10-15T04:30:00Z");
const FRONT = "2026-10-20";
const SPOT = 25000;

function input(over: Partial<OptimizerInput> = {}): OptimizerInput {
  const front = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: FRONT, now: NOW, strikes: 41 });
  return {
    symbol: "NIFTY",
    spot: SPOT,
    lotSize: 65,
    front: { expiry: FRONT, chain: front.chain },
    back: null,
    nowMs: NOW.getTime(),
    r: 0.065,
    targetPrice: SPOT,
    targetDate: FRONT,
    budget: 150000,
    maxLots: 5,
    definedRiskOnly: true,
    strikesAroundAtm: 6,
    minOiPct: 0.0,
    maxSpreadPct: 0.2,
    minPremium: 1,
    pricing: "mid",
    kinds: null,
    ...over,
  };
}

describe("profit zones", () => {
  it("finds interpolated zones, open at either edge", () => {
    const grid = [100, 110, 120, 130, 140];
    expect(profitZonesFromGrid(grid, [1, 1, -1, -1, 1])).toEqual([
      { from: 0, to: 115 },
      { from: 135, to: Infinity },
    ]);
    expect(profitZonesFromGrid(grid, [-1, 1, 1, -1, -1])).toEqual([{ from: 105, to: 125 }]);
    expect(profitZonesFromGrid(grid, [-1, -1, -1, -1, -1])).toEqual([]);
    expect(profitZonesFromGrid([1], [1])).toEqual([]);
    expect(profitZonesFromGrid(grid, [1, 2])).toEqual([]);
    expect(inZones([{ from: 105, to: 125 }], 110)).toBe(true);
    expect(inZones([{ from: 105, to: 125 }], 130)).toBe(false);
    expect(inZones([{ from: 105, to: 125 }], Number.NaN)).toBe(false);
  });

  it("popFromGrid matches popFromZones and handles the edge cases", () => {
    const grid = [20000, 22000, 24000, 25000, 26000, 28000, 30000];
    const vals = [-1, -1, 1, 1, 1, -1, -1];
    const smile = () => 0.15;
    const p = popFromGrid(grid, vals, 25000, 0.05, smile);
    expect(p).toBeCloseTo(popFromZones(profitZonesFromGrid(grid, vals), 25000, 0.05, smile), 12);
    expect(p).toBeGreaterThan(0.5);
    expect(popFromGrid(grid, vals, 25000, 0, smile)).toBe(1);
    expect(popFromGrid([1], [1], 25000, 0.05, smile)).toBeNaN();
    expect(popFromZones([], 0, 0.1, smile)).toBeNaN();
    expect(popFromZones([{ from: 0, to: 25000 }], 25000, 0.05, smile)).toBeCloseTo(0.5, 1);
  });
});

describe("payoffTag", () => {
  const o = { symbol: "NIFTY", spot: 24500, target: 24300 };
  it("describes one-sided zones against spot", () => {
    expect(payoffTag([{ from: 0, to: 24373 }], { ...o, spot: 24300 })).toEqual({ text: "Profits if NIFTY stays below 24,373", tone: "bearish" });
    expect(payoffTag([{ from: 0, to: 24373 }], o).text).toBe("Profits if NIFTY falls below 24,373");
    expect(payoffTag([{ from: 24620.4, to: Infinity }], o)).toEqual({ text: "Profits if NIFTY rises above 24,620", tone: "bullish" });
    expect(payoffTag([{ from: 24400, to: Infinity }], o).text).toBe("Profits if NIFTY stays above 24,400");
  });
  it("describes a range, a move either way and the target-date suffix", () => {
    expect(payoffTag([{ from: 24200, to: 24800 }], o)).toEqual({ text: "Profits if NIFTY stays between 24,200 and 24,800", tone: "neutral" });
    expect(payoffTag([{ from: 24600, to: 24800 }], o).tone).toBe("bullish");
    expect(payoffTag([{ from: 24000, to: 24300 }], o).text).toBe("Profits if NIFTY falls to between 24,000 and 24,300");
    expect(payoffTag([{ from: 0, to: 24000 }, { from: 25000, to: Infinity }], o)).toEqual({ text: "Profits if NIFTY moves below 24,000 or above 25,000", tone: "volatile" });
    expect(payoffTag([{ from: 0, to: Infinity }], o).text).toBe("Profits at any price");
    expect(payoffTag([{ from: 24200, to: 24800 }], { ...o, on: "20 Oct 2026" }).text).toBe("Profits if NIFTY stays between 24,200 and 24,800 on 20 Oct 2026");
  });
  it("picks the zone holding the target when there are several", () => {
    const zones = [
      { from: 23000, to: 23500 },
      { from: 24200, to: 24400 },
      { from: 26000, to: 26500 },
    ];
    expect(payoffTag(zones, o).text).toBe("Profits if NIFTY falls to between 24,200 and 24,400");
    expect(payoffTag(zones, { ...o, target: 25900 }).text).toBe("Profits if NIFTY rises to between 26,000 and 26,500");
    expect(payoffTag([], o)).toEqual({ text: "No profit zone for NIFTY", tone: "neutral" });
    expect(payoffTag([{ from: 5, to: 5 }], { ...o, symbol: "" }).text).toBe("No profit zone for the underlying");
  });
});

describe("views", () => {
  it("maps a target to a view in σ units", () => {
    // σ√T = 0.15·√(7/365) ≈ 2.08%.
    const T = 7 / 365;
    expect(viewFromTarget(25000, 25000, 0.15, T)).toBe("neutral");
    expect(viewFromTarget(25000, 25250, 0.15, T)).toBe("bullish");
    expect(viewFromTarget(25000, 25600, 0.15, T)).toBe("very_bullish");
    expect(viewFromTarget(25000, 24750, 0.15, T)).toBe("bearish");
    expect(viewFromTarget(25000, 24400, 0.15, T)).toBe("very_bearish");
    expect(viewFromTarget(0, 24400, 0.15, T)).toBe("neutral");
  });
  it("matches structures to views", () => {
    const flat = { deltaPerSet: 0.02, spotInProfitZone: true };
    expect(matchesView(flat, "neutral")).toBe(true);
    expect(matchesView({ ...flat, spotInProfitZone: false }, "neutral")).toBe(false);
    expect(matchesView({ deltaPerSet: DELTA_NEUTRAL_BAND + 0.05, spotInProfitZone: true }, "neutral")).toBe(false);
    expect(matchesView({ deltaPerSet: 0.3, spotInProfitZone: false }, "bullish")).toBe(true);
    expect(matchesView({ deltaPerSet: 0.3, spotInProfitZone: false }, "very_bullish")).toBe(true);
    expect(matchesView({ deltaPerSet: -0.3, spotInProfitZone: false }, "bearish")).toBe(true);
    expect(matchesView({ deltaPerSet: 0.3, spotInProfitZone: false }, "very_bearish")).toBe(false);
    expect(matchesView(flat, null)).toBe(false);
    expect(matchesView({ deltaPerSet: Number.NaN, spotInProfitZone: true }, "neutral")).toBe(false);
  });
});

describe("stepTarget", () => {
  const o = { step: 50, sigmaPts: 420, min: 24000, max: 26000 };
  it("steps one strike, snapping off-grid values", () => {
    expect(stepTarget(25000, "ArrowRight", o)).toBe(25050);
    expect(stepTarget(25000, "ArrowUp", o)).toBe(25050);
    expect(stepTarget(25000, "ArrowLeft", o)).toBe(24950);
    expect(stepTarget(25012, "ArrowRight", o)).toBe(25050);
    expect(stepTarget(25012, "ArrowDown", o)).toBe(25000);
  });
  it("steps 1σ, jumps to the ends and clamps", () => {
    expect(stepTarget(25000, "PageUp", o)).toBe(25400);
    expect(stepTarget(25000, "PageDown", o)).toBe(24600);
    expect(stepTarget(25000, "PageUp", { ...o, sigmaPts: 10 })).toBe(25050);
    expect(stepTarget(25000, "PageDown", { ...o, sigmaPts: 0 })).toBe(24750);
    expect(stepTarget(25000, "Home", o)).toBe(24000);
    expect(stepTarget(25000, "End", o)).toBe(26000);
    expect(stepTarget(25990, "ArrowRight", o)).toBe(26000);
    expect(stepTarget(Number.NaN, "ArrowRight", o)).toBe(24050);
    expect(stepTarget(25000, "Enter", o)).toBeNull();
    expect(stepTarget(10, "ArrowRight", { step: 0, sigmaPts: 0, min: 1, max: 100 })).toBe(11);
  });
});

describe("URL params", () => {
  it("reads symbol and target defensively", () => {
    expect(parseOptimizerParams(new URLSearchParams("symbol=banknifty&target=56,500"))).toEqual({ symbol: "BANKNIFTY", target: 56500 });
    expect(parseOptimizerParams(new URLSearchParams("symbol=M%26M&target=3000.257"))).toEqual({ symbol: "M&M", target: 3000.26 });
    expect(parseOptimizerParams(new URLSearchParams("symbol=<script>&target=-4"))).toEqual({ symbol: null, target: null });
    expect(parseOptimizerParams(new URLSearchParams("target=abc"))).toEqual({ symbol: null, target: null });
    expect(parseOptimizerParams(new URLSearchParams("target="))).toEqual({ symbol: null, target: null });
  });
});

describe("scoring on funds required", () => {
  const inp = input();
  const ctx = buildScoreContext(inp, "2026-10-15");

  it("measures return on funds required (net debit for debit spreads)", () => {
    const out = optimize({ ...inp, targetPrice: 24600 });
    const bearPut = out.results.find((r) => r.kind === "bear_put_spread");
    expect(bearPut).toBeDefined();
    const legs = toLegs(bearPut!, bearPut!.lots, "NIFTY", 65);
    const m = estimateMargin(legs, { spot: SPOT, now: NOW, sigma: ctx.sigma });
    expect(bearPut!.fundsRequired).toBeCloseTo(m.fundsRequired, 6);
    expect(bearPut!.capital).toBe(bearPut!.fundsRequired);
    expect(bearPut!.marginTotal).toBeCloseTo(m.total, 6);
    expect(bearPut!.fundsRequired).toBeLessThan(bearPut!.marginTotal);
    expect(bearPut!.roi).toBeCloseTo(bearPut!.netProfit / bearPut!.fundsRequired, 12);
    expect(bearPut!.elm).toBe(0);
    expect(bearPut!.deltaPerSet).toBeLessThan(0);
    expect(bearPut!.profitZones.length).toBeGreaterThan(0);
    for (const r of out.results) expect(r.fundsRequired).toBeLessThanOrEqual(inp.budget + 1e-6);
  });

  it("computes net delta per unit", () => {
    const atm = (type: "CE" | "PE", side: "BUY" | "SELL", strike: number) => ({ type, side, strike, expiry: FRONT, ratio: 1, premium: 100, iv: 0.14, oi: 1, spreadPct: 0.01, noQuote: false });
    const straddle: Pick<Candidate, "legs"> = { legs: [atm("CE", "SELL", 25000), atm("PE", "SELL", 25000)] };
    const call: Pick<Candidate, "legs"> = { legs: [atm("CE", "BUY", 25000)] };
    expect(Math.abs(deltaPerSet(straddle, ctx))).toBeLessThan(0.1);
    expect(deltaPerSet(call, ctx)).toBeGreaterThan(0.4);
    expect(deltaPerSet(call, ctx)).toBeLessThan(0.65);
    // Expired legs count as intrinsic delta.
    const expired: Pick<Candidate, "legs"> = { legs: [{ ...atm("CE", "BUY", 24000), expiry: "2026-10-01" }, { ...atm("PE", "SELL", 24000), expiry: "2026-10-01" }] };
    expect(deltaPerSet(expired, ctx)).toBe(1);
    const noIv: Pick<Candidate, "legs"> = { legs: [{ ...atm("PE", "BUY", 25000), iv: null }] };
    expect(deltaPerSet(noIv, ctx)).toBeLessThan(-0.3);
  });

  it("boosts delta-neutral fits for a Neutral view and flags matches", () => {
    const out = optimize({ ...input({ definedRiskOnly: false }), targetPrice: SPOT });
    const plain = rankResults(out.results, 0.5, 1e6);
    const neutral = rankResults(out.results, 0.5, 1e6, { view: "neutral" });
    expect(plain.overall.every((r) => !r.matchesView)).toBe(true);
    const fits = neutral.overall.filter((r) => r.matchesView);
    expect(fits.length).toBeGreaterThan(0);
    for (const f of fits) {
      const base = plain.overall.find((r) => r.id === f.id)!;
      expect(f.utility).toBeCloseTo(base.utility + NEUTRAL_VIEW_BOOST, 12);
      expect(Math.abs(f.deltaPerSet)).toBeLessThanOrEqual(DELTA_NEUTRAL_BAND);
      expect(f.spotInProfitZone).toBe(true);
    }
    // The boost pulls matching structures up: their mean rank improves.
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const ranksPlain = fits.map((f) => plain.overall.find((r) => r.id === f.id)!.rank);
    expect(mean(fits.map((f) => f.rank))).toBeLessThan(mean(ranksPlain));
    // Directional views flag but do not boost.
    const bull = rankResults(out.results, 0.5, 1e6, { view: "bullish" });
    for (const r of bull.overall) expect(r.utility).toBeCloseTo(plain.overall.find((p) => p.id === r.id)!.utility, 12);
    expect(bull.overall.some((r) => r.matchesView)).toBe(true);
  });

  it("keeps scored results serialisable for the worker", () => {
    const out = optimize({ ...inp, targetPrice: 25300 });
    const r = out.results[0] as ScoredCandidate;
    expect(structuredClone(r).profitZones).toEqual(r.profitZones);
  });
});
