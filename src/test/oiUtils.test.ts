import { describe, it, expect } from "vitest";
import {
  buildupCounts,
  buildupQuadrantPoints,
  buildupTone,
  calculatePCR,
  diffSnapshots,
  expirySummary,
  getATMIV,
  getATMZoneAnalysis,
  getBuildup,
  getDeltaOI,
  getIVSkew,
  getMaxPain,
  getOILevels,
  getStrikePCR,
  legOIChangePct,
  legPriceChange,
  maxOIStrike,
  pcrSignal,
  percentileRank,
  quantile,
  significantStrikes,
  snapshotSeries,
  wallShift,
  windowAround,
} from "@/lib/oiUtils";
import type { OptionData, OptionLegData } from "@/lib/mockData";
import type { ChainSnapshot } from "@/lib/snapshotStore";

type Overrides = Partial<{
  ceLTP: number; peLTP: number; ceIV: number; peIV: number;
  ceDelta: number; peDelta: number; ceVol: number; peVol: number;
  ceOIChg: number; peOIChg: number; ceChange: number; peChange: number;
}>;

function makeRow(strike: number, ceOI: number, peOI: number, o?: Overrides): OptionData {
  const leg = (side: "ce" | "pe", oi: number): OptionLegData => ({
    ltp: (side === "ce" ? o?.ceLTP : o?.peLTP) ?? 100,
    oi,
    oiChange: (side === "ce" ? o?.ceOIChg : o?.peOIChg) ?? 0,
    volume: (side === "ce" ? o?.ceVol : o?.peVol) ?? 10000,
    iv: (side === "ce" ? o?.ceIV : o?.peIV) ?? 15,
    delta: (side === "ce" ? o?.ceDelta : o?.peDelta) ?? (side === "ce" ? 0.5 : -0.5),
    gamma: 0.01,
    theta: -5,
    vega: 10,
    bidPrice: 99,
    askPrice: 101,
    change: side === "ce" ? o?.ceChange : o?.peChange,
  });
  return { strikePrice: strike, ce: leg("ce", ceOI), pe: leg("pe", peOI) };
}

describe("getMaxPain", () => {
  it("returns 0 for an empty chain", () => {
    expect(getMaxPain([])).toBe(0);
  });

  it("returns the strike with minimum total writer payout", () => {
    const chain = [makeRow(24000, 50000, 200000), makeRow(24100, 100000, 100000), makeRow(24200, 200000, 50000)];
    expect(getMaxPain(chain)).toBe(24100);
  });

  it("handles a single-strike chain", () => {
    expect(getMaxPain([makeRow(25000, 100000, 100000)])).toBe(25000);
  });
});

describe("pcrSignal bands", () => {
  it.each([
    [0.5, "call-heavy", "bearish"],
    [0.69, "call-heavy", "bearish"],
    [0.7, "balanced", "neutral"],
    [1.0, "balanced", "neutral"],
    [1.2, "balanced", "neutral"],
    [1.21, "put-heavy", "bullish"],
    [1.6, "put-heavy", "bullish"],
    [1.61, "extreme-put", "warning"],
    [2.5, "extreme-put", "warning"],
  ])("PCR %s → %s (%s)", (pcr, band, tone) => {
    const s = pcrSignal(pcr);
    expect(s.band).toBe(band);
    expect(s.tone).toBe(tone);
  });

  it("returns a neutral no-data reading for bad input", () => {
    expect(pcrSignal(0).label).toBe("No data");
    expect(pcrSignal(NaN).tone).toBe("neutral");
  });
});

