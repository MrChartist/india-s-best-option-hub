import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markProxyOnline, resetProxyGate } from "@/lib/api/proxyClient";
import { HYDRATE_GAP_MS, MAX_HYDRATE_RANGES, hydrateSnapshots, isProxyReachable, missingRanges, resetHydrateMemory, sanitiseServerSnapshots, sessionStartToday } from "../hydrate";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const MIN = 60_000;

describe("missingRanges", () => {
  const from = 1_000_000;
  const to = from + 60 * MIN;

  it("asks for the whole window when nothing is stored", () => {
    expect(missingRanges([], from, to)).toEqual([[from, to]]);
    expect(missingRanges([to + 5], from, to)).toEqual([[from, to]]);
    expect(missingRanges([], to, from)).toEqual([]);
  });

  it("finds the lead-in, interior gaps and the tail", () => {
    const ts = [from + 10 * MIN, from + 11 * MIN, from + 30 * MIN, from + 31 * MIN];
    expect(missingRanges(ts, from, to)).toEqual([
      [from, from + 10 * MIN - 1],
      [from + 11 * MIN + 1, from + 30 * MIN - 1],
      [from + 31 * MIN + 1, to],
    ]);
  });

  it("ignores gaps shorter than the threshold", () => {
    const ts = Array.from({ length: 61 }, (_, i) => from + i * MIN);
    expect(missingRanges(ts, from, to, HYDRATE_GAP_MS)).toEqual([]);
  });

  it("keeps only the longest ranges, in time order", () => {
    const ts = [0, 10, 12, 30, 32, 40, 42, 70, 72, 100].map((m) => from + m * MIN);
    const out = missingRanges(ts, from, from + 100 * MIN);
    expect(out).toHaveLength(MAX_HYDRATE_RANGES);
    expect(out.map((r) => r[0])).toEqual([...out.map((r) => r[0])].sort((a, b) => a - b));
    expect(out.some((r) => r[0] === from + 42 * MIN + 1)).toBe(true); // the 28-minute gap
  });
});

describe("sanitiseServerSnapshots", () => {
  it("normalises valid snapshots and drops junk", () => {
    const out = sanitiseServerSnapshots({
      snapshots: [
        { symbol: "nifty", expiry: "20-Oct-2026", ts: 2000, spot: 25000, rows: [{ strike: 25000, side: "CE", ltp: 100, oi: 5, vol: 1, iv: 12, bid: 99, ask: 101, bidQty: 75 }, { strike: -1, side: "CE" }, { strike: 1, side: "XX" }] },
        { symbol: "NIFTY", expiry: "2026-10-20", ts: 1000, spot: "bad", rows: [{ strike: 25000, side: "PE", ltp: -3, oi: 5 }] },
        { symbol: "NIFTY", expiry: "nope", ts: 3000, rows: [{ strike: 1, side: "CE" }] },
        { symbol: "NIFTY", expiry: "2026-10-20", ts: 4000, rows: [] },
        null,
      ],
    });
    expect(out.map((s) => s.ts)).toEqual([1000, 2000]);
    expect(out[1]).toMatchObject({ id: "NIFTY|2026-10-20|2000", symbol: "NIFTY", expiry: "2026-10-20", spot: 25000 });
    expect(out[1].rows).toEqual([{ strike: 25000, side: "CE", ltp: 100, oi: 5, vol: 1, iv: 12, bid: 99, ask: 101, bidQty: 75 }]);
    expect(out[0].spot).toBe(0);
    expect(out[0].rows[0].ltp).toBe(0);
    expect(sanitiseServerSnapshots("nope")).toEqual([]);
  });
});

describe("hydrateSnapshots", () => {
  beforeEach(() => {
    resetProxyGate();
    resetHydrateMemory();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetProxyGate();
  });

  it("does nothing until the proxy has answered", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(isProxyReachable()).toBe(false);
    expect(await hydrateSnapshots("NIFTY", "2026-10-20")).toMatchObject({ imported: 0, reason: "proxy-offline" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the missing range once per minute and passes the query", async () => {
    markProxyOnline();
    const now = Date.UTC(2026, 9, 16, 6, 0);
    const fetchMock = vi.fn(async () => json({ data: { symbol: "NIFTY", expiry: "2026-10-20", from: 0, to: 0, snapshots: [] }, meta: { source: "cache", asOf: now, stale: false } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await hydrateSnapshots("nifty", "20-Oct-2026", { now });
    expect(res).toMatchObject({ imported: 0, requested: 1 });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/api/x/snapshots");
    expect(url.searchParams.get("symbol")).toBe("NIFTY");
    expect(url.searchParams.get("expiry")).toBe("2026-10-20");
    expect(Number(url.searchParams.get("from"))).toBe(sessionStartToday(new Date(now)));
    expect(Number(url.searchParams.get("to"))).toBe(now);
    expect(await hydrateSnapshots("NIFTY", "2026-10-20", { now: now + 1000 })).toMatchObject({ reason: "throttled" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable recorder without throwing", async () => {
    markProxyOnline();
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: null, meta: { source: "cache", asOf: 1, stale: true, reason: "Unknown /api/x route" } }, 404)));
    expect(await hydrateSnapshots("NIFTY", "2026-10-20", { now: Date.UTC(2026, 9, 16, 6, 0) })).toMatchObject({ imported: 0, reason: "unavailable" });
  });
});
