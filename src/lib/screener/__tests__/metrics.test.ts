import { describe, expect, it } from "vitest";
import {
  annualisedCarry,
  buildRow,
  buildupTag,
  chainMetrics,
  hv20FromBars,
  ivHvRatio,
  ivpFromHistory,
  mwplStatus,
  pctChange,
  rolloverPct,
  summariseFutures,
  volumeRatio,
  type BhavRow,
  type DailyBar,
} from "../metrics";
import { generateSampleChain } from "@/lib/options";

describe("basic moves", () => {
  it("pctChange", () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(1, 0)).toBeNull();
    expect(pctChange(NaN, 1)).toBeNull();
  });
  it("buildup quadrants", () => {
    expect(buildupTag(1, 5)).toBe("LONG_BUILDUP");
    expect(buildupTag(-1, 5)).toBe("SHORT_BUILDUP");
    expect(buildupTag(1, -5)).toBe("SHORT_COVERING");
    expect(buildupTag(-1, -5)).toBe("LONG_UNWINDING");
    expect(buildupTag(0.01, 5)).toBe("NEUTRAL");
    expect(buildupTag(1, null)).toBe("NEUTRAL");
  });
});

describe("chainMetrics", () => {
  it("computes PCR and a sensible ATM IV from a sample chain", () => {
    const now = new Date("2026-10-15T05:00:00Z");
    const { chain } = generateSampleChain({ symbol: "RELIANCE", spot: 1400, expiry: "2026-10-27", atmIv: 0.25, now, seed: 7 });
    const m = chainMetrics(chain, 1400, "2026-10-27", now);
    expect(m.pcrOi).not.toBeNull();
    expect(m.pcrOi as number).toBeCloseTo(m.peOi / m.ceOi, 3);
    expect(m.atmIv).not.toBeNull();
    expect(m.atmIv as number).toBeGreaterThan(18);
    expect(m.atmIv as number).toBeLessThan(32);
  });
  it("handles an empty chain", () => {
    const m = chainMetrics([], 100, "2026-10-27");
    expect(m).toMatchObject({ pcrOi: null, pcrVol: null, atmIv: null });
  });
});

describe("history metrics", () => {
  const bars: DailyBar[] = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    close: 100 * (1 + (i % 2 === 0 ? 0.01 : -0.01)),
    volume: 1000,
  }));
  it("HV20 is positive percent", () => {
    const hv = hv20FromBars(bars);
    expect(hv).not.toBeNull();
    expect(hv as number).toBeGreaterThan(10);
  });
  it("HV20 needs 21 closes", () => {
    expect(hv20FromBars(bars.slice(0, 10))).toBeNull();
  });
  it("volume ratio excludes today", () => {
    const b: DailyBar[] = [
      { date: "2026-10-10", close: 1, volume: 100 },
      { date: "2026-10-13", close: 1, volume: 200 },
      { date: "2026-10-14", close: 1, volume: 300 },
      { date: "2026-10-15", close: 1, volume: 400 },
      { date: "2026-10-16", close: 1, volume: 500 },
      { date: "2026-10-17", close: 1, volume: 9999 },
    ];
    expect(volumeRatio(900, b, "2026-10-17")).toBeCloseTo(3, 6);
    expect(volumeRatio(0, b, "2026-10-17")).toBeNull();
    expect(volumeRatio(100, b.slice(0, 2), "2026-10-17")).toBeNull();
  });
  it("ivHvRatio and ivp", () => {
    expect(ivHvRatio(30, 20)).toBe(1.5);
    expect(ivHvRatio(30, 0)).toBeNull();
    const hist = Array.from({ length: 40 }, (_, i) => 10 + i);
    expect(ivpFromHistory(30, hist)).toBe(50);
    expect(ivpFromHistory(30, hist.slice(0, 5))).toBeNull();
    expect(ivpFromHistory(null, hist)).toBeNull();
  });
});

