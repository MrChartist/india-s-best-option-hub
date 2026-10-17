import { describe, expect, it } from "vitest";
import { isTradingDay, isoWeekday } from "@/lib/options";
import {
  allMacroEvents,
  eventLinks,
  eventMatchesSymbol,
  expiryEvents,
  filterEvents,
  fiscalQuarterLabel,
  groupByDate,
  holidayEvents,
  isUsDst,
  lastWeekdayOfMonth,
  macroEvents,
  mergeEvents,
  monthGrid,
  monthRange,
  normaliseCalendarRows,
  reactionDate,
  resultsQuarterFor,
  sampleResultsEvents,
  shiftMonth,
  staticEvents,
  usEasternToIst,
  weekRange,
  weekdayOnOrAfter,
  type MarketEvent,
} from "@/lib/events";

describe("US Eastern → IST", () => {
  it("knows US daylight saving", () => {
    expect(isUsDst("2026-03-07")).toBe(false);
    expect(isUsDst("2026-03-08")).toBe(true); // second Sunday of March 2026
    expect(isUsDst("2026-10-31")).toBe(true);
    expect(isUsDst("2026-11-01")).toBe(false); // first Sunday of November 2026
  });

  it("maps FOMC and CPI clock times", () => {
    expect(usEasternToIst("2026-07-29", "14:00")).toEqual({ date: "2026-07-29", time: "23:30" });
    expect(usEasternToIst("2026-01-28", "14:00")).toEqual({ date: "2026-01-29", time: "00:30" });
    expect(usEasternToIst("2026-10-14", "08:30")).toEqual({ date: "2026-10-14", time: "18:00" });
    expect(usEasternToIst("2026-12-10", "08:30")).toEqual({ date: "2026-12-10", time: "19:00" });
    expect(usEasternToIst("bad", "08:30")).toBeNull();
  });
});

