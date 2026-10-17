import { describe, it, expect } from "vitest";
import type { OptionData } from "@/lib/mockData";
import { generateSampleChain, maxPain } from "@/lib/options";
import {
  SNAPSHOT_CSV_HEADER,
  buildSnapshot,
  buildSnapshotRows,
  computeDailyStat,
  getDailyStats,
  getLatestSnapshots,
  getSnapshotStats,
  getSnapshots,
  istTimestamp,
  normaliseExpiryKey,
  recordSnapshot,
  selectRecentDailyStats,
  snapshotDateIST,
  snapshotId,
  snapshotToChain,
  snapshotsToCSV,
  type DailyStat,
} from "@/lib/snapshotStore";
import { effectiveInterval, isAfterCloseIST } from "@/hooks/useSnapshotRecorder";

const leg = (o: Partial<OptionData["ce"]> = {}): OptionData["ce"] => ({ ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0, ...o });

const chain: OptionData[] = [
  { strikePrice: 25100, ce: leg({ ltp: 40, oi: 900, volume: 50, iv: 12, bidPrice: 39.5, askPrice: 40.5 }), pe: leg({ ltp: 140, oi: 300, volume: 20, iv: 13 }) },
  { strikePrice: 24900, ce: leg({ ltp: 160, oi: 200, volume: 10, iv: 13 }), pe: leg({ ltp: 50, oi: 1000, volume: 60, iv: 14 }) },
  { strikePrice: 25000, ce: leg({ ltp: 90, oi: 500, volume: 100, iv: 12.5 }), pe: leg() },
];

describe("snapshot rows", () => {
  it("flattens legs in strike order and skips empty legs", () => {
    const rows = buildSnapshotRows(chain);
    expect(rows.map((r) => `${r.strike}${r.side}`)).toEqual(["24900CE", "24900PE", "25000CE", "25100CE", "25100PE"]);
    expect(rows[3]).toMatchObject({ ltp: 40, oi: 900, vol: 50, iv: 12, bid: 39.5, ask: 40.5 });
  });

  it("keeps bid/ask quantities when present", () => {
    const rows = buildSnapshotRows([{ strikePrice: 100, ce: { ...leg({ ltp: 1 }), bidQty: 75, askQty: 150 } as OptionData["ce"], pe: leg() }]);
    expect(rows[0]).toMatchObject({ bidQty: 75, askQty: 150 });
  });

  it("round-trips through snapshotToChain", () => {
    const snap = buildSnapshot("nifty", "20-Oct-2026", 25010, chain, 1_792_000_000_000);
    expect(snap.symbol).toBe("NIFTY");
    expect(snap.expiry).toBe("2026-10-20");
    expect(snap.id).toBe("NIFTY|2026-10-20|1792000000000");
    const back = snapshotToChain(snap);
    expect(back.map((r) => r.strikePrice)).toEqual([24900, 25000, 25100]);
    expect(back[2].ce.oi).toBe(900);
    expect(back[1].pe.ltp).toBe(0);
  });

  it("normalises ids and expiry keys", () => {
    expect(snapshotId(" banknifty ", "2026-10-27", 5)).toBe("BANKNIFTY|2026-10-27|5");
    expect(normaliseExpiryKey("27-Oct-2026")).toBe("2026-10-27");
    expect(normaliseExpiryKey("weekly")).toBe("weekly");
  });
});

