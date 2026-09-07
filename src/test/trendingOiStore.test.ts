import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyTrendingOI,
  recordTrendingOISnapshot,
  getTrendingOIHistory,
  annotateTrendingOIRows,
  resampleTrendingOIRows,
  type TrendingOISnapshot,
} from "@/lib/trendingOiStore";

function makeHistory(ceOIChgSeries: number[], peOIChgSeries: number[]): TrendingOISnapshot[] {
  return ceOIChgSeries.map((ceOIChg, i) => ({
    time: i * 60_000,
    spot: 24000,
    ceOI: 1_000_000,
    peOI: 1_100_000,
    ceOIChg,
    peOIChg: peOIChgSeries[i],
    diff: peOIChgSeries[i] - ceOIChg,
    netPCR: 1.1,
  }));
}

describe("classifyTrendingOI", () => {
  it("returns Neutral with fewer than 3 readings", () => {
    const result = classifyTrendingOI(makeHistory([1000], [2000]));
    expect(result.signal).toBe("Neutral");
    expect(result.readingsUsed).toBe(1);
  });

  it("flags Bullish when Put OI change rises while Call OI change falls", () => {
    const history = makeHistory(
      [50000, 40000, 30000, 20000, 10000, 0],
      [10000, 20000, 30000, 40000, 50000, 60000],
    );
    const result = classifyTrendingOI(history);
    expect(result.signal).toBe("Bullish");
    expect(result.ceDownFrac).toBe(1);
    expect(result.peUpFrac).toBe(1);
  });

  it("flags Bearish when Call OI change rises while Put OI change falls", () => {
    const history = makeHistory(
      [10000, 20000, 30000, 40000, 50000, 60000],
      [50000, 40000, 30000, 20000, 10000, 0],
    );
    const result = classifyTrendingOI(history);
    expect(result.signal).toBe("Bearish");
    expect(result.ceUpFrac).toBe(1);
    expect(result.peDownFrac).toBe(1);
  });

  it("stays Neutral when readings are mixed / directionless", () => {
    const history = makeHistory(
      [10000, 30000, 15000, 35000, 12000, 32000],
      [10000, 5000, 20000, 8000, 25000, 9000],
    );
    const result = classifyTrendingOI(history);
    expect(result.signal).toBe("Neutral");
  });
});

describe("annotateTrendingOIRows", () => {
  it("flags a rising spot as day-high breaks (never on the first row)", () => {
    const history: TrendingOISnapshot[] = [
      { time: 0, spot: 24000, ceOI: 1e6, peOI: 1e6, ceOIChg: 0, peOIChg: 0, diff: 0, netPCR: 1 },
      { time: 60_000, spot: 24050, ceOI: 1e6, peOI: 1e6, ceOIChg: 0, peOIChg: 0, diff: 0, netPCR: 1 },
      { time: 120_000, spot: 24030, ceOI: 1e6, peOI: 1e6, ceOIChg: 0, peOIChg: 0, diff: 0, netPCR: 1 },
    ];
    const rows = annotateTrendingOIRows(history);
    expect(rows[0].dayHighBreak).toBe(false);
    expect(rows[1].dayHighBreak).toBe(true); // 24050 > 24000
    expect(rows[2].dayHighBreak).toBe(false); // 24030 < running high of 24050
  });

  it("tags sentiment purely from the diff's sign", () => {
    const history: TrendingOISnapshot[] = [
      { time: 0, spot: 24000, ceOI: 1e6, peOI: 1e6, ceOIChg: 1000, peOIChg: 5000, diff: 4000, netPCR: 1 },
      { time: 60_000, spot: 24000, ceOI: 1e6, peOI: 1e6, ceOIChg: 5000, peOIChg: 1000, diff: -4000, netPCR: 1 },
    ];
    const rows = annotateTrendingOIRows(history);
    expect(rows[0].sentiment).toBe("Bullish");
    expect(rows[1].sentiment).toBe("Bearish");
  });

  it("computes direction of change and its percentage vs the prior reading", () => {
    const history: TrendingOISnapshot[] = [
      { time: 0, spot: 24000, ceOI: 1e6, peOI: 1e6, ceOIChg: 0, peOIChg: 0, diff: 1000, netPCR: 1 },
      { time: 60_000, spot: 24000, ceOI: 1e6, peOI: 1e6, ceOIChg: 0, peOIChg: 0, diff: 1500, netPCR: 1 },
    ];
    const rows = annotateTrendingOIRows(history);
    expect(rows[1].directionOfChange).toBe("up");
    expect(rows[1].changeInDirection).toBe(500);
    expect(rows[1].directionChangePercent).toBe(50);
  });
});

