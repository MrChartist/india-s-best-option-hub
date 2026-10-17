import { describe, expect, it } from "vitest";
import {
  buildFuturesView,
  buildViews,
  comparableDates,
  compareRollover,
  dateAtTradingDte,
  futuresDayFromBhav,
  historyDatesFor,
  monthlyExpiriesBetween,
  oiPriceSeries,
  previousMonthlyExpiries,
  rollCost,
  rollTracker,
  rolloverRead,
  tdteLabel,
  type FuturesDay,
} from "../model";
import { sampleFuturesHistory, sampleSpot, tradingDaysBack } from "../sample";
import { decodeDay, encodeDay, loadDays, saveDays, storedDates, MAX_DAYS_PER_SYMBOL, type KVStorage } from "../store";
import { isOfflineReason, latestBhavDate, sampleOverview, isBseSymbol } from "../api";
import { tradingDaysBetween } from "@/lib/options";
import type { BhavRow } from "@/lib/screener/metrics";

const bhav = (p: Partial<BhavRow>): BhavRow => ({
  symbol: "NIFTY",
  expiry: "2026-10-27",
  strike: 0,
  type: "FUT",
  close: 0,
  settle: 0,
  oi: 0,
  chgOi: 0,
  volume: 0,
  underlyingClose: 25000,
  ...p,
});

function memStorage(): KVStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("futuresDayFromBhav", () => {
  it("keeps futures rows only, nearest three first, and falls back to the settlement price", () => {
    const day = futuresDayFromBhav("NIFTY", "2026-10-16", [
      bhav({ expiry: "2026-12-29", close: 25350, oi: 5000 }),
      bhav({ expiry: "2026-10-27", close: 25080, oi: 90000, chgOi: 3000 }),
      bhav({ expiry: "2026-11-24", close: 0, settle: 25210, oi: 20000 }),
      bhav({ expiry: "2027-01-26", close: 25500, oi: 100 }),
      bhav({ type: "CE", strike: 25000, close: 120, oi: 1e6 }),
    ]);
    expect(day.contracts.map((c) => c.expiry)).toEqual(["2026-10-27", "2026-11-24", "2026-12-29"]);
    expect(day.contracts[1].price).toBe(25210);
    expect(day.underlying).toBe(25000);
  });
});

describe("buildFuturesView", () => {
  const prev: FuturesDay = {
    symbol: "NIFTY",
    date: "2026-10-15",
    underlying: 24900,
    contracts: [
      { expiry: "2026-10-27", price: 24950, oi: 87000, chgOi: 0, volume: 0 },
      { expiry: "2026-11-24", price: 25100, oi: 18000, chgOi: 0, volume: 0 },
    ],
  };
  const day: FuturesDay = {
    symbol: "NIFTY",
    date: "2026-10-16",
    underlying: 25000,
    contracts: [
      { expiry: "2026-10-27", price: 25080, oi: 90000, chgOi: 3000, volume: 1 },
      { expiry: "2026-11-24", price: 25230, oi: 20000, chgOi: 2000, volume: 1 },
      { expiry: "2026-12-29", price: 25390, oi: 5000, chgOi: 500, volume: 1 },
    ],
  };
  const v = buildFuturesView(day, prev);

  it("computes basis, simple annualised carry and per-series buildup", () => {
    const near = v.series[0];
    expect(near.label).toBe("Near");
    expect(near.basis).toBe(80);
    expect(near.basisPct).toBeCloseTo(0.32, 3);
    expect(near.dte).toBe(11);
    // (25080/25000 − 1) × 365/11 × 100 = 10.62%
    expect(near.carryPct).toBeCloseTo(10.62, 2);
    expect(near.priceChg).toBe(130);
    expect(near.oiChgPct).toBeCloseTo((3000 / 87000) * 100, 2);
    expect(near.buildup).toBe("LONG_BUILDUP");
    // Far series has no previous price: buildup is unknown, not guessed.
    expect(v.series[2].buildup).toBeNull();
  });

  it("computes rollover, total OI change and roll cost", () => {
    expect(v.totalOi).toBe(115000);
    expect(v.rolloverPct).toBeCloseTo((25000 / 115000) * 100, 1);
    expect(v.totalOiChgPct).toBeCloseTo((5500 / 109500) * 100, 2);
    // 150 points over 28 days between expiries: 0.598% → 7.80% a year.
    expect(v.rollCost?.points).toBe(150);
    expect(v.rollCost?.pct).toBeCloseTo(0.598, 3);
    expect(v.rollCost?.annualisedPct).toBeCloseTo(7.8, 1);
    expect(v.tradingDte).toBe(tradingDaysBetween("2026-10-16", "2026-10-27"));
  });

  it("derives a fair value from the futures basis maths", () => {
    expect(v.fair).not.toBeNull();
    expect(v.fair!.fair).toBeGreaterThan(25000);
    expect(v.fair!.mispricing).toBeCloseTo(25080 - v.fair!.fair, 2);
  });

  it("handles missing prices and a single series", () => {
    const lone = buildFuturesView({
      symbol: "X",
      date: "2026-10-16",
      underlying: null,
      contracts: [{ expiry: "2026-10-27", price: null, oi: 10, chgOi: 10, volume: 0 }],
    });
    expect(lone.rollCost).toBeNull();
    expect(lone.series[0].basis).toBeNull();
    expect(lone.series[0].oiChgPct).toBeNull();
    expect(lone.rolloverPct).toBe(0);
    expect(lone.fair).toBeNull();
  });
});

