import { describe, expect, it, beforeEach } from "vitest";
import { generateSampleChain, greeks76, forwardFromSpot, timeToExpiryYears, type Leg } from "@/lib/options";
import {
  STRATEGY_TEMPLATES,
  TEMPLATE_VIEWS,
  getTemplate,
  rankTemplates,
  resolveTemplate,
  smileFromChain,
  snapStrike,
  type ResolveContext,
} from "@/lib/strategyTemplates";
import { analyseStrategy } from "./strategyAnalysis";
import {
  SAVED_KEY,
  decodeBase64Url,
  decodeShare,
  deleteSavedStrategy,
  encodeBase64Url,
  encodeLegsParam,
  encodeShare,
  heatColumns,
  isTypingTarget,
  loadSavedStrategies,
  normaliseIv,
  parseLegsParam,
  saveStrategy,
  shiftStrikes,
  targetTimeline,
  toBuilderLegs,
  toCsv,
  updateLegById,
  type BuilderLeg,
} from "./strategyState";

const NOW = new Date("2026-10-19T05:00:00Z"); // Mon 19 Oct 2026, 10:30 IST
const EXP1 = "2026-10-27";
const EXP2 = "2026-11-03";
const SPOT = 25000;
const chains: Record<string, ReturnType<typeof generateSampleChain>["chain"]> = {
  [EXP1]: generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXP1, now: NOW, strikes: 81 }).chain,
  [EXP2]: generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXP2, now: NOW, strikes: 81 }).chain,
};
const ctx: ResolveContext = {
  symbol: "NIFTY",
  spot: SPOT,
  expiries: [EXP1, EXP2],
  strikeStep: 50,
  lotSizeFor: () => 65,
  chainFor: (e) => chains[e],
  atmIv: 0.14,
  priceMode: "mid",
  now: NOW,
  r: 0.065,
  q: 0,
};
const lotSizeFor = () => 65;

function analyse(legs: Leg[]) {
  return analyseStrategy({
    legs: toBuilderLegs(legs),
    spot: SPOT,
    now: NOW,
    r: 0.065,
    q: 0,
    atmIv: 0.14,
    smile: smileFromChain(chains[EXP1], SPOT, 0.14),
    roundTrip: true,
  });
}

describe("strategy templates", () => {
  it("has about 40 uniquely named templates across all four views", () => {
    expect(STRATEGY_TEMPLATES.length).toBeGreaterThanOrEqual(38);
    expect(new Set(STRATEGY_TEMPLATES.map((t) => t.id)).size).toBe(STRATEGY_TEMPLATES.length);
    for (const v of TEMPLATE_VIEWS) expect(STRATEGY_TEMPLATES.filter((t) => t.view === v).length).toBeGreaterThanOrEqual(6);
  });

  it("every template resolves to priced legs on the sample chain", () => {
    for (const t of STRATEGY_TEMPLATES) {
      const legs = resolveTemplate(t, ctx);
      expect(legs.length, t.id).toBe(t.legs.length);
      for (const l of legs) {
        expect(l.premium, t.id).toBeGreaterThan(0);
        expect(l.lotSize).toBe(65);
        if (l.type !== "FUT") expect(l.strike % 50, t.id).toBe(0);
      }
    }
  });

  it("iron condor: short strikes near 0.16 delta, wings outside, ordered", () => {
    const legs = resolveTemplate(getTemplate("iron-condor")!, ctx);
    const [sc, sp, lc, lp] = legs;
    expect(lp.strike).toBeLessThan(sp.strike);
    expect(sp.strike).toBeLessThan(SPOT);
    expect(sc.strike).toBeGreaterThan(SPOT);
    expect(lc.strike).toBeGreaterThan(sc.strike);
    const T = timeToExpiryYears(EXP1, NOW);
    const F = forwardFromSpot(SPOT, T, 0.065);
    const d = Math.abs(greeks76({ F, K: sc.strike, T, r: 0.065, sigma: sc.iv ?? 0.14, type: "CE" }).delta);
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(0.22);
  });

  it("calendars use two expiries, ratio spreads double the lots, FUT is priced near the forward", () => {
    const cal = resolveTemplate(getTemplate("call-calendar")!, ctx);
    expect(new Set(cal.map((l) => l.expiry))).toEqual(new Set([EXP1, EXP2]));
    expect(cal[0].strike).toBe(cal[1].strike);
    const ratio = resolveTemplate(getTemplate("call-ratio-backspread")!, ctx);
    expect(ratio[1].lots).toBe(2);
    const fut = resolveTemplate(getTemplate("long-futures")!, ctx)[0];
    expect(Math.abs(fut.premium - SPOT) / SPOT).toBeLessThan(0.01);
  });

  it("falls back to theoretical prices without a chain", () => {
    const legs = resolveTemplate(getTemplate("short-strangle")!, { ...ctx, chainFor: undefined });
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.premium > 0)).toBe(true);
  });

  it("snapStrike rounds to the step or the nearest listed strike", () => {
    expect(snapStrike(25024, 50)).toBe(25000);
    expect(snapStrike(25026, 50)).toBe(25050);
    expect(snapStrike(25070, 50, [25000, 25100])).toBe(25100);
  });

  it("rankTemplates sorts by return on margin and keeps the view", () => {
    const at = new Date("2026-10-27T09:59:00Z");
    const ranked = rankTemplates({ direction: "Bullish", targetPrice: 25600, targetDate: at }, ctx);
    expect(ranked.length).toBeGreaterThan(5);
    expect(ranked.every((r) => r.template.view === "Bullish")).toBe(true);
    const roms = ranked.map((r) => r.returnOnMargin).filter(Number.isFinite);
    for (let i = 1; i < roms.length; i++) expect(roms[i]).toBeLessThanOrEqual(roms[i - 1]);
    expect(ranked[0].netPnl).toBeGreaterThan(0);
  });
});