describe("computeDailyStat", () => {
  it("computes PCR and max pain from OI and volume", () => {
    const stat = computeDailyStat({ symbol: "nifty", date: "2026-10-16", spot: 25000, chain, expiry: "2026-10-20", now: new Date("2026-10-16T10:00:00Z") });
    expect(stat.symbol).toBe("NIFTY");
    expect(stat.pcrOi).toBeCloseTo(1300 / 1600, 4);
    expect(stat.pcrVol).toBeCloseTo(80 / 160, 4);
    expect(stat.maxPain).toBe(maxPain(chain));
    expect(stat.spot).toBe(25000);
  });

  it("produces a sensible ATM IV, straddle and skew on a sample chain", () => {
    const now = new Date("2026-10-16T06:00:00Z");
    const sample = generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry: "2026-10-27", atmIv: 0.14, now });
    const stat = computeDailyStat({ symbol: "NIFTY", date: "2026-10-16", spot: 25000, chain: sample.chain, expiry: "2026-10-27", now });
    expect(stat.atmIv).toBeGreaterThan(11);
    expect(stat.atmIv).toBeLessThan(17);
    expect(stat.straddle).toBeGreaterThan(0);
    expect(stat.futBasis).toBeDefined();
    // The sample has a put skew: 25-delta puts trade above 25-delta calls.
    expect(stat.rr25).toBeLessThan(0);
  });

  it("uses a supplied futures price for the basis", () => {
    const stat = computeDailyStat({ symbol: "NIFTY", date: "2026-10-16", spot: 25000, chain, expiry: "2026-10-20", futuresPrice: 25080 });
    expect(stat.futBasis).toBe(80);
  });

  it("returns NaN rather than throwing on an empty chain", () => {
    const stat = computeDailyStat({ symbol: "X", date: "2026-10-16", spot: 100, chain: [], expiry: "2026-10-20" });
    expect(Number.isNaN(stat.pcrOi)).toBe(true);
    expect(Number.isNaN(stat.maxPain)).toBe(true);
    expect(stat.rr25).toBeUndefined();
  });
});

describe("CSV and daily stat helpers", () => {
  it("writes IST timestamps and one line per row", () => {
    const a = buildSnapshot("NIFTY", "2026-10-20", 25000, chain, Date.UTC(2026, 9, 16, 4, 0, 0));
    const b = buildSnapshot("NIFTY", "2026-10-20", 25010, chain.slice(0, 1), Date.UTC(2026, 9, 16, 3, 59, 0));
    const csv = snapshotsToCSV([a, b]).split("\n");
    expect(csv[0]).toBe(SNAPSHOT_CSV_HEADER);
    expect(csv).toHaveLength(1 + a.rows.length + b.rows.length);
    expect(csv[1].startsWith("2026-10-16 09:29:00")).toBe(true); // earlier snapshot first
    expect(istTimestamp(Date.UTC(2026, 9, 16, 4, 0, 0))).toBe("2026-10-16 09:30:00");
    expect(snapshotDateIST(Date.UTC(2026, 9, 16, 20, 0, 0))).toBe("2026-10-17");
  });

  it("keeps the most recent N daily stats, one per date", () => {
    const s = (date: string, atmIv: number): DailyStat => ({ symbol: "NIFTY", date, atmIv, pcrOi: 1, pcrVol: 1, maxPain: 1, straddle: 1, spot: 1 });
    const out = selectRecentDailyStats([s("2026-10-15", 1), s("2026-10-13", 2), s("2026-10-14", 3), s("2026-10-15", 4)], 2);
    expect(out.map((x) => [x.date, x.atmIv])).toEqual([["2026-10-14", 3], ["2026-10-15", 4]]);
    expect(selectRecentDailyStats([], 5)).toEqual([]);
    expect(selectRecentDailyStats([s("2026-10-15", 1)], 0)).toEqual([]);
  });
});

describe("store functions without IndexedDB", () => {
  it("resolve to empty results instead of throwing", async () => {
    await expect(recordSnapshot("NIFTY", "2026-10-20", 25000, chain)).resolves.toBeUndefined();
    expect(await getSnapshots("NIFTY", "2026-10-20")).toEqual([]);
    expect(await getLatestSnapshots("NIFTY", "2026-10-20", 3)).toEqual([]);
    expect(await getDailyStats("NIFTY", 10)).toEqual([]);
    expect(await getSnapshotStats()).toMatchObject({ count: 0, symbols: [], recording: false });
  });
});

describe("recorder helpers", () => {
  it("never records faster than every 15 seconds", () => {
    expect(effectiveInterval(1000)).toBe(15000);
    expect(effectiveInterval(undefined)).toBe(60000);
    expect(effectiveInterval(90000)).toBe(90000);
  });

  it("detects 15:30 IST on trading days only", () => {
    expect(isAfterCloseIST(new Date("2026-10-16T10:00:00Z"))).toBe(true); // Fri 15:30 IST
    expect(isAfterCloseIST(new Date("2026-10-16T09:59:00Z"))).toBe(false); // 15:29 IST
    expect(isAfterCloseIST(new Date("2026-10-17T11:00:00Z"))).toBe(false); // Saturday
  });
});