describe("futures", () => {
  it("carry and rollover", () => {
    expect(annualisedCarry(101, 100, 365)).toBeCloseTo(1, 6);
    expect(annualisedCarry(101, 100, 0)).toBeCloseTo(365, 6);
    expect(annualisedCarry(0, 100, 10)).toBeNull();
    expect(rolloverPct([600, 300, 100])).toBe(40);
    expect(rolloverPct([])).toBeNull();
  });
  it("summarises bhavcopy rows", () => {
    const base = { symbol: "TCS", strike: 0, settle: 0, volume: 0, underlyingClose: 3000 };
    const rows: BhavRow[] = [
      { ...base, expiry: "2026-11-24", type: "FUT", close: 3030, oi: 300, chgOi: 100 },
      { ...base, expiry: "2026-10-27", type: "FUT", close: 3010, oi: 700, chgOi: -50 },
      { ...base, expiry: "2026-10-27", type: "CE", strike: 3100, close: 20, oi: 1000, chgOi: 0 },
      { ...base, expiry: "2026-10-27", type: "PE", strike: 2900, close: 15, oi: 800, chgOi: 0 },
    ];
    const s = summariseFutures(rows, "2026-10-16");
    expect(s.nearExpiry).toBe("2026-10-27");
    expect(s.basis).toBe(10);
    expect(s.futDte).toBe(11);
    expect(s.rolloverPct).toBe(30);
    expect(s.futOiChgPct).toBeCloseTo((50 / 950) * 100, 1);
    expect(s.eodPcr).toBe(0.8);
    expect(s.carryPct).toBeCloseTo((3010 / 3000 - 1) * (365 / 11) * 100, 1);
  });
  it("no futures rows", () => {
    expect(summariseFutures([], null)).toMatchObject({ basis: null, rolloverPct: null, eodPcr: null });
  });
});

describe("mwplStatus and buildRow", () => {
  it("status thresholds", () => {
    expect(mwplStatus(50, true)).toBe("BAN");
    expect(mwplStatus(86, false)).toBe("DANGER");
    expect(mwplStatus(81, false)).toBe("NEAR");
    expect(mwplStatus(40, false)).toBe("OK");
    expect(mwplStatus(null, false)).toBeNull();
  });
  it("prefers futures OI and live PCR, falls back to spurts and EOD", () => {
    const row = buildRow({ symbol: "TCS", kind: "STOCK", sector: "IT", ltp: 3000, changePct: 1.2, volume: 10, spurtOiChgPct: 4, todayIso: "2026-10-17", mwplPct: 82, banned: false });
    expect(row.oiChangePct).toBe(4);
    expect(row.oiSource).toBe("oi-spurts");
    expect(row.buildup).toBe("LONG_BUILDUP");
    expect(row.mwplStatus).toBe("NEAR");
    expect(row.pcrOi).toBeNull();
    const fut = summariseFutures(
      [
        { symbol: "TCS", expiry: "2026-10-27", strike: 0, type: "FUT", close: 3010, settle: 0, oi: 900, chgOi: -100, volume: 0, underlyingClose: 3000 },
        { symbol: "TCS", expiry: "2026-10-27", strike: 3000, type: "PE", close: 1, settle: 0, oi: 50, chgOi: 0, volume: 0, underlyingClose: 3000 },
        { symbol: "TCS", expiry: "2026-10-27", strike: 3000, type: "CE", close: 1, settle: 0, oi: 100, chgOi: 0, volume: 0, underlyingClose: 3000 },
      ],
      "2026-10-16",
    );
    const r2 = buildRow({ symbol: "TCS", kind: "STOCK", sector: "IT", ltp: 3000, changePct: 1.2, volume: 10, spurtOiChgPct: 4, futures: fut, todayIso: "2026-10-17" });
    expect(r2.oiSource).toBe("futures-eod");
    expect(r2.buildup).toBe("SHORT_COVERING");
    expect(r2.pcrOi).toBe(0.5);
    expect(r2.pcrSource).toBe("eod");
    const r3 = buildRow({ symbol: "NIFTY", kind: "INDEX", sector: "Index", ltp: 1, changePct: 0, volume: 0, todayIso: "2026-10-17", chain: { pcrOi: 1.1, atmIv: 12, ivp: 40, stale: true, asOf: 5 } });
    expect(r3.pcrSource).toBe("live");
    expect(r3.chainStale).toBe(true);
    expect(r3.mwplStatus).toBeNull();
  });
});