describe("strategy analysis", () => {
  it("short straddle is short gamma, unlimited loss and has no R:R", () => {
    const a = analyse(resolveTemplate(getTemplate("short-straddle")!, ctx));
    expect(a.netGreeks.gamma).toBeLessThan(0);
    expect(a.netGreeks.theta).toBeGreaterThan(0);
    expect(a.unlimitedLoss).toBe(true);
    expect(a.riskReward).toBeNull();
    expect(a.breakevens).toHaveLength(2);
    // costs narrow the profit zone
    expect(a.breakevensNet[0]).toBeGreaterThan(a.breakevens[0]);
    expect(a.breakevensNet[1]).toBeLessThan(a.breakevens[1]);
    expect(a.pop).toBeGreaterThan(0.2);
    expect(a.pop).toBeLessThan(0.8);
  });

  it("bull call spread has finite R:R, debit and long delta", () => {
    const a = analyse(resolveTemplate(getTemplate("bull-call-spread")!, ctx));
    expect(a.riskReward).not.toBeNull();
    expect(a.net.type).toBe("DEBIT");
    expect(a.netGreeks.delta).toBeGreaterThan(0);
    expect(a.margin.total).toBeGreaterThan(0);
  });

  it("calendars are evaluated at the front expiry", () => {
    const a = analyse(resolveTemplate(getTemplate("call-calendar")!, ctx));
    expect(a.multiExpiry).toBe(true);
    expect(a.frontExpiry).toBe(EXP1);
    expect(a.breakevens.length).toBe(2);
    expect(a.pop).toBeGreaterThan(0);
  });

  it("disabled legs are ignored", () => {
    const legs = toBuilderLegs(resolveTemplate(getTemplate("short-straddle")!, ctx)).map((l) => ({ ...l, enabled: false }));
    const a = analyseStrategy({ legs, spot: SPOT, now: NOW, r: 0.065, q: 0, atmIv: 0.14, smile: () => 0.14, roundTrip: false });
    expect(a.empty).toBe(true);
  });
});

