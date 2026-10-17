import { describe, expect, it } from "vitest";
import { generateSampleChain, getExpiries, isMonthlyExpiry, toISTDate } from "@/lib/options";
import { computeIvStats, hvSnapshot, type IvPoint, type SpotIvRow } from "../history";
import { sampleExpiryAtmHistory, sampleVolHistory, sampleWeeklyMonthly, sampleYesterdaySurface } from "../sampleHistory";
import {
  VIX_BUCKETS,
  vixBands,
  vixImpliedMove,
  vixMoveHitStats,
  vixRegimeStats,
  vixSpotRows,
  vixVrpSeries,
  vixZone,
  vrpSummary,
  weeklyVsMonthly,
} from "../vix";
import { buildCompareRow, ivSpreadSeries, parseCompareStocks, sortCompareRows, STRADDLE_1SIGMA_LABEL, type CompareRow } from "../compare";
import { bhavTermByExpiry, expiryChartRows, expiryMarkers, expirySourceCounts, mergeExpiryHistories } from "../atmHistory";
import { buildExpirySmiles, deltaAxisLabel, deltaSurface, moneynessSurface, skewOverlay, surfaceAbsMax, surfaceChange } from "../surface";

const NOW = toISTDate("2026-10-14", "11:00");
const END = "2026-10-14";

describe("sampleVolHistory", () => {
  const s = sampleVolHistory({ symbol: "NIFTY", spot: 25000, atmIv: 14.2, end: END });

  it("produces a year of labelled points ending at the given IV and spot", () => {
    expect(s.iv).toHaveLength(252);
    expect(s.bars).toHaveLength(252);
    expect(s.iv.every((p) => p.source === "sample")).toBe(true);
    expect(s.iv[s.iv.length - 1]).toMatchObject({ date: END, iv: 14.2 });
    expect(s.bars[s.bars.length - 1].c).toBe(25000);
    for (const b of s.bars) {
      expect(b.h).toBeGreaterThanOrEqual(Math.max(b.o, b.c) - 0.05);
      expect(b.l).toBeLessThanOrEqual(Math.min(b.o, b.c) + 0.05);
    }
  });

  it("is deterministic per symbol and seed", () => {
    expect(sampleVolHistory({ symbol: "NIFTY", spot: 25000, atmIv: 14.2, end: END })).toEqual(s);
    expect(sampleVolHistory({ symbol: "BANKNIFTY", spot: 25000, atmIv: 14.2, end: END }).iv).not.toEqual(s.iv);
  });

  it("stays in a plausible range and lets IVR, IVP and HV compute", () => {
    const ivs = s.iv.map((p) => p.iv);
    expect(Math.min(...ivs)).toBeGreaterThan(14.2 * 0.44);
    expect(Math.max(...ivs)).toBeLessThan(14.2 * 3.01);
    const st = computeIvStats(14.2, s.iv);
    expect(st.insufficient).toBe(false);
    expect(st.ivRank).not.toBeNull();
    const hv = hvSnapshot(s.bars);
    expect(hv.hv20).toBeGreaterThan(2);
    expect(hv.hv20).toBeLessThan(60);
  });

  it("returns nothing for unusable inputs", () => {
    expect(sampleVolHistory({ symbol: "NIFTY", spot: 0, atmIv: 14 }).iv).toEqual([]);
    expect(sampleVolHistory({ symbol: "NIFTY", spot: 25000, atmIv: Number.NaN }).bars).toEqual([]);
  });

  it("couples one series to another", () => {
    const b = sampleVolHistory({ symbol: "BANKNIFTY", spot: 56000, atmIv: 16, end: END, coupleTo: s.iv });
    expect(b.iv[b.iv.length - 1].iv).toBe(16);
    const sp = ivSpreadSeries(s.iv, b.iv);
    expect(sp.rows).toHaveLength(252);
    expect(sp.sd).toBeLessThan(3);
  });

  it("builds sample per-expiry, weekly/monthly and yesterday helpers", () => {
    const h = sampleExpiryAtmHistory(["2026-10-20", "2026-10-27"], s.iv, { days: 20 });
    expect(h["2026-10-20"].length).toBe(20);
    expect(h["2026-10-20"].every((p) => p.source === "sample" && p.date < "2026-10-20")).toBe(true);
    expect(sampleWeeklyMonthly(s.iv, { days: 30 })).toHaveLength(30);
    const rows = [{ expiry: "2026-10-20", T: 0.02, cells: { A: 14, ATM: 13, B: null } }];
    const y = sampleYesterdaySurface(rows);
    expect(y[0].cells.B).toBeNull();
    expect(y[0].cells.A).not.toBe(14);
  });
});

