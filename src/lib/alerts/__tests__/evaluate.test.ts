import { describe, expect, it } from "vitest";
import {
  ANY_SYMBOL,
  createRule,
  evaluateRules,
  ruleNeedsChain,
  strikeRuleValue,
  type AlertRule,
  type PortfolioSnapshot,
  type RuleContext,
  type RuleState,
  type StrikeQuote,
  type SymbolMarket,
} from "@/lib/alerts";

const market = (o: Partial<SymbolMarket>): SymbolMarket => ({ symbol: "NIFTY", ts: 1, spot: 25_000, ...o });
const ctx = (now: number, m: Partial<SymbolMarket> | null, extra: Partial<RuleContext> = {}): RuleContext => ({
  now,
  markets: m ? { NIFTY: market({ ts: now, ...m }) } : {},
  prints: [],
  ...extra,
});

function run(rule: AlertRule, steps: RuleContext[]) {
  let state: RuleState = {};
  const out: Array<{ titles: string[]; snapshot?: unknown }> = [];
  for (const c of steps) {
    const r = evaluateRules([rule], c, state);
    state = r.state;
    out.push({ titles: r.events.map((e) => e.title), snapshot: r.events[0]?.snapshot });
  }
  return out;
}
const counts = (o: ReturnType<typeof run>) => o.map((x) => x.titles.length);

const quote = (strike: number, ceLtp: number, peLtp = 50, iv = 14, oiChange = 0): StrikeQuote => ({
  strike,
  ce: { ltp: ceLtp, iv, oiChange },
  pe: { ltp: peLtp, iv, oiChange },
});

