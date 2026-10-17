import { describe, expect, it } from "vitest";
import {
  DASH_LAYOUT_KEY,
  DEFAULT_LAYOUT,
  SECTION_IDS,
  buildIndexExpiryRows,
  buildMcxExpiryRows,
  daysBetweenIso,
  direction,
  loadLayout,
  moveSection,
  rangePosition,
  sanitizeLayout,
  saveLayout,
  sentimentScore,
  sourceName,
  statusFrom,
  setSectionVisible,
  visibleSections,
  vixRegime,
  weekdayOnOrBefore,
  weekdaysBeforeMonthEnd,
} from "./dashboardModel";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

class ThrowingStorage extends MemoryStorage {
  getItem(): string | null { throw new Error("blocked"); }
  setItem(): void { throw new Error("blocked"); }
}

// 17 Oct 2026, 10:00 IST (a Saturday)
const SAT = new Date("2026-10-17T04:30:00Z");
// 27 Oct 2026, 11:00 IST (a Tuesday, NIFTY weekly expiry day)
const TUE = new Date("2026-10-27T05:30:00Z");

describe("layout", () => {
  it("sanitises junk into the default layout", () => {
    expect(sanitizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout("x")).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout({ order: ["nope", 3], hidden: "all", density: "huge" })).toEqual(DEFAULT_LAYOUT);
  });

  it("keeps a saved order, drops duplicates and appends new sections", () => {
    const l = sanitizeLayout({ order: ["breadth", "indices", "breadth"], hidden: ["sectors", "bogus"], density: "compact" });
    expect(l.order.slice(0, 2)).toEqual(["breadth", "indices"]);
    expect(l.order).toHaveLength(SECTION_IDS.length);
    expect(new Set(l.order).size).toBe(SECTION_IDS.length);
    expect(l.hidden).toEqual(["sectors"]);
    expect(l.density).toBe("compact");
  });

  it("moves and hides sections", () => {
    const moved = moveSection(DEFAULT_LAYOUT, "metrics", -1);
    expect(moved.order[0]).toBe("metrics");
    expect(moveSection(DEFAULT_LAYOUT, "indices", -1)).toBe(DEFAULT_LAYOUT);
    const hidden = setSectionVisible(DEFAULT_LAYOUT, "indices", false);
    expect(visibleSections(hidden)).not.toContain("indices");
    expect(visibleSections(setSectionVisible(hidden, "indices", true))).toContain("indices");
  });

  it("round-trips through storage and survives blocked storage", () => {
    const s = new MemoryStorage();
    const l = { ...DEFAULT_LAYOUT, density: "compact" as const, hidden: ["breadth" as const] };
    saveLayout(l, s);
    expect(JSON.parse(s.getItem(DASH_LAYOUT_KEY) as string).density).toBe("compact");
    expect(loadLayout(s)).toEqual(l);
    s.setItem(DASH_LAYOUT_KEY, "{not json");
    expect(loadLayout(s)).toEqual(DEFAULT_LAYOUT);
    const t = new ThrowingStorage();
    expect(() => saveLayout(l, t)).not.toThrow();
    expect(loadLayout(t)).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout(null)).toEqual(DEFAULT_LAYOUT);
  });
});

describe("index expiries", () => {
  it("uses Tuesday weekly for NIFTY, Thursday for SENSEX and monthly for BANKNIFTY", () => {
    const rows = buildIndexExpiryRows(SAT);
    const by = Object.fromEntries(rows.map((r) => [r.symbol, r]));
    // Tuesday 20 Oct 2026 is an exchange holiday, so the weekly shifts back to Monday 19 Oct.
    expect(by.NIFTY.date).toBe("2026-10-19");
    expect(by.NIFTY.type).toBe("weekly");
    expect(by.NIFTY.exchange).toBe("NSE");
    expect(by.SENSEX.exchange).toBe("BSE");
    expect(by.BANKNIFTY.type).toBe("monthly");
    expect(by.BANKNIFTY.date >= by.NIFTY.date).toBe(true);
    expect(by.NIFTY.basis).toBe("derived");
    expect(by.NIFTY.lotSize).toBeGreaterThan(0);
  });

  it("prefers a live nearest expiry in any common format", () => {
    const rows = buildIndexExpiryRows(SAT, { NIFTY: "20-Oct-2026" }, ["NIFTY"]);
    expect(rows[0]).toMatchObject({ date: "2026-10-20", basis: "live" });
  });

  it("ignores a live expiry that is already past", () => {
    const rows = buildIndexExpiryRows(SAT, { NIFTY: "2026-10-13" }, ["NIFTY"]);
    expect(rows[0].basis).toBe("derived");
    expect(rows[0].date > "2026-10-17").toBe(true);
  });

  it("flags expiry day as urgent", () => {
    const rows = buildIndexExpiryRows(TUE, {}, ["NIFTY"]);
    expect(rows[0].date).toBe("2026-10-27");
    expect(rows[0].dte.startsWith("Expiry today")).toBe(true);
    expect(rows[0].urgent).toBe(true);
  });
});

