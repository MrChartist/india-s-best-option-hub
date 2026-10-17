import { describe, expect, it } from "vitest";
import { generateSampleChain, istDateString, normalizeExpiry } from "@/lib/options";
import {
  ALL_KINDS,
  KIND_META,
  buildQuoteBook,
  enumerateCandidates,
  isDefinedRisk,
  optimize,
  popFromGrid,
  quoteLeg,
  rankResults,
  roiNormaliser,
  runOnMainThread,
  runOptimizer,
  sentimentTarget,
  toBasketLegs,
  utility,
  type OptimizerInput,
  type ScoredCandidate,
} from "@/lib/optimizer";

// Fixed clock: Thursday 15 Oct 2026, 10:00 IST. Front expiry Tue 20 Oct, back Tue 27 Oct.
const NOW = new Date("2026-10-15T04:30:00Z");
const FRONT = "2026-10-20";
const BACK = "2026-10-27";
const SPOT = 25000;

function input(over: Partial<OptimizerInput> = {}): OptimizerInput {
  const front = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: FRONT, now: NOW, strikes: 41 });
  const back = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: BACK, now: NOW, strikes: 41 });
  return {
    symbol: "NIFTY",
    spot: SPOT,
    lotSize: 65,
    front: { expiry: FRONT, chain: front.chain },
    back: { expiry: BACK, chain: back.chain },
    nowMs: NOW.getTime(),
    r: 0.065,
    targetPrice: 25300,
    targetDate: FRONT,
    budget: 100000,
    maxLots: 10,
    definedRiskOnly: true,
    strikesAroundAtm: 8,
    minOiPct: 0.03,
    maxSpreadPct: 0.1,
    minPremium: 2,
    pricing: "mid",
    kinds: null,
    ...over,
  };
}

describe("candidates", () => {
  it("respects the defined-risk toggle", () => {
    const inp = input();
    const front = buildQuoteBook(FRONT, inp.front.chain);
    const back = buildQuoteBook(BACK, inp.back!.chain);
    const rules = { minOiPct: 0.03, maxSpreadPct: 0.1, minPremium: 2, pricing: "mid" as const };
    const on = enumerateCandidates({ front, back, spot: SPOT, strikesAroundAtm: 8, definedRiskOnly: true, rules });
    expect(on.candidates.length).toBeGreaterThan(200);
    for (const c of on.candidates) {
      expect(KIND_META[c.kind].definedRisk).toBe(true);
      expect(isDefinedRisk(c.legs)).toBe(true);
    }
    expect(on.riskSkipped).toBeGreaterThan(0);

    const off = enumerateCandidates({ front, back, spot: SPOT, strikesAroundAtm: 8, definedRiskOnly: false, rules });
    const kinds = new Set(off.candidates.map((c) => c.kind));
    expect(kinds.has("short_strangle")).toBe(true);
    expect(kinds.has("call_ratio_spread")).toBe(true);
    expect(kinds.has("jade_lizard")).toBe(true);
    expect(off.candidates.length).toBeGreaterThan(on.candidates.length);
  });

  it("enumerates every family with a second expiry", () => {
    const inp = input({ definedRiskOnly: false });
    const res = optimize({ ...inp, targetPrice: SPOT });
    const front = buildQuoteBook(FRONT, inp.front.chain);
    const back = buildQuoteBook(BACK, inp.back!.chain);
    const en = enumerateCandidates({ front, back, spot: SPOT, strikesAroundAtm: 8, definedRiskOnly: false, rules: { minOiPct: 0, maxSpreadPct: 1, minPremium: 0, pricing: "mid" } });
    const kinds = new Set(en.candidates.map((c) => c.kind));
    for (const k of ALL_KINDS) expect(kinds.has(k)).toBe(true);
    expect(res.stats.multiExpirySkipped).toBe(false);
  });

  it("flags multi-expiry kinds as skipped without a back expiry", () => {
    const res = optimize(input({ back: null }));
    expect(res.stats.multiExpirySkipped).toBe(true);
    expect(res.results.every((r) => r.category !== "calendar_diagonal")).toBe(true);
  });

  it("applies OI, spread and minimum-premium filters", () => {
    const inp = input();
    const book = buildQuoteBook(FRONT, inp.front.chain);
    const k = book.strikes[book.strikes.length - 1];
    const strict = { minOiPct: 0, maxSpreadPct: 1, minPremium: 1e9, pricing: "mid" as const };
    expect(quoteLeg(book, k, "CE", "BUY", strict)).toBeNull();
    const oiStrict = { minOiPct: 1.01, maxSpreadPct: 1, minPremium: 0, pricing: "mid" as const };
    expect(quoteLeg(book, book.strikes[20], "CE", "BUY", oiStrict)).toBeNull();
    const spreadStrict = { minOiPct: 0, maxSpreadPct: 0, minPremium: 0, pricing: "mid" as const };
    expect(quoteLeg(book, book.strikes[20], "CE", "BUY", spreadStrict)).toBeNull();
    const natural = quoteLeg(book, book.strikes[20], "CE", "BUY", { minOiPct: 0, maxSpreadPct: 1, minPremium: 0, pricing: "natural" });
    const row = inp.front.chain.find((r) => r.strikePrice === book.strikes[20])!;
    expect(natural?.premium).toBeCloseTo(row.ce.askPrice, 2);
  });
});