describe("resampleTrendingOIRows", () => {
  it("keeps every row when the interval is 1 minute or less", () => {
    const rows = [{ time: 0 }, { time: 60_000 }, { time: 120_000 }];
    expect(resampleTrendingOIRows(rows, 1)).toHaveLength(3);
  });

  it("keeps the latest row per bucket for wider intervals", () => {
    const rows = [
      { time: 0, v: "a" },
      { time: 60_000, v: "b" },
      { time: 120_000, v: "c" },
      { time: 180_000, v: "d" },
    ];
    const resampled = resampleTrendingOIRows(rows, 5);
    expect(resampled).toHaveLength(1);
    expect(resampled[0].v).toBe("d"); // last-in-bucket wins
  });
});

describe("recordTrendingOISnapshot / getTrendingOIHistory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty history for a symbol with no readings yet", () => {
    expect(getTrendingOIHistory("NIFTY")).toEqual([]);
  });

  it("records a reading and makes it visible via getTrendingOIHistory", () => {
    const now = Date.now();
    recordTrendingOISnapshot("NIFTY", { spot: 24000, ceOI: 1e6, peOI: 1.1e6, ceOIChg: 1000, peOIChg: 2000 }, now);
    const history = getTrendingOIHistory("NIFTY");
    expect(history).toHaveLength(1);
    expect(history[0].diff).toBe(1000);
    expect(history[0].netPCR).toBe(1.1);
  });

  it("throttles readings inside the 10s window", () => {
    const now = Date.now();
    recordTrendingOISnapshot("NIFTY", { spot: 24000, ceOI: 1e6, peOI: 1.1e6, ceOIChg: 1000, peOIChg: 2000 }, now);
    const result = recordTrendingOISnapshot("NIFTY", { spot: 24010, ceOI: 1e6, peOI: 1.1e6, ceOIChg: 1500, peOIChg: 2500 }, now + 9000);
    expect(result).toHaveLength(1); // second call within 10s is a no-op
  });

  it("accepts a new reading once the interval has elapsed", () => {
    const now = Date.now();
    recordTrendingOISnapshot("NIFTY", { spot: 24000, ceOI: 1e6, peOI: 1.1e6, ceOIChg: 1000, peOIChg: 2000 }, now);
    const result = recordTrendingOISnapshot("NIFTY", { spot: 24010, ceOI: 1e6, peOI: 1.1e6, ceOIChg: 1500, peOIChg: 2500 }, now + 11_000);
    expect(result).toHaveLength(2);
  });

  it("keeps separate histories per symbol", () => {
    const now = Date.now();
    recordTrendingOISnapshot("NIFTY", { spot: 24000, ceOI: 1e6, peOI: 1.1e6, ceOIChg: 1000, peOIChg: 2000 }, now);
    recordTrendingOISnapshot("BANKNIFTY", { spot: 51000, ceOI: 5e5, peOI: 6e5, ceOIChg: 500, peOIChg: 700 }, now);
    expect(getTrendingOIHistory("NIFTY")).toHaveLength(1);
    expect(getTrendingOIHistory("BANKNIFTY")).toHaveLength(1);
  });

  it("discards a same-day entry recorded under an older schema instead of handing it to the UI", () => {
    // Simulates a browser that recorded readings before ceOI/peOI/netPCR existed
    // on TrendingOISnapshot — reading them back as-is would crash the UI on
    // `r.netPCR.toFixed(2)` over undefined.
    const today = new Date().toLocaleDateString("en-CA");
    localStorage.setItem("optionsdesk_trending_oi", JSON.stringify({
      NIFTY: { date: today, snapshots: [{ time: Date.now(), spot: 24000, ceOIChg: 1000, peOIChg: 2000, diff: 1000 }] },
    }));
    expect(getTrendingOIHistory("NIFTY")).toEqual([]);

    const result = recordTrendingOISnapshot("NIFTY", { spot: 24000, ceOI: 1e6, peOI: 1.1e6, ceOIChg: 1000, peOIChg: 2000 });
    expect(result).toHaveLength(1); // starts a fresh, correctly-shaped series rather than appending to the stale one
    expect(result[0].netPCR).toBe(1.1);
  });
});