describe("rollCost", () => {
  it("rejects bad inputs", () => {
    expect(rollCost(null, 100, "2026-10-27", "2026-11-24")).toBeNull();
    expect(rollCost(100, 101, "2026-11-24", "2026-10-27")).toBeNull();
    expect(rollCost(100, 99, "2026-10-27", "2026-11-24")?.points).toBe(-1);
  });
});

describe("expiry cycles", () => {
  it("lists monthly expiries in a range (holiday shifted)", () => {
    expect(monthlyExpiriesBetween("NIFTY", "2026-09-01", "2026-12-31")).toEqual([
      "2026-09-29",
      "2026-10-27",
      "2026-11-23",
      "2026-12-29",
    ]);
    expect(monthlyExpiriesBetween("NIFTY", "2026-12-31", "2026-01-01")).toEqual([]);
  });

  it("finds the previous monthly expiries and the comparable day in each", () => {
    expect(previousMonthlyExpiries("RELIANCE", "2026-10-27", 3)).toEqual(["2026-09-29", "2026-08-25", "2026-07-28"]);
    const comps = comparableDates("RELIANCE", "2026-10-16", "2026-10-27", 3);
    const tdte = tradingDaysBetween("2026-10-16", "2026-10-27");
    expect(comps).toHaveLength(3);
    for (const c of comps) expect(tradingDaysBetween(c.date, c.expiry)).toBe(tdte);
  });

  it("dateAtTradingDte counts trading days back from expiry", () => {
    expect(dateAtTradingDte("2026-10-27", 0)).toBe("2026-10-27");
    expect(dateAtTradingDte("2026-10-27", 1)).toBe("2026-10-26");
    expect(dateAtTradingDte("2026-10-27", 2)).toBe("2026-10-23");
    expect(tdteLabel(0)).toBe("Expiry");
    expect(tdteLabel(3)).toBe("T-3");
  });

  it("historyDatesFor returns unique trading dates up to the latest, newest first", () => {
    const dates = historyDatesFor("NIFTY", "2026-10-16", "2026-10-27");
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates[0]).toBe("2026-10-16");
    expect(dates.every((d) => d <= "2026-10-16")).toBe(true);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(dates).toContain("2026-09-29");
    expect(dates.length).toBeGreaterThanOrEqual(15);
  });
});

describe("compareRollover and rolloverRead", () => {
  const mk = (roll: number, cost: number) =>
    ({ rolloverPct: roll, rollCost: { points: 1, pct: 1, annualisedPct: cost } }) as never;
  it("averages the prior cycles that have data", () => {
    const c = compareRollover(mk(60, 8), [mk(50, 7), mk(54, 7.5), null]);
    expect(c.average).toBe(52);
    expect(c.diff).toBe(8);
    expect(c.rollCostAvgAnn).toBe(7.25);
    expect(c.rollCostDiff).toBe(0.75);
    expect(c.cycles).toBe(2);
    expect(rolloverRead(c)).toMatch(/ahead of the 2-expiry average of 52\.0%/);
    expect(rolloverRead(c)).toMatch(/costing more than usual/);
  });
  it("explains what is missing", () => {
    expect(rolloverRead(compareRollover(null, []))).toMatch(/not available/);
    expect(rolloverRead(compareRollover(mk(40, 6), []))).toMatch(/Load history/);
  });
});

