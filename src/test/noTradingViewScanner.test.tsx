/**
 * Option Hub's market data comes from brokers and exchanges only. These tests guard against the
 * removed TradingView scanner source (/api/tv-scan, scanner.tradingview.com) coming back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const db = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/localDatabase", () => ({
  getAllPriceSnapshots: vi.fn(async () => db.rows),
  getCandleHistory: vi.fn(async () => null),
}));

import { invalidateLocalPriceCache, useFnOStocks } from "@/hooks/useMarketData";
import { fetchLiveFnOStocks } from "@/lib/marketApi";

const ROOT = resolve(__dirname, "../..");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("no TradingView scanner data source", () => {
  it("proxy-server.mjs has no /api/tv-scan route and never calls the TradingView scanner", () => {
    const src = readFileSync(resolve(ROOT, "proxy-server.mjs"), "utf8");
    expect(src).not.toContain("/api/tv-scan");
    expect(src).not.toMatch(/tradingview\.com/i);
    expect(src).not.toMatch(/handleTradingViewScan/);
  });

  it("marketApi.ts has no TradingView fetcher or request", () => {
    const src = readFileSync(resolve(ROOT, "src/lib/marketApi.ts"), "utf8");
    expect(src).not.toMatch(/tradingview|tv-scan|fetchTradingView/i);
  });

  describe("F&O stocks when NSE fails", () => {
    const urls: string[] = [];

    beforeEach(() => {
      urls.length = 0;
      db.rows = [];
      invalidateLocalPriceCache();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          urls.push(String(input));
          return json({ error: "NSE equity-derivatives unavailable" }, 502);
        }),
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it("fetchLiveFnOStocks rejects without requesting TradingView", async () => {
      await expect(fetchLiveFnOStocks()).rejects.toThrow();
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.some((u) => /tradingview|tv-scan/i.test(u))).toBe(false);
    });

    it("useFnOStocks falls back to the local database, labelled as saved", async () => {
      db.rows = [{ securityId: "1", symbol: "SBIN", ltp: 800, open: 790, high: 805, low: 788, close: 792, change: 8, changePercent: 1, volume: 10, oi: 5, timestamp: 1_760_000_000_000 }];
      const { result } = renderHook(() => useFnOStocks(), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.data).toBeDefined());
      expect(result.current.data).toMatchObject({ source: "database", isLive: false, stale: true, asOf: 1_760_000_000_000 });
      expect(urls.some((u) => /tradingview|tv-scan/i.test(u))).toBe(false);
    });

    it("useFnOStocks reports no data (source none) when the database is empty, so pages show sample data", async () => {
      const { result } = renderHook(() => useFnOStocks(), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.data).toBeDefined());
      expect(result.current.data).toMatchObject({ source: "none", isLive: false, stale: true });
      expect(result.current.data?.allStocks).toEqual([]);
    });
  });
});
