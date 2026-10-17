import { describe, expect, it } from "vitest";
import {
  ANY_SYMBOL,
  RULE_IDEAS,
  RULE_TYPES,
  alertFeedSymbols,
  alertRuleSchema,
  createRule,
  describeRule,
  exportRulesJSON,
  hasEquivalentRule,
  headerAlertToRule,
  idTimestamp,
  isAlertRule,
  isRuleExpired,
  migrateAlertRecord,
  parseAlertRule,
  parseRulesJSON,
  ruleTitle,
  ruleToStrikeAlert,
  strikeAlertToRule,
  type AlertRule,
  type NewAlertRule,
} from "@/lib/alerts";

const NOW = Date.UTC(2026, 9, 16, 5, 0, 0);

/** One valid example per rule type. */
const EXAMPLES: Record<AlertRule["type"], NewAlertRule> = {
  pcr_cross: { symbol: "NIFTY", type: "pcr_cross", direction: "either", level: 1 },
  oi_change_strike: { symbol: "NIFTY", type: "oi_change_strike", strike: 25_000, side: "CE", threshold: 1000 },
  ivp_level: { symbol: "NIFTY", type: "ivp_level", direction: "above", level: 80 },
  price_level: { symbol: "NIFTY", type: "price_level", direction: "above", level: 25_100 },
  atm_iv_spike: { symbol: "NIFTY", type: "atm_iv_spike", points: 1.5, windowMin: 15 },
  oi_wall_shift: { symbol: "NIFTY", type: "oi_wall_shift", side: "BOTH" },
  spot_cross_ref: { symbol: "NIFTY", type: "spot_cross_ref", ref: "gamma_flip" },
  repeated_hits: { symbol: ANY_SYMBOL, type: "repeated_hits", minHits: 3, windowMin: 30, minPremium: 10_00_000 },
  big_opening_print: { symbol: ANY_SYMBOL, type: "big_opening_print", minPremium: 50_00_000 },
  ban_entry: { symbol: ANY_SYMBOL, type: "ban_entry" },
  iv_level: { symbol: "BANKNIFTY", type: "iv_level", direction: "below", level: 12.5 },
  strike_level: {
    symbol: "NIFTY",
    type: "strike_level",
    expiry: "2026-10-20",
    strike: 25_000,
    side: "PE",
    field: "premium",
    op: "lte",
    value: 40,
  },
  premium_tide: { symbol: "NIFTY", type: "premium_tide", direction: "below", level: -5_00_00_000 },
  position_pnl: { symbol: ANY_SYMBOL, type: "position_pnl", direction: "below", level: -10_000 },
  position_greek: { symbol: "NIFTY", type: "position_greek", greek: "delta", direction: "abs_above", level: 100 },
};

