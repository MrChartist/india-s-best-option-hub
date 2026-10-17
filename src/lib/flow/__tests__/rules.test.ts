import { describe, expect, it } from "vitest";
import type { FlowPrint } from "../types";
import {
  ANY_SYMBOL,
  RULE_IDEAS,
  createRule,
  crossed,
  describeRule,
  evaluateRules,
  exportRulesJSON,
  loadRules,
  mergeRules,
  oiWall,
  parseRulesJSON,
  saveRules,
  type AlertRule,
  type RuleContext,
  type RuleState,
  type SymbolMarket,
} from "../rules";

const market = (o: Partial<SymbolMarket>): SymbolMarket => ({ symbol: "NIFTY", ts: 1, spot: 25_000, ...o });
const ctx = (now: number, m: Partial<SymbolMarket> | null, extra: Partial<RuleContext> = {}): RuleContext => ({
  now,
  markets: m ? { NIFTY: market({ ts: now, ...m }) } : {},
  prints: [],
  ...extra,
});

function run(rule: AlertRule, steps: RuleContext[]) {
  let state: RuleState = {};
  const fired: string[][] = [];
  for (const c of steps) {
    const r = evaluateRules([rule], c, state);
    state = r.state;
    fired.push(r.events.map((e) => e.title));
  }
  return fired;
}

describe("crossed", () => {
  it("detects direction-aware crossings", () => {
    expect(crossed(0.9, 1.1, 1, "above")).toBe("up");
    expect(crossed(0.9, 1.1, 1, "below")).toBeNull();
    expect(crossed(1.1, 0.9, 1, "either")).toBe("down");
    expect(crossed(undefined, 1.1, 1, "either")).toBeNull();
    expect(crossed(1, 1, 1, "either")).toBeNull();
  });
});

