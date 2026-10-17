import { beforeEach, describe, expect, it } from "vitest";
import { STRIKE_ALERTS_KEY, alertConditionMet, describeAlert, evaluateAlerts, readAlerts, writeAlerts, type StrikeAlert } from "./alerts";
import type { RowView } from "./chainModel";
import { buildChainModel } from "./chainModel";
import { matchPreset, normaliseColumns, presetColumns, readColumnPrefs, readRange, writeColumnPrefs, writeRange, COLUMNS_KEY } from "./preferences";
import { canonicalSymbol, filterSymbols, ALL_SYMBOLS } from "./symbols";
import { gammaBadgeMap, safeGammaLevels } from "./gammaLevels";

function rowsWith(ltp: number, iv: number, oiChange: number): RowView[] {
  return buildChainModel(
    [{ strikePrice: 24500, ce: { ltp, oi: 1000, oiChange, volume: 10, iv, delta: 0.5, gamma: 0.001, theta: -5, vega: 10, bidPrice: 0, askPrice: 0 }, pe: { ltp: 50, oi: 1000, oiChange: 0, volume: 10, iv: 14, delta: -0.5, gamma: 0.001, theta: -5, vega: 10, bidPrice: 0, askPrice: 0 } }],
    { spot: 24500, expiry: "2026-10-20", lotSize: 65, now: new Date("2026-10-15T05:00:00Z") },
  ).rows;
}

const alert = (over: Partial<StrikeAlert> = {}): StrikeAlert => ({ id: "a1", symbol: "NIFTY", expiry: "2026-10-20", strike: 24500, type: "CE", field: "premium", op: "gte", value: 100, ...over });

describe("strike alerts", () => {
  beforeEach(() => localStorage.clear());

  it("evaluates ≥ / ≤ and ignores NaN", () => {
    expect(alertConditionMet(alert(), 100)).toBe(true);
    expect(alertConditionMet(alert({ op: "lte" }), 101)).toBe(false);
    expect(alertConditionMet(alert(), NaN)).toBe(false);
  });

  it("fires once, then re-arms after the condition turns false", () => {
    const a = [alert()];
    let r = evaluateAlerts(a, rowsWith(120, 14, 0), "NIFTY", "2026-10-20", new Set());
    expect(r.hits).toHaveLength(1);
    r = evaluateAlerts(a, rowsWith(125, 14, 0), "NIFTY", "2026-10-20", r.fired);
    expect(r.hits).toHaveLength(0);
    r = evaluateAlerts(a, rowsWith(90, 14, 0), "NIFTY", "2026-10-20", r.fired);
    expect(r.hits).toHaveLength(0);
    r = evaluateAlerts(a, rowsWith(110, 14, 0), "NIFTY", "2026-10-20", r.fired);
    expect(r.hits).toHaveLength(1);
  });

  it("only evaluates alerts for the current symbol and expiry, and supports IV / OI change", () => {
    const a = [alert({ id: "x", symbol: "BANKNIFTY" }), alert({ id: "iv", field: "iv", value: 15 }), alert({ id: "oi", field: "oiChange", value: 500 })];
    const r = evaluateAlerts(a, rowsWith(10, 16, 600), "NIFTY", "2026-10-20", new Set());
    expect(r.hits.map((h) => h.alert.id).sort()).toEqual(["iv", "oi"]);
  });

  it("persists to mc_strike_alerts_v1 and drops malformed rows", () => {
    writeAlerts([alert()]);
    expect(readAlerts()).toHaveLength(1);
    localStorage.setItem(STRIKE_ALERTS_KEY, JSON.stringify([alert(), { id: 1 }]));
    expect(readAlerts()).toHaveLength(1);
    localStorage.setItem(STRIKE_ALERTS_KEY, "{");
    expect(readAlerts()).toEqual([]);
    expect(describeAlert(alert())).toContain("≥ ₹100");
  });
});

describe("column preferences", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to the Sensibull preset and recognises presets", () => {
    expect(readColumnPrefs().preset).toBe("sensibull");
    expect(matchPreset(presetColumns("greeks"))).toBe("greeks");
    expect(matchPreset(["ltp", "rho"])).toBe("custom");
  });
  it("normalises order and drops unknown ids", () => {
    expect(normaliseColumns(["ltp", "oi", "nope", "oi"])).toEqual(["oi", "ltp"]);
  });
  it("persists columns and range with safe fallbacks", () => {
    writeColumnPrefs({ preset: "custom", visible: ["ltp", "iv"] });
    expect(readColumnPrefs().visible).toEqual(["iv", "ltp"]);
    localStorage.setItem(COLUMNS_KEY, "garbage");
    expect(readColumnPrefs().preset).toBe("sensibull");
    writeRange(30);
    expect(readRange()).toBe(30);
    writeRange("all");
    expect(readRange()).toBe("all");
  });
});

describe("symbols", () => {
  it("includes SENSEX and BANKEX and drops delisted names", () => {
    const v = ALL_SYMBOLS.map((s) => s.value);
    expect(v).toContain("SENSEX");
    expect(v).toContain("BANKEX");
    expect(v).not.toContain("ADANITRANS");
    expect(v).not.toContain("ZOMATO");
    expect(new Set(v).size).toBe(v.length);
  });
  it("maps renamed tickers and filters", () => {
    expect(canonicalSymbol("zomato")).toBe("ETERNAL");
    expect(canonicalSymbol(null)).toBe("NIFTY");
    expect(filterSymbols("bank").some((c) => c.symbols.some((s) => s.value === "BANKNIFTY"))).toBe(true);
  });
});

describe("gamma badges", () => {
  it("maps levels to strikes and snaps the flip", () => {
    const m = gammaBadgeMap({ callWall: 25000, putWall: 24000, absGamma: 24500, flip: 24480 }, [24000, 24450, 24500, 25000]);
    expect(m.get(25000)).toEqual(["CW"]);
    expect(m.get(24000)).toEqual(["PW"]);
    expect(m.get(24500)).toEqual(["AG", "FLIP"]);
    expect(gammaBadgeMap(null, [1]).size).toBe(0);
  });
  it("never throws even if the GEX module is incomplete", () => {
    expect(() => safeGammaLevels([], 0, "", 0)).not.toThrow();
  });
});
