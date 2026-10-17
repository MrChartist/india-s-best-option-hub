import { describe, expect, it } from "vitest";
import { FAILURE_COOLDOWN_MS, isChainStale, needsPart, parseEntries, pickNextJob, prioritise, pruneEntries, scanCoverage, scanTtl, type ScanEntries } from "../scanner";

const ttl = scanTtl(true);
const chain = (asOf: number) => ({ pcrOi: 1, pcrVol: 1, atmIv: 20, ivp: null, expiry: "2026-10-27", spot: 100, source: "nse", asOf });
const fut = (asOf: number) => ({ nearExpiry: null, nearPrice: null, underlying: null, futOi: 0, futOiChgPct: null, basis: null, basisPct: null, carryPct: null, rolloverPct: null, futDte: null, eodPcr: null, asOfDate: null, asOf });

describe("scheduling", () => {
  const now = 10 * 3600000;
  it("ttl differs in and out of session", () => {
    expect(scanTtl(false).chain).toBeGreaterThan(ttl.chain);
  });
  it("picks parts in order and respects priority", () => {
    const entries: ScanEntries = { A: { chain: chain(now), futures: fut(now), history: { bars: [], asOf: now } }, B: { chain: chain(now) } };
    expect(pickNextJob(["A", "B"], entries, now, ttl)).toEqual({ symbol: "B", part: "futures" });
    expect(pickNextJob(["C", "A"], entries, now, ttl)).toEqual({ symbol: "C", part: "chain" });
    expect(pickNextJob(["A"], entries, now, ttl)).toBeNull();
    expect(pickNextJob(["B"], entries, now, ttl, (_s, p) => p !== "chain")).toBeNull();
  });
  it("refreshes expired parts and cools down failures", () => {
    const e = { chain: chain(now - ttl.chain - 1), failedAt: { futures: now - 1000 } };
    expect(needsPart(e, "chain", now, ttl)).toBe(true);
    expect(needsPart(e, "futures", now, ttl)).toBe(false);
    expect(needsPart(e, "futures", now + FAILURE_COOLDOWN_MS, ttl)).toBe(true);
    expect(isChainStale(e, now, ttl)).toBe(true);
    expect(isChainStale(undefined, now, ttl)).toBe(false);
  });
  it("coverage", () => {
    const entries: ScanEntries = { A: { chain: chain(now) }, B: { chain: chain(now - ttl.chain - 5) } };
    expect(scanCoverage(["A", "B", "C"], entries, now, ttl)).toEqual({ done: 2, fresh: 1, total: 3 });
  });
  it("prioritise dedupes", () => {
    expect(prioritise(["B", "B", ""], ["A", "B", "C"])).toEqual(["B", "A", "C"]);
  });
});

describe("persistence", () => {
  it("prunes old parts and parses defensively", () => {
    const now = 1e9;
    const pruned = pruneEntries({ A: { chain: chain(now - 10), futures: fut(now - 1e8) }, B: { futures: fut(0) } }, now, 1e6);
    expect(Object.keys(pruned)).toEqual(["A"]);
    expect(pruned.A.futures).toBeUndefined();
    expect(parseEntries(null)).toEqual({});
    const parsed = parseEntries({ A: { chain: chain(1) }, "bad sym": { chain: chain(1) }, C: { history: { asOf: 1 } }, D: 5 });
    expect(Object.keys(parsed)).toEqual(["A"]);
  });
});