describe("strategy state", () => {
  beforeEach(() => {
    try {
      window.localStorage.removeItem(SAVED_KEY);
    } catch {
      /* ignore */
    }
  });

  it("base64url round-trips unicode", () => {
    const s = JSON.stringify({ a: "₹ lakh / crore ?&=" });
    const enc = encodeBase64Url(s);
    expect(enc).not.toMatch(/[+/=]/);
    expect(decodeBase64Url(enc)).toBe(s);
    expect(decodeBase64Url("%%%")).toBeNull();
  });

  it("parses the ?legs= basket contract and drops bad rows", () => {
    const param = encodeBase64Url(
      JSON.stringify([
        { symbol: "nifty", expiry: "27-Oct-2026", strike: 25000, type: "CE", side: "sell", lots: 2, premium: 120.5, iv: 13.2 },
        { symbol: "NIFTY", expiry: EXP1, strike: 24500, type: "PE", side: "B", lots: 1, premium: 0, iv: 0.15 },
        { symbol: "NIFTY", expiry: "garbage", strike: 1, type: "CE", side: "BUY" },
        { nope: true },
      ]),
    );
    const legs = parseLegsParam(param, lotSizeFor);
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ symbol: "NIFTY", expiry: EXP1, side: "SELL", lots: 2, premium: 120.5, manual: true, lotSize: 65 });
    expect(legs[0].iv).toBeCloseTo(0.132);
    expect(legs[1]).toMatchObject({ side: "BUY", requote: true });
    expect(legs[1].iv).toBeCloseTo(0.15);
    expect(parseLegsParam("not-base64!!", lotSizeFor)).toEqual([]);
    expect(parseLegsParam(encodeBase64Url("{bad json"), lotSizeFor)).toEqual([]);
  });

  it("encodeLegsParam round-trips through parseLegsParam", () => {
    const legs = resolveTemplate(getTemplate("iron-condor")!, ctx);
    const back = parseLegsParam(encodeLegsParam(legs), lotSizeFor);
    expect(back.map((l) => [l.type, l.side, l.strike, l.expiry])).toEqual(legs.map((l) => [l.type, l.side, l.strike, l.expiry]));
  });

  it("normaliseIv reads percent and decimal", () => {
    expect(normaliseIv(14)).toBeCloseTo(0.14);
    expect(normaliseIv(0.14)).toBeCloseTo(0.14);
    expect(normaliseIv(0)).toBeUndefined();
  });

  it("share links keep legs, enabled flags and name", () => {
    const legs = toBuilderLegs(resolveTemplate(getTemplate("jade-lizard")!, ctx));
    legs[1] = { ...legs[1], enabled: false };
    const st = decodeShare(encodeShare({ symbol: "NIFTY", name: "My lizard", legs }), lotSizeFor);
    expect(st?.name).toBe("My lizard");
    expect(st?.legs.map((l) => l.enabled)).toEqual([true, false, true]);
    expect(st?.legs[0].strike).toBe(legs[0].strike);
    expect(decodeShare("abc", lotSizeFor)).toBeNull();
  });

  it("updateLegById and shiftStrikes never mutate the input", () => {
    const legs: BuilderLeg[] = toBuilderLegs(resolveTemplate(getTemplate("bull-call-spread")!, ctx));
    const frozen = JSON.stringify(legs);
    const next = updateLegById(legs, legs[0].id, { lots: 3 });
    expect(next[0].lots).toBe(3);
    expect(next[1]).toBe(legs[1]);
    const shifted = shiftStrikes(legs, 1, 50);
    expect(shifted[0].strike).toBe(legs[0].strike + 50);
    const onlyOne = shiftStrikes(legs, -2, 50, [legs[1].id]);
    expect(onlyOne[0].strike).toBe(legs[0].strike);
    expect(onlyOne[1].strike).toBe(legs[1].strike - 100);
    expect(JSON.stringify(legs)).toBe(frozen);
    expect(updateLegById(legs, "missing", { lots: 9 })).toBe(legs);
  });

  it("target timeline runs from now to the 15:30 IST expiry with hourly points on expiry day", () => {
    const tl = targetTimeline(EXP1, NOW);
    expect(tl[0].label).toBe("Now");
    expect(tl[tl.length - 1].at.toISOString()).toBe("2026-10-27T10:00:00.000Z");
    for (let i = 1; i < tl.length; i++) expect(tl[i].at.getTime()).toBeGreaterThan(tl[i - 1].at.getTime());
    expect(tl.filter((p) => p.final).length).toBeGreaterThanOrEqual(7);
    expect(targetTimeline("2020-01-01", NOW)).toHaveLength(1);
    const cols = heatColumns(EXP2, NOW, 6);
    expect(cols.length).toBeLessThanOrEqual(6);
    expect(cols[cols.length - 1].label).toBe("At expiry");
  });

  it("toCsv escapes quotes and commas", () => {
    expect(toCsv(["a", "b,c"], [[1.234, 'x"y']])).toBe('a,"b,c"\n1.23,"x""y"');
  });

  it("saves, lists and deletes strategies in localStorage", () => {
    const legs = toBuilderLegs(resolveTemplate(getTemplate("long-straddle")!, ctx));
    const list = saveStrategy("Event play", { symbol: "NIFTY", legs });
    expect(list).toHaveLength(1);
    saveStrategy("Event play", { symbol: "NIFTY", legs });
    expect(loadSavedStrategies()).toHaveLength(1);
    const saved = loadSavedStrategies()[0];
    expect(decodeShare(saved.share, lotSizeFor)?.legs).toHaveLength(2);
    expect(deleteSavedStrategy(saved.id)).toHaveLength(0);
    window.localStorage.setItem(SAVED_KEY, "{corrupt");
    expect(loadSavedStrategies()).toEqual([]);
  });

  it("isTypingTarget ignores inputs and controls but not leg rows", () => {
    const input = document.createElement("input");
    const div = document.createElement("div");
    div.setAttribute("role", "group");
    const slider = document.createElement("span");
    slider.setAttribute("role", "slider");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(slider)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
