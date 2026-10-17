import { describe, expect, it } from "vitest";
import {
  buildHistorySeries,
  classifyLongPct,
  clearingImbalance,
  cumulativeCash,
  deriveFiiStats,
  deriveParticipantView,
  deriveParticipantViews,
  indexDirection,
  isAwaitingPublication,
  lastTradingDays,
  latestExpectedDate,
  loadStoredCash,
  loadStoredRows,
  longPercent,
  longShortRatio,
  mergeByDate,
  monthlyCashTotals,
  parseCashFlows,
  pearson,
  percentileRank,
  productChange,
  productStats,
  publishState,
  sampleCashFlows,
  sampleParticipantHistory,
  sampleParticipantVolume,
  sanitizeRows,
  saveCash,
  saveRows,
  sma,
  type KVStorage,
  type ParticipantOIRow,
} from "@/lib/participantsApi";

function row(participant: ParticipantOIRow["participant"], date: string, v: Partial<ParticipantOIRow> = {}): ParticipantOIRow {
  return {
    date,
    participant,
    futIdxLong: 0,
    futIdxShort: 0,
    futStkLong: 0,
    futStkShort: 0,
    optIdxCallLong: 0,
    optIdxCallShort: 0,
    optIdxPutLong: 0,
    optIdxPutShort: 0,
    ...v,
  };
}

