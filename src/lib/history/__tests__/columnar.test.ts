import { describe, expect, it } from "vitest";
import { buildSnapshot, type ChainSnapshot } from "@/lib/snapshotStore";
import { generateSampleChain } from "@/lib/options";
import {
  COLUMNAR_FORMAT,
  barStart,
  decodeSnapshot,
  encodeSnapshot,
  isColumnarRecord,
  isLegacyRecord,
  istDateOf,
  migrateRecord,
  planDownsample,
  recordBytes,
  recordToSnapshot,
} from "../columnar";

const now = new Date("2026-10-16T06:00:00Z");
const sample = generateSampleChain({ symbol: "NIFTY", spot: 25012.35, expiry: "2026-10-20", now, strikes: 61 });
const snap = buildSnapshot("NIFTY", "2026-10-20", 25012.35, sample.chain, now.getTime());

describe("columnar codec", () => {
  it("stores strikes in a Float64Array and each side in Float32Array columns", () => {
    const rec = encodeSnapshot(snap);
    expect(rec.fmt).toBe(COLUMNAR_FORMAT);
    expect(rec.granularity).toBe("raw");
    expect(rec.strikes).toBeInstanceOf(Float64Array);
    expect(rec.strikes.length).toBe(61);
    for (const col of [rec.ce.ltp, rec.ce.oi, rec.ce.vol, rec.ce.iv, rec.ce.bid, rec.ce.ask, rec.pe.ltp]) expect(col).toBeInstanceOf(Float32Array);
    expect([...rec.strikes]).toEqual([...rec.strikes].sort((a, b) => a - b));
    expect(isColumnarRecord(rec)).toBe(true);
    expect(isLegacyRecord(rec)).toBe(false);
  });

  it("round-trips a realistic chain exactly", () => {
    expect(decodeSnapshot(encodeSnapshot(snap))).toEqual(snap);
  });

  it("keeps absent legs absent and optional quantities optional", () => {
    const s: ChainSnapshot = {
      id: "X|2026-10-20|1",
      symbol: "X",
      expiry: "2026-10-20",
      ts: 1,
      spot: 100,
      rows: [
        { strike: 112.5, side: "PE", ltp: 1.05, oi: 16_777_216, vol: 3, iv: 31.45, bid: 1, ask: 1.1, bidQty: 1500 },
        { strike: 100, side: "CE", ltp: 4.2, oi: 10, vol: 0, iv: 0, bid: 0, ask: 0 },
      ],
    };
    const rec = encodeSnapshot(s);
    expect(rec.ce.bidQty).toBeInstanceOf(Float32Array);
    expect(Number.isNaN(rec.ce.ltp[1])).toBe(true); // no CE at 112.5
    const back = decodeSnapshot(rec);
    expect(back.rows).toEqual([
      { strike: 100, side: "CE", ltp: 4.2, oi: 10, vol: 0, iv: 0, bid: 0, ask: 0 },
      { strike: 112.5, side: "PE", ltp: 1.05, oi: 16_777_216, vol: 3, iv: 31.45, bid: 1, ask: 1.1, bidQty: 1500 },
    ]);
  });

  it("is smaller than the row-object form", () => {
    const rec = encodeSnapshot(snap);
    expect(recordBytes(rec)).toBeLessThan(JSON.stringify(snap.rows).length / 2);
  });

  it("reads legacy records and migrates them once", () => {
    const legacy = { ...snap };
    expect(recordToSnapshot(legacy)).toEqual(snap);
    const migrated = migrateRecord(legacy);
    expect(migrated && isColumnarRecord(migrated)).toBe(true);
    expect(migrateRecord(migrated)).toBeNull();
    expect(migrateRecord({ nope: true })).toBeNull();
    expect(recordToSnapshot(null)).toBeNull();
    expect(decodeSnapshot(migrated!)).toEqual(snap);
  });
});

describe("downsampling plan", () => {
  const base = Date.UTC(2026, 9, 15, 3, 45); // 09:15 IST
  const item = (min: number, expiry = "2026-10-20", symbol = "NIFTY") => ({ id: `${symbol}|${expiry}|${min}`, symbol, expiry, ts: base + min * 60_000 });

  it("keeps the last snapshot of each 5-minute IST bar per symbol and expiry", () => {
    const items = [item(0), item(1), item(4), item(5), item(7), item(12), item(2, "2026-10-27"), item(3, "2026-10-27"), item(1, "2026-10-20", "BANKNIFTY")];
    const plan = planDownsample(items);
    expect(plan.keep.sort()).toEqual(["BANKNIFTY|2026-10-20|1", "NIFTY|2026-10-20|12", "NIFTY|2026-10-20|4", "NIFTY|2026-10-20|7", "NIFTY|2026-10-27|3"].sort());
    expect(plan.drop.sort()).toEqual(["NIFTY|2026-10-20|0", "NIFTY|2026-10-20|1", "NIFTY|2026-10-20|5", "NIFTY|2026-10-27|2"].sort());
  });

  it("aligns bars to IST wall-clock minutes and dates to IST days", () => {
    expect(barStart(base + 4 * 60_000 + 59_000)).toBe(base);
    expect(barStart(base + 5 * 60_000)).toBe(base + 5 * 60_000);
    expect(istDateOf(Date.UTC(2026, 9, 15, 18, 29))).toBe("2026-10-15");
    expect(istDateOf(Date.UTC(2026, 9, 15, 18, 30))).toBe("2026-10-16");
  });
});
