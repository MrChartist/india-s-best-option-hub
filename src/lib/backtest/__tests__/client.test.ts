import { describe, expect, it } from "vitest";
import { isAbortError, runBacktest } from "../client";
import { generateSampleDataset, SAMPLE_RANGE, tradingDaysInRange } from "../sampleData";
import { baseConfig } from "./fixtures";

const cfg = baseConfig({ from: "2026-06-01", to: SAMPLE_RANGE.to, profitPct: 50, stopPct: 100 });

describe("runBacktest", () => {
  it("falls back to the main thread without Worker and reports progress", async () => {
    const phases = new Set<string>();
    const { output, mode } = await runBacktest({ config: cfg, data: { kind: "sample" } }, { onProgress: (p) => phases.add(p.phase) });
    expect(mode).toBe("main-thread");
    expect(output.source).toBe("sample");
    expect(output.trades.length).toBeGreaterThan(5);
    expect([...phases]).toEqual(expect.arrayContaining(["prepare", "simulate", "stats"]));
  });
  it("accepts a ready dataset", async () => {
    const ds = { ...generateSampleDataset("NIFTY", { from: "2026-06-01", to: SAMPLE_RANGE.to }), source: "bhavcopy" as const };
    const { output } = await runBacktest({ config: cfg, data: { kind: "dataset", dataset: ds } }, { noWorker: true });
    expect(output.source).toBe("bhavcopy");
  });
  it("cancels", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runBacktest({ config: cfg, data: { kind: "sample" } }, { signal: ac.signal })).rejects.toSatisfy(isAbortError);
  });
});

describe("sample dataset", () => {
  it("covers about a year of sessions with VIX and several expiries per day", () => {
    const ds = generateSampleDataset("BANKNIFTY");
    expect(ds.source).toBe("sample");
    expect(ds.days.length).toBe(tradingDaysInRange(SAMPLE_RANGE.from, SAMPLE_RANGE.to).length);
    expect(ds.days.length).toBeGreaterThan(240);
    for (const d of ds.days) {
      expect(d.vix).toBeGreaterThan(9);
      expect(d.chains.length).toBeGreaterThanOrEqual(3);
      for (const c of d.chains) expect(c.strikes.length).toBe(c.ce.length);
    }
    // BANKNIFTY is monthly-only: every expiry is a last-Tuesday (or the trading day before it).
    const expiries = new Set(ds.days.flatMap((d) => d.chains.map((c) => c.expiry)));
    for (const e of expiries) expect(+e.slice(8, 10)).toBeGreaterThanOrEqual(22);
  });
  it("is identical across calls and a sub-range is a slice of the same history", () => {
    const a = generateSampleDataset("NIFTY");
    const b = generateSampleDataset("NIFTY", { from: "2026-03-02", to: "2026-03-31" });
    const same = a.days.find((d) => d.date === b.days[0].date)!;
    expect(b.days[0].spot).toBe(same.spot);
    expect(b.days[0].vix).toBe(same.vix);
    expect(generateSampleDataset("NIFTY").days[100]).toEqual(a.days[100]);
  });
});