describe("rule model: validation", () => {
  it("accepts one example of every rule type and describes it", () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual([...RULE_TYPES].sort());
    for (const ex of Object.values(EXAMPLES)) {
      const rule = createRule(ex, NOW);
      const r = parseAlertRule(rule);
      expect(r.ok, ex.type).toBe(true);
      expect(isAlertRule(rule)).toBe(true);
      expect(describeRule(rule).length).toBeGreaterThan(10);
    }
  });

  it("applies defaults and normalises the symbol", () => {
    const r = parseAlertRule({ id: "a", symbol: " nifty ", type: "price_level", direction: "above", level: 1 }, NOW);
    expect(r.ok && r.rule).toMatchObject({ symbol: "NIFTY", enabled: true, cooldownMin: 15, createdAt: NOW });
  });

  it("rejects bad values with a field and a plain-English message", () => {
    const bad = (x: Record<string, unknown>) => parseAlertRule({ id: "a", symbol: "NIFTY", ...x });
    expect(bad({ type: "nope" })).toMatchObject({ ok: false, field: "type" });
    expect(bad({ type: "pcr_cross", direction: "above", level: 12 })).toMatchObject({ ok: false, field: "level" });
    expect(bad({ type: "ivp_level", direction: "either", level: 50 })).toMatchObject({ ok: false, field: "direction" });
    expect(bad({ type: "repeated_hits", minHits: 2.5, windowMin: 5, minPremium: 1 })).toMatchObject({
      ok: false,
      field: "minHits",
    });
    expect(
      bad({ type: "strike_level", expiry: "20-Oct", strike: 1, side: "CE", field: "iv", op: "gte", value: 1 }),
    ).toMatchObject({ ok: false, field: "expiry" });
    expect(
      bad({ type: "strike_level", expiry: "2026-10-20", strike: 1, side: "BOTH", field: "iv", op: "gte", value: 1 }),
    ).toMatchObject({ ok: false, field: "side" });
    expect(bad({ type: "price_level", direction: "above", level: 1, cooldownMin: -1 })).toMatchObject({
      ok: false,
      field: "cooldownMin",
    });
    expect(
      parseAlertRule({ id: "a", symbol: ANY_SYMBOL, type: "price_level", direction: "above", level: 1 }),
    ).toMatchObject({ ok: false, field: "symbol" });
    expect(parseAlertRule({ id: "a", symbol: "bad symbol!", type: "ban_entry" })).toMatchObject({
      ok: false,
      field: "symbol",
    });
    expect(parseAlertRule(null)).toMatchObject({ ok: false });
    expect(isAlertRule({ id: "a", symbol: "NIFTY", type: "ban_entry" })).toBe(false);
  });

  it("allows a negative OI-change value on strike rules and signed P&L levels", () => {
    expect(
      parseAlertRule({
        id: "a",
        symbol: "NIFTY",
        type: "strike_level",
        expiry: "2026-10-20",
        strike: 25000,
        side: "CE",
        field: "oiChange",
        op: "lte",
        value: -50000,
      }).ok,
    ).toBe(true);
    expect(parseAlertRule({ id: "a", symbol: "NIFTY", type: "position_pnl", direction: "above", level: 5000 }).ok).toBe(
      true,
    );
    expect(
      parseAlertRule({
        id: "a",
        symbol: "NIFTY",
        type: "position_greek",
        greek: "theta",
        direction: "abs_above",
        level: -1,
      }).ok,
    ).toBe(false);
  });

  it("keeps optional fields and drops junk", () => {
    const r = parseAlertRule({
      ...createRule(EXAMPLES.price_level, NOW),
      label: "  Breakout  ",
      channels: { sound: false, junk: true },
      snoozeUntil: NOW + 1,
      origin: "chain",
      extra: 1,
    });
    expect(r.ok && r.rule).toMatchObject({
      label: "Breakout",
      channels: { sound: false },
      snoozeUntil: NOW + 1,
      origin: "chain",
    });
    expect(r.ok && "extra" in r.rule).toBe(false);
    expect(r.ok && ruleTitle(r.rule)).toBe("Breakout");
  });

  it("keeps a zod-compatible safeParse for older callers", () => {
    expect(alertRuleSchema.safeParse({ id: "a", symbol: "NIFTY", type: "ban_entry" }).success).toBe(true);
    const bad = alertRuleSchema.safeParse({ id: "a", symbol: "NIFTY", type: "pcr_cross", direction: "up", level: 1 });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path).toEqual(["direction"]);
  });
});

