import { describe, it, expect } from "vitest";
import { evaluateRules, validateRulesNoCycles } from "./legRules.mjs";

describe("evaluateRules — pure event-to-action translation", () => {
  it("fires the matching rule's action for a matching event", () => {
    const rules = [{ when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } }];
    const actions = evaluateRules(rules, [{ leg: "L1", event: "FILLED" }]);
    expect(actions).toEqual([{ action: "ENTER", target: "L2", causeLeg: "L1", causeEvent: "FILLED" }]);
  });

  it("ignores events that match no rule", () => {
    const rules = [{ when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } }];
    expect(evaluateRules(rules, [{ leg: "L1", event: "REJECTED" }])).toEqual([]);
    expect(evaluateRules(rules, [{ leg: "L9", event: "FILLED" }])).toEqual([]);
  });

  it("does not confuse a leg+event match with a different leg or event", () => {
    const rules = [
      { when: { leg: "L1", event: "SL_HIT" }, then: { action: "EXIT", target: "ALL_REMAINING" } },
      { when: { leg: "L1", event: "TARGET_HIT" }, then: { action: "CANCEL", target: "L2" } },
    ];
    expect(evaluateRules(rules, [{ leg: "L1", event: "TARGET_HIT" }])).toEqual([
      { action: "CANCEL", target: "L2", causeLeg: "L1", causeEvent: "TARGET_HIT" },
    ]);
  });

  it("fires every rule that matches the same event (fan-out)", () => {
    const rules = [
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } },
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L3" } },
    ];
    const actions = evaluateRules(rules, [{ leg: "L1", event: "FILLED" }]);
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.target)).toEqual(["L2", "L3"]);
  });

  it("processes multiple events in order, each against the full rule set", () => {
    const rules = [
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } },
      { when: { leg: "L2", event: "REJECTED" }, then: { action: "HALT_BASKET", target: "ALL_REMAINING" } },
    ];
    const events = [{ leg: "L1", event: "FILLED" }, { leg: "L2", event: "REJECTED" }];
    const actions = evaluateRules(rules, events);
    expect(actions.map((a) => a.action)).toEqual(["ENTER", "HALT_BASKET"]);
  });

  it("is pure — calling it twice with the same inputs gives the same output, and never mutates its inputs", () => {
    const rules = [{ when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } }];
    const events = [{ leg: "L1", event: "FILLED" }];
    const rulesCopy = JSON.parse(JSON.stringify(rules));
    const eventsCopy = JSON.parse(JSON.stringify(events));
    const a1 = evaluateRules(rules, events);
    const a2 = evaluateRules(rules, events);
    expect(a1).toEqual(a2);
    expect(rules).toEqual(rulesCopy);
    expect(events).toEqual(eventsCopy);
  });

  it("returns an empty array for non-array inputs rather than throwing", () => {
    expect(evaluateRules(null, [])).toEqual([]);
    expect(evaluateRules([], null)).toEqual([]);
  });
});

describe("validateRulesNoCycles", () => {
  it("accepts an empty or acyclic rule set", () => {
    expect(validateRulesNoCycles([])).toEqual({ ok: true });
    const rules = [
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } },
      { when: { leg: "L2", event: "SL_HIT" }, then: { action: "EXIT", target: "L3" } },
    ];
    expect(validateRulesNoCycles(rules)).toEqual({ ok: true });
  });

  it("rejects a rule that re-enters its own leg on its own fill — the infinite order generator", () => {
    const rules = [{ when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L1" } }];
    const result = validateRulesNoCycles(rules);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cycle/i);
    expect(result.cycle).toEqual(["L1", "L1"]);
  });

  it("rejects a transitive two-leg cycle (L1 enters L2, L2 enters L1)", () => {
    const rules = [
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } },
      { when: { leg: "L2", event: "FILLED" }, then: { action: "ENTER", target: "L1" } },
    ];
    const result = validateRulesNoCycles(rules);
    expect(result.ok).toBe(false);
    expect(result.cycle).toContain("L1");
    expect(result.cycle).toContain("L2");
  });

  it("rejects a longer transitive cycle (L1 -> L2 -> L3 -> L1)", () => {
    const rules = [
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } },
      { when: { leg: "L2", event: "FILLED" }, then: { action: "EXIT", target: "L3" } },
      { when: { leg: "L3", event: "REJECTED" }, then: { action: "ENTER", target: "L1" } },
    ];
    expect(validateRulesNoCycles(rules).ok).toBe(false);
  });

  it("rejects a cycle reached through ALL_REMAINING", () => {
    const rules = [
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "ALL_REMAINING" } },
      { when: { leg: "L2", event: "FILLED" }, then: { action: "ENTER", target: "L1" } },
    ];
    const result = validateRulesNoCycles(rules);
    expect(result.ok).toBe(false);
    expect(result.cycle).toContain("L1");
    expect(result.cycle).toContain("L2");
  });

  it("does NOT flag CANCEL or HALT_BASKET as cycle-forming — they stop orders, they don't generate them", () => {
    const rules = [
      { when: { leg: "L1", event: "FILLED" }, then: { action: "CANCEL", target: "L2" } },
      { when: { leg: "L2", event: "REJECTED" }, then: { action: "HALT_BASKET", target: "L1" } },
    ];
    expect(validateRulesNoCycles(rules)).toEqual({ ok: true });
  });

  it("a diamond (L1 feeds both L2 and L3, both feed L4) is acyclic and accepted", () => {
    const rules = [
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } },
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L3" } },
      { when: { leg: "L2", event: "FILLED" }, then: { action: "ENTER", target: "L4" } },
      { when: { leg: "L3", event: "FILLED" }, then: { action: "ENTER", target: "L4" } },
    ];
    expect(validateRulesNoCycles(rules)).toEqual({ ok: true });
  });

  it("a legitimate one-directional chain of several legs is accepted (not every graph is a cycle)", () => {
    const rules = [
      { when: { leg: "L1", event: "FILLED" }, then: { action: "ENTER", target: "L2" } },
      { when: { leg: "L2", event: "FILLED" }, then: { action: "ENTER", target: "L3" } },
      { when: { leg: "L3", event: "FILLED" }, then: { action: "ENTER", target: "L4" } },
    ];
    expect(validateRulesNoCycles(rules)).toEqual({ ok: true });
  });
});
