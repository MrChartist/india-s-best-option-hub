import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_DAYS,
  buildHistorySeries,
  correlationStrength,
  loadParticipantsDashboard,
  nextDayCorrelation,
  parseDailyCloses,
  sampleNiftyCloses,
  sampleParticipantHistory,
  type HistoryPoint,
} from "@/lib/participantsApi";
import { ordinal, percentileLabel } from "./format";

const pt = (date: string, fiiLongPct: number) => ({ date, fiiLongPct }) as HistoryPoint;

describe("ordinal and percentileLabel", () => {
  it("uses the right English suffixes", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 100, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "100th",
      "101st",
      "111th",
    ]);
  });
  it("labels a percentile (the old '3th pct' bug)", () => {
    expect(percentileLabel(3.2, 250)).toBe("3rd percentile of 250 sessions");
    expect(percentileLabel(22)).toBe("22nd percentile");
    expect(percentileLabel(100.4)).toBe("100th percentile");
    expect(percentileLabel(NaN)).toBe("—");
  });
});

describe("parseDailyCloses", () => {
  it("reads second or millisecond timestamps, skips gaps and keeps one close per IST day", () => {
    const t = Date.parse("2026-10-14T10:00:00Z") / 1000;
    const closes = parseDailyCloses({
      timestamp: [t, t + 86400, (t + 2 * 86400) * 1000, t + 3 * 86400],
      close: [100, null, 102, 103],
    });
    expect(closes).toEqual([
      { date: "2026-10-14", close: 100 },
      { date: "2026-10-16", close: 102 },
      { date: "2026-10-17", close: 103 },
    ]);
    expect(parseDailyCloses(null)).toEqual([]);
  });
});

describe("nextDayCorrelation", () => {
  const series = [
    pt("2026-10-12", 20),
    pt("2026-10-13", 22),
    pt("2026-10-14", 21),
    pt("2026-10-15", 24),
    pt("2026-10-16", 23),
  ];

  it("pairs the change on day t with the return from t to the next close", () => {
    // Returns follow the change exactly: +2 → +1%, −1 → −0.5%, +3 → +1.5%.
    const closes = [
      { date: "2026-10-12", close: 100 },
      { date: "2026-10-13", close: 100 },
      { date: "2026-10-14", close: 101 },
      { date: "2026-10-15", close: 100.495 },
      { date: "2026-10-16", close: 102.0024 },
    ];
    const lag = nextDayCorrelation(series, closes);
    expect(lag.n).toBe(3); // 16 Oct has no later close
    expect(lag.points[0]).toMatchObject({ date: "2026-10-13", fiiChange: 2 });
    expect(lag.points[0].nextRet).toBeCloseTo(1, 6);
    expect(lag.corrChange).toBeCloseTo(1, 4);
  });

  it("returns NaN with too few overlapping days", () => {
    const lag = nextDayCorrelation(series, [{ date: "2026-10-13", close: 1 }]);
    expect(lag.n).toBe(0);
    expect(lag.corrChange).toBeNaN();
    expect(correlationStrength(lag.corrChange)).toBe("unknown");
  });

  it("grades strength", () => {
    expect(correlationStrength(0.05)).toBe("none");
    expect(correlationStrength(-0.2)).toBe("weak");
    expect(correlationStrength(0.4)).toBe("moderate");
    expect(correlationStrength(-0.7)).toBe("strong");
  });

  it("sample closes cover the series and yield a correlation", () => {
    const s = buildHistorySeries(sampleParticipantHistory(120, "2026-10-16"));
    const closes = sampleNiftyCloses(s);
    expect(closes).toHaveLength(s.length);
    expect(closes.every((c) => c.close > 0)).toBe(true);
    const lag = nextDayCorrelation(s, closes);
    expect(lag.n).toBe(s.length - 2);
    expect(Number.isFinite(lag.corrChange)).toBe(true);
    expect(Math.abs(lag.corrChange)).toBeLessThanOrEqual(1);
  });
});

describe("1Y history window", () => {
  it("serves 250 sessions in sample mode", async () => {
    expect(MAX_HISTORY_DAYS).toBe(250);
    const d = await loadParticipantsDashboard({ date: null, days: 250, now: new Date("2026-10-17T06:00:00Z") });
    expect(d.mode).toBe("sample");
    expect(d.series).toHaveLength(250);
    const capped = await loadParticipantsDashboard({ date: null, days: 999, now: new Date("2026-10-17T06:00:00Z") });
    expect(capped.series).toHaveLength(250);
  });
});