describe("rule model: migration", () => {
  const strike = {
    id: "sa_mgdmd0w0_abcd12",
    symbol: "NIFTY",
    expiry: "2026-10-20",
    strike: 25_000,
    type: "CE" as const,
    field: "iv" as const,
    op: "gte" as const,
    value: 18,
  };

  it("turns chain strike alerts into strike rules with the same id and back", () => {
    const r = strikeAlertToRule(strike, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rule).toMatchObject({
      id: strike.id,
      type: "strike_level",
      side: "CE",
      field: "iv",
      value: 18,
      cooldownMin: 0,
      origin: "chain",
      enabled: true,
    });
    expect(r.rule.createdAt).toBe(idTimestamp(strike.id));
    expect(ruleToStrikeAlert(r.rule)).toEqual(strike);
    expect(ruleToStrikeAlert({ ...r.rule, enabled: false })?.paused).toBe(true);
    expect(strikeAlertToRule({ ...strike, paused: true }, NOW)).toMatchObject({ ok: true, rule: { enabled: false } });
    expect(ruleToStrikeAlert(createRule(EXAMPLES.ban_entry))).toBeNull();
  });

  it("maps old header alerts where an honest equivalent exists", () => {
    const base = {
      id: "1",
      symbol: "NIFTY",
      condition: "above" as const,
      value: 25_000,
      active: true,
      triggered: false,
    };
    expect(headerAlertToRule({ ...base, type: "price" }, NOW)).toMatchObject({
      ok: true,
      rule: { id: "h_1", type: "price_level", direction: "above", level: 25_000, origin: "header" },
    });
    expect(headerAlertToRule({ ...base, type: "pcr", value: 1.2, active: false }, NOW)).toMatchObject({
      ok: true,
      rule: { type: "pcr_cross", level: 1.2, enabled: false },
    });
    expect(headerAlertToRule({ ...base, type: "iv_spike", value: 16 }, NOW)).toMatchObject({
      ok: true,
      rule: { type: "iv_level", level: 16 },
    });
    expect(headerAlertToRule({ ...base, type: "vix" }, NOW).ok).toBe(false);
    expect(headerAlertToRule({ ...base, type: "oi_spike" }, NOW).ok).toBe(false);
  });

  it("detects each record shape", () => {
    expect(migrateAlertRecord(strike, NOW)).toMatchObject({ ok: true, source: "chain" });
    expect(
      migrateAlertRecord({ id: "x", symbol: "NIFTY", type: "price", condition: "below", value: 1 }, NOW),
    ).toMatchObject({ ok: true, source: "header" });
    expect(migrateAlertRecord(createRule(EXAMPLES.pcr_cross, NOW), NOW)).toMatchObject({ ok: true, source: "flow" });
    expect(migrateAlertRecord({ hello: 1 }, NOW).ok).toBe(false);
  });

  it("imports a mixed legacy file, de-duplicates ids and reports skips", () => {
    const flow = createRule(EXAMPLES.pcr_cross, NOW);
    const text = JSON.stringify({
      version: 1,
      rules: [
        flow,
        flow,
        strike,
        { id: "v", symbol: "NIFTY", type: "vix", condition: "above", value: 20 },
        { nope: true },
      ],
    });
    const res = parseRulesJSON(text, NOW);
    expect(res.rules.map((r) => r.type)).toEqual(["pcr_cross", "strike_level"]);
    expect(res.skipped).toBe(2);
    expect(res.bySource).toEqual({ flow: 1, chain: 1, header: 0 });
    expect(res.errors?.some((e) => /VIX/.test(e))).toBe(true);
  });

  it("exports version 2 files that re-import losslessly", () => {
    const rules = Object.values(EXAMPLES).map((e) => createRule(e, NOW));
    const text = exportRulesJSON(rules, new Date(NOW));
    expect(JSON.parse(text)).toMatchObject({ app: "mr-chartist-terminal", kind: "alert-rules", version: 2 });
    const back = parseRulesJSON(text, NOW);
    expect(back.skipped).toBe(0);
    expect(back.rules).toEqual(rules);
  });

  it("reads ids without a timestamp as NaN", () => {
    expect(idTimestamp("r1")).toBeNaN();
    expect(idTimestamp("sa_zz_x")).toBeNaN();
  });
});

describe("rule model: helpers", () => {
  it("flags expired strike rules only", () => {
    const s = createRule(EXAMPLES.strike_level, NOW);
    expect(isRuleExpired(s, "2026-10-21")).toBe(true);
    expect(isRuleExpired(s, "2026-10-20")).toBe(false);
    expect(isRuleExpired(createRule(EXAMPLES.price_level), "2030-01-01")).toBe(false);
  });

  it("spots equivalent rules by description", () => {
    const a = createRule(EXAMPLES.price_level, NOW);
    expect(hasEquivalentRule([a], createRule(EXAMPLES.price_level, NOW))).toBe(true);
    expect(hasEquivalentRule([a], a)).toBe(false);
  });

  it("plans feeds for position rules from open-position underlyings", () => {
    const rules = [
      createRule(EXAMPLES.position_pnl),
      createRule(EXAMPLES.position_greek),
      createRule(EXAMPLES.strike_level),
    ];
    expect(alertFeedSymbols(rules, [], ["RELIANCE", "NIFTY"])).toEqual(["NIFTY", "RELIANCE"]);
    expect(alertFeedSymbols([createRule(EXAMPLES.position_greek)], [], ["RELIANCE"])).toEqual([]);
  });

  it("every idea builds a valid rule", () => {
    for (const idea of RULE_IDEAS)
      expect(parseAlertRule(createRule(idea.make("NIFTY", 25_040))).ok, idea.id).toBe(true);
  });
});