describe("India VIX analytics", () => {
  const s = sampleVolHistory({ symbol: "NIFTY", spot: 25000, atmIv: 13.5, end: END, seed: 42 });

  it("percentile bands and zones", () => {
    const pts: IvPoint[] = Array.from({ length: 100 }, (_, i) => ({ date: `d${String(i).padStart(3, "0")}`, iv: i + 1, source: "vix" }));
    const b = vixBands(pts);
    expect(b.n).toBe(100);
    expect(b.p50).toBeCloseTo(50.5, 1);
    expect(b.p10).toBeLessThan(b.p25);
    expect(b.latestPct).toBe(99);
    expect(vixZone(5, b)).toBe("very-low");
    expect(vixZone(50, b)).toBe("normal");
    expect(vixZone(95, b)).toBe("very-high");
    expect(vixZone(Number.NaN, b)).toBe("unknown");
    expect(vixBands([]).n).toBe(0);
  });

  it("VRP series has trailing and forward realised vol", () => {
    const rows = vixVrpSeries(s.iv, s.bars);
    expect(rows.length).toBe(252);
    expect(rows[0].hv20).toBeNull();
    expect(rows[30].hv20).not.toBeNull();
    expect(rows[rows.length - 1].fwd21).toBeNull();
    expect(rows[100].fwd21).not.toBeNull();
    const sum = vrpSummary(rows);
    expect(sum.n).toBeGreaterThan(150);
    // Sample realised vol runs below IV, so VIX usually exceeds the realised vol that follows.
    expect(sum.overShare).toBeGreaterThan(0.5);
    expect(sum.meanVrp).toBeGreaterThan(0);
  });

  it("implied move and hit rates", () => {
    const m = vixImpliedMove(25000, 14.6, 1);
    expect(m.move).toBeCloseTo(25000 * Math.sinh(0.146 / Math.sqrt(365)), 3);
    const rows = vixSpotRows(s.iv, s.bars);
    const h = vixMoveHitStats(rows);
    expect(h.daily.n).toBeGreaterThan(200);
    expect(h.daily.rate).toBeGreaterThan(0.5);
    expect(h.weekly.n).toBeGreaterThan(200);
  });

  it("regime statistics and straddle P&L", () => {
    const flat: SpotIvRow[] = [];
    // VIX 10 with a flat market: short straddles always win, returns are zero.
    for (let i = 0; i < 30; i++) flat.push({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, spot: 100, iv: 10 });
    const r = vixRegimeStats(flat, 5);
    const lt12 = r.find((x) => x.key === "lt12");
    expect(lt12?.n).toBeGreaterThan(0);
    expect(lt12?.avgRetH).toBe(0);
    expect(lt12?.straddleWin).toBe(1);
    expect(lt12?.straddlePnl).toBeGreaterThan(0);
    expect(r.find((x) => x.key === "ge25")?.n).toBe(0);
    expect(r).toHaveLength(VIX_BUCKETS.length);
  });

  it("weekly vs monthly proxy", () => {
    const exps = getExpiries("NIFTY", NOW, 8);
    const term = exps.map((e, i) => ({ expiry: e.date, dte: e.dte, atmIv: 15 - i * 0.3 }));
    const w = weeklyVsMonthly("NIFTY", term);
    expect(w).not.toBeNull();
    expect(isMonthlyExpiry("NIFTY", w!.monthly.expiry)).toBe(true);
    expect(w!.weekly.dte).toBeLessThan(w!.monthly.dte);
    expect(w!.spread).toBeGreaterThan(0);
    expect(weeklyVsMonthly("NIFTY", [])).toBeNull();
  });

  it("weekly vs monthly in the monthly-expiry week uses the next weekly, not month 1 vs month 2", () => {
    const exps = getExpiries("NIFTY", NOW, 10);
    const firstMonthly = exps.findIndex((e) => isMonthlyExpiry("NIFTY", e.date));
    expect(firstMonthly).toBeGreaterThanOrEqual(0);
    // Drop the weeklies before the first monthly so the front expiry is the monthly.
    const term = exps.slice(firstMonthly).map((e, i) => ({ expiry: e.date, dte: e.dte + 2, atmIv: 15 - i * 0.3 }));
    const w = weeklyVsMonthly("NIFTY", term)!;
    expect(w.frontIsMonthly).toBe(true);
    expect(w.monthlyOnly).toBe(false);
    expect(isMonthlyExpiry("NIFTY", w.weekly.expiry)).toBe(false);
    expect(isMonthlyExpiry("NIFTY", w.monthly.expiry)).toBe(true);
    expect(w.monthly.dte).toBeGreaterThan(w.weekly.dte);
    // Monthly-only symbols: front monthly vs next monthly, flagged.
    const monthlies = term.filter((t) => isMonthlyExpiry("NIFTY", t.expiry));
    const m = weeklyVsMonthly("NIFTY", monthlies)!;
    expect(m.monthlyOnly).toBe(true);
    expect(m.weekly.expiry).toBe(monthlies[0].expiry);
  });
});

