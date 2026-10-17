import { describe, expect, it } from "vitest";
import { generateSampleChain, toISTDate } from "@/lib/options";
import {
  derivePrintsFromSeries,
  hedgeFlowCr,
  hedgePressureReading,
  hedgePressureSeries,
  hedgePressureSummary,
  hedgePrintCount,
  printDelta,
  simulateSession,
  type HedgePrint,
} from "@/lib/flow";

const EXP = "2026-10-20";
const T1 = toISTDate("2026-10-16", "10:00").getTime();

function pr(o: Partial<HedgePrint> = {}): HedgePrint {
  return {
    ts: T1,
    symbol: "NIFTY",
    expiry: EXP,
    strike: 25_000,
    type: "CE",
    ltp: 180,
    dOI: 1_000,
    dte: 4,
    spot: 25_000,
    lotSize: 65,
    ...o,
  };
}

const fmt = (v: number) => `₹${v.toFixed(1)} Cr`;

describe("printDelta", () => {
  it("is about 0.5 at the money, positive for calls and negative for puts", () => {
    const c = printDelta(pr());
    const p = printDelta(pr({ type: "PE", ltp: 160 }));
    expect(c).toBeGreaterThan(0.4);
    expect(c).toBeLessThan(0.65);
    expect(p).toBeLessThan(-0.35);
    expect(p).toBeGreaterThan(-0.6);
  });

  it("uses intrinsic delta once expired and falls back when the LTP cannot be inverted", () => {
    const after = toISTDate(EXP, "15:45").getTime();
    expect(printDelta(pr({ ts: after, spot: 25_100 }))).toBe(1);
    expect(printDelta(pr({ ts: after, spot: 24_900 }))).toBe(0);
    expect(printDelta(pr({ ts: after, type: "PE", spot: 24_900 }))).toBe(-1);
    const fallback = printDelta(pr({ ltp: 0 }));
    expect(fallback).toBeGreaterThan(0.4);
    expect(fallback).toBeLessThan(0.65);
    expect(printDelta(pr({ spot: 0 }))).toBe(0);
  });
});

describe("hedgeFlowCr", () => {
  it("is dOI × delta × lot × spot in crore", () => {
    // 1,000 contracts × 0.5 × 65 × 25,000 = ₹81.25 Cr
    expect(hedgeFlowCr(pr(), 0.5)).toBeCloseTo(81.25, 6);
    expect(hedgeFlowCr(pr({ dOI: -1_000 }), 0.5)).toBeCloseTo(-81.25, 6);
    expect(hedgeFlowCr(pr({ lotSize: 0 }), 0.5)).toBeCloseTo(81.25 / 65, 6);
    expect(hedgeFlowCr(pr({ dOI: NaN }), 0.5)).toBe(0);
  });
});