describe("new rule types", () => {
  it("ATM IV level fires on a crossing with a snapshot", () => {
    const rule = createRule({ symbol: "NIFTY", type: "iv_level", direction: "above", level: 15, cooldownMin: 0 });
    const out = run(rule, [ctx(1, { atmIv: 14.2 }), ctx(2, { atmIv: 15.3, pcr: 1.1 }), ctx(3, { atmIv: 15.6 })]);
    expect(counts(out)).toEqual([0, 1, 0]);
    expect(out[1].snapshot).toMatchObject({
      symbol: "NIFTY",
      atmIv: 15.3,
      pcr: 1.1,
      value: 15.3,
      valueLabel: "ATM IV %",
      dataTs: 2,
    });
  });

  it("strike rule enters its zone once, re-arms, and ignores other expiries", () => {
    const rule = createRule({
      symbol: "NIFTY",
      type: "strike_level",
      expiry: "2026-10-20",
      strike: 25_000,
      side: "CE",
      field: "premium",
      op: "gte",
      value: 100,
      cooldownMin: 0,
    });
    const m = (ltp: number, expiry = "2026-10-20") => ({ expiry, quotes: [quote(25_000, ltp)] });
    expect(
      counts(run(rule, [ctx(1, m(120)), ctx(2, m(125)), ctx(3, m(90)), ctx(4, m(110)), ctx(5, m(150, "2026-10-27"))])),
    ).toEqual([1, 0, 0, 1, 0]);
    expect(strikeRuleValue(rule as Extract<AlertRule, { type: "strike_level" }>, market(m(0)))).toBeNaN();
  });

  it("strike rule on IV and OI change reads the right leg", () => {
    const iv = createRule({
      symbol: "NIFTY",
      type: "strike_level",
      expiry: "2026-10-20",
      strike: 25_000,
      side: "PE",
      field: "iv",
      op: "gte",
      value: 15,
      cooldownMin: 0,
    }) as Extract<AlertRule, { type: "strike_level" }>;
    const m = market({
      expiry: "2026-10-20",
      quotes: [{ strike: 25_000, ce: { ltp: 1, iv: 10, oiChange: 5 }, pe: { ltp: 1, iv: 16, oiChange: -500 } }],
    });
    expect(strikeRuleValue(iv, m)).toBe(16);
    expect(strikeRuleValue({ ...iv, field: "oiChange" }, m)).toBe(-500);
  });

  it("Premium Tide crosses levels including a sign flip at zero", () => {
    const rule = createRule({ symbol: "NIFTY", type: "premium_tide", direction: "either", level: 0, cooldownMin: 0 });
    const out = run(rule, [
      ctx(1, { tideNet: 2e7 }),
      ctx(2, { tideNet: -1e6 }),
      ctx(3, { tideNet: -3e7 }),
      ctx(4, { tideNet: 1 }),
    ]);
    expect(counts(out)).toEqual([0, 1, 0, 1]);
    expect(out[1].titles[0]).toContain("fell below");
  });

  const pf = (o: Partial<PortfolioSnapshot>): Record<string, PortfolioSnapshot> => ({
    [ANY_SYMBOL]: { pnl: 0, delta: 0, gamma: 0, theta: 0, vega: 0, legs: 2, marked: 2, ts: 5, ...o },
  });

  it("position P&L needs every leg marked live and fires on entering the zone", () => {
    const rule = createRule({
      symbol: ANY_SYMBOL,
      type: "position_pnl",
      direction: "below",
      level: -10_000,
      cooldownMin: 0,
    });
    const step = (now: number, o: Partial<PortfolioSnapshot>): RuleContext => ({
      now,
      markets: {},
      prints: [],
      portfolio: pf(o),
    });
    const out = run(rule, [
      step(1, { pnl: -12_000, marked: 1 }),
      step(2, { pnl: -12_000 }),
      step(3, { pnl: -15_000 }),
      step(4, { pnl: -2_000 }),
      step(5, { pnl: -10_000 }),
    ]);
    expect(counts(out)).toEqual([0, 1, 0, 0, 1]);
    expect(out[1].snapshot).toMatchObject({ pnl: -12_000, valueLabel: "P&L ₹" });
    expect(ruleNeedsChain(rule)).toBe(false);
  });

  it("position Greeks support |value| thresholds", () => {
    const rule = createRule({
      symbol: ANY_SYMBOL,
      type: "position_greek",
      greek: "delta",
      direction: "abs_above",
      level: 100,
      cooldownMin: 0,
    });
    const step = (now: number, delta: number): RuleContext => ({
      now,
      markets: {},
      prints: [],
      portfolio: pf({ delta }),
    });
    expect(counts(run(rule, [step(1, 40), step(2, -130), step(3, -150), step(4, 20), step(5, 101)]))).toEqual([
      0, 1, 0, 0, 1,
    ]);
    const below = createRule({
      symbol: ANY_SYMBOL,
      type: "position_greek",
      greek: "theta",
      direction: "below",
      level: -500,
      cooldownMin: 0,
    });
    expect(counts(run(below, [{ now: 1, markets: {}, prints: [], portfolio: pf({ theta: -600 }) }]))).toEqual([1]);
  });

  it("a snoozed rule tracks crossings but does not fire until the snooze ends", () => {
    const rule = {
      ...createRule({ symbol: "NIFTY", type: "price_level", direction: "either", level: 25_000, cooldownMin: 0 }),
      snoozeUntil: 10,
    };
    expect(counts(run(rule, [ctx(1, { spot: 24_900 }), ctx(2, { spot: 25_100 }), ctx(11, { spot: 24_900 })]))).toEqual([
      0, 0, 1,
    ]);
  });

  it("does not mutate memory arrays from the previous state", () => {
    const rule = createRule({ symbol: ANY_SYMBOL, type: "ban_entry", cooldownMin: 0 });
    const s1 = evaluateRules([rule], { now: 1, markets: {}, prints: [], banList: ["IDEA"] }).state;
    const before = JSON.stringify(s1);
    evaluateRules([rule], { now: 2, markets: {}, prints: [], banList: ["IDEA", "PNB"] }, s1);
    expect(JSON.stringify(s1)).toBe(before);
  });
});