describe("calculatePCR", () => {
  it("returns zeros and nulls for an empty chain", () => {
    const r = calculatePCR([]);
    expect(r.pcrOI).toBe(0);
    expect(r.pcrVolume).toBe(0);
    expect(r.pcrChgOI).toBeNull();
    expect(r.pcrPremium).toBeNull();
  });

  it("computes OI, volume, change-in-OI and premium PCR", () => {
    const chain = [
      makeRow(24000, 100000, 150000, { ceVol: 1000, peVol: 3000, ceOIChg: 1000, peOIChg: 4000, ceLTP: 50, peLTP: 20 }),
      makeRow(24100, 200000, 250000, { ceVol: 1000, peVol: 1000, ceOIChg: 1000, peOIChg: 0, ceLTP: 50, peLTP: 20 }),
    ];
    const r = calculatePCR(chain);
    expect(r.totalCEOI).toBe(300000);
    expect(r.totalPEOI).toBe(400000);
    expect(r.pcrOI).toBeCloseTo(1.33, 2);
    expect(r.pcrVolume).toBe(2);
    expect(r.pcrChgOI).toBe(2);
    // PE premium 20 × 4000 = 80000; CE premium 50 × 2000 = 100000
    expect(r.pcrPremium).toBe(0.8);
    expect(r.signalTone).toBe("bullish");
  });

  it("leaves change-in-OI PCR empty when call OI was shed", () => {
    const r = calculatePCR([makeRow(24000, 100, 100, { ceOIChg: -50, peOIChg: 20 })]);
    expect(r.pcrChgOI).toBeNull();
  });
});

describe("getATMIV", () => {
  it("returns 0 for an empty chain", () => {
    expect(getATMIV([], 24000).atmIV).toBe(0);
  });

  it("uses the OTM leg IV at the strike nearest spot", () => {
    const chain = [
      makeRow(23900, 1, 1, { ceIV: 12, peIV: 14 }),
      makeRow(24000, 1, 1, { ceIV: 16, peIV: 18 }),
      makeRow(24100, 1, 1, { ceIV: 20, peIV: 22 }),
    ];
    const r = getATMIV(chain, 24050);
    expect(r.atmStrike).toBe(24000);
    expect(r.atmIV).toBe(18); // 24000 < spot, so the put is OTM
  });

  it("does not halve when one leg IV is zero", () => {
    const r = getATMIV([makeRow(24000, 1, 1, { ceIV: 0, peIV: 16 })], 23990);
    expect(r.atmIV).toBe(16);
  });
});

describe("getIVSkew", () => {
  it("drops rows with no IV and averages only valid legs", () => {
    const chain = [
      makeRow(24000, 1, 1, { ceIV: 15, peIV: 16 }),
      makeRow(24100, 1, 1, { ceIV: 0, peIV: 0 }),
      makeRow(24200, 1, 1, { ceIV: 18, peIV: 0 }),
    ];
    const skew = getIVSkew(chain);
    expect(skew).toHaveLength(2);
    expect(skew[0].avgIV).toBeCloseTo(15.5, 5);
    expect(skew[1].avgIV).toBe(18);
  });
});

describe("relative thresholds", () => {
  it("keeps strikes with at least 5% of the largest leg OI", () => {
    const chain = [makeRow(24000, 4000, 4000), makeRow(24100, 100000, 200000), makeRow(24200, 12000, 0)];
    expect(significantStrikes(chain).map((r) => r.strikePrice)).toEqual([24100, 24200]);
  });

  it("strike PCR filters on both legs relative to max OI", () => {
    const chain = [makeRow(24000, 5000, 5000), makeRow(24100, 100000, 200000)];
    const r = getStrikePCR(chain, 24050);
    expect(r).toHaveLength(1);
    expect(r[0].pcr).toBe(2);
  });
});