describe("scoring", () => {
  const out = optimize(input());

  it("produces feasible, profitable results with sane metrics", () => {
    expect(out.results.length).toBeGreaterThan(20);
    for (const r of out.results) {
      expect(r.netProfit).toBeGreaterThan(0);
      expect(r.netProfit).toBeCloseTo(r.profitAtTarget - r.charges, 6);
      expect(r.roi).toBeCloseTo(r.netProfit / r.capital, 9);
      expect(r.pop).toBeGreaterThanOrEqual(0);
      expect(r.pop).toBeLessThanOrEqual(1);
      expect(r.charges).toBeGreaterThan(0);
      expect(r.maxLoss).toBeLessThanOrEqual(0);
      expect(r.definedRisk).toBe(true);
      expect(Number.isFinite(r.maxLoss)).toBe(true);
    }
    expect(out.context.lower).toBeLessThan(SPOT);
    expect(out.context.upper).toBeGreaterThan(SPOT);
  });

  it("holds the budget and max-lots constraints", () => {
    for (const budget of [15000, 40000, 100000]) {
      const res = optimize(input({ budget, maxLots: 4 }));
      expect(res.results.length).toBeGreaterThan(0);
      for (const r of res.results) {
        expect(r.capital).toBeLessThanOrEqual(budget);
        expect(r.lots).toBeGreaterThanOrEqual(1);
        expect(r.lots).toBeLessThanOrEqual(4);
      }
    }
    const tiny = optimize(input({ budget: 100 }));
    expect(tiny.results).toHaveLength(0);
    expect(tiny.stats.overBudget).toBeGreaterThan(0);
  });

  it("is monotonic in w: more weight on return never lowers the top pick's ROI or raises its POP", () => {
    const ws = [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
    const tops = ws.map((w) => rankResults(out.results, w).overall[0]);
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i].roiNorm).toBeGreaterThanOrEqual(tops[i - 1].roiNorm - 1e-12);
      expect(tops[i].pop).toBeLessThanOrEqual(tops[i - 1].pop + 1e-12);
    }
    const best = rankResults(out.results, 1).overall[0];
    const safest = rankResults(out.results, 0).overall[0];
    expect(safest.pop).toBe(Math.max(...out.results.map((r) => r.pop)));
    expect(best.roiNorm).toBe(1);
  });

  it("keeps at most 10 per category and ranks by utility", () => {
    const ranked = rankResults(out.results, 0.5);
    expect(ranked.overall.length).toBeLessThanOrEqual(10);
    for (const list of Object.values(ranked.byCategory)) {
      expect(list.length).toBeLessThanOrEqual(10);
      for (let i = 1; i < list.length; i++) expect(list[i].utility).toBeLessThanOrEqual(list[i - 1].utility);
    }
  });

  it("a bullish target favours bullish structures; a bearish one bearish", () => {
    const bull = rankResults(optimize(input({ targetPrice: 25500 })).results, 0.7).overall;
    const bear = rankResults(optimize(input({ targetPrice: 24500 })).results, 0.7).overall;
    expect(bull.filter((r) => KIND_META[r.kind].bias === "bullish").length).toBeGreaterThan(bull.length / 2);
    expect(bear.filter((r) => KIND_META[r.kind].bias === "bearish").length).toBeGreaterThan(bear.length / 2);
  });

  it("scores a target date before expiry (T+x) and calendars", () => {
    const res = optimize(input({ targetDate: "2026-10-16", targetPrice: SPOT }));
    expect(res.context.atExpiry).toBe(false);
    expect(res.context.tTarget).toBeGreaterThan(0);
    expect(res.results.some((r) => r.category === "calendar_diagonal")).toBe(true);
    for (const r of res.results) expect(Number.isFinite(r.pop)).toBe(true);
  });

  it("clamps a target date outside [today, expiry]", () => {
    const res = optimize(input({ targetDate: "2030-01-01" }));
    expect(res.context.atExpiry).toBe(true);
    expect(istDateString(new Date(res.context.atDateMs))).toBe(FRONT);
  });

  it("the main-thread runner matches the synchronous engine", async () => {
    const inp = input({ strikesAroundAtm: 4 });
    const sync = optimize(inp);
    const progress: number[] = [];
    const asyncOut = await runOnMainThread(inp, { onProgress: (p) => progress.push(p.done) });
    expect(asyncOut.results.map((r) => r.id)).toEqual(sync.results.map((r) => r.id));
    expect(progress.length).toBeGreaterThan(1);
    const viaClient = await runOptimizer(inp);
    expect(viaClient.mode).toBe("main-thread");
    expect(viaClient.output.results.length).toBe(sync.results.length);
  });
});