describe("surface additions", () => {
  const exps = getExpiries("NIFTY", NOW, 3).map((e) => e.date);
  const chains = exps.map((expiry, i) => ({ expiry, chain: generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry, atmIv: 0.13 + i * 0.01, now: NOW, seed: 9 }).chain }));
  const smiles = buildExpirySmiles(chains, { spot: 25000, now: NOW, r: 0.065 });

  it("moneyness surface interpolates around ATM with put skew", () => {
    const m = moneynessSurface(smiles);
    expect(m).toHaveLength(smiles.length);
    const row = m[m.length - 1];
    expect(row.cells.ATM).toBeCloseTo(smiles[smiles.length - 1].atmIv, 1);
    expect(row.cells["97.5"]).not.toBeNull();
    expect(row.cells["97.5"] as number).toBeGreaterThan(row.cells["102.5"] as number);
  });

  it("change vs yesterday and abs max", () => {
    const today = deltaSurface(smiles);
    const prior = today.map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, v === null ? null : v - 1])) }));
    const ch = surfaceChange(today, prior);
    for (const r of ch) for (const v of Object.values(r.cells)) if (v !== null) expect(v).toBeCloseTo(1, 6);
    expect(surfaceAbsMax(ch)).toBeCloseTo(1, 6);
    expect(surfaceChange(today, [])[0].cells.ATM).toBeNull();
  });

  it("skew overlay on both axes", () => {
    const mo = skewOverlay(smiles, "moneyness");
    expect(mo.length).toBe(smiles.length);
    const atmPt = mo[0].points.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a));
    expect(Math.abs(atmPt.skew)).toBeLessThan(1.5);
    const de = skewOverlay(smiles, "delta");
    expect(de[0].points.every((p) => p.x >= 5 && p.x <= 95)).toBe(true);
    expect(deltaAxisLabel(50)).toBe("ATM");
    expect(deltaAxisLabel(25)).toBe("25Δ P");
    expect(deltaAxisLabel(90)).toBe("10Δ C");
  });

  it("compare row from a chain", () => {
    const row = buildCompareRow({ symbol: "NIFTY", spot: 25000, chains, smiles, iv30: 13.5, ivRank: 40, ivPercentile: 55, sample: true, historySample: true });
    expect(row).not.toBeNull();
    expect(row!.atmIv).toBeGreaterThan(10);
    expect(row!.pcr).toBeGreaterThan(0.5);
    expect(row!.em.label).toBe("IV 1σ");
    expect(row!.straddlePct).toBeGreaterThan(0);
    expect(Number.isFinite(row!.maxPainDistPct)).toBe(true);
    expect(buildCompareRow({ symbol: "X", spot: 0, chains, smiles, iv30: 1, ivRank: null, ivPercentile: null, sample: false, historySample: false })).toBeNull();
  });

  it("straddle fallback is scaled to 1σ so the column compares like with like", () => {
    const ivRow = buildCompareRow({ symbol: "NIFTY", spot: 25000, chains, smiles, iv30: 13.5, ivRank: 40, ivPercentile: 55, sample: true, historySample: true })!;
    // No usable time to expiry: the IV band is NaN, so the straddle fallback is used.
    const noT = smiles.map((s) => ({ ...s, T: NaN }));
    const stRow = buildCompareRow({ symbol: "NIFTY", spot: 25000, chains, smiles: noT, iv30: 13.5, ivRank: 40, ivPercentile: 55, sample: true, historySample: true })!;
    expect(stRow.em.method).toBe("straddle");
    expect(stRow.em.label).toBe(STRADDLE_1SIGMA_LABEL);
    expect(stRow.em.move).toBeCloseTo(stRow.straddle * Math.sqrt(Math.PI / 2), 6);
    // Same chain, same expiry: the 1σ-equivalent straddle lands close to the IV 1σ band (not ~32% lower).
    expect(Math.abs(stRow.em.pct / ivRow.em.pct - 1)).toBeLessThan(0.1);
  });
});