describe("date helpers", () => {
  it("rolls weekends forward and finds the last weekday", () => {
    expect(weekdayOnOrAfter("2026-12-12")).toBe("2026-12-14"); // Saturday → Monday
    expect(weekdayOnOrAfter("2026-10-12")).toBe("2026-10-12");
    expect(lastWeekdayOfMonth(2026, 2)).toBe("2026-02-27");
    expect(lastWeekdayOfMonth(2026, 5)).toBe("2026-05-29");
  });

  it("labels Indian fiscal quarters", () => {
    expect(fiscalQuarterLabel(2026, 9)).toBe("Q2 FY27");
    expect(fiscalQuarterLabel(2026, 12)).toBe("Q3 FY27");
    expect(fiscalQuarterLabel(2027, 3)).toBe("Q4 FY27");
    expect(resultsQuarterFor("2026-10-20")).toBe("Q2 FY27");
    expect(resultsQuarterFor("2027-01-15")).toBe("Q3 FY27");
    expect(resultsQuarterFor("2026-05-05")).toBe("Q4 FY26");
  });

  it("builds month ranges, grids and weeks", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(weekRange("2026-10-17")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(weekRange("2026-10-18")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    const grid = monthGrid("2026-10");
    expect(grid[0][0].date).toBe("2026-09-28");
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(31);
    expect(grid.flat().find((c) => c.date === "2026-10-02")?.trading).toBe(false);
  });
});

describe("static macro list", () => {
  it("is flagged verify, sorted and inside the coverage", () => {
    const all = allMacroEvents();
    expect(all.length).toBeGreaterThan(80);
    expect(all.every((e) => e.verify && e.source === "schedule")).toBe(true);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].date <= all[i].date).toBe(true);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  it("covers RBI, Budget, CPI, GDP, IIP, FOMC and US CPI", () => {
    const cats = new Set(macroEvents({ from: "2026-01-01", to: "2026-12-31" }).map((e) => e.category));
    for (const c of ["RBI MPC", "Union Budget", "CPI", "GDP", "IIP", "FOMC", "US CPI"]) expect(cats.has(c)).toBe(true);
    const rbi = macroEvents({ from: "2026-10-01", to: "2026-10-01" }).find((e) => e.category === "RBI MPC");
    expect(rbi?.time).toBe("10:00");
    // CPI never lands on a weekend
    for (const e of allMacroEvents().filter((x) => x.category === "CPI")) expect([0, 6]).not.toContain(isoWeekday(e.date));
  });
});

describe("holidays and expiries", () => {
  it("lists exchange holidays with names", () => {
    const h = holidayEvents({ from: "2026-10-01", to: "2026-10-31" });
    expect(h.map((e) => e.date)).toEqual(expect.arrayContaining(["2026-10-02", "2026-10-20"]));
    expect(h.find((e) => e.date === "2026-10-20")?.title).toContain("Dussehra");
    const p = holidayEvents({ from: "2027-01-01", to: "2027-01-31" });
    expect(p[0]?.provisional).toBe(true);
  });

  it("builds NSE monthly, NIFTY weekly and SENSEX expiries on trading days", () => {
    const ex = expiryEvents({ from: "2026-10-01", to: "2026-10-31" });
    const monthly = ex.find((e) => e.id.endsWith("nse-monthly"));
    expect(monthly?.date).toBe("2026-10-27");
    expect(monthly?.marketWide).toBe(true);
    expect(ex.filter((e) => e.id.endsWith("nifty-weekly")).length).toBeGreaterThanOrEqual(3);
    expect(ex.some((e) => e.symbol === "SENSEX")).toBe(true);
    for (const e of ex) expect(isTradingDay(e.date)).toBe(true);
    // the 20 Oct 2026 (Dussehra) NIFTY weekly shifts to Monday 19 Oct
    expect(ex.some((e) => e.date === "2026-10-19" && e.symbol === "NIFTY")).toBe(true);
  });

  it("returns nothing for an inverted range", () => {
    expect(staticEvents({ from: "2026-10-31", to: "2026-10-01" })).toEqual([]);
  });
});

describe("NSE event-calendar rows", () => {
  it("splits results from other corporate actions and de-duplicates", () => {
    const evs = normaliseCalendarRows([
      { symbol: "reliance", company: "Reliance Industries", purpose: "Financial Results", description: "To consider quarterly results", date: "2026-10-23" },
      { symbol: "RELIANCE", company: "Reliance Industries", purpose: "Financial Results/Dividend", description: "", date: "2026-10-23" },
      { symbol: "XYZSMALL", company: "XYZ", purpose: "Fund Raising", description: "", date: "2026-10-24" },
      { symbol: "", purpose: "Financial Results", date: "2026-10-24" },
      { symbol: "TCS", purpose: "Financial Results", date: "not-a-date" },
      null,
    ]);
    expect(evs).toHaveLength(2);
    const rel = evs.find((e) => e.symbol === "RELIANCE")!;
    expect(rel.kind).toBe("results");
    expect(rel.fno).toBe(true);
    expect(rel.title).toBe("RELIANCE Q2 FY27 results");
    expect(rel.detail).toContain("Dividend");
    expect(rel.source).toBe("nse");
    const small = evs.find((e) => e.symbol === "XYZSMALL")!;
    expect(small.kind).toBe("corporate");
    expect(small.fno).toBe(false);
    expect(normaliseCalendarRows("nope")).toEqual([]);
  });
});

describe("sample results season", () => {
  it("is deterministic, labelled and on weekdays", () => {
    const a = sampleResultsEvents({ from: "2026-10-01", to: "2026-11-30" });
    const b = sampleResultsEvents({ from: "2026-10-01", to: "2026-11-30" });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(30);
    expect(a.every((e) => e.source === "sample" && e.kind === "results" && e.detail?.includes("Sample"))).toBe(true);
    for (const e of a) expect([0, 6]).not.toContain(isoWeekday(e.date));
    expect(sampleResultsEvents({ from: "2026-06-01", to: "2026-06-30" })).toEqual([]);
  });
});

describe("merge, filter, group, link", () => {
  const ev = (p: Partial<MarketEvent>): MarketEvent => ({
    id: p.id ?? `${p.kind}:${p.date}:${p.symbol ?? "x"}`,
    date: "2026-10-20",
    kind: "results",
    category: "Results",
    title: "t",
    impact: "medium",
    region: "IN",
    source: "nse",
    ...p,
  });

  it("merges without duplicates in date/time order", () => {
    const a = ev({ id: "a", date: "2026-10-21" });
    const b = ev({ id: "b", date: "2026-10-20", time: "16:00" });
    const c = ev({ id: "c", date: "2026-10-20", time: "10:00" });
    const h = ev({ id: "h", date: "2026-10-20", kind: "holiday" });
    expect(mergeEvents([a, b], [c, a, h]).map((e) => e.id)).toEqual(["h", "c", "b", "a"]);
  });

  it("filters by kind, F&O, impact and symbol (keeping market-wide events)", () => {
    const list = [
      ev({ id: "r1", symbol: "TCS", fno: true, impact: "high" }),
      ev({ id: "r2", symbol: "SMALLCO", fno: false }),
      ev({ id: "m", kind: "india-macro", symbol: "NIFTY", marketWide: true, impact: "high" }),
      ev({ id: "w", kind: "expiry", symbol: "NIFTY" }),
    ];
    expect(filterEvents(list, { fnoOnly: true }).map((e) => e.id)).toEqual(["r1", "m", "w"]);
    expect(filterEvents(list, { kinds: ["results"] }).map((e) => e.id)).toEqual(["r1", "r2"]);
    expect(filterEvents(list, { symbol: "tcs" }).map((e) => e.id)).toEqual(["r1", "m"]);
    expect(filterEvents(list, { highImpactOnly: true }).map((e) => e.id)).toEqual(["r1", "m"]);
    expect(eventMatchesSymbol(ev({ symbol: "NIFTY", symbols: ["NIFTY", "BANKNIFTY"] }), "BANKNIFTY")).toBe(true);
  });

  it("groups by date", () => {
    const g = groupByDate([ev({ id: "x", date: "2026-10-21" }), ev({ id: "y" }), ev({ id: "z" })]);
    expect(g.map((d) => [d.date, d.events.length])).toEqual([
      ["2026-10-20", 2],
      ["2026-10-21", 1],
    ]);
  });

  it("finds the reaction session and deep links", () => {
    expect(reactionDate({ date: "2026-10-19", time: "10:00", kind: "india-macro" })).toBe("2026-10-19");
    expect(reactionDate({ date: "2026-10-19", time: "16:00", kind: "india-macro" })).toBe("2026-10-21"); // 20 Oct is a holiday
    expect(reactionDate({ date: "2026-10-17", kind: "results" })).toBe("2026-10-19");
    const links = eventLinks(ev({ symbol: "RELIANCE", fno: true, date: "2026-10-23" }), "2026-10-17");
    expect(links.map((l) => l.label)).toEqual(["Chain", "Straddles"]);
    expect(links[0].href).toBe("/option-chain?symbol=RELIANCE&expiry=2026-10-27");
    expect(links[1].href).toContain("view=daily");
    expect(eventLinks(ev({ symbol: "SMALLCO", fno: false }), "2026-10-17")).toEqual([]);
    expect(eventLinks(ev({ symbol: "RELIANCE", fno: true, date: "2026-07-20" }), "2026-10-17")).toEqual([]);
    const exp = eventLinks(ev({ kind: "expiry", symbol: "NIFTY", date: "2026-10-27" }), "2026-10-17");
    expect(exp.map((l) => l.label)).toContain("Expiry day");
  });
});