describe("helpers", () => {
  it("utility is a clamped convex blend", () => {
    expect(utility(1, 0, 1)).toBe(1);
    expect(utility(1, 0, 0)).toBe(0);
    expect(utility(0.4, 0.8, 0.5)).toBeCloseTo(0.6, 12);
    expect(utility(0.4, 0.8, 7)).toBe(0.4);
  });

  it("roiNormaliser clips to 0..1", () => {
    const rs = Array.from({ length: 50 }, (_, i) => ({ roi: i / 10 })) as Pick<ScoredCandidate, "roi">[];
    const f = roiNormaliser(rs);
    expect(f(-5)).toBe(0);
    expect(f(100)).toBe(1);
    expect(f(2.45)).toBeCloseTo(0.5, 2);
  });

  it("popFromGrid integrates the profitable region", () => {
    const grid = Array.from({ length: 201 }, (_, i) => 20000 + i * 50);
    const vals = grid.map((S) => (S > 25000 ? 1 : -1));
    const p = popFromGrid(grid, vals, 25000, 0.05, () => 0.15);
    expect(p).toBeGreaterThan(0.45);
    expect(p).toBeLessThan(0.52);
  });

  it("sentiment targets move by k·σ√T", () => {
    expect(sentimentTarget(25000, 0.15, 0.04, 0)).toBe(25000);
    expect(sentimentTarget(25000, 0.15, 0.04, 1)).toBeCloseTo(25000 * Math.exp(0.03), 0);
    expect(sentimentTarget(25000, 0.15, 0.04, -1)).toBeLessThan(25000);
  });

  it("builds basket legs in the shared shape with decimal IV", () => {
    const res = optimize(input());
    const top = res.results[0];
    const legs = toBasketLegs(top, top.lots, "NIFTY");
    expect(legs.length).toBe(top.legs.length);
    for (const l of legs) {
      expect(normalizeExpiry(l.expiry)).toBe(l.expiry);
      expect(l.lots % top.lots).toBe(0);
      if (l.iv !== null) expect(l.iv).toBeLessThan(3);
    }
  });
});