describe("evaluateRules", () => {
  it("PCR cross fires on crossing only, then respects cooldown", () => {
    const rule = createRule({ symbol: "NIFTY", type: "pcr_cross", direction: "either", level: 1, cooldownMin: 10 });
    const fired = run(rule, [
      ctx(1_000, { pcr: 0.9 }),
      ctx(2_000, { pcr: 1.05 }),
      ctx(3_000, { pcr: 0.95 }),
      ctx(700_000, { pcr: 1.02 }),
    ]);
    expect(fired.map((f) => f.length)).toEqual([0, 1, 0, 1]);
    expect(fired[1][0]).toContain("rose above 1.00");
  });

  it("does not re-evaluate chain rules without new data", () => {
    const rule = createRule({
      symbol: "NIFTY",
      type: "price_level",
      direction: "above",
      level: 25_100,
      cooldownMin: 0,
    });
    let state: RuleState = {};
    state = evaluateRules(
      [rule],
      { now: 1, markets: { NIFTY: market({ ts: 5, spot: 25_000 }) }, prints: [] },
      state,
    ).state;
    const same = evaluateRules(
      [rule],
      { now: 2, markets: { NIFTY: market({ ts: 5, spot: 25_200 }) }, prints: [] },
      state,
    );
    expect(same.events).toHaveLength(0);
    const fresh = evaluateRules(
      [rule],
      { now: 3, markets: { NIFTY: market({ ts: 6, spot: 25_200 }) }, prints: [] },
      state,
    );
    expect(fresh.events).toHaveLength(1);
  });

  it("IVP zone fires on entry, including the first reading, and re-arms on exit", () => {
    const rule = createRule({ symbol: "NIFTY", type: "ivp_level", direction: "above", level: 80, cooldownMin: 0 });
    const fired = run(rule, [
      ctx(1, { ivp: 85 }),
      ctx(2, { ivp: 90 }),
      ctx(3, { ivp: 50 }),
      ctx(4, { ivp: 81 }),
      ctx(5, { ivp: null }),
    ]);
    expect(fired.map((f) => f.length)).toEqual([1, 0, 0, 1, 0]);
  });

  it("ATM IV spike compares with the low inside the window", () => {
    const rule = createRule({ symbol: "NIFTY", type: "atm_iv_spike", points: 1.5, windowMin: 15, cooldownMin: 0 });
    const min = 60_000;
    const fired = run(rule, [
      ctx(0, { atmIv: 12 }),
      ctx(5 * min, { atmIv: 12.8 }),
      ctx(10 * min, { atmIv: 13.6 }),
      ctx(40 * min, { atmIv: 13.7 }),
    ]);
    expect(fired.map((f) => f.length)).toEqual([0, 0, 1, 0]);
    expect(fired[2][0]).toContain("+1.6");
  });

  it("OI change at strike and OI wall shift", () => {
    const strikes = (ceChg: number, wall: number) => [
      { strike: 25_000, ceOi: wall === 25_000 ? 9 : 1, peOi: 1, ceOiChg: ceChg, peOiChg: 0 },
      { strike: 25_500, ceOi: wall === 25_500 ? 9 : 1, peOi: 1, ceOiChg: 0, peOiChg: 0 },
    ];
    const chg = createRule({
      symbol: "NIFTY",
      type: "oi_change_strike",
      strike: 25_000,
      side: "CE",
      threshold: 1000,
      cooldownMin: 0,
    });
    expect(
      run(chg, [ctx(1, { strikes: strikes(500, 25_000) }), ctx(2, { strikes: strikes(-1500, 25_000) })]).map(
        (f) => f.length,
      ),
    ).toEqual([0, 1]);
    const wall = createRule({ symbol: "NIFTY", type: "oi_wall_shift", side: "CE", cooldownMin: 0 });
    const f = run(wall, [
      ctx(1, { strikes: strikes(0, 25_000) }),
      ctx(2, { strikes: strikes(0, 25_000) }),
      ctx(3, { strikes: strikes(0, 25_500) }),
    ]);
    expect(f.map((x) => x.length)).toEqual([0, 0, 1]);
    expect(oiWall(strikes(0, 25_500), "CE")).toBe(25_500);
  });

  it("spot crossing max pain and the flip", () => {
    const rule = createRule({ symbol: "NIFTY", type: "spot_cross_ref", ref: "max_pain", cooldownMin: 0 });
    expect(
      run(rule, [
        ctx(1, { spot: 24_950, maxPain: 25_000 }),
        ctx(2, { spot: 25_000, maxPain: 25_000 }),
        ctx(3, { spot: 25_050, maxPain: 25_000 }),
      ]).map((f) => f.length),
    ).toEqual([0, 0, 1]);
    const flip = createRule({ symbol: "NIFTY", type: "spot_cross_ref", ref: "gamma_flip", cooldownMin: 0 });
    expect(
      run(flip, [
        ctx(1, { spot: 25_050, gammaFlip: 25_000 }),
        ctx(2, { spot: 24_990, gammaFlip: 25_000 }),
        ctx(3, { spot: 24_980, gammaFlip: null }),
      ]).map((f) => f.length),
    ).toEqual([0, 1, 0]);
  });

  const print = (ts: number, o: Partial<FlowPrint> = {}): FlowPrint => ({
    id: `p${ts}${o.strike ?? ""}`,
    ts,
    fromTs: ts - 60_000,
    symbol: "NIFTY",
    expiry: "2026-10-20",
    strike: 25_000,
    type: "CE",
    dVol: 1000,
    premium: 20_00_000,
    ltp: 30,
    bid: 29,
    ask: 30,
    aggressor: "ASK",
    aggressorBasis: "quote",
    dOI: 800,
    tag: "OPENING",
    dte: 3,
    moneyness: "OTM",
    spot: 25_000,
    lotSize: 65,
    ...o,
  });

  it("big opening print ignores the backlog and fires on new prints only", () => {
    const rule = createRule({ symbol: ANY_SYMBOL, type: "big_opening_print", minPremium: 10_00_000, cooldownMin: 0 });
    const f = run(rule, [
      { now: 1, markets: {}, prints: [print(100)] },
      { now: 2, markets: {}, prints: [print(100), print(200, { tag: "CLOSING" })] },
      {
        now: 3,
        markets: {},
        prints: [
          print(100),
          print(200, { tag: "CLOSING" }),
          print(300, { premium: 5_00_000 }),
          print(300, { strike: 25_100, premium: 60_00_000 }),
        ],
      },
    ]);
    expect(f.map((x) => x.length)).toEqual([0, 0, 1]);
    expect(f[2][0]).toContain("25,100");
  });

  it("repeated hits needs N big prints on one contract inside the window", () => {
    const rule = createRule({
      symbol: "NIFTY",
      type: "repeated_hits",
      minHits: 3,
      windowMin: 30,
      minPremium: 10_00_000,
      cooldownMin: 0,
    });
    const min = 60_000;
    const base: FlowPrint[] = [];
    const steps: RuleContext[] = [{ now: 0, markets: {}, prints: [] }];
    for (let i = 1; i <= 3; i++) {
      base.push(print(i * min));
      steps.push({ now: i * min, markets: {}, prints: [...base] });
    }
    expect(run(rule, steps).map((x) => x.length)).toEqual([0, 0, 0, 1]);
  });

  it("ban list entry: specific symbol fires on first sighting; ANY needs a baseline", () => {
    const one = createRule({ symbol: "IDEA", type: "ban_entry", cooldownMin: 0 });
    expect(
      run(one, [
        { now: 1, markets: {}, prints: [], banList: ["IDEA"] },
        { now: 2, markets: {}, prints: [], banList: ["IDEA"] },
      ]).map((x) => x.length),
    ).toEqual([1, 0]);
    const any = createRule({ symbol: ANY_SYMBOL, type: "ban_entry", cooldownMin: 0 });
    const f = run(any, [
      { now: 1, markets: {}, prints: [], banList: ["IDEA"] },
      { now: 2, markets: {}, prints: [], banList: ["IDEA", "RBLBANK"] },
      { now: 3, markets: {}, prints: [], banList: null },
    ]);
    expect(f.map((x) => x.length)).toEqual([0, 1, 0]);
    expect(f[1][0]).toContain("RBLBANK");
  });

  it("disabled rules never fire and the input state is not mutated", () => {
    const rule = {
      ...createRule({ symbol: "NIFTY", type: "price_level", direction: "either", level: 25_000 }),
      enabled: false,
    };
    const state: RuleState = { [rule.id]: { last: 24_900 } };
    const r = evaluateRules([rule], ctx(5, { spot: 25_100 }), state);
    expect(r.events).toHaveLength(0);
    expect(state[rule.id]).toEqual({ last: 24_900 });
  });
});