describe("sample history", () => {
  const h = sampleFuturesHistory("NIFTY", "2026-10-16", 90);

  it("is deterministic, ends at the sample spot and has up to three series", () => {
    expect(sampleFuturesHistory("NIFTY", "2026-10-16", 90)).toEqual(h);
    expect(h).toHaveLength(90);
    expect(h[h.length - 1].date).toBe("2026-10-16");
    expect(h[h.length - 1].underlying).toBe(sampleSpot("NIFTY"));
    expect(h.every((d) => d.contracts.length === 3)).toBe(true);
    expect(tradingDaysBack("2026-10-18", 2)).toEqual(["2026-10-15", "2026-10-16"]);
  });

  it("rolls OI into the next month towards expiry", () => {
    const views = buildViews(h);
    const track = rollTracker("NIFTY", "2026-10-27", views);
    expect(track).toHaveLength(6);
    expect(track[0].label).toBe("T-5");
    expect(track[track.length - 1].label).toBe("Expiry");
    // Prior cycles: rollover climbs through the roll window.
    expect(track[track.length - 1].average!).toBeGreaterThan(track[0].average!);
    expect(track[track.length - 1].average!).toBeGreaterThan(60);
    // The current cycle has not reached its roll window on 16 Oct.
    expect(track.every((p) => p.current === null)).toBe(true);
    const latest = views[views.length - 1];
    expect(latest.rolloverPct!).toBeLessThan(40);
    // Contango: next trades above near.
    expect(latest.rollCost!.points).toBeGreaterThan(0);
  });

  it("feeds the OI vs price series", () => {
    const pts = oiPriceSeries(buildViews(h), 20);
    expect(pts).toHaveLength(20);
    expect(pts[0].total).toBe(pts[0].near + pts[0].next + pts[0].far);
  });

  it("sampleOverview matches the detail history for the same day", () => {
    const o = sampleOverview(["NIFTY"], "2026-10-16");
    const detail = sampleFuturesHistory("NIFTY", "2026-10-16");
    expect(o.snapshots[0].latest).toEqual(detail[detail.length - 1]);
    expect(o.snapshots[0].prev).toEqual(detail[detail.length - 2]);
  });

  it("sampleOverview labels every snapshot as sample", () => {
    const o = sampleOverview(["NIFTY", "RELIANCE"], "2026-10-16");
    expect(o.mode).toBe("sample");
    expect(o.snapshots.every((s) => s.source === "sample" && s.latest && s.prev)).toBe(true);
  });
});

describe("store", () => {
  const day: FuturesDay = {
    symbol: "NIFTY",
    date: "2026-10-16",
    underlying: 25000,
    contracts: [{ expiry: "2026-10-27", price: 25080, oi: 90000, chgOi: 3000, volume: 12 }],
  };

  it("round-trips a day", () => {
    expect(decodeDay("NIFTY", "2026-10-16", encodeDay(day))).toEqual(day);
    expect(decodeDay("NIFTY", "bad", encodeDay(day))).toBeNull();
    expect(decodeDay("NIFTY", "2026-10-16", { c: [["x", 1, 1, 1, 1]] })).toBeNull();
  });

  it("merges, sorts and trims per symbol", () => {
    const s = memStorage();
    saveDays([day, { ...day, date: "2026-10-15" }], s);
    expect(loadDays("NIFTY", s).map((d) => d.date)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(storedDates("NIFTY", s).has("2026-10-15")).toBe(true);
    const many = tradingDaysBack("2026-10-16", MAX_DAYS_PER_SYMBOL + 5).map((date) => ({ ...day, date }));
    saveDays(many, s);
    expect(loadDays("NIFTY", s)).toHaveLength(MAX_DAYS_PER_SYMBOL);
    expect(loadDays("BANKNIFTY", s)).toEqual([]);
  });

  it("survives corrupt storage", () => {
    const s = memStorage();
    s.data.set("mc_futures_days_v1", "{not json");
    expect(loadDays("NIFTY", s)).toEqual([]);
    saveDays([day], s);
    expect(loadDays("NIFTY", s)).toHaveLength(1);
  });
});

describe("api helpers", () => {
  it("classifies offline reasons and BSE symbols", () => {
    expect(isOfflineReason("proxy-offline")).toBe(true);
    expect(isOfflineReason("http-404")).toBe(false);
    expect(isBseSymbol("SENSEX")).toBe(true);
    expect(isBseSymbol("NIFTY")).toBe(false);
  });
  it("latestBhavDate waits for the evening file", () => {
    expect(latestBhavDate(new Date("2026-10-16T08:00:00Z"))).toBe("2026-10-15"); // 13:30 IST Fri
    expect(latestBhavDate(new Date("2026-10-16T14:00:00Z"))).toBe("2026-10-16"); // 19:30 IST Fri
    expect(latestBhavDate(new Date("2026-10-18T08:00:00Z"))).toBe("2026-10-16"); // Sunday
  });
});
