// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { generateSampleChain, getExpiries } from "@/lib/options";

const expiry = getExpiries("NIFTY", new Date(), 1)[0].date;
const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry });

vi.mock("@/lib/marketApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/marketApi")>()),
  fetchChainMulti: vi.fn(async () => ({
    data: { spot: 25000, expiries: [{ expiry, chain }] },
    meta: { source: "live", asOf: Date.now(), stale: false },
  })),
}));
vi.mock("@/lib/api/proxyClient", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/proxyClient")>()),
  proxyGet: vi.fn(async () => ({ data: null, meta: { source: "cache", asOf: Date.now(), stale: true, reason: "offline" } })),
  proxyFetchJSON: vi.fn(async () => {
    throw new Error("Proxy unreachable");
  }),
}));
vi.mock("@/lib/snapshotStore", async (orig) => ({
  ...(await orig<typeof import("@/lib/snapshotStore")>()),
  getDailyStats: vi.fn(async () => []),
  putDailyStat: vi.fn(async () => undefined),
}));

import { useRotatingScan } from "../useScreener";

const CACHE_KEY = "mc_screener_scan_v1";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useRotatingScan persistence", () => {
  it("flushes a result that lands just before unmount instead of dropping it", async () => {
    const { result, unmount } = renderHook(() => useRotatingScan(["NIFTY"], true));
    // First tick fires after the scan interval; let the mocked chain job resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(result.current.entries.NIFTY?.chain).toBeTruthy();
    // Still inside the 2 s debounce: nothing written yet.
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    unmount();
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
    expect(saved.NIFTY?.chain).toBeTruthy();
  });
});