describe("persistence and import/export", () => {
  it("round-trips through JSON and storage", () => {
    const rules = RULE_IDEAS.map((i) => createRule(i.make("NIFTY", 25_040)));
    const parsed = parseRulesJSON(exportRulesJSON(rules));
    expect(parsed.rules).toHaveLength(rules.length);
    expect(parsed.skipped).toBe(0);
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    expect(saveRules(rules, storage)).toBe(true);
    expect(loadRules(storage).map((r) => r.id)).toEqual(rules.map((r) => r.id));
    for (const r of rules) expect(describeRule(r).length).toBeGreaterThan(5);
  });

  it("skips invalid rules and reports bad JSON", () => {
    expect(parseRulesJSON("{oops").error).toBeDefined();
    expect(parseRulesJSON('{"x":1}').error).toBeDefined();
    const r = parseRulesJSON(
      JSON.stringify([
        { id: "a", symbol: "nifty", type: "pcr_cross", direction: "above", level: 1 },
        { id: "b", symbol: "NIFTY", type: "nope" },
      ]),
    );
    expect(r.rules).toHaveLength(1);
    expect(r.rules[0].symbol).toBe("NIFTY");
    expect(r.rules[0].cooldownMin).toBe(15);
    expect(r.skipped).toBe(1);
  });

  it("mergeRules gives clashing ids new ids", () => {
    const a = createRule({ symbol: "NIFTY", type: "ban_entry" });
    const merged = mergeRules([a], [{ ...a }]);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).not.toBe(a.id);
  });
});

import { alertFeedSymbols } from "../rules";

describe("alertFeedSymbols", () => {
  it("collects chain symbols and expands ANY flow rules", () => {
    const rules = [
      createRule({ symbol: "RELIANCE", type: "price_level", direction: "above", level: 3000 }),
      createRule({ symbol: ANY_SYMBOL, type: "ban_entry" }),
      { ...createRule({ symbol: "TCS", type: "pcr_cross", direction: "either", level: 1 }), enabled: false },
      createRule({ symbol: ANY_SYMBOL, type: "big_opening_print", minPremium: 1 }),
    ];
    expect(alertFeedSymbols(rules, ["NIFTY", "SENSEX"])).toEqual(["NIFTY", "RELIANCE", "SENSEX"]);
    expect(alertFeedSymbols([])).toEqual([]);
  });
});

import { alertRuleSchema, isAlertRule, parseAlertRule } from "../rules";

describe("hand-written validation (replaces the old zod schema)", () => {
  it("keeps the safeParse shape and the type guards", () => {
    const ok = alertRuleSchema.safeParse({
      id: "a",
      symbol: "nifty",
      type: "price_level",
      direction: "below",
      level: 24_000,
    });
    expect(ok.success && ok.data.symbol).toBe("NIFTY");
    expect(
      alertRuleSchema.safeParse({ id: "a", symbol: "NIFTY", type: "price_level", direction: "below", level: 0 })
        .success,
    ).toBe(false);
    expect(parseAlertRule({ id: "a", symbol: "NIFTY", type: "oi_wall_shift", side: "XX" })).toMatchObject({
      ok: false,
      field: "side",
    });
    expect(isAlertRule(createRule({ symbol: "NIFTY", type: "oi_wall_shift", side: "PE" }))).toBe(true);
    expect(isAlertRule("rule")).toBe(false);
  });
});