describe("compare helpers", () => {
  const mk = (symbol: string, atmIv: number, ivp: number | null): CompareRow =>
    ({ symbol, atmIv, ivPercentile: ivp, em: { move: 1, pct: atmIv / 10, method: "iv", label: "IV 1σ" }, pcr: NaN }) as unknown as CompareRow;

  it("sorts with missing values last", () => {
    const rows = [mk("A", 12, null), mk("B", 18, 40), mk("C", 15, 80)];
    expect(sortCompareRows(rows, "atmIv").map((r) => r.symbol)).toEqual(["B", "C", "A"]);
    expect(sortCompareRows(rows, "ivPercentile", "asc").map((r) => r.symbol)).toEqual(["B", "C", "A"]);
    expect(sortCompareRows(rows, "symbol", "asc").map((r) => r.symbol)).toEqual(["A", "B", "C"]);
    expect(sortCompareRows(rows, "pcr").map((r) => r.symbol)).toEqual(["A", "B", "C"]);
  });

  it("parses the stock list from the URL", () => {
    expect(parseCompareStocks("reliance, TCS,NIFTY,TCS,bad!,INFY,SBIN,LT")).toEqual(["RELIANCE", "TCS", "INFY", "SBIN"]);
    expect(parseCompareStocks(null)).toEqual([]);
  });

  it("spread z-score needs ten rows", () => {
    const a: IvPoint[] = Array.from({ length: 12 }, (_, i) => ({ date: `d${String(i).padStart(2, "0")}`, iv: 12, source: "bhavcopy" }));
    const b = a.map((p, i) => ({ ...p, iv: 14 + (i % 2) }));
    const s = ivSpreadSeries(a, b);
    expect(s.rows).toHaveLength(12);
    expect(s.mean).toBeCloseTo(2.5, 6);
    expect(Number.isFinite(s.z)).toBe(true);
    expect(Number.isNaN(ivSpreadSeries(a.slice(0, 5), b.slice(0, 5)).z)).toBe(true);
  });
});

describe("per-expiry ATM history", () => {
  const entries = [
    { date: "2026-10-12", iv30: 14, spot: 25000, term: [{ expiry: "2026-10-20", T: 0.02, F: NaN, atmIv: 13 }, { expiry: "2026-10-27", T: 0.04, F: NaN, atmIv: 14 }] },
    { date: "2026-10-13", iv30: 14, spot: 25000, term: [{ expiry: "2026-10-20", T: 0.02, F: NaN, atmIv: 13.5 }] },
  ];

  it("regroups bhavcopy terms by expiry and merges layers", () => {
    const h = bhavTermByExpiry(entries, ["2026-10-20"]);
    expect(Object.keys(h)).toEqual(["2026-10-20"]);
    expect(h["2026-10-20"].map((p) => p.iv)).toEqual([13, 13.5]);
    const merged = mergeExpiryHistories(h, { "2026-10-20": [{ date: "2026-10-13", iv: 99, source: "snapshot" }, { date: "2026-10-14", iv: 14, source: "snapshot" }] });
    expect(merged["2026-10-20"].map((p) => p.iv)).toEqual([13, 13.5, 14]);
    expect(expirySourceCounts(merged)).toEqual({ bhavcopy: 2, snapshot: 1, sample: 0 });
    const rows = expiryChartRows(bhavTermByExpiry(entries), ["2026-10-20", "2026-10-27"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]["2026-10-27"]).toBe(14);
    expect(rows[1]["2026-10-27"]).toBeUndefined();
  });

  it("markers within an expiry's life", () => {
    const ivs = [12, 14, 13, 16, ...Array.from({ length: 15 }, () => 13.5), 15];
    const pts = ivs.map((iv, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, iv, source: "bhavcopy" as const }));
    const m = expiryMarkers(pts);
    expect(m).toMatchObject({ n: 20, latest: 15, high: 16, highDate: "2026-09-04", low: 12, lowDate: "2026-09-01" });
    expect(m.ivRank).toBeCloseTo(75, 6);
    expect(m.ivPercentile).toBeCloseTo(90, 6);
    expect(expiryMarkers(pts.slice(0, 5)).ivRank).toBeNull();
    expect(expiryMarkers([]).n).toBe(0);
  });
});
