import { afterEach, describe, expect, it, vi } from "vitest";
import { toISTDate } from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import { IDLE_FEED_MS, createFlowStore } from "../flowStore";

const T0 = toISTDate("2026-10-16", "10:00").getTime();
const chain: OptionData[] = [
  { strikePrice: 25_000, ce: { ltp: 100, oi: 5000, oiChange: 0, volume: 1000, iv: 14, delta: 0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 99, askPrice: 100 }, pe: { ltp: 90, oi: 5000, oiChange: 0, volume: 100, iv: 14, delta: -0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 89, askPrice: 91 } },
];
const base = { expiry: "2026-10-20", lotSize: 65, spot: 25_010, chain, source: "nse", stale: false, isLive: true, asOf: T0 };

afterEach(() => vi.useRealTimers());

describe("flowStore retain / release", () => {
  it("keeps a feed while any holder retains it and drops it on the last release", () => {
    const store = createFlowStore();
    const a = store.retain("nifty");
    const b = store.retain("NIFTY");
    store.ingest({ ...base, symbol: "NIFTY" });
    a();
    a(); // idempotent
    expect(store.getState().feeds.NIFTY).toBeDefined();
    b();
    expect(store.getState().feeds.NIFTY).toBeUndefined();
  });

  it("prunes unretained feeds that have gone idle when another symbol ingests", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const store = createFlowStore();
    store.ingest({ ...base, symbol: "BANKNIFTY" });
    const held = store.retain("FINNIFTY");
    store.ingest({ ...base, symbol: "FINNIFTY" });
    vi.setSystemTime(T0 + IDLE_FEED_MS + 1);
    store.ingest({ ...base, symbol: "NIFTY" });
    const feeds = store.getState().feeds;
    expect(feeds.BANKNIFTY).toBeUndefined();
    expect(feeds.FINNIFTY).toBeDefined();
    expect(feeds.NIFTY).toBeDefined();
    held();
  });
});