describe("getDeltaOI (writer delta exposure)", () => {
  it("negates buyer delta and reports lots", () => {
    const chain = [
      makeRow(24000, 1000, 1000, { ceDelta: 0.7, peDelta: -0.3 }), // below 5% of max
      makeRow(24100, 50000, 80000, { ceDelta: 0.5, peDelta: -0.5 }),
    ];
    const r = getDeltaOI(chain, 24050, 100);
    expect(r).toHaveLength(1);
    expect(r[0].ceDeltaOI).toBe(-25000); // writers short 0.5 × 50000
    expect(r[0].peDeltaOI).toBe(40000); // short puts are long delta
    expect(r[0].netDeltaOI).toBe(15000);
  });

  it("converts quantity OI to lots", () => {
    const r = getDeltaOI([makeRow(24100, 6500, 0, { ceDelta: 0.5 })], 0, 0, { oiUnit: "qty", lotSize: 65 });
    expect(r[0].ceDeltaOI).toBe(-50);
  });
});

describe("getATMZoneAnalysis", () => {
  const chain = [
    makeRow(23800, 90000, 100000),
    makeRow(23900, 100000, 120000, { ceOIChg: 5000, peOIChg: 8000 }),
    makeRow(24000, 150000, 180000, { ceOIChg: 10000, peOIChg: 12000 }),
    makeRow(24100, 130000, 110000, { ceOIChg: 7000, peOIChg: 6000 }),
    makeRow(24200, 120000, 60000),
  ];

  it("takes ATM ± N listed strikes", () => {
    const z1 = getATMZoneAnalysis(chain, 24010, 100, 1);
    expect(z1.strikes).toBe(3);
    expect(z1.atmStrike).toBe(24000);
    expect(z1.strikeData.map((s) => s.strike)).toEqual([23900, 24000, 24100]);
    expect(z1.strikeData.find((s) => s.isATM)?.strike).toBe(24000);
    expect(getATMZoneAnalysis(chain, 24010, 100, 2).strikes).toBe(5);
  });

  it("clips at the chain edge", () => {
    expect(getATMZoneAnalysis(chain, 23800, 100, 2).strikes).toBe(3);
  });

  it("reports PCR change as PCR now minus PCR at the previous close", () => {
    const z = getATMZoneAnalysis(chain, 24010, 100, 1);
    expect(z.totalCEOI).toBe(380000);
    expect(z.totalPEOI).toBe(410000);
    const now = 410000 / 380000;
    const prev = (410000 - 26000) / (380000 - 22000);
    expect(z.pcrChange).toBeCloseTo(Math.round((now - prev) * 100) / 100, 5);
    expect(z.prevPcr).toBeCloseTo(prev, 2);
  });

  it("is empty for an empty chain", () => {
    expect(getATMZoneAnalysis([], 24000).strikes).toBe(0);
  });
});

describe("buildup", () => {
  it("applies the same rule to calls and puts", () => {
    const row = makeRow(24000, 100, 100, { ceChange: 5, ceOIChg: 10, peChange: 5, peOIChg: 10 });
    expect(getBuildup(row.ce)).toBe("LONG_BUILDUP");
    expect(getBuildup(row.pe)).toBe("LONG_BUILDUP");
    expect(getBuildup(makeRow(1, 100, 100, { ceChange: -5, ceOIChg: 10 }).ce)).toBe("SHORT_BUILDUP");
    expect(getBuildup(makeRow(1, 100, 100, { peChange: 5, peOIChg: -10 }).pe)).toBe("SHORT_COVERING");
    expect(getBuildup(makeRow(1, 100, 100, { peChange: -5, peOIChg: -10 }).pe)).toBe("LONG_UNWINDING");
  });

  it("is neutral when the price change is unknown", () => {
    expect(getBuildup(makeRow(1, 100, 100, { ceOIChg: 10 }).ce)).toBe("NEUTRAL");
  });

  it("derives price change from prevClose", () => {
    const leg = { ...makeRow(1, 100, 100).ce, change: undefined, prevClose: 80 };
    expect(legPriceChange(leg)).toBe(20);
  });

  it("maps tones per the theme spec", () => {
    expect(buildupTone("LONG_BUILDUP")).toBe("bullish");
    expect(buildupTone("SHORT_BUILDUP")).toBe("bearish");
    expect(buildupTone("SHORT_COVERING")).toBe("info");
    expect(buildupTone("LONG_UNWINDING")).toBe("warning");
  });
});

