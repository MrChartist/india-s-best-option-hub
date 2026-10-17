import { describe, expect, it } from "vitest";
import { banCalendar, banOutlook, banSince, mergeBanHistory, nearBanList, parseBanPayload, parseMwplPayload } from "../ban";

describe("payload parsing", () => {
  it("ban list", () => {
    expect(parseBanPayload(null)).toBeNull();
    expect(parseBanPayload({ date: "2026-10-17", symbols: ["SAIL", "ZOMATO", "SAIL", 3] })).toEqual({ date: "2026-10-17", symbols: ["ETERNAL", "SAIL"] });
  });
  it("mwpl", () => {
    const rows = parseMwplPayload([{ symbol: "A", mwplPct: 50 }, { symbol: "B", mwplPct: 90, oi: 9 }, { symbol: "A", mwplPct: 99 }, { bad: 1 }]);
    expect(rows.map((r) => r.symbol)).toEqual(["B", "A"]);
    expect(rows[0].oi).toBe(9);
    expect(parseMwplPayload("x")).toEqual([]);
  });
});

describe("near ban and outlook", () => {
  it("nearBanList excludes banned names", () => {
    expect(nearBanList([{ symbol: "A", mwplPct: 96 }, { symbol: "B", mwplPct: 81 }, { symbol: "C", mwplPct: 70 }], ["A"])).toEqual([{ symbol: "B", mwplPct: 81 }]);
  });
  it("outlook follows NSE thresholds", () => {
    expect(banOutlook(75, true).tone).toBe("bullish");
    expect(banOutlook(90, true).tone).toBe("bearish");
    expect(banOutlook(96, false).label).toMatch(/95%/);
    expect(banOutlook(86, false).tone).toBe("warning");
    expect(banOutlook(81, false).tone).toBe("warning");
    expect(banOutlook(50, false).tone).toBe("neutral");
    expect(banOutlook(null, false).label).toMatch(/not available/);
  });
});

describe("history", () => {
  const h = [
    { date: "2026-10-14", symbols: ["A"] },
    { date: "2026-10-15", symbols: ["A", "B"] },
    { date: "2026-10-16", symbols: ["B"] },
  ];
  it("merges, replaces and trims", () => {
    const m = mergeBanHistory(h, { date: "2026-10-15", symbols: ["C"] }, 2);
    expect(m).toEqual([{ date: "2026-10-15", symbols: ["C"] }, { date: "2026-10-16", symbols: ["B"] }]);
    expect(mergeBanHistory(h, { date: "", symbols: [] })).toHaveLength(3);
  });
  it("banSince finds the current run", () => {
    expect(banSince("B", h)).toBe("2026-10-15");
    expect(banSince("A", h)).toBeNull();
    expect(banSince("A", [])).toBeNull();
  });
  it("calendar entries and exits", () => {
    const c = banCalendar(h);
    expect(c[1]).toMatchObject({ entered: ["B"], exited: [] });
    expect(c[2]).toMatchObject({ entered: [], exited: ["A"] });
    expect(banCalendar(h, 1)).toHaveLength(1);
  });
});
