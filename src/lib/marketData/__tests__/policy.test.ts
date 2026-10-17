import { describe, expect, it } from "vitest";
import {
  MINUTE,
  SECOND,
  allIndicesRefetchInterval,
  buildCachedIndices,
  chainMultiRefetchInterval,
  chainRefetchInterval,
  fallbackReason,
  fnoRefetchInterval,
  indicesRefetchInterval,
  isLiveSession,
  marketStatusRefetchInterval,
  meta,
} from "@/lib/marketData/policy";
import type { PriceSnapshot } from "@/lib/localDatabase";

const snap = (symbol: string, ltp: number, timestamp: number): PriceSnapshot => ({
  securityId: "1",
  symbol,
  ltp,
  open: ltp - 10,
  high: ltp + 20,
  low: ltp - 30,
  close: ltp - 5,
  change: 5,
  changePercent: 0.02,
  volume: 0,
  oi: 0,
  timestamp,
});

describe("isLiveSession", () => {
  it("is true only in the pre-open and normal session", () => {
    expect(isLiveSession("open")).toBe(true);
    expect(isLiveSession("pre-open")).toBe(true);
    for (const s of ["closing", "closed", "holiday", "weekend"] as const) expect(isLiveSession(s)).toBe(false);
  });
});

describe("meta", () => {
  it("omits an empty reason and keeps a given one", () => {
    expect(meta("nse", 5)).toEqual({ source: "nse", asOf: 5, stale: false });
    expect(meta("sample", 5, true, "Proxy offline")).toEqual({ source: "sample", asOf: 5, stale: true, reason: "Proxy offline" });
    expect(meta("none", 5, true, "")).not.toHaveProperty("reason");
  });

  it("defaults asOf to now", () => {
    const before = Date.now();
    expect(meta("cache").asOf).toBeGreaterThanOrEqual(before);
  });
});

describe("chainRefetchInterval", () => {
  it("polls a live chain every 3 s in session", () => {
    expect(chainRefetchInterval({ isLive: true, source: "dhan" }, true)).toBe(3 * SECOND);
  });
  it("keeps trying a live source every 20 s while showing sample data", () => {
    expect(chainRefetchInterval({ isLive: false, source: "sample" }, true)).toBe(20 * SECOND);
  });
  it("polls a cached chain every 15 s and an unknown one too", () => {
    expect(chainRefetchInterval({ isLive: false, source: "cache" }, true)).toBe(15 * SECOND);
    expect(chainRefetchInterval(undefined, true)).toBe(15 * SECOND);
  });
  it("slows to 5 min outside the session whatever the source", () => {
    expect(chainRefetchInterval({ isLive: true, source: "dhan" }, false)).toBe(5 * MINUTE);
    expect(chainRefetchInterval({ source: "sample" }, false)).toBe(5 * MINUTE);
  });
});

describe("indicesRefetchInterval", () => {
  it("treats polling as a 2 min backstop while the WebSocket is live", () => {
    expect(indicesRefetchInterval({ wsConnected: true, live: true, isLive: true })).toBe(2 * MINUTE);
  });
  it("polls every 15 s live, 60 s offline, 5 min after hours", () => {
    expect(indicesRefetchInterval({ wsConnected: false, live: true, isLive: true })).toBe(15 * SECOND);
    expect(indicesRefetchInterval({ wsConnected: false, live: true, isLive: false })).toBe(MINUTE);
    expect(indicesRefetchInterval({ wsConnected: false, live: false, isLive: true })).toBe(5 * MINUTE);
  });
  it("uses the IST clock when live is not given", () => {
    const v = indicesRefetchInterval({ wsConnected: false });
    expect([MINUTE, 5 * MINUTE]).toContain(v);
  });
});

describe("other intervals", () => {
  it("all indices", () => {
    expect(allIndicesRefetchInterval({ wsConnected: true, live: true })).toBe(2 * MINUTE);
    expect(allIndicesRefetchInterval({ wsConnected: false, live: false })).toBe(5 * MINUTE);
    expect(allIndicesRefetchInterval({ wsConnected: false, live: true, isLive: true })).toBe(30 * SECOND);
    expect(allIndicesRefetchInterval({ wsConnected: false, live: true, isLive: false })).toBe(2 * MINUTE);
    expect([2 * MINUTE, 5 * MINUTE]).toContain(allIndicesRefetchInterval({ wsConnected: false }));
  });
  it("market status", () => {
    expect(marketStatusRefetchInterval(true, true)).toBe(15 * SECOND);
    expect(marketStatusRefetchInterval(true, false)).toBe(MINUTE);
    expect(marketStatusRefetchInterval(false, true)).toBe(MINUTE);
    expect(marketStatusRefetchInterval(undefined)).toBeGreaterThan(0);
  });
  it("multi-expiry chain", () => {
    expect(chainMultiRefetchInterval(true, false)).toBe(15 * SECOND);
    expect(chainMultiRefetchInterval(false, true)).toBe(MINUTE);
    expect(chainMultiRefetchInterval(false, false)).toBe(5 * MINUTE);
    expect(chainMultiRefetchInterval(undefined)).toBeGreaterThan(0);
  });
  it("F&O movers", () => {
    expect(fnoRefetchInterval(true, true)).toBe(30 * SECOND);
    expect(fnoRefetchInterval(false, true)).toBe(2 * MINUTE);
    expect(fnoRefetchInterval(true, false)).toBe(5 * MINUTE);
    expect(fnoRefetchInterval(undefined)).toBeGreaterThan(0);
  });
});

describe("buildCachedIndices", () => {
  it("maps saved prices to NSE index names in a fixed order with the newest timestamp", () => {
    const out = buildCachedIndices([snap("BANKNIFTY", 55000, 200), snap("NIFTY", 25000, 100), snap("RELIANCE", 1400, 999)]);
    expect(out.data.map((d) => d.symbol)).toEqual(["NIFTY", "BANKNIFTY"]);
    expect(out.data[0]).toMatchObject({ name: "NIFTY 50", ltp: 25000, prevClose: 24995, high: 25020, low: 24970, open: 24990 });
    expect(out.asOf).toBe(200);
  });
  it("is empty for no prices and skips zero prices", () => {
    expect(buildCachedIndices([])).toEqual({ data: [], asOf: 0 });
    expect(buildCachedIndices([snap("NIFTY", 0, 50)]).data).toHaveLength(0);
  });
  it("tolerates a missing timestamp", () => {
    expect(buildCachedIndices([snap("FINNIFTY", 27000, 0)]).asOf).toBe(0);
  });
});

describe("fallbackReason", () => {
  it("maps proxy errors to readable copy", () => {
    expect(fallbackReason(new Error("Proxy unreachable"))).toBe("Proxy offline");
    expect(fallbackReason(new Error("Proxy request timed out"))).toBe("Proxy timed out");
    expect(fallbackReason("timeout")).toBe("Proxy timed out");
    expect(fallbackReason("proxy-offline")).toBe("Proxy offline");
    expect(fallbackReason(new Error("Sample data mode: proxy disabled"))).toMatch(/Sample mode/);
    expect(fallbackReason(new TypeError("Failed to fetch"))).toBe("Proxy offline");
  });
  it("passes other messages through (truncated) and falls back when empty", () => {
    expect(fallbackReason(new Error("Proxy 502: upstream"))).toBe("Proxy 502: upstream");
    expect(fallbackReason(new Error("x".repeat(400))).length).toBe(160);
    expect(fallbackReason(undefined)).toBe("Proxy offline");
    expect(fallbackReason(null, "fallback")).toBe("fallback");
  });
});
