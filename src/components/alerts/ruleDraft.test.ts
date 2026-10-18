import { describe, expect, it } from "vitest";
import { ANY_SYMBOL, RULE_TYPES, createRule, describeRule } from "@/lib/alerts";
import { DEFAULT_DRAFT, draftFromRule, draftToRule, retypeDraft } from "./ruleDraft";

describe("rule editor draft", () => {
  it("every rule type has a default draft that validates (after its required inputs)", () => {
    for (const type of RULE_TYPES) {
      let d = retypeDraft({ ...DEFAULT_DRAFT }, type, 25_040);
      if (type === "strike_level") d = { ...d, expiry: "2026-10-20", strike: "25000", value: "120" };
      if (type === "oi_change_strike") d = { ...d, strike: "25000" };
      const r = draftToRule(d);
      expect(r.ok, `${type}: ${r.ok ? "" : r.error}`).toBe(true);
    }
  });

  it("round-trips rules through the editor without changes", () => {
    const rules = [
      createRule({
        symbol: "NIFTY",
        type: "premium_tide",
        direction: "below",
        level: -2_50_00_000,
        label: "Put tide",
        channels: { sound: false },
      }),
      createRule({
        symbol: ANY_SYMBOL,
        type: "repeated_hits",
        minHits: 4,
        windowMin: 20,
        minPremium: 15_00_000,
        cooldownMin: 5,
      }),
      createRule({
        symbol: "NIFTY",
        type: "strike_level",
        expiry: "2026-10-20",
        strike: 25_000,
        side: "PE",
        field: "oiChange",
        op: "lte",
        value: -40_000,
        cooldownMin: 0,
      }),
      createRule({ symbol: "RELIANCE", type: "position_greek", greek: "vega", direction: "above", level: 2_000 }),
    ];
    for (const rule of rules) {
      const r = draftToRule(draftFromRule(rule), rule);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.rule).toEqual(rule);
    }
  });

  it("reports the first problem with its field", () => {
    expect(draftToRule({ ...retypeDraft(DEFAULT_DRAFT, "strike_level") })).toMatchObject({
      ok: false,
      field: "expiry",
    });
    expect(draftToRule({ ...DEFAULT_DRAFT, level: "" })).toMatchObject({ ok: false, field: "level" });
    expect(draftToRule({ ...retypeDraft(DEFAULT_DRAFT, "pcr_cross"), level: "11" })).toMatchObject({
      ok: false,
      field: "level",
    });
  });

  it("accepts Indian-formatted numbers and maps channel choices", () => {
    const r = draftToRule({
      ...DEFAULT_DRAFT,
      level: "25,100",
      channels: { ...DEFAULT_DRAFT.channels, webhook: "on", sound: "off" },
    });
    expect(r.ok && r.rule).toMatchObject({ level: 25_100, channels: { webhook: true, sound: false } });
    expect(r.ok && describeRule(r.rule)).toBe("NIFTY crosses 25,100");
  });

  it("switching type picks sensible defaults and the ANY scope", () => {
    expect(retypeDraft(DEFAULT_DRAFT, "ban_entry").symbol).toBe(ANY_SYMBOL);
    expect(retypeDraft(DEFAULT_DRAFT, "position_pnl")).toMatchObject({
      symbol: ANY_SYMBOL,
      direction: "below",
      level: "-10000",
    });
    expect(retypeDraft({ ...DEFAULT_DRAFT, symbol: ANY_SYMBOL }, "pcr_cross")).toMatchObject({
      symbol: "NIFTY",
      level: "1",
    });
    expect(retypeDraft(DEFAULT_DRAFT, "strike_level")).toMatchObject({ side: "CE", cooldownMin: "0" });
    expect(retypeDraft(DEFAULT_DRAFT, "price_level", 25_040).level).toBe("25000");
  });

  it("rejects blank numeric fields instead of saving them as 0", () => {
    const cases = [
      { ...DEFAULT_DRAFT, type: "ivp_level" as const, level: "", direction: "above" as const },
      { ...DEFAULT_DRAFT, type: "position_pnl" as const, symbol: ANY_SYMBOL, level: "", direction: "below" as const },
      { ...DEFAULT_DRAFT, type: "position_greek" as const, level: " " },
      { ...DEFAULT_DRAFT, type: "premium_tide" as const, tideCrore: "" },
      {
        ...DEFAULT_DRAFT,
        type: "strike_level" as const,
        expiry: "2026-10-20",
        strike: "25000",
        field: "oiChange" as const,
        value: "",
      },
    ];
    for (const d of cases) {
      const r = draftToRule(d);
      expect(r.ok, d.type).toBe(false);
    }
  });

  it("rejects look-back windows shorter than 1 minute", () => {
    const spike = retypeDraft({ ...DEFAULT_DRAFT }, "atm_iv_spike", 25_000);
    expect(draftToRule({ ...spike, windowMin: "0.2" }).ok).toBe(false);
    expect(draftToRule({ ...spike, windowMin: "1" }).ok).toBe(true);
    const hits = retypeDraft({ ...DEFAULT_DRAFT }, "repeated_hits", 25_000);
    expect(draftToRule({ ...hits, windowMin: "0.5" }).ok).toBe(false);
  });
});
