import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const db = vi.hoisted(() => ({ impl: null as null | (() => Promise<unknown[]>) }));

vi.mock("@/lib/localDatabase", () => ({
  getAllPriceSnapshots: vi.fn(() => (db.impl ? db.impl() : Promise.resolve([]))),
  getCandleHistory: vi.fn(async () => null),
}));

import { invalidateLocalPriceCache, useAllIndices, useExpiryList, useFnOStocks, useLiveIndices, useMarketStatus } from "@/hooks/useMarketData";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const SAVED_AT = 1_760_000_000_000;

describe("legacy proxy routes answering with a last saved copy", () => {
  beforeEach(() => {
    invalidateLocalPriceCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("endpoint=market-status")) return json({ marketState: [{ market: "Capital Market", marketStatus: "Open" }], stale: true, cachedAt: SAVED_AT });
        if (url.includes("endpoint=indices")) {
          return json({ data: [{ index: "NIFTY 50", last: 25000, variation: 10, percentChange: 0.04, advances: 30, declines: 20 }, { index: "INDIA VIX", last: 12 }], stale: true, cachedAt: SAVED_AT });
        }
        if (url.includes("endpoint=equity-derivatives")) return json({ data: [{ symbol: "SBIN", lastPrice: 800, pChange: 1, totalTradedVolume: 10, openInterest: 5 }], stale: true, cachedAt: SAVED_AT });
        if (url.includes("/api/tv-scan")) return json({ error: "down" }, 502);
        if (url.includes("/api/dhan-proxy")) return json({ error: "No Dhan keys" }, 401);
        if (url.includes("endpoint=option-chain")) return json({ records: { expiryDates: ["20-Oct-2026", "27-Oct-2026"] } });
        return json({}, 404);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("useMarketStatus does not show a saved 'Open' as live; it uses the IST clock", async () => {
    const { result } = renderHook(() => useMarketStatus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({ isLive: false, stale: true, giftNifty: null });
    expect(result.current.data?.reason).toMatch(/IST clock/);
  });

  it("useLiveIndices labels saved index prices as stale, dated by cachedAt", async () => {
    const { result } = renderHook(() => useLiveIndices(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data.data.length).toBe(1));
    expect(result.current.data.isLive).toBe(false);
    expect(result.current.stale).toBe(true);
    expect(result.current.asOf).toBe(SAVED_AT);
    expect(result.current.data.reason).toMatch(/last saved/);
  });

  it("useAllIndices labels a saved snapshot as stale", async () => {
    const { result } = renderHook(() => useAllIndices(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data.vix).not.toBeNull());
    expect(result.current.data).toMatchObject({ isLive: false, stale: true, asOf: SAVED_AT });
  });

  it("useFnOStocks labels a saved list as stale", async () => {
    const { result } = renderHook(() => useFnOStocks(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({ isLive: false, stale: true, asOf: SAVED_AT });
    expect(result.current.data?.allStocks).toHaveLength(1);
  });

  it("useExpiryList names NSE when the Dhan expiry list is unavailable", async () => {
    const { result } = renderHook(() => useExpiryList("NIFTY"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({ isLive: true, source: "nse" });
    expect(result.current.data?.expiries.map((e) => e.value)).toEqual(["2026-10-20", "2026-10-27"]);
  });
});

describe("local price cache invalidation", () => {
  afterEach(() => {
    db.impl = null;
    vi.unstubAllGlobals();
  });

  it("a read already in flight does not write its old snapshot back after invalidate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    invalidateLocalPriceCache();
    const row = (symbol: string, ltp: number) => ({ securityId: "1", symbol, ltp, open: ltp, high: ltp, low: ltp, close: ltp, change: 0, changePercent: 0, volume: 1, oi: 0, timestamp: 1_700_000_000_000 });
    let release: (rows: unknown[]) => void = () => undefined;
    db.impl = () => new Promise((r) => { release = r; });

    const first = renderHook(() => useFnOStocks(), { wrapper: wrapper() });
    await waitFor(() => expect(db.impl).toBeTruthy());
    await new Promise((r) => setTimeout(r, 10));
    // The database is updated while that read is still running.
    invalidateLocalPriceCache();
    release([row("OLD", 1)]);
    await waitFor(() => expect(first.result.current.data).toBeDefined());

    db.impl = async () => [row("NEW", 2)];
    const second = renderHook(() => useFnOStocks(), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.data).toBeDefined());
    expect(second.result.current.data?.allStocks.map((s) => s.symbol)).toEqual(["NEW"]);
  });
});
