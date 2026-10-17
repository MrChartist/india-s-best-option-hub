import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionData } from "@/lib/mockData";
import { generateSampleChain, maxPain } from "@/lib/options";
import {
  MIN_SNAPSHOT_GAP_MS,
  SNAPSHOT_CSV_HEADER,
  buildSnapshot,
  clearQuotaPause,
  compactSnapshots,
  getStorageHealth,
  importSnapshots,
  pruneSnapshots,
  recordSnapshotDetailed,
  resetRecorderMemory,
  snapshotSkipReason,
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
import { DB_NAME, DB_VERSION, STORE_CHAIN_SNAPSHOTS, closeMarketDB, openMarketDB } from "@/lib/localDatabase";
import { isColumnarRecord, type ColumnarSnapshotRecord } from "@/lib/history/columnar";
import { resetStorageHealth } from "@/lib/history/storageHealth";

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
  it("refuses sample, stale, old and empty chains", () => {
    const now = 1_792_000_000_000;
    expect(snapshotSkipReason({ source: "sample", rowCount: 10 }, now)).toBe("sample");
    expect(snapshotSkipReason({ source: "nse", stale: true, rowCount: 10 }, now)).toBe("stale");
    expect(snapshotSkipReason({ source: "dhan", asOf: now - 3 * 60_000, rowCount: 10 }, now)).toBe("old");
    expect(snapshotSkipReason({ source: "nse", asOf: now - 30_000, rowCount: 0 }, now)).toBe("empty");
    expect(snapshotSkipReason({ source: "nse", asOf: now - 30_000, rowCount: 10 }, now)).toBeNull();
    expect(snapshotSkipReason({ rowCount: 1 }, now)).toBeNull();
  });

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

// ── IndexedDB behaviour (fake-indexeddb) ──
//
// fake-indexeddb is a dev dependency; when it is not installed these tests are skipped rather
// than failing. The module name sits in a variable so Vite does not try to resolve it statically.

interface FakeIDBModule {
  IDBFactory: new () => IDBFactory;
  IDBKeyRange: typeof IDBKeyRange;
  IDBObjectStore: { prototype: IDBObjectStore };
}

const FAKE_IDB = "fake-indexeddb";
const fakeIdb: FakeIDBModule | null = await import(/* @vite-ignore */ FAKE_IDB).then((m: FakeIDBModule) => m).catch(() => null);

describe.skipIf(!fakeIdb)("snapshot store on IndexedDB", () => {
  const T0 = Date.UTC(2026, 9, 16, 4, 0, 0); // Fri 16 Oct 2026, 09:30 IST
  const fresh = (ts: number) => ({ source: "nse", stale: false, asOf: ts, ts });

  beforeEach(() => {
    const f = fakeIdb as FakeIDBModule;
    vi.stubGlobal("indexedDB", new f.IDBFactory());
    vi.stubGlobal("IDBKeyRange", f.IDBKeyRange);
    closeMarketDB();
    resetRecorderMemory();
    resetStorageHealth();
  });

  afterEach(() => {
    closeMarketDB();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetStorageHealth();
  });

  async function rawRecords(): Promise<unknown[]> {
    const d = await openMarketDB();
    return new Promise((resolve, reject) => {
      const req = d.transaction(STORE_CHAIN_SNAPSHOTS, "readonly").objectStore(STORE_CHAIN_SNAPSHOTS).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  it("upgrades a v3 database and migrates row-object snapshots to columns", async () => {
    const legacy = buildSnapshot("NIFTY", "2026-10-20", 25000, chain, T0);
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        const snap = db.createObjectStore(STORE_CHAIN_SNAPSHOTS, { keyPath: "id" });
        snap.createIndex("symbolExpiryTs", ["symbol", "expiry", "ts"], { unique: false });
        snap.createIndex("ts", "ts", { unique: false });
        snap.createIndex("symbol", "symbol", { unique: false });
        db.createObjectStore("dailyStats", { keyPath: ["symbol", "date"] }).createIndex("symbol", "symbol", { unique: false });
        snap.put(legacy);
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    const d = await openMarketDB();
    expect(d.version).toBe(DB_VERSION);
    expect(DB_VERSION).toBe(4);
    for (const store of ["instruments", "prices", "candles", "metadata", STORE_CHAIN_SNAPSHOTS, "dailyStats"]) expect(d.objectStoreNames.contains(store)).toBe(true);
    const [raw] = (await rawRecords()) as ColumnarSnapshotRecord[];
    expect(isColumnarRecord(raw)).toBe(true);
    expect(Object.prototype.toString.call(raw.strikes)).toBe("[object Float64Array]");
    expect(Object.prototype.toString.call(raw.ce.ltp)).toBe("[object Float32Array]");
    expect("rows" in raw).toBe(false);
    const [back] = await getSnapshots("NIFTY", "2026-10-20");
    expect(back.rows).toEqual(legacy.rows);
  });

  it("round-trips snapshots through the columnar store unchanged", async () => {
    const qtyChain: OptionData[] = [...chain, { strikePrice: 25200, ce: { ...leg({ ltp: 12.35, oi: 4_500_000, volume: 12_345_678, iv: 11.87, bidPrice: 12.3, askPrice: 12.4 }), bidQty: 650, askQty: 1300 } as OptionData["ce"], pe: leg() }];
    const res = await recordSnapshotDetailed("nifty", "20-Oct-2026", 25012.35, qtyChain, fresh(T0));
    expect(res).toEqual({ recorded: true });
    const [snap] = await getSnapshots("NIFTY", "2026-10-20");
    expect(snap).toEqual(buildSnapshot("NIFTY", "2026-10-20", 25012.35, qtyChain, T0));
    const latest = await getLatestSnapshots("NIFTY", "2026-10-20", 5);
    expect(latest).toHaveLength(1);
    expect(snapshotsToCSV(latest).split("\n")).toHaveLength(1 + snap.rows.length);
    expect(await getSnapshotStats()).toMatchObject({ count: 1, symbols: ["NIFTY"], lastTs: T0 });
  });

  it("never records sample, stale or old chains, and keeps one write per gap", async () => {
    expect(await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, { source: "sample", ts: T0 })).toEqual({ recorded: false, reason: "sample" });
    expect(await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, { source: "nse", stale: true, ts: T0 })).toEqual({ recorded: false, reason: "stale" });
    expect(await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, { source: "nse", asOf: T0 - 10 * 60_000, ts: T0 })).toEqual({ recorded: false, reason: "old" });
    await recordSnapshot("NIFTY", "2026-10-20", 25000, chain, { source: "sample" });
    expect(await getSnapshots("NIFTY", "2026-10-20")).toEqual([]);

    expect((await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(T0))).recorded).toBe(true);
    expect(await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(T0 + 5_000))).toEqual({ recorded: false, reason: "too-soon" });
    expect((await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(T0 + MIN_SNAPSHOT_GAP_MS))).recorded).toBe(true);
    expect(await getSnapshots("NIFTY", "2026-10-20")).toHaveLength(2);
  });

  it("prunes snapshots older than the retention window", async () => {
    const day = 86_400_000;
    for (const ts of [T0 - 40 * day, T0 - 31 * day, T0 - 2 * day, T0]) await recordSnapshotDetailed("NIFTY", "2026-12-29", 25000, chain, fresh(ts));
    expect(await getSnapshots("NIFTY", "2026-12-29")).toHaveLength(4);
    expect(await pruneSnapshots(30, T0)).toBe(2);
    const left = await getSnapshots("NIFTY", "2026-12-29");
    expect(left.map((s) => s.ts)).toEqual([T0 - 2 * day, T0]);
    expect(await pruneSnapshots(30, T0)).toBe(0);
  });

  it("downsamples finished days to 5-minute bars and leaves today raw", async () => {
    const yesterday = T0 - 86_400_000;
    const times = [0, 1, 2, 3, 4, 5, 6, 9, 11].map((m) => yesterday + m * 60_000);
    for (const ts of times) await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(ts));
    for (const ts of [T0, T0 + 60_000]) await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(ts));
    const res = await compactSnapshots(T0 + 2 * 60_000);
    // Bars from 09:30 IST: [0-4] → 4, [5-9] → 9, [10-14] → 11.
    expect(res).toEqual({ dropped: 6, kept: 3 });
    const left = await getSnapshots("NIFTY", "2026-10-20");
    expect(left.map((s) => (s.ts - yesterday) / 60_000).filter((m) => m < 1000)).toEqual([4, 9, 11]);
    expect(left.filter((s) => s.ts >= T0)).toHaveLength(2);
    const raw = (await rawRecords()) as ColumnarSnapshotRecord[];
    expect(raw.filter((r) => r.granularity === "5m")).toHaveLength(3);
    expect(await compactSnapshots(T0 + 3 * 60_000)).toEqual({ dropped: 0, kept: 0 });
  });

  it("imports server snapshots without duplicating local ones", async () => {
    await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(T0));
    const server = [T0 - 120_000, T0 + 3_000, T0 + 120_000].map((ts) => buildSnapshot("NIFTY", "2026-10-20", 25001, chain, ts));
    expect(await importSnapshots(server)).toBe(2);
    expect((await getSnapshots("NIFTY", "2026-10-20")).map((s) => s.ts)).toEqual([T0 - 120_000, T0, T0 + 120_000]);
    expect(await importSnapshots(server)).toBe(0);
  });

  it("pauses near the quota and after a QuotaExceededError", async () => {
    const f = fakeIdb as FakeIDBModule;
    vi.stubGlobal("navigator", { ...navigator, storage: { estimate: async () => ({ usage: 85, quota: 100 }), persist: async () => true, persisted: async () => false } });
    expect(await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(T0))).toEqual({ recorded: false, reason: "paused" });
    expect(getStorageHealth()).toMatchObject({ paused: true, pauseReason: "near-quota", persisted: true, ratio: 0.85 });

    resetStorageHealth();
    vi.stubGlobal("navigator", { ...navigator, storage: { estimate: async () => ({ usage: 10, quota: 100 }), persist: async () => false, persisted: async () => false } });
    const put = vi.spyOn(f.IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    expect(await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(T0))).toEqual({ recorded: false, reason: "paused" });
    expect(getStorageHealth()).toMatchObject({ paused: true, pauseReason: "quota-error" });
    expect(getStorageHealth().lastError).toMatch(/full/);
    put.mockRestore();
    // Still inside the backoff: skipped without touching IndexedDB.
    expect(await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(T0 + MIN_SNAPSHOT_GAP_MS))).toEqual({ recorded: false, reason: "paused" });
    expect(getStorageHealth().skippedWrites).toBeGreaterThan(0);
    clearQuotaPause();
    expect((await recordSnapshotDetailed("NIFTY", "2026-10-20", 25000, chain, fresh(T0 + 2 * MIN_SNAPSHOT_GAP_MS))).recorded).toBe(true);
  });
});
