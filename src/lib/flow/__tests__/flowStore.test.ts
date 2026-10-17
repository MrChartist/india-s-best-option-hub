import { describe, expect, it } from "vitest";
import { generateSampleChain, toISTDate } from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import { buildSnapshot } from "@/lib/snapshotStore";
import { SnapshotRing, allPrints, createFlowStore } from "../flowStore";
import { sampleSessionWindow, simulateSession } from "../sampleSession";

const T0 = toISTDate("2026-10-16", "10:00").getTime();
const chainAt = (vol: number, oi: number, ltp: number): OptionData[] => [
  { strikePrice: 25_000, ce: { ltp, oi, oiChange: 0, volume: vol, iv: 14, delta: 0.5, gamma: 0, theta: 0, vega: 0, bidPrice: ltp - 1, askPrice: ltp }, pe: { ltp: 90, oi: 5000, oiChange: 0, volume: 100, iv: 14, delta: -0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 89, askPrice: 91 } },
];

describe("SnapshotRing", () => {
  it("dedupes, enforces the gap and the capacity", () => {
    const ring = new SnapshotRing(3, 10_000);
    const s = (ts: number, vol: number) => buildSnapshot("NIFTY", "2026-10-20", 25_000, chainAt(vol, 1000, 100), ts);
    expect(ring.push(s(T0, 1))).toBe(true);
    expect(ring.push(s(T0, 2))).toBe(false); // same ts
    expect(ring.push(s(T0 + 5_000, 2))).toBe(false); // too close
    expect(ring.push(s(T0 + 20_000, 1))).toBe(false); // identical content
    for (let i = 1; i <= 4; i++) ring.push(s(T0 + i * 30_000, i + 1));
    expect(ring.size).toBe(3);
    ring.merge([s(T0 - 60_000, 0)]);
    expect(ring.size).toBe(3);
    expect(ring.last()?.ts).toBe(T0 + 120_000);
  });
});

describe("createFlowStore", () => {
  it("derives prints from successive live polls", () => {
    const store = createFlowStore();
    let calls = 0;
    store.subscribe(() => calls++);
    const base = { symbol: "nifty", expiry: "2026-10-20", lotSize: 65, spot: 25_010, source: "nse", stale: false, isLive: true };
    store.ingest({ ...base, chain: chainAt(1000, 5000, 100), asOf: T0 });
    store.ingest({ ...base, chain: chainAt(1600, 5400, 101), asOf: T0 + 30_000 });
    const feed = store.getState().feeds.NIFTY;
    expect(feed.mode).toBe("live");
    expect(feed.snaps).toHaveLength(2);
    expect(feed.prints).toHaveLength(1);
    expect(feed.prints[0].premium).toBe(600 * 101 * 65);
    expect(calls).toBe(2);
    // expiry change resets the series
    store.ingest({ ...base, expiry: "2026-10-27", chain: chainAt(10, 10, 50), asOf: T0 + 60_000 });
    expect(store.getState().feeds.NIFTY.prints).toHaveLength(0);
    expect(allPrints(store.getState().feeds)).toHaveLength(0);
  });

  it("hydrates recorded snapshots and rebuilds prints", () => {
    const store = createFlowStore();
    const base = { symbol: "NIFTY", expiry: "2026-10-20", lotSize: 65, spot: 25_010, source: "cache", stale: true, isLive: false };
    store.ingest({ ...base, chain: chainAt(2000, 6000, 102), asOf: T0 + 60_000 });
    expect(store.getState().feeds.NIFTY.mode).toBe("recorded");
    store.hydrate("NIFTY", "2026-10-20", [buildSnapshot("NIFTY", "2026-10-20", 25_000, chainAt(1000, 5000, 100), T0)]);
    const feed = store.getState().feeds.NIFTY;
    expect(feed.hydrated).toBe(true);
    expect(feed.snaps).toHaveLength(2);
    expect(feed.prints).toHaveLength(1);
  });

  it("builds a labelled simulated session from a sample chain", () => {
    const store = createFlowStore();
    const now = toISTDate("2026-10-16", "13:00");
    const sample = generateSampleChain({ symbol: "NIFTY", spot: 25_000, expiry: "2026-10-20", now });
    store.ingest({ symbol: "NIFTY", expiry: "2026-10-20", lotSize: 65, spot: 25_000, chain: sample.chain, source: "sample", asOf: now.getTime(), stale: true, isLive: false, now });
    const feed = store.getState().feeds.NIFTY;
    expect(feed.mode).toBe("sample");
    expect(feed.snaps.length).toBeGreaterThan(40);
    expect(feed.prints.length).toBeGreaterThan(100);
  });
});

describe("simulateSession", () => {
  it("ends exactly at the given chain and is deterministic", () => {
    const now = toISTDate("2026-10-16", "12:00");
    const sample = generateSampleChain({ symbol: "NIFTY", spot: 25_000, expiry: "2026-10-20", now });
    const a = simulateSession({ symbol: "NIFTY", expiry: "2026-10-20", spot: 25_000, chain: sample.chain, now });
    const b = simulateSession({ symbol: "NIFTY", expiry: "2026-10-20", spot: 25_000, chain: sample.chain, now });
    expect(a).toEqual(b);
    const last = a[a.length - 1];
    expect(last.ts).toBe(now.getTime());
    const row = sample.chain.find((r) => r.ce.ltp > 0)!;
    const ce = last.rows.find((r) => r.strike === row.strikePrice && r.side === "CE")!;
    expect(ce.vol).toBe(row.ce.volume);
    expect(ce.oi).toBe(row.ce.oi);
    for (let i = 1; i < a.length; i++) for (let j = 0; j < a[i].rows.length; j++) expect(a[i].rows[j].vol).toBeGreaterThanOrEqual(a[i - 1].rows[j].vol);
  });

  it("covers the previous session before the open", () => {
    const w = sampleSessionWindow(toISTDate("2026-10-19", "08:00"));
    expect(w.date).toBe("2026-10-16");
    expect(w.end).toBe(toISTDate("2026-10-16", "15:30").getTime());
  });
});