describe("MCX helpers", () => {
  it("rolls weekends back to Friday without timezone drift", () => {
    expect(weekdayOnOrBefore(2026, 7, 19)).toBe("2026-07-17"); // 19 Jul 2026 is a Sunday
    expect(weekdayOnOrBefore(2026, 10, 19)).toBe("2026-10-19"); // Monday stays
    expect(weekdayOnOrBefore(2026, 2, 31)).toBe("2026-02-27"); // clamps to month end, then rolls back
  });

  it("counts weekdays before month end", () => {
    // Oct 2026 ends on Saturday 31st → last weekday Fri 30th → 3 weekdays earlier is Tue 27th
    expect(weekdaysBeforeMonthEnd(2026, 10, 3)).toBe("2026-10-27");
  });

  it("returns the next approximate expiry per commodity", () => {
    const rows = buildMcxExpiryRows(SAT);
    const by = Object.fromEntries(rows.map((r) => [r.symbol, r]));
    expect(by.CRUDEOIL.date).toBe("2026-10-19");
    expect(by.CRUDEOIL.dte).toBe("2 days");
    expect(by.NATURALGAS.date).toBe("2026-10-27");
    expect(by.GOLD.date).toBe("2026-12-04"); // 5 Dec 2026 is a Saturday
    expect(by.SILVER.date).toBe("2026-12-04");
    expect(daysBetweenIso("2026-10-17", "2026-10-19")).toBe(2);
  });
});

describe("signals", () => {
  it("classifies VIX regimes, including the >25 band", () => {
    expect(vixRegime(null)).toBeNull();
    expect(vixRegime(0)).toBeNull();
    expect(vixRegime(11)?.label).toBe("Very low");
    expect(vixRegime(13.5)?.label).toBe("Low");
    expect(vixRegime(17)?.label).toBe("Normal");
    expect(vixRegime(22)?.label).toBe("Elevated");
    expect(vixRegime(30)?.label).toBe("High");
  });

  it("reports direction with a dead band", () => {
    expect(direction(1.1, 1.0)).toBe("up");
    expect(direction(0.9, 1.0)).toBe("down");
    expect(direction(1.005, 1.0)).toBe("flat");
    expect(direction(1, null)).toBeNull();
    expect(direction(NaN, 1)).toBeNull();
  });

  it("clamps range positions", () => {
    expect(rangePosition(5, 0, 10)).toBe(50);
    expect(rangePosition(15, 0, 10)).toBe(100);
    expect(rangePosition(5, 5, 5)).toBe(50);
  });

  it("scores breadth within 0-100 and penalises very high VIX more", () => {
    const base = { advances: 30, declines: 20, unchanged: 0, stocksUp: 0, stocksDown: 0, totalStocks: 0 };
    const high = sentimentScore({ ...base, vix: 30 });
    const elevated = sentimentScore({ ...base, vix: 22 });
    expect(high).toBeLessThan(elevated);
    expect(sentimentScore({ ...base, advances: 1000, declines: 0, vix: 10, stocksUp: 100, totalStocks: 100 })).toBeLessThanOrEqual(100);
  });
});

describe("statusFrom", () => {
  it("maps hook state to widget status", () => {
    expect(statusFrom({ isLoading: true, hasData: false })).toBe("loading");
    expect(statusFrom({ isError: true, hasData: false })).toBe("error");
    expect(statusFrom({ hasData: false })).toBe("empty");
    expect(statusFrom({ hasData: true, source: "sample", isLive: true })).toBe("sample");
    expect(statusFrom({ hasData: true, source: "database" })).toBe("stale");
    expect(statusFrom({ hasData: true, source: "nse", stale: true })).toBe("stale");
    expect(statusFrom({ hasData: true, source: "nse", isLive: true, sessionOpen: true })).toBe("live");
    expect(statusFrom({ hasData: true, source: "nse", isLive: false, sessionOpen: true })).toBe("delayed");
    expect(statusFrom({ hasData: true, source: "nse", isLive: true, sessionOpen: false })).toBe("closed");
    // keeps showing data while a refetch is loading
    expect(statusFrom({ isLoading: true, hasData: true, source: "nse", isLive: true, sessionOpen: true })).toBe("live");
  });

  it("names sources", () => {
    expect(sourceName("nse")).toBe("NSE");
    expect(sourceName("database")).toBe("Local DB");
    expect(sourceName("xyz")).toBe("XYZ");
    expect(sourceName(undefined)).toBeUndefined();
  });
});