describe("buildupQuadrantPoints", () => {
  it("places each leg in the right quadrant with % axes", () => {
    const chain = [
      makeRow(24000, 1200, 1100, { ceLTP: 110, ceChange: 10, ceOIChg: 200, peLTP: 90, peChange: -10, peOIChg: 100 }),
      makeRow(24100, 800, 900, { ceLTP: 90, ceChange: -10, ceOIChg: -200, peLTP: 110, peChange: 10, peOIChg: -100 }),
    ];
    const pts = buildupQuadrantPoints(chain);
    expect(pts).toHaveLength(4);
    const ce24000 = pts.find((p) => p.strike === 24000 && p.side === "CE");
    expect(ce24000?.pricePct).toBe(10); // 10 / 100
    expect(ce24000?.oiPct).toBe(20); // 200 / 1000
    expect(ce24000?.buildup).toBe("LONG_BUILDUP");
    const counts = buildupCounts(pts);
    expect(counts.LONG_BUILDUP).toBe(1);
    expect(counts.SHORT_BUILDUP).toBe(1);
    expect(counts.LONG_UNWINDING).toBe(1);
    expect(counts.SHORT_COVERING).toBe(1);
  });

  it("skips legs without a price change or with no previous OI", () => {
    const pts = buildupQuadrantPoints([makeRow(24000, 100, 100, { ceOIChg: 100, peOIChg: 10 })]);
    expect(pts).toHaveLength(0);
    expect(legOIChangePct(makeRow(1, 100, 1, { ceOIChg: 100 }).ce)).toBeNaN();
  });
});

describe("getOILevels", () => {
  const chain = [
    makeRow(23900, 10, 500, { peOIChg: 0 }),
    makeRow(24000, 400, 400, { peOIChg: 300 }),
    makeRow(24100, 600, 10),
    makeRow(24200, 300, 5, { ceOIChg: 500 }),
  ];

  it("includes the ATM strike on both sides when spot sits on it", () => {
    const l = getOILevels(chain, 24000);
    expect(l.resistance.map((x) => x.strike)).toContain(24000);
    expect(l.support.map((x) => x.strike)).toContain(24000);
  });

  it("weights fresh OI change", () => {
    const l = getOILevels(chain, 24000, { freshWeight: 1 });
    // 24000 PE: 400 + 300 = 700 beats 23900 PE: 500
    expect(l.support[0].strike).toBe(24000);
    expect(l.support[0].strength).toBe(100);
    // 24200 CE: 300 + 500 = 800 beats 24100 CE: 600
    const strongest = [...l.resistance].sort((a, b) => b.score - a.score)[0];
    expect(strongest.strike).toBe(24200);
  });

  it("guards an empty chain", () => {
    expect(getOILevels([], 24000)).toEqual({ resistance: [], support: [] });
  });

  it("finds max OI strikes and shifts", () => {
    expect(maxOIStrike(chain, "CE")).toBe(24100);
    expect(maxOIStrike(chain, "PE")).toBe(23900);
    expect(maxOIStrike([], "CE")).toBeNaN();
    expect(wallShift(24000, 24100)).toBe("up");
    expect(wallShift(24100, 24000)).toBe("down");
    expect(wallShift(NaN, 24000)).toBe("unknown");
  });
});

