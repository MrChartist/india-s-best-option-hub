import { describe, expect, it } from "vitest";
import type { OptionData, OptionLegData } from "@/lib/mockData";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { toISTDate } from "@/lib/options";
import {
  DEFAULT_UNUSUAL_THRESHOLDS,
  UNUSUAL_PRESETS,
  applyPreset,
  averageVolumeFromSnapshots,
  flagContract,
  isIndexUnderlying,
  premiumThreshold,
  unusual,
} from "../unusual";

const leg = (o: Partial<OptionLegData> = {}): OptionLegData => ({ ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0, ...o });

describe("thresholds", () => {
  it("uses ₹10L for indices and ₹2L for stocks", () => {
    expect(isIndexUnderlying("NIFTY")).toBe(true);
    expect(isIndexUnderlying("SENSEX")).toBe(true);
    expect(isIndexUnderlying("RELIANCE")).toBe(false);
    expect(premiumThreshold("NIFTY")).toBe(10_00_000);
    expect(premiumThreshold("RELIANCE")).toBe(2_00_000);
    expect(premiumThreshold("RELIANCE", { ...DEFAULT_UNUSUAL_THRESHOLDS, minPremiumStock: 5_00_000 })).toBe(5_00_000);
  });

  it("flags Vol/OI at exactly 1.25 but not below", () => {
    expect(flagContract({ symbol: "NIFTY", volume: 1250, oi: 1000, premium: 0 }).flags).toContain("VOL_OI");
    expect(flagContract({ symbol: "NIFTY", volume: 1249, oi: 1000, premium: 0 }).flags).not.toContain("VOL_OI");
  });

  it("flags volume at 3× the average but not below", () => {
    expect(flagContract({ symbol: "NIFTY", volume: 300, oi: 10_000, premium: 0, avgVolume: 100 }).flags).toEqual(["VOL_SPIKE"]);
    expect(flagContract({ symbol: "NIFTY", volume: 299, oi: 10_000, premium: 0, avgVolume: 100 }).flags).toEqual([]);
    expect(flagContract({ symbol: "NIFTY", volume: 299, oi: 10_000, premium: 0 }).volMultiple).toBeUndefined();
  });

  it("flags premium by underlying type", () => {
    expect(flagContract({ symbol: "NIFTY", volume: 100, oi: 10_000, premium: 9_99_999 }).flags).toEqual([]);
    expect(flagContract({ symbol: "NIFTY", volume: 100, oi: 10_000, premium: 10_00_000 }).flags).toEqual(["BIG_PREMIUM"]);
    expect(flagContract({ symbol: "TCS", volume: 100, oi: 10_000, premium: 2_00_000 }).flags).toEqual(["BIG_PREMIUM"]);
  });

  it("ignores thin contracts below minVolume", () => {
    expect(flagContract({ symbol: "NIFTY", volume: 49, oi: 1, premium: 1e9 }).flags).toEqual([]);
  });
});

describe("unusual()", () => {
  const chain: OptionData[] = [
    { strikePrice: 24_900, ce: leg({ ltp: 180, oi: 50_000, volume: 20_000 }), pe: leg({ ltp: 60, oi: 80_000, oiChange: 20_000, volume: 30_000, change: -12 }) },
    { strikePrice: 25_000, ce: leg({ ltp: 120, oi: 40_000, volume: 60_000, oiChange: 10_000, change: 15 }), pe: leg({ ltp: 110, oi: 30_000, volume: 100 }) },
    { strikePrice: 25_800, ce: leg({ ltp: 4, oi: 2_000, volume: 9_000, oiChange: 1_500, change: 1 }), pe: leg({ ltp: 790, oi: 10, volume: 0 }) },
  ];
  const ts = toISTDate("2026-10-16", "11:00").getTime();
  const out = unusual({ symbol: "NIFTY", expiry: "2026-10-20", spot: 25_010, lotSize: 65, chain, ts });

  it("returns only flagged contracts with derived fields", () => {
    const keys = out.map((c) => `${c.strike}${c.type}`);
    expect(keys).toContain("25000CE"); // vol/oi 1.5 and big premium
    expect(keys).toContain("25800CE"); // vol/oi 4.5
    expect(keys).not.toContain("25000PE");
    const atm = out.find((c) => c.strike === 25_000 && c.type === "CE");
    expect(atm?.flags).toEqual(expect.arrayContaining(["VOL_OI", "BIG_PREMIUM"]));
    expect(atm?.premium).toBe(60_000 * 120 * 65);
    expect(atm?.moneyness).toBe("ATM");
    expect(atm?.dte).toBe(4);
  });

  it("is sorted by score", () => {
    for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
  });

  it("presets filter as described", () => {
    expect(applyPreset(out, "far-otm-lottery").map((c) => c.strike)).toEqual([25_800]);
    expect(applyPreset(out, "put-writing-support").map((c) => `${c.strike}${c.type}`)).toEqual(["24900PE"]);
    expect(applyPreset(out, "fresh-otm-calls").map((c) => c.strike)).toEqual([25_800]);
    expect(applyPreset(out, "all").length).toBe(out.length);
    expect(UNUSUAL_PRESETS.map((p) => p.label)).toEqual(["All unusual", "Fresh OTM call buying", "Put writing at support", "Far-OTM lottery"]);
  });

  it("uses history for the volume spike", () => {
    const hist = { avgVolume: new Map([["24900|CE", 5_000]]), days: 5 };
    const withHist = unusual({ symbol: "NIFTY", expiry: "2026-10-20", spot: 25_010, lotSize: 65, chain, ts }, hist);
    const c = withHist.find((x) => x.strike === 24_900 && x.type === "CE");
    expect(c?.flags).toContain("VOL_SPIKE");
    expect(c?.volMultiple).toBe(4);
  });
});

describe("averageVolumeFromSnapshots", () => {
  const mk = (date: string, hhmm: string, vol: number): ChainSnapshot => ({
    id: `${date}${hhmm}`,
    symbol: "NIFTY",
    expiry: "2026-10-20",
    ts: toISTDate(date, hhmm).getTime(),
    spot: 25_000,
    rows: [{ strike: 25_000, side: "CE", ltp: 100, oi: 1, vol, iv: 0, bid: 0, ask: 0 }],
  });

  it("averages the last snapshot at or before the same time of day, excluding today", () => {
    const snaps = [mk("2026-10-14", "10:30", 100), mk("2026-10-14", "10:55", 200), mk("2026-10-14", "14:00", 900), mk("2026-10-15", "10:50", 400), mk("2026-10-16", "10:00", 7_000)];
    const h = averageVolumeFromSnapshots(snaps, { nowTs: toISTDate("2026-10-16", "11:00").getTime() });
    expect(h.days).toBe(2);
    expect(h.avgVolume.get("25000|CE")).toBe(300);
  });

  it("returns days 0 without history", () => {
    expect(averageVolumeFromSnapshots([], { nowTs: Date.now() }).days).toBe(0);
  });
});
