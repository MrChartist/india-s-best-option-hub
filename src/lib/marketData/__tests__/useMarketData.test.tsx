// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const prices = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/localDatabase", () => ({
  getAllPriceSnapshots: vi.fn(async () => prices.rows),
  getCandleHistory: vi.fn(async () => null),
}));

import {
  useAllIndices,
  useChainMulti,
  useExpiryList,
  useFnOStocks,
  useLiveIndices,
  useLiveOptionChain,
  useMarketStatus,
  useProxyHealth,
  invalidateLocalPriceCache,
} from "@/hooks/useMarketData";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("market-data hooks with the proxy unreachable", () => {
  beforeEach(() => {
    prices.rows = [];
    invalidateLocalPriceCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("useLiveOptionChain falls back to a labelled sample chain", async () => {
    const { result } = renderHook(() => useLiveOptionChain("NIFTY"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const d = result.current.data!;
    expect(d.source).toBe("sample");
    expect(d.stale).toBe(true);
    expect(d.isLive).toBe(false);
    expect(d.reason).toBe("Proxy offline");
    expect(d.chain.length).toBeGreaterThan(0);
    expect(d.lotSize).toBeGreaterThan(0);
  });

  it("useChainMulti falls back to sample chains per expiry with a reason", async () => {
    const { result } = renderHook(() => useChainMulti("BANKNIFTY", "next3"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const d = result.current.data!;
    expect(d.source).toBe("sample");
    expect(d.stale).toBe(true);
    expect(d.reason).toBeTruthy();
    expect(d.expiries.length).toBe(3);
  });

  it("useExpiryList derives expiries from the calendar and says so", async () => {
    const { result } = renderHook(() => useExpiryList("NIFTY"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const d = result.current.data!;
    expect(d.source).toBe("sample");
    expect(d.stale).toBe(true);
    expect(d.reason).toMatch(/SEBI/);
    expect(d.expiries.length).toBeGreaterThan(0);
  });

  it("useLiveIndices shows no prices (never fake ones) with a reason", async () => {
    const { result } = renderHook(() => useLiveIndices(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.data).toEqual([]);
    expect(result.current.stale).toBe(true);
    expect(result.current.source).toBe("none");
    expect(result.current.data.reason).toBe("Proxy offline");
  });

  it("useLiveIndices uses prices saved in the local database, labelled as such", async () => {
    prices.rows = [{ securityId: "13", symbol: "NIFTY", ltp: 25000, open: 1, high: 1, low: 1, close: 24900, change: 100, changePercent: 0.4, volume: 0, oi: 0, timestamp: 1_700_000_000_000 }];
    const { result } = renderHook(() => useLiveIndices(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data.data.length).toBe(1));
    expect(result.current.source).toBe("database");
    expect(result.current.asOf).toBe(1_700_000_000_000);
    expect(result.current.data.reason).toMatch(/local database/);
  });

  it("useMarketStatus derives the session from the IST clock", async () => {
    const { result } = renderHook(() => useMarketStatus(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({ isLive: false, stale: true, giftNifty: null });
    expect(result.current.data?.reason).toMatch(/IST clock/);
  });

  it("useAllIndices and useFnOStocks return empty, stale results with a reason", async () => {
    const all = renderHook(() => useAllIndices(), { wrapper: wrapper() });
    await waitFor(() => expect(all.result.current.isLoading).toBe(false));
    expect(all.result.current.data).toMatchObject({ vix: null, isLive: false, stale: true, reason: "Proxy offline" });

    const fno = renderHook(() => useFnOStocks(), { wrapper: wrapper() });
    await waitFor(() => expect(fno.result.current.data).toBeDefined());
    expect(fno.result.current.data).toMatchObject({ source: "none", stale: true, reason: "Proxy offline", allStocks: [] });
  });

  it("useProxyHealth reports the proxy as unreachable", async () => {
    const { result } = renderHook(() => useProxyHealth(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({ reachable: false, status: "offline", stale: true, reason: "Proxy offline" });
  });
});