describe("hedgePressureSeries", () => {
  const prints: HedgePrint[] = [
    pr({ ts: T1, dOI: 1_000 }),
    pr({ ts: T1 + 60_000, type: "PE", ltp: 160, dOI: 2_000 }),
    pr({ ts: T1 + 6 * 60_000, dOI: -500, dte: 0, spot: 25_050 }),
    pr({ ts: T1 + 6 * 60_000, symbol: "BANKNIFTY", dOI: 9_999 }),
    pr({ ts: T1 + 7 * 60_000, dOI: 0 }),
  ];

  it("splits calls, puts and 0DTE and accumulates through the day", () => {
    const s = hedgePressureSeries(prints, { symbol: "NIFTY", bucketMs: 5 * 60_000 });
    expect(s).toHaveLength(2);
    expect(s[0].calls).toBeGreaterThan(0); // new call OI → writers buy futures
    expect(s[0].puts).toBeLessThan(0); // new put OI → writers sell futures
    expect(s[0].total).toBeCloseTo(s[0].calls + s[0].puts, 9);
    expect(s[0].zeroDte).toBe(0);
    expect(s[1].calls).toBeLessThan(s[0].calls); // call OI closed → hedge unwinds
    expect(s[1].zeroDte).toBeLessThan(0);
    expect(s[1].spot).toBe(25_050);
    expect(hedgePrintCount(prints, "NIFTY")).toBe(3);
  });

  it("summarises and reads the session", () => {
    const s = hedgePressureSeries(prints, { symbol: "NIFTY" });
    const sum = hedgePressureSummary(s, 3);
    expect(sum.total).toBeCloseTo(s[s.length - 1].total, 9);
    expect(sum.firstSpot).toBe(25_000);
    expect(sum.spotChangePct).toBeCloseTo(0.2, 6);
    expect(hedgePressureReading(sum, fmt)).toMatch(
      /net sellers .* led by fresh put writing, leaning against the spot move/,
    );
    expect(hedgePressureReading({ ...sum, total: sum.calls * 0.001, calls: 10, puts: -10 }, fmt)).toMatch(
      /roughly cancel/,
    );
    expect(hedgePressureReading(hedgePressureSummary([], 0), fmt)).toMatch(/No open-interest changes/);
  });

  it("returns an empty series for no usable prints", () => {
    expect(hedgePressureSeries([])).toEqual([]);
    expect(hedgePressureSummary([]).total).toBe(0);
  });

  it("runs on a full simulated session", () => {
    const now = toISTDate("2026-10-16", "15:45");
    const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25_000, expiry: EXP, now, seed: 2 });
    const snaps = simulateSession({ symbol: "NIFTY", expiry: EXP, spot: 25_000, chain, now });
    const s = hedgePressureSeries(derivePrintsFromSeries(snaps, 65), { symbol: "NIFTY" });
    expect(s.length).toBeGreaterThan(20);
    expect(s.every((p) => Number.isFinite(p.total))).toBe(true);
    for (let i = 1; i < s.length; i++) expect(s[i].ts).toBeGreaterThan(s[i - 1].ts);
  });
});

describe("OI unit (contracts vs quantity feeds)", () => {
  it("skips the lot multiplier for quantity OI", async () => {
    const { hedgeFlowCr: flow } = await import("@/lib/flow");
    const contracts = flow(pr({ dOI: 1_000 }), 0.5, "contracts");
    const qty = flow(pr({ dOI: 65_000 }), 0.5, "qty");
    expect(qty).toBeCloseTo(contracts, 9);
  });

  it("infers quantity OI when every dOI is a whole multiple of the lot size", async () => {
    const { inferPrintOiUnit } = await import("@/lib/flow");
    const qtyPrints = Array.from({ length: 20 }, (_, i) => pr({ dOI: 65 * (i + 3) * (i % 2 ? -1 : 1) }));
    expect(inferPrintOiUnit(qtyPrints)).toBe("qty");
    const contractPrints = Array.from({ length: 20 }, (_, i) => pr({ dOI: 101 + i * 7 }));
    expect(inferPrintOiUnit(contractPrints)).toBe("contracts");
    expect(inferPrintOiUnit(qtyPrints.slice(0, 5))).toBe("contracts");
    // The series agrees: quantity prints are not inflated by the lot size.
    const sQty = hedgePressureSeries(qtyPrints, { bucketMs: 0 });
    const sExplicit = hedgePressureSeries(qtyPrints, { bucketMs: 0, oiUnit: "qty" });
    expect(sQty[sQty.length - 1].total).toBeCloseTo(sExplicit[sExplicit.length - 1].total, 9);
  });

  it("sample sessions (contract OI) are read as contracts", () => {
    const now = toISTDate("2026-10-16", "14:00");
    const chain = generateSampleChain({ symbol: "NIFTY", spot: 25_000, expiry: EXP, now }).chain;
    const snaps = simulateSession({ symbol: "NIFTY", expiry: EXP, spot: 25_000, chain, now });
    return import("@/lib/flow").then(({ inferPrintOiUnit }) => {
      expect(inferPrintOiUnit(derivePrintsFromSeries(snaps, 65))).toBe("contracts");
    });
  });
});

describe("printDelta dividend yield", () => {
  it("a dividend yield lowers call delta and makes put delta more negative", () => {
    const c0 = printDelta(pr(), { q: 0 });
    const c1 = printDelta(pr(), { q: 0.03 });
    const p0 = printDelta(pr({ type: "PE", ltp: 160 }), { q: 0 });
    const p1 = printDelta(pr({ type: "PE", ltp: 160 }), { q: 0.03 });
    expect(c1).toBeLessThan(c0);
    expect(p1).toBeLessThan(p0);
  });
});
