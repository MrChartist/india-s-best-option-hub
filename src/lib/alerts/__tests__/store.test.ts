// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  ALERT_LOG_KEY,
  ALERT_RULES_STORAGE_KEY,
  ALERT_SETTINGS_KEY,
  EMPTY_RUNTIME,
  LEGACY_STRIKE_ALERTS_KEY,
  LOG_MAX,
  alertStore,
  createRule,
  fireCountByRule,
  lastFiredByRule,
  parseLog,
  parseSettings,
  ruleCoverage,
  ruleCurrentValue,
  type RuntimeStatus,
  type TriggerLogEntry,
} from "@/lib/alerts";

const entry = (i: number, o: Partial<TriggerLogEntry> = {}): TriggerLogEntry => ({
  id: `e${i}`,
  ruleId: "r1",
  type: "price_level",
  symbol: "NIFTY",
  ts: i,
  title: "t",
  message: "m",
  tone: "info",
  rule: "rule",
  delivery: {},
  ...o,
});

beforeEach(() => {
  localStorage.clear();
  alertStore.resetForTests();
});

describe("alertStore", () => {
  it("loads, migrates the legacy chain store and removes it", () => {
    localStorage.setItem(ALERT_RULES_STORAGE_KEY, JSON.stringify([createRule({ symbol: "NIFTY", type: "ban_entry" })]));
    localStorage.setItem(
      LEGACY_STRIKE_ALERTS_KEY,
      JSON.stringify([
        {
          id: "sa_1",
          symbol: "NIFTY",
          expiry: "2026-10-20",
          strike: 25000,
          type: "PE",
          field: "premium",
          op: "lte",
          value: 40,
        },
      ]),
    );
    const s = alertStore.getState();
    expect(s.rules.map((r) => r.type)).toEqual(["ban_entry", "strike_level"]);
    expect(localStorage.getItem(LEGACY_STRIKE_ALERTS_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(ALERT_RULES_STORAGE_KEY)!)).toHaveLength(2);
    expect(s.persisted).toBe(true);
  });

  it("adds, edits with validation, pauses, snoozes and deletes", () => {
    let notified = 0;
    const off = alertStore.subscribe(() => notified++);
    const r = alertStore.addRule({ symbol: "NIFTY", type: "price_level", direction: "above", level: 25_000 });
    expect(alertStore.updateRule(r.id, (x) => ({ ...x, level: -1 }) as typeof x)).toMatch(/price/i);
    expect(alertStore.updateRule(r.id, (x) => ({ ...x, level: 25_500, label: "Breakout" }) as typeof x)).toBeNull();
    expect(alertStore.getState().rules[0]).toMatchObject({ level: 25_500, label: "Breakout", createdAt: r.createdAt });
    alertStore.snoozeRule(r.id, 99);
    alertStore.toggleRule(r.id);
    expect(alertStore.getState().rules[0]).toMatchObject({ enabled: false });
    expect(alertStore.getState().rules[0].snoozeUntil).toBeUndefined();
    expect(alertStore.updateRule("missing", r)).toMatch(/no longer exists/);
    alertStore.removeRules([r.id]);
    expect(alertStore.getState().rules).toEqual([]);
    expect(notified).toBeGreaterThan(4);
    off();
  });

  it("imports and exports, merging clashing ids", () => {
    const r = alertStore.addRule({ symbol: "NIFTY", type: "ban_entry" });
    const res = alertStore.importJSON(alertStore.exportJSON());
    expect(res.rules).toHaveLength(1);
    const ids = alertStore.getState().rules.map((x) => x.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(r.id);
    expect(alertStore.importJSON("{").error).toBeDefined();
  });

  it("persists settings and a capped log, and patches entries", () => {
    alertStore.setSettings({ sound: false, volume: 4, webhookUrl: "https://x.example" });
    expect(JSON.parse(localStorage.getItem(ALERT_SETTINGS_KEY)!)).toMatchObject({ sound: false, volume: 1 });
    alertStore.appendLog(Array.from({ length: LOG_MAX + 10 }, (_, i) => entry(i)));
    expect(alertStore.getState().log).toHaveLength(LOG_MAX);
    alertStore.patchLog("e0", { delivery: { webhook: "failed" } });
    expect(alertStore.getState().log.find((e) => e.id === "e0")?.delivery.webhook).toBe("failed");
    alertStore.resetForTests();
    expect(alertStore.getState().log).toHaveLength(LOG_MAX);
    alertStore.clearLog();
    expect(JSON.parse(localStorage.getItem(ALERT_LOG_KEY)!)).toEqual([]);
  });

  it("parses settings and logs defensively", () => {
    expect(parseSettings({ toast: "yes", volume: -3 })).toMatchObject({ toast: true, volume: 0 });
    expect(parseLog([entry(1), { id: 2 }, null])).toHaveLength(1);
    expect(parseLog("x")).toEqual([]);
  });

  it("derives last fired and counts from the log, ignoring tests", () => {
    const log = [entry(5), entry(3), entry(9, { test: true }), entry(4, { ruleId: "r2" })];
    expect(lastFiredByRule(log)).toEqual({ r1: 5, r2: 4 });
    expect(fireCountByRule(log)).toEqual({ r1: 2, r2: 1 });
  });
});

describe("ruleCoverage", () => {
  const rt = (o: Partial<RuntimeStatus>): RuntimeStatus => ({ ...EMPTY_RUNTIME, running: true, ...o });
  const price = createRule({ symbol: "NIFTY", type: "price_level", direction: "above", level: 1 });

  it("explains why a rule is or is not being watched", () => {
    expect(ruleCoverage({ ...price, enabled: false }, rt({})).state).toBe("paused");
    expect(ruleCoverage(price, rt({ running: false })).state).toBe("unavailable");
    expect(ruleCoverage(price, rt({})).state).toBe("waiting");
    expect(ruleCoverage(price, rt({ feeds: [{ symbol: "NIFTY", mode: "sample" }] })).state).toBe("sample");
    expect(ruleCoverage(price, rt({ feeds: [{ symbol: "NIFTY", mode: "live", asOf: 1 }] }))).toMatchObject({
      state: "watching",
      label: "Watching · live",
    });
    expect(ruleCoverage({ ...price, snoozeUntil: 2_000 }, rt({}), 1_000).state).toBe("snoozed");
  });

  it("handles strike, ban and position rules", () => {
    const strike = createRule({
      symbol: "NIFTY",
      type: "strike_level",
      expiry: "2026-10-27",
      strike: 25000,
      side: "CE",
      field: "premium",
      op: "gte",
      value: 1,
    });
    expect(
      ruleCoverage(strike, rt({ feeds: [{ symbol: "NIFTY", mode: "live", expiry: "2026-10-20" }] }), 0, "2026-10-16")
        .state,
    ).toBe("elsewhere");
    expect(ruleCoverage(strike, rt({}), 0, "2026-10-28").state).toBe("expired");
    const ban = createRule({ symbol: "ANY", type: "ban_entry" });
    expect(ruleCoverage(ban, rt({ banListAvailable: false })).state).toBe("unavailable");
    const pnl = createRule({ symbol: "ANY", type: "position_pnl", direction: "below", level: -1 });
    expect(ruleCoverage(pnl, rt({ positions: 0 })).label).toBe("No open positions");
    const portfolio = { ANY: { pnl: -500, delta: 1, gamma: 0, theta: 0, vega: 0, legs: 2, marked: 1, ts: 1 } };
    expect(ruleCoverage(pnl, rt({ positions: 2, portfolio })).label).toBe("1 of 2 legs marked live");
    expect(ruleCurrentValue(pnl, rt({ positions: 2, portfolio }))).toBeNull();
    const full = { ANY: { ...portfolio.ANY, marked: 2 } };
    expect(ruleCurrentValue(pnl, rt({ positions: 2, portfolio: full }))).toEqual({ label: "P&L", value: "−₹500" });
  });

  it("shows the current value from the last market context", () => {
    const markets = { NIFTY: { symbol: "NIFTY", ts: 1, spot: 25_012.5, pcr: 1.234 } };
    expect(ruleCurrentValue(price, rt({ markets }))).toEqual({ label: "Spot", value: "25,012.50" });
    expect(
      ruleCurrentValue(
        createRule({ symbol: "NIFTY", type: "pcr_cross", direction: "either", level: 1 }),
        rt({ markets }),
      ),
    ).toEqual({ label: "PCR", value: "1.23" });
  });
});
