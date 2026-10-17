import { describe, expect, it, vi } from "vitest";
import type { BhavcopyFoRow } from "@/lib/types/market";
import { attachVix, compactBhavcopy, lastBhavcopyDate, loadDays, lookbackDates, memoryCache, vixByDate } from "../data";

const row = (p: Partial<BhavcopyFoRow>): BhavcopyFoRow => ({ symbol: "NIFTY", expiry: "2026-02-10", strike: 25_000, type: "CE", close: 100, settle: 101, oi: 1, chgOi: 0, volume: 1, underlyingClose: 25_010, ...p });

describe("compactBhavcopy", () => {
  it("groups by expiry, keeps the strike band and falls back to the settlement price", () => {
    const rows = [
      row({}),
      row({ type: "PE", close: 0, settle: 90 }),
      row({ strike: 24_900, type: "PE", close: 60 }),
      row({ strike: 40_000, close: 1 }), // outside ±20%
      row({ type: "FUT", strike: 0, close: 25_080 }),
      row({ expiry: "2026-02-17", strike: 25_100, close: 120 }),
      row({ symbol: "BANKNIFTY", close: 999 }),
      row({ expiry: "2026-01-27" }), // already expired
    ];
    const d = compactBhavcopy(rows, "NIFTY", "2026-02-03", 13.2)!;
    expect(d.spot).toBe(25_010);
    expect(d.vix).toBe(13.2);
    expect(d.chains.map((c) => c.expiry)).toEqual(["2026-02-10", "2026-02-17"]);
    const c = d.chains[0];
    expect(c.strikes).toEqual([24_900, 25_000]);
    expect(c.ce).toEqual([null, 100]);
    expect(c.pe).toEqual([60, 90]);
    expect(c.fut).toBe(25_080);
  });
  it("uses the futures close when the file has no underlying close", () => {
    const d = compactBhavcopy([row({ underlyingClose: 0 }), row({ type: "FUT", strike: 0, close: 25_050, underlyingClose: 0 })], "NIFTY", "2026-02-03")!;
    expect(d.spot).toBe(25_050);
  });
  it("returns null without rows for the symbol", () => {
    expect(compactBhavcopy([], "NIFTY", "2026-02-03")).toBeNull();
    expect(compactBhavcopy([row({ symbol: "X" })], "NIFTY", "2026-02-03")).toBeNull();
  });
});

describe("dates and VIX", () => {
  it("lookback covers trading days only", () => {
    const d = lookbackDates("2026-02-27", 1);
    expect(d[0]).toBe("2026-01-27");
    expect(d.at(-1)).toBe("2026-02-27");
    expect(d).not.toContain("2026-02-01");
  });
  it("the last bhavcopy is today only after 19:00 IST on a trading day", () => {
    expect(lastBhavcopyDate(new Date("2026-02-04T14:00:00Z"))).toBe("2026-02-04"); // 19:30 IST
    expect(lastBhavcopyDate(new Date("2026-02-04T08:00:00Z"))).toBe("2026-02-03");
    expect(lastBhavcopyDate(new Date("2026-02-08T08:00:00Z"))).toBe("2026-02-06"); // Sunday
  });
  it("attaches VIX by date", () => {
    const m = vixByDate([{ date: "2026-02-03", close: 13 }, { date: "bad", close: Number.NaN }]);
    const [a, b] = attachVix([{ date: "2026-02-03", spot: 1, vix: null, chains: [] }, { date: "2026-02-04", spot: 1, vix: null, chains: [] }], m);
    expect(a.vix).toBe(13);
    expect(b.vix).toBeNull();
  });
});

describe("loadDays", () => {
  const dates = ["2026-02-02", "2026-02-03", "2026-02-04"];
  it("fetches misses, caches them and serves the next load from the cache", async () => {
    const cache = memoryCache();
    const fetchDay = vi.fn(async (date: string) => ({ rows: date === "2026-02-04" ? [] : [row({})] }));
    const first = await loadDays({ symbol: "NIFTY", dates, fetchDay, cache, concurrency: 2 });
    expect(fetchDay).toHaveBeenCalledTimes(3);
    expect(first.days.map((d) => d.date)).toEqual(["2026-02-02", "2026-02-03"]);
    expect(first.answered).toBe(3);
    const progress: number[] = [];
    const second = await loadDays({ symbol: "NIFTY", dates, fetchDay, cache, onProgress: (p) => progress.push(p.done) });
    expect(fetchDay).toHaveBeenCalledTimes(3);
    expect(second.cached).toBe(3);
    expect(second.days).toHaveLength(2);
    expect(progress.at(-1)).toBe(3);
  });
  it("stops early when the proxy is offline", async () => {
    const fetchDay = vi.fn(async () => ({ rows: null, reason: "proxy-offline" }));
    const res = await loadDays({ symbol: "NIFTY", dates: [...dates, "2026-02-05", "2026-02-06", "2026-02-09"], fetchDay, cache: memoryCache(), concurrency: 1 });
    expect(fetchDay).toHaveBeenCalledTimes(1);
    expect(res.answered).toBe(0);
    expect(res.reason).toBe("proxy-offline");
  });
  it("rejects with an AbortError when cancelled", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(loadDays({ symbol: "NIFTY", dates, fetchDay: async () => ({ rows: [] }), cache: memoryCache(), signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