describe("snapshot helpers", () => {
  const snap = (ts: number, spot: number, rows: Array<[number, "CE" | "PE", number, number?]>): ChainSnapshot => ({
    id: String(ts),
    symbol: "NIFTY",
    expiry: "2026-10-20",
    ts,
    spot,
    rows: rows.map(([strike, side, oi, vol]) => ({ strike, side, oi, vol: vol ?? 0, ltp: 10, iv: 15, bid: 9, ask: 11 })),
  });
  const s1 = snap(1000, 24000, [[24000, "CE", 100, 10], [24000, "PE", 50, 20], [24100, "CE", 300], [23900, "PE", 200]]);
  const s2 = snap(2000, 24050, [[24000, "CE", 150, 10], [24000, "PE", 90, 30], [24100, "CE", 250], [23900, "PE", 400]]);

  it("builds an ordered series with PCR, walls and max pain", () => {
    const series = snapshotSeries([s2, s1]);
    expect(series.map((p) => p.ts)).toEqual([1000, 2000]);
    expect(series[0].pcrOI).toBe(0.63); // 250 / 400
    expect(series[0].pcrVol).toBe(2);
    expect(series[0].maxCEStrike).toBe(24100);
    expect(series[1].maxPEStrike).toBe(23900);
    expect(series[0].maxPain).not.toBeNull();
  });

  it("diffs OI by strike between two snapshots", () => {
    const d = diffSnapshots(s2, s1);
    const k = d.find((x) => x.strike === 24000);
    expect(k?.ceChg).toBe(50);
    expect(k?.peChg).toBe(40);
    expect(diffSnapshots(s2, null).every((x) => x.ceChg === 0 && x.peChg === 0)).toBe(true);
    expect(diffSnapshots(undefined, s1)).toEqual([]);
  });

  it("windows rows around a centre strike", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((strike) => ({ strike }));
    expect(windowAround(rows, 4, 1).map((r) => r.strike)).toEqual([3, 4, 5]);
    expect(windowAround(rows, 1, 2).map((r) => r.strike)).toEqual([1, 2, 3]);
  });
});

describe("distribution helpers", () => {
  it("computes quantiles and percentile ranks", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(quantile(xs, 0.5)).toBe(3);
    expect(quantile(xs, 0.25)).toBe(2);
    expect(quantile([], 0.5)).toBeNaN();
    expect(percentileRank(3, xs)).toBe(50);
    expect(percentileRank(6, xs)).toBe(100);
    expect(percentileRank(1, [])).toBeNull();
  });
});

describe("expirySummary", () => {
  const chain = [
    makeRow(23900, 100000, 300000, { ceLTP: 160, peLTP: 60, ceIV: 15, peIV: 15 }),
    makeRow(24000, 200000, 200000, { ceLTP: 100, peLTP: 100, ceIV: 15, peIV: 15 }),
    makeRow(24100, 300000, 100000, { ceLTP: 60, peLTP: 160, ceIV: 15, peIV: 15 }),
  ];
  const now = new Date("2026-10-13T04:00:00Z"); // 09:30 IST, a week before expiry

  it("reports max pain distance in points, percent and expected-move multiples", () => {
    const s = expirySummary(chain, 23950, "2026-10-20", { now, r: 0.065 });
    expect(s.maxPain).toBe(24000);
    expect(s.distance).toBe(50);
    expect(s.distancePct).toBeCloseTo(0.21, 2);
    expect(s.emSource).toBe("iv");
    expect(s.expectedMove).toBeGreaterThan(300);
    expect(s.expectedMove).toBeLessThan(700);
    expect(s.emMultiple).toBeCloseTo(50 / (s.expectedMove as number), 2);
    expect(s.pcr.pcrOI).toBe(1);
  });

  it("falls back to the straddle when IV is missing", () => {
    const noIv = chain.map((r) => ({ ...r, ce: { ...r.ce, iv: 0 }, pe: { ...r.pe, iv: 0 } }));
    const s = expirySummary(noIv, 24000, "2026-10-20", { now });
    expect(s.emSource).toBe("straddle");
    expect(s.expectedMove).toBeCloseTo(0.85 * 200, 5);
  });

  it("returns nulls for an empty chain", () => {
    const s = expirySummary([], 24000, "2026-10-20", { now });
    expect(s.maxPain).toBeNull();
    expect(s.emMultiple).toBeNull();
  });
});
