import { describe, expect, it } from "vitest";
import { applyFilters, matchesRule, rowsToCSV, sortRows, EMPTY_FILTERS, type FilterRule } from "../filters";
import { presetCounts, PRESETS, getPreset, presetRules } from "../presets";
import { sampleRows } from "../sample";
import type { ScreenerRow } from "../metrics";

const rows = sampleRows(1);
const pick = (r: Partial<ScreenerRow>): ScreenerRow => ({ ...rows[10], ...r });

describe("matchesRule", () => {
  it("numeric ops and nulls", () => {
    const r = pick({ atmIv: 30 });
    const rule = (op: "gt" | "gte" | "lt" | "lte" | "between", value: number, value2?: number): FilterRule => ({ id: "x", kind: "number", field: "atmIv", op, value, value2 });
    expect(matchesRule(r, rule("gt", 29))).toBe(true);
    expect(matchesRule(r, rule("gt", 30))).toBe(false);
    expect(matchesRule(r, rule("gte", 30))).toBe(true);
    expect(matchesRule(r, rule("lt", 31))).toBe(true);
    expect(matchesRule(r, rule("lte", 29))).toBe(false);
    expect(matchesRule(r, rule("between", 35, 25))).toBe(true);
    expect(matchesRule(pick({ atmIv: null }), rule("gt", 0))).toBe(false);
  });
  it("categorical rules", () => {
    expect(matchesRule(pick({ buildup: "SHORT_BUILDUP" }), { id: "b", kind: "buildup", values: ["SHORT_BUILDUP"] })).toBe(true);
    expect(matchesRule(pick({ buildup: "LONG_BUILDUP" }), { id: "b", kind: "buildup", values: ["SHORT_BUILDUP"] })).toBe(false);
    expect(matchesRule(pick({ banned: true }), { id: "c", kind: "banned", value: true })).toBe(true);
    expect(matchesRule(pick({ kind: "INDEX" }), { id: "d", kind: "instrument", value: "STOCK" })).toBe(false);
  });
});

describe("applyFilters", () => {
  it("search and sectors", () => {
    expect(applyFilters(rows, EMPTY_FILTERS)).toHaveLength(rows.length);
    const banks = applyFilters(rows, { search: "", sectors: ["Banks"], rules: [] });
    expect(banks.length).toBeGreaterThan(5);
    expect(banks.every((r) => r.sector === "Banks")).toBe(true);
    expect(applyFilters(rows, { search: "reli", sectors: [], rules: [] }).map((r) => r.symbol)).toContain("RELIANCE");
  });
});

describe("sortRows", () => {
  it("sorts with nulls last in both directions and is stable", () => {
    const data = [pick({ symbol: "A", pcrOi: 1 }), pick({ symbol: "B", pcrOi: null }), pick({ symbol: "C", pcrOi: 0.5 }), pick({ symbol: "D", pcrOi: 1 })];
    expect(sortRows(data, "pcrOi", "asc").map((r) => r.symbol)).toEqual(["C", "A", "D", "B"]);
    expect(sortRows(data, "pcrOi", "desc").map((r) => r.symbol)).toEqual(["A", "D", "C", "B"]);
    expect(sortRows(data, "symbol", "desc").map((r) => r.symbol)).toEqual(["D", "C", "B", "A"]);
  });
});

describe("CSV", () => {
  it("escapes and labels sample rows", () => {
    const csv = rowsToCSV([pick({ symbol: "M&M", sector: 'Auto, "4W"', atmIv: null })]);
    const [header, line] = csv.split("\n");
    expect(header.startsWith("symbol,type,sector")).toBe(true);
    expect(line).toContain('"Auto, ""4W"""');
    expect(line.endsWith(",sample")).toBe(true);
  });
});

describe("presets", () => {
  it("all eight presets exist and count matches filtering", () => {
    expect(PRESETS).toHaveLength(8);
    const counts = presetCounts(rows);
    for (const p of PRESETS) {
      expect(counts[p.id]).toBe(applyFilters(rows, { search: "", sectors: [], rules: p.rules }).length);
    }
    expect(counts["near-ban"]).toBeGreaterThan(0);
  });
  it("presetRules copies rules", () => {
    const p = getPreset("volume-spike");
    expect(p).toBeDefined();
    const copy = presetRules(p!);
    expect(copy[0]).not.toBe(p!.rules[0]);
    expect(getPreset("nope")).toBeUndefined();
  });
});
