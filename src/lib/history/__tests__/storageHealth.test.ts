import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ESTIMATE_THROTTLE_MS,
  QUOTA_ERROR_BACKOFF_MS,
  canWrite,
  clearQuotaPause,
  getStorageHealth,
  isNearQuota,
  isQuotaError,
  noteWriteError,
  refreshStorageHealth,
  resetStorageHealth,
  subscribeStorageHealth,
} from "../storageHealth";

function stubStorage(usage: number, quota: number, persist = true) {
  const estimate = vi.fn(async () => ({ usage, quota }));
  const persistFn = vi.fn(async () => persist);
  vi.stubGlobal("navigator", { storage: { estimate, persist: persistFn, persisted: async () => false } });
  return { estimate, persistFn };
}

describe("storage health", () => {
  beforeEach(() => resetStorageHealth());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorageHealth();
  });

  it("classifies quota ratios and quota errors", () => {
    expect(isNearQuota(80, 100)).toBe(true);
    expect(isNearQuota(79, 100)).toBe(false);
    expect(isNearQuota(null, 100)).toBe(false);
    expect(isNearQuota(10, 0)).toBe(false);
    expect(isQuotaError(new DOMException("x", "QuotaExceededError"))).toBe(true);
    expect(isQuotaError({ name: "Error", message: "Quota exceeded for origin" })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error("Transaction aborted"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it("requests persistence once and reports usage", async () => {
    const { persistFn } = stubStorage(30, 100, true);
    resetStorageHealth();
    const seen: number[] = [];
    const off = subscribeStorageHealth((h) => h.ratio !== null && seen.push(h.ratio));
    const h = await refreshStorageHealth(1000);
    await refreshStorageHealth(2000);
    off();
    expect(persistFn).toHaveBeenCalledTimes(1);
    expect(h).toMatchObject({ supported: true, usage: 30, quota: 100, ratio: 0.3, persisted: true, paused: false });
    expect(seen).toContain(0.3);
  });

  it("pauses writes above 80% of the quota and resumes below it", async () => {
    stubStorage(85, 100);
    expect(await canWrite(1000)).toBe(false);
    expect(getStorageHealth()).toMatchObject({ paused: true, pauseReason: "near-quota", skippedWrites: 1 });
    stubStorage(50, 100);
    expect(await canWrite(1000 + 1000)).toBe(false); // throttled: no new estimate yet
    expect(await canWrite(1000 + ESTIMATE_THROTTLE_MS)).toBe(true);
    expect(getStorageHealth().paused).toBe(false);
  });

  it("backs off after a QuotaExceededError until the backoff ends or space is freed", async () => {
    stubStorage(10, 100);
    const t = 10_000;
    noteWriteError(new DOMException("full", "QuotaExceededError"), t);
    expect(getStorageHealth()).toMatchObject({ paused: true, pauseReason: "quota-error", lastErrorAt: t });
    expect(await canWrite(t + 1000)).toBe(false);
    expect(await canWrite(t + QUOTA_ERROR_BACKOFF_MS + 1)).toBe(true);
    noteWriteError(new DOMException("full", "QuotaExceededError"), t + QUOTA_ERROR_BACKOFF_MS + 2);
    clearQuotaPause();
    expect(await canWrite(t + QUOTA_ERROR_BACKOFF_MS + 3)).toBe(true);
  });

  it("remembers other write errors without pausing", () => {
    noteWriteError(new Error("Transaction aborted"), 5);
    expect(getStorageHealth()).toMatchObject({ paused: false, lastError: "Transaction aborted", lastErrorAt: 5 });
  });

  it("allows writes when the browser cannot estimate storage", async () => {
    vi.stubGlobal("navigator", {});
    resetStorageHealth();
    expect(await canWrite(1)).toBe(true);
    expect(getStorageHealth().supported).toBe(false);
  });
});
