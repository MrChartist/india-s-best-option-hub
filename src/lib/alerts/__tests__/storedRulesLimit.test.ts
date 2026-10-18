// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  ALERT_RULES_STORAGE_KEY,
  alertStore,
  createRule,
  loadAllRules,
  loadRules,
  mergeRules,
  parseRulesJSON,
  type AlertRule,
} from "@/lib/alerts";

const many = (n: number): AlertRule[] =>
  Array.from({ length: n }, (_, i) => createRule({ symbol: "NIFTY", type: "price_level", direction: "above", level: 20_000 + i }));

beforeEach(() => {
  localStorage.clear();
  alertStore.resetForTests();
});

describe("stored rules are never capped at the import limit", () => {
  it("reads more than 500 stored rules back, so the next save does not drop the rest", () => {
    const batch = many(400);
    const stored = mergeRules(mergeRules([], batch), batch);
    expect(stored).toHaveLength(800);
    localStorage.setItem(ALERT_RULES_STORAGE_KEY, JSON.stringify(stored));

    expect(loadRules()).toHaveLength(800);
    expect(loadAllRules().rules).toHaveLength(800);

    alertStore.resetForTests();
    alertStore.reload();
    expect(alertStore.getState().rules).toHaveLength(800);
    alertStore.toggleRule(stored[0].id, false);
    expect(JSON.parse(localStorage.getItem(ALERT_RULES_STORAGE_KEY)!)).toHaveLength(800);
  });

  it("still caps a single import file at 500 records", () => {
    const res = parseRulesJSON(JSON.stringify(many(600)));
    expect(res.rules).toHaveLength(500);
    expect(res.skipped).toBe(100);
  });
});