function memoryStorage(): KVStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** IST wall-clock time → Date (IST = UTC+05:30). */
function ist(date: string, hh: number, mm = 0): Date {
  return new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`);
}

describe("long % and long/short ratio", () => {
  it("computes long % of the book", () => {
    expect(longPercent(25, 75)).toBeCloseTo(25, 10);
    expect(longPercent(1, 0)).toBe(100);
    expect(longPercent(0, 10)).toBe(0);
  });
  it("returns NaN with no position and ignores negatives", () => {
    expect(longPercent(0, 0)).toBeNaN();
    expect(longPercent(-5, 10)).toBe(0);
  });
  it("computes long/short ratio with infinity and NaN edges", () => {
    expect(longShortRatio(50, 100)).toBe(0.5);
    expect(longShortRatio(10, 0)).toBe(Infinity);
    expect(longShortRatio(0, 0)).toBeNaN();
  });
});

describe("productStats / productChange", () => {
  const today = row("FII", "2026-10-16", { futIdxLong: 60_000, futIdxShort: 180_000, optIdxCallLong: 900, optIdxCallShort: 400 });
  const prev = row("FII", "2026-10-15", { futIdxLong: 50_000, futIdxShort: 200_000 });

  it("derives net, gross, long % and ratio per product", () => {
    const s = productStats(today, "futIdx");
    expect(s).toMatchObject({ long: 60_000, short: 180_000, net: -120_000, gross: 240_000 });
    expect(s.longPct).toBeCloseTo(25, 10);
    expect(s.lsRatio).toBeCloseTo(1 / 3, 10);
    expect(productStats(today, "optIdxCall").net).toBe(500);
  });

  it("computes day-over-day change including long % in points", () => {
    const ch = productChange(productStats(today, "futIdx"), productStats(prev, "futIdx"));
    expect(ch).not.toBeNull();
    expect(ch?.long).toBe(10_000);
    expect(ch?.short).toBe(-20_000);
    expect(ch?.net).toBe(30_000);
    expect(ch?.longPct).toBeCloseTo(25 - 20, 10);
    expect(productChange(productStats(today, "futIdx"), null)).toBeNull();
  });

  it("gives NaN long % change when the previous book was empty", () => {
    const ch = productChange(productStats(today, "futStk"), productStats(prev, "futStk"));
    expect(ch?.longPct).toBeNaN();
  });
});

describe("index direction and participant views", () => {
  it("adds net futures and net calls, subtracts net puts", () => {
    const r = row("Pro", "2026-10-16", { futIdxLong: 100, futIdxShort: 40, optIdxCallLong: 30, optIdxCallShort: 10, optIdxPutLong: 5, optIdxPutShort: 25 });
    // 60 + 20 − (−20) = 100
    expect(indexDirection(r)).toBe(100);
  });

  it("builds views with changes and keeps participant order", () => {
    const today = [row("Client", "d2", { futIdxLong: 10 }), row("FII", "d2", { futIdxLong: 30, futIdxShort: 10 })];
    const prev = [row("FII", "d1", { futIdxLong: 20, futIdxShort: 10 })];
    const views = deriveParticipantViews(today, prev);
    expect(views.map((v) => v.participant)).toEqual(["FII", "Client"]);
    expect(views[0].products.futIdx.change?.net).toBe(10);
    expect(views[0].indexDirectionChange).toBe(10);
    expect(views[1].products.futIdx.change).toBeNull();
    expect(deriveParticipantView(today[1]).indexDirectionChange).toBeNull();
  });
});

describe("clearing", () => {
  it("is zero when longs equal shorts across participants", () => {
    const rows = [row("FII", "d", { futIdxLong: 10, futIdxShort: 30 }), row("Client", "d", { futIdxLong: 30, futIdxShort: 10 })];
    expect(clearingImbalance(rows)).toBe(0);
  });
  it("reports the worst product imbalance as a fraction", () => {
    const rows = [row("FII", "d", { futIdxLong: 100, futIdxShort: 0 }), row("Client", "d", { futIdxShort: 90 })];
    expect(clearingImbalance(rows)).toBeCloseTo(0.1, 10);
  });
});

describe("deriveFiiStats", () => {
  it("mirrors the proxy shape with volume", () => {
    const oi = [row("FII", "2026-10-16", { futIdxLong: 1, futIdxShort: 3, optIdxPutLong: 7, optIdxPutShort: 3 })];
    const vol = [row("FII", "2026-10-16", { futIdxLong: 500, futIdxShort: 450 })];
    const s = deriveFiiStats(oi, vol);
    expect(s.map((x) => x.segment)).toEqual(["Index Futures", "Index Calls", "Index Puts", "Stock Futures"]);
    expect(s[0]).toMatchObject({ longOi: 1, shortOi: 3, netOi: -2, longPct: 25, buyVol: 500, sellVol: 450, netVol: 50 });
    expect(s[2].longPct).toBe(70);
    expect(s[1].longPct).toBe(0);
  });
  it("returns nulls without volume and [] without an FII row", () => {
    expect(deriveFiiStats([row("FII", "d", { futIdxLong: 1 })])[0].netVol).toBeNull();
    expect(deriveFiiStats([row("Client", "d")])).toEqual([]);
  });
});

describe("classifyLongPct", () => {
  it.each([
    [5, "extreme-short"],
    [10, "extreme-short"],
    [18, "heavy-short"],
    [40, "leaning-short"],
    [50, "leaning-long"],
    [80, "heavy-long"],
    [90, "extreme-long"],
    [NaN, "unknown"],
  ])("%s → %s", (pct, zone) => {
    expect(classifyLongPct(pct)).toBe(zone);
  });
});

describe("series helpers", () => {
  it("sma needs a full window of finite values", () => {
    const out = sma([1, 2, 3, 4, NaN, 6], 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3);
    expect(out[4]).toBeNaN();
    expect(out[5]).toBeNaN();
  });
  it("pearson detects a perfect mirror", () => {
    expect(pearson([1, 2, 3, 4], [-2, -4, -6, -8])).toBeCloseTo(-1, 10);
    expect(pearson([1, 2], [2, 1])).toBeNaN();
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN();
  });
  it("percentileRank counts values at or below", () => {
    expect(percentileRank(3, [1, 2, 3, 4])).toBe(75);
    expect(percentileRank(3, [])).toBeNaN();
  });
  it("buildHistorySeries sorts by date and needs an FII row", () => {
    const rows = [
      row("FII", "2026-10-16", { futIdxLong: 30, futIdxShort: 70 }),
      row("Client", "2026-10-16", { futIdxLong: 70, futIdxShort: 30 }),
      row("FII", "2026-10-15", { futIdxLong: 20, futIdxShort: 80 }),
      row("Client", "2026-10-14"),
    ];
    const s = buildHistorySeries(rows);
    expect(s.map((p) => p.date)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(s[1].fiiLongPct).toBeCloseTo(30, 10);
    expect(s[1].clientNetFut).toBe(40);
    expect(s[0].clientNetFut).toBeNaN();
  });
});

describe("publication window (IST)", () => {
  // 2026-10-16 is a Friday trading day.
  it("tracks the 18:00–20:00 window", () => {
    expect(publishState(ist("2026-10-16", 15))).toBe("before-window");
    expect(publishState(ist("2026-10-16", 18, 30))).toBe("in-window");
    expect(publishState(ist("2026-10-16", 20, 5))).toBe("published");
    expect(publishState(ist("2026-10-17", 12))).toBe("non-trading-day");
  });
  it("picks the latest date whose file should be out", () => {
    expect(latestExpectedDate(ist("2026-10-16", 21))).toBe("2026-10-16");
    expect(latestExpectedDate(ist("2026-10-16", 10))).toBe("2026-10-15");
    expect(latestExpectedDate(ist("2026-10-18", 10))).toBe("2026-10-16");
  });
  it("flags today's date as awaiting until shortly after the window", () => {
    expect(isAwaitingPublication("2026-10-16", ist("2026-10-16", 17))).toBe(true);
    expect(isAwaitingPublication("2026-10-16", ist("2026-10-16", 22))).toBe(false);
    expect(isAwaitingPublication("2026-10-15", ist("2026-10-16", 17))).toBe(false);
  });
});

describe("sanitizeRows", () => {
  it("drops malformed rows and coerces numbers", () => {
    const out = sanitizeRows([
      { date: "2026-10-16", participant: "FII", futIdxLong: "1,234", futIdxShort: -5 },
      { date: "bad", participant: "FII" },
      { date: "2026-10-16", participant: "TOTAL" },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].futIdxLong).toBe(1234);
    expect(out[0].futIdxShort).toBe(0);
    expect(out[0].optIdxPutShort).toBe(0);
    expect(sanitizeRows({})).toEqual([]);
  });
});

describe("browser history store", () => {
  it("merges by date, replaces per participant and survives round trips", () => {
    const st = memoryStorage();
    saveRows([row("FII", "2026-10-15", { futIdxLong: 1 }), row("Client", "2026-10-15")], "oi", st);
    saveRows([row("FII", "2026-10-15", { futIdxLong: 9 }), row("FII", "2026-10-16")], "oi", st);
    const rows = loadStoredRows("oi", st);
    expect(rows.map((r) => `${r.date}:${r.participant}`)).toEqual(["2026-10-15:FII", "2026-10-15:Client", "2026-10-16:FII"]);
    expect(rows[0].futIdxLong).toBe(9);
  });
  it("is safe with no storage or corrupt JSON", () => {
    expect(loadStoredRows("oi", null)).toEqual([]);
    const st = memoryStorage();
    st.setItem("mc_participant_oi_v1", "{not json");
    expect(loadStoredRows("oi", st)).toEqual([]);
    expect(saveRows([row("FII", "2026-10-16")], "oi", null)).toHaveLength(1);
  });
  it("mergeByDate is pure", () => {
    const base = {};
    const next = mergeByDate(base, [row("DII", "2026-10-16")]);
    expect(base).toEqual({});
    expect(Object.keys(next)).toEqual(["2026-10-16"]);
  });
});

describe("cash flows", () => {
  const raw = [
    { category: "DII **", date: "16-Oct-2026", buyValue: 15000, sellValue: 12000, netValue: 3000 },
    { category: "FII/FPI *", date: "16-Oct-2026", buyValue: 11000, sellValue: 13500.5, netValue: -2500.5 },
    { category: "Other", date: "16-Oct-2026", buyValue: 1, sellValue: 1, netValue: 0 },
  ];
  it("merges FII and DII rows by date", () => {
    const d = parseCashFlows(raw);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ date: "2026-10-16", fiiNet: -2500.5, diiNet: 3000, fiiBuy: 11000, diiSell: 12000 });
  });
  it("computes net from buy and sell when net is missing", () => {
    const d = parseCashFlows([{ category: "FII/FPI", date: "2026-10-16", buyValue: 10, sellValue: 4, netValue: 0 }]);
    expect(d[0].fiiNet).toBe(6);
  });
  it("totals by month and accumulates", () => {
    const days = [
      { date: "2026-09-30", fiiBuy: 0, fiiSell: 0, fiiNet: -100, diiBuy: 0, diiSell: 0, diiNet: 50 },
      { date: "2026-10-01", fiiBuy: 0, fiiSell: 0, fiiNet: 200, diiBuy: 0, diiSell: 0, diiNet: -20 },
      { date: "2026-10-03", fiiBuy: 0, fiiSell: 0, fiiNet: -50, diiBuy: 0, diiSell: 0, diiNet: 10 },
    ];
    expect(monthlyCashTotals(days)).toEqual([
      { month: "2026-09", fiiNet: -100, diiNet: 50, days: 1 },
      { month: "2026-10", fiiNet: 150, diiNet: -10, days: 2 },
    ]);
    expect(cumulativeCash(days).map((d) => d.fiiCum)).toEqual([-100, 100, 50]);
  });
  it("stores cash days by date", () => {
    const st = memoryStorage();
    saveCash(parseCashFlows(raw), st);
    saveCash(parseCashFlows(raw), st);
    expect(loadStoredCash(st)).toHaveLength(1);
  });
});

describe("sample data", () => {
  it("covers trading days only and is deterministic", () => {
    const days = lastTradingDays("2026-10-18", 5);
    expect(days).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(sampleParticipantHistory(10, "2026-10-16")).toEqual(sampleParticipantHistory(10, "2026-10-16"));
  });
  it("clears every product exactly, like real NSE data", () => {
    const rows = sampleParticipantHistory(30, "2026-10-16");
    expect(rows).toHaveLength(120);
    const byDate = new Map<string, ParticipantOIRow[]>();
    for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
    for (const list of byDate.values()) {
      expect(clearingImbalance(list)).toBe(0);
      for (const r of list) for (const v of Object.values(r)) if (typeof v === "number") expect(v).toBeGreaterThanOrEqual(0);
    }
  });
  it("keeps FII long % within a plausible range", () => {
    const s = buildHistorySeries(sampleParticipantHistory(60, "2026-10-16"));
    for (const p of s) {
      expect(p.fiiLongPct).toBeGreaterThan(5);
      expect(p.fiiLongPct).toBeLessThan(65);
    }
  });
  it("produces volume and cash samples with consistent nets", () => {
    const oi = sampleParticipantHistory(2, "2026-10-16");
    expect(sampleParticipantVolume(oi)).toHaveLength(oi.length);
    for (const d of sampleCashFlows(20, "2026-10-16")) {
      expect(d.fiiBuy - d.fiiSell).toBeCloseTo(d.fiiNet, 1);
      expect(d.diiBuy - d.diiSell).toBeCloseTo(d.diiNet, 1);
    }
  });
});
