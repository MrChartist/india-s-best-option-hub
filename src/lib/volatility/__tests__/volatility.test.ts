import { describe, expect, it } from "vitest";
import { black76Price, generateSampleChain, toISTDate, type OHLC } from "@/lib/options";
import type { BhavcopyFoRow } from "@/lib/types/market";
import type { DailyStat } from "@/lib/snapshotStore";
import {
  bhavcopyChains,
  candlesToBars,
  computeIvStats,
  countBySource,
  dailyStatsSpotIv,
  dailyStatsToPoints,
  hvSnapshot,
  ivFromBhavChains,
  ivHvSeries,
  ivMoveHitRate,
  ivRegime,
  joinSpotIv,
  lastSessionDate,
  latestBhavcopyDate,
  mergeIvPoints,
  recentTradingDays,
  vixRowsToPoints,
  type IvPoint,
} from "../history";
import { buildSmile, defaultSmileRange, fitSmileSvi, fitSvi, nelderMead, skewPosition, smileIvAt, smileSeries, sviIv, type SviParams } from "../smile";
import { buildExpirySmiles, deltaSurface, expectedMoveRows, iv30FromTerm, ivAtDelta, surfaceRange, termShape, termStructure } from "../surface";
import { chainAtmIv, pickScreenerExpiry, rankByIvChange, screenerCsv, SCREENER_CSV_HEADER, symbolKind, withChange, type ScreenerRow } from "../screener";

// Wednesday 14 Oct 2026, 11:00 IST (a trading day).
const NOW = toISTDate("2026-10-14", "11:00");
const SPOT = 25000;

function sample(expiry: string, atmIv = 0.14, seed = 3) {
  return generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry, atmIv, strikes: 81, now: NOW, seed }).chain;
}

function seq(n: number, start: string, f: (i: number) => number): IvPoint[] {
  const out: IvPoint[] = [];
  const d0 = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) out.push({ date: new Date(d0 + i * 86400000).toISOString().slice(0, 10), iv: f(i), source: "vix" });
  return out;
}

describe("history: merging and stats", () => {
  it("merges layers with earlier layers winning and sorts by date", () => {
    const a: IvPoint[] = [{ date: "2026-10-02", iv: 15, source: "bhavcopy" }];
    const b: IvPoint[] = [
      { date: "2026-10-02", iv: 99, source: "snapshot" },
      { date: "2026-10-01", iv: 14, source: "snapshot" },
      { date: "2026-10-03", iv: 0, source: "snapshot" },
    ];
    const m = mergeIvPoints(a, b);
    expect(m.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(m[1].iv).toBe(15);
    expect(countBySource(m)).toEqual({ bhavcopy: 1, snapshot: 1, vix: 0, sample: 0 });
  });

  it("converts VIX rows and daily stats, dropping bad values", () => {
    expect(vixRowsToPoints([{ date: "2026-10-01", close: 12.5 }, { date: "2026-10-02", close: Number.NaN }])).toHaveLength(1);
    const stats = [
      { symbol: "NIFTY", date: "2026-10-01", atmIv: 13.2, pcrOi: 1, pcrVol: 1, maxPain: 25000, straddle: 300, spot: 25000 },
      { symbol: "NIFTY", date: "2026-10-02", atmIv: Number.NaN, pcrOi: 1, pcrVol: 1, maxPain: 25000, straddle: 300, spot: 25100 },
    ] as DailyStat[];
    expect(dailyStatsToPoints(stats)).toEqual([{ date: "2026-10-01", iv: 13.2, source: "snapshot" }]);
    expect(dailyStatsSpotIv(stats)).toEqual([{ date: "2026-10-01", spot: 25000, iv: 13.2 }]);
  });

  it("reports insufficient history below 20 points", () => {
    const s = computeIvStats(15, seq(10, "2026-01-01", (i) => 10 + i));
    expect(s.insufficient).toBe(true);
    expect(s.ivRank).toBeNull();
    expect(s.n).toBe(10);
  });

  it("computes IV rank and percentile over the lookback", () => {
    const pts = seq(100, "2026-01-01", (i) => 10 + (i % 11)); // 10..20
    const s = computeIvStats(15, pts);
    expect(s.insufficient).toBe(false);
    expect(s.ivRank).toBeCloseTo(50, 6);
    expect(s.low).toBe(10);
    expect(s.high).toBe(20);
    expect(s.ivPercentile).toBeGreaterThan(40);
    expect(s.ivPercentile).toBeLessThan(50);
    // Lookback trims to the most recent points.
    expect(computeIvStats(15, pts, 30).n).toBe(30);
  });

  it("labels regimes at the 50 / 20 thresholds", () => {
    expect(ivRegime(51)).toBe("premium-selling");
    expect(ivRegime(50)).toBe("neutral");
    expect(ivRegime(19.9)).toBe("premium-buying");
    expect(ivRegime(null)).toBe("unknown");
  });
});

describe("history: trading dates", () => {
  it("uses today only once the session has opened", () => {
    expect(lastSessionDate(toISTDate("2026-10-14", "09:00"))).toBe("2026-10-13");
    expect(lastSessionDate(toISTDate("2026-10-14", "10:00"))).toBe("2026-10-14");
    // Saturday → Friday
    expect(lastSessionDate(toISTDate("2026-10-17", "12:00"))).toBe("2026-10-16");
  });

  it("expects the bhavcopy only in the evening", () => {
    expect(latestBhavcopyDate(toISTDate("2026-10-14", "15:00"))).toBe("2026-10-13");
    expect(latestBhavcopyDate(toISTDate("2026-10-14", "20:00"))).toBe("2026-10-14");
  });

  it("lists recent trading days newest first, skipping weekends", () => {
    const d = recentTradingDays("2026-10-19", 3); // Monday
    expect(d).toEqual(["2026-10-19", "2026-10-16", "2026-10-15"]);
  });
});

describe("history: HV and candles", () => {
  const bars: OHLC[] = [];
  let c = 100;
  for (let i = 0; i < 120; i++) {
    const r = i % 2 === 0 ? 0.01 : -0.01;
    const o = c;
    c = c * Math.exp(r);
    bars.push({ t: Date.parse("2026-01-01T10:00:00Z") + i * 86400000, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c });
  }

  it("parses columnar candles (seconds) and drops gaps", () => {
    const parsed = candlesToBars({ timestamp: [1760000000, 1760086400, 1760172800], open: [1, null, 3], high: [2, 2, 4], low: [0.5, 1, 2], close: [1.5, 1.5, 3.5] });
    expect(parsed).toHaveLength(2);
    expect(parsed[0].t).toBe(1760000000 * 1000);
    expect(candlesToBars(null)).toEqual([]);
  });

  it("returns HV in percent", () => {
    const hv = hvSnapshot(bars);
    // Alternating ±1% log returns → sd ≈ 1% daily → ≈ 15.9% annualised.
    expect(hv.hv20).toBeGreaterThan(15);
    expect(hv.hv20).toBeLessThan(17);
    expect(Number.isFinite(hv.parkinson20)).toBe(true);
    expect(Number.isFinite(hv.yangZhang20)).toBe(true);
  });

  it("aligns IV and HV rows by date", () => {
    const pts: IvPoint[] = [{ date: "2026-03-01", iv: 14, source: "vix" }];
    const rows = ivHvSeries(pts, bars);
    expect(rows.some((r) => r.iv === 14)).toBe(true);
    expect(rows.some((r) => r.hv20 !== null)).toBe(true);
  });

  it("computes the 1σ hit rate", () => {
    // Flat spot always stays inside the band.
    const rows = Array.from({ length: 30 }, (_, i) => ({ date: recentTradingDays("2026-10-16", 30)[29 - i], spot: 100, iv: 15 }));
    const hr = ivMoveHitRate(rows, 5);
    expect(hr.n).toBe(25);
    expect(hr.rate).toBe(1);
    // A 10% jump every day with 1% IV always breaks the band.
    const wild = rows.map((r, i) => ({ ...r, spot: 100 * 1.1 ** i, iv: 1 }));
    expect(ivMoveHitRate(wild, 1).rate).toBe(0);
    const joined = joinSpotIv([{ date: "2026-03-01", iv: 14, source: "vix" }], bars);
    expect(joined).toHaveLength(1);
  });
});

describe("history: bhavcopy IV", () => {
  it("rebuilds chains and recovers the IV used to price them", () => {
    const date = "2026-10-14";
    const now = toISTDate(date, "15:30");
    const rows: BhavcopyFoRow[] = [];
    const sigma = 0.15;
    for (const [expiry, T] of [["2026-10-27", 13 / 365], ["2026-11-24", 41 / 365]] as const) {
      const F = SPOT * Math.exp(0.065 * T);
      for (let K = 23000; K <= 27000; K += 100) {
        for (const type of ["CE", "PE"] as const) {
          const price = black76Price({ F, K, T, r: 0.065, sigma, type });
          rows.push({ symbol: "NIFTY", expiry, strike: K, type, close: Math.round(price * 100) / 100, settle: 0, oi: 10, chgOi: 0, volume: 5, underlyingClose: SPOT });
        }
      }
    }
    rows.push({ symbol: "BANKNIFTY", expiry: "2026-10-27", strike: 50000, type: "CE", close: 100, settle: 0, oi: 1, chgOi: 0, volume: 1, underlyingClose: 50000 });
    const chains = bhavcopyChains(rows, "nifty");
    expect(chains).toHaveLength(2);
    expect(chains[0].chain.length).toBeGreaterThan(30);
    const iv = ivFromBhavChains(chains, date, 0.065);
    expect(iv.term).toHaveLength(2);
    expect(now.getTime()).toBeGreaterThan(0);
    // T in the fixture is approximate (expiry at 15:30 vs whole days), so allow a small tolerance.
    for (const t of iv.term) {
      expect(t.atmIv).toBeGreaterThan(14.5);
      expect(t.atmIv).toBeLessThan(15.5);
    }
    expect(iv.iv30).toBeGreaterThan(14.5);
    expect(iv.iv30).toBeLessThan(15.5);
    expect(iv.spot).toBe(SPOT);
  });

  it("returns NaN iv30 for empty input", () => {
    expect(Number.isNaN(ivFromBhavChains([], "2026-10-14", 0.065).iv30)).toBe(true);
    expect(bhavcopyChains(null, "NIFTY")).toEqual([]);
  });
});

describe("smile", () => {
  const expiry = "2026-11-13";
  const chain = sample(expiry);

  it("builds an OTM composite with the ATM IV near the sample's 14%", () => {
    const s = buildSmile(chain, { spot: SPOT, expiry, now: NOW, r: 0.065 });
    expect(s.atmIv).toBeGreaterThan(13);
    expect(s.atmIv).toBeLessThan(15);
    expect(s.points.length).toBeGreaterThan(10);
    for (const p of s.points) expect(p.side).toBe(p.strike < s.F ? "PE" : "CE");
    // Put skew → negative risk reversal.
    expect(s.rr25).toBeLessThan(0);
    expect(Number.isFinite(s.bf25)).toBe(true);
    expect(smileSeries(s).length).toBeGreaterThan(0);
    expect(smileIvAt(s, s.points[3].strike)).toBeCloseTo(s.points[3].iv as number, 6);
    expect(Number.isNaN(smileIvAt(s, 1))).toBe(true);
  });

  it("marks strikes without IV as gaps rather than zero", () => {
    const broken = chain.map((r) => (r.strikePrice === 24500 ? { ...r, pe: { ...r.pe, ltp: 0, bidPrice: 0, askPrice: 0, iv: 0 } } : r));
    const s = buildSmile(broken, { spot: SPOT, expiry, now: NOW, r: 0.065 });
    const p = s.points.find((x) => x.strike === 24500);
    expect(p?.iv).toBeNull();
  });

  it("returns an empty smile for bad input", () => {
    expect(buildSmile([], { spot: SPOT, expiry, now: NOW }).points).toEqual([]);
    expect(buildSmile(chain, { spot: 0, expiry, now: NOW }).points).toEqual([]);
  });

  it("computes the skew position of ATM IV within the smile", () => {
    const s = buildSmile(chain, { spot: SPOT, expiry, now: NOW, r: 0.065 });
    const sp = skewPosition(s);
    expect(sp.n).toBeGreaterThan(10);
    expect(sp.position).toBeGreaterThanOrEqual(0);
    expect(sp.position).toBeLessThan(60); // ATM sits near the bottom of a skewed smile
    expect(sp.min).toBeLessThanOrEqual(s.atmIv + 0.5);
    expect(Number.isNaN(skewPosition(buildSmile([], { spot: SPOT, expiry, now: NOW })).position)).toBe(true);
  });

  it("clamps the default range", () => {
    expect(defaultSmileRange(14, 1 / 365)).toBeGreaterThanOrEqual(0.03);
    expect(defaultSmileRange(80, 1)).toBe(0.3);
    expect(defaultSmileRange(Number.NaN, 1)).toBe(0.1);
  });
});

describe("SVI", () => {
  it("minimises a quadratic with Nelder–Mead", () => {
    const r = nelderMead((x) => (x[0] - 3) ** 2 + (x[1] + 1) ** 2, [0, 0]);
    expect(r.x[0]).toBeCloseTo(3, 3);
    expect(r.x[1]).toBeCloseTo(-1, 3);
  });

  it("recovers a known SVI smile", () => {
    const T = 30 / 365;
    const truth: SviParams = { a: 0.0008, b: 0.012, rho: -0.4, m: 0.01, sigma: 0.05 };
    const pts = [];
    for (let k = -0.15; k <= 0.12; k += 0.01) pts.push({ k, iv: sviIv(truth, k, T) });
    const fit = fitSvi(pts, T);
    expect(fit).not.toBeNull();
    expect(fit!.rmseIv).toBeLessThan(0.1);
    expect(fit!.params.b).toBeGreaterThanOrEqual(0);
    expect(Math.abs(fit!.params.rho)).toBeLessThan(1);
  });

  it("needs at least five points", () => {
    expect(fitSvi([{ k: 0, iv: 14 }], 0.1)).toBeNull();
  });

  it("fits a sample smile closely", () => {
    const expiry = "2026-11-13";
    const s = buildSmile(sample(expiry), { spot: SPOT, expiry, now: NOW, r: 0.065 });
    const res = fitSmileSvi(s, 40);
    expect(res).not.toBeNull();
    expect(res!.curve.length).toBeGreaterThan(30);
    expect(res!.fit.rmseIv).toBeLessThan(0.6);
  });
});

describe("surface, term structure and expected move", () => {
  const expiries = [
    { expiry: "2026-10-20", chain: sample("2026-10-20", 0.12, 1) },
    { expiry: "2026-10-27", chain: sample("2026-10-27", 0.13, 2) },
    { expiry: "2026-11-24", chain: sample("2026-11-24", 0.145, 4) },
  ];
  const smiles = buildExpirySmiles(expiries, { spot: SPOT, now: NOW, r: 0.065 });

  it("sorts smiles by maturity and builds the term structure", () => {
    expect(smiles.map((s) => s.expiry)).toEqual(["2026-10-20", "2026-10-27", "2026-11-24"]);
    const term = termStructure(smiles, NOW);
    expect(term[0].fwdVol).toBeNull();
    expect(term[1].fwdVol).not.toBeNull();
    // Rising term structure → forward vol above both spot vols.
    expect(term[2].fwdVol as number).toBeGreaterThan(term[2].atmIv);
    expect(term[0].dte).toBe(6);
    expect(termShape(term).shape).toBe("contango");
    const iv30 = iv30FromTerm(term);
    expect(iv30).toBeGreaterThan(term[1].atmIv - 0.5);
    expect(iv30).toBeLessThan(term[2].atmIv + 0.5);
  });

  it("classifies backwardation and flat curves", () => {
    expect(termShape([{ T: 0.02, atmIv: 20 }, { T: 0.1, atmIv: 15 }]).shape).toBe("backwardation");
    expect(termShape([{ T: 0.02, atmIv: 15 }, { T: 0.1, atmIv: 15.2 }]).shape).toBe("flat");
    expect(termShape([{ T: 0.02, atmIv: 15 }]).shape).toBe("unknown");
  });

  it("fills delta buckets and ranges", () => {
    const rows = deltaSurface(smiles);
    expect(rows).toHaveLength(3);
    const last = rows[2].cells;
    expect(last.ATM).not.toBeNull();
    expect(last["25P"] as number).toBeGreaterThan(last["25C"] as number);
    const range = surfaceRange(rows);
    expect(range.max).toBeGreaterThan(range.min);
    expect(ivAtDelta(smiles[2], -0.999)).toBeNull();
  });

  it("computes IV and straddle expected moves per expiry", () => {
    const rows = expectedMoveRows(expiries, smiles, SPOT, NOW);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.iv1.move).toBeGreaterThan(0);
      expect(r.iv2.move).toBeGreaterThan(r.iv1.move);
      expect(r.iv1.lower).toBeLessThan(r.F);
      expect(r.iv1.upper).toBeGreaterThan(r.F);
      expect(r.straddle).toBeGreaterThan(0);
      // 0.85 × straddle ≈ √(2/π)·σ√T·F ≈ 0.8 × the 1σ move.
      expect(r.ratio).toBeGreaterThan(0.6);
      expect(r.ratio).toBeLessThan(1.1);
    }
  });
});

describe("screener", () => {
  it("picks the first expiry at least a week away", () => {
    expect(pickScreenerExpiry(["2026-10-20", "2026-10-27", "2026-10-13"], NOW)).toBe("2026-10-27");
    expect(pickScreenerExpiry(["2026-10-15"], NOW)).toBe("2026-10-15");
    expect(pickScreenerExpiry([], NOW)).toBe("");
  });

  it("computes chain ATM IV", () => {
    const iv = chainAtmIv(sample("2026-11-13"), SPOT, "2026-11-13", NOW, 0.065);
    expect(iv).toBeGreaterThan(13);
    expect(iv).toBeLessThan(15);
    expect(Number.isNaN(chainAtmIv([], SPOT, "2026-11-13", NOW))).toBe(true);
  });

  it("ranks changes, ignores sample rows and exports CSV", () => {
    const base = { kind: "STOCK" as const, expiry: "2026-10-27", spot: 100, prevSource: "bhavcopy" as const, sample: false, asOf: 0 };
    const rows: ScreenerRow[] = [
      withChange({ ...base, symbol: "A", iv: 20, prevIv: 18 }),
      withChange({ ...base, symbol: "B", iv: 15, prevIv: 17 }),
      withChange({ ...base, symbol: "C", iv: 30, prevIv: 20, sample: true }),
      withChange({ ...base, symbol: "D", iv: 25, prevIv: null }),
    ];
    expect(rows[0].change).toBe(2);
    expect(rows[0].changePct).toBeCloseTo(11.11, 2);
    expect(rows[3].change).toBeNull();
    const { gainers, losers } = rankByIvChange(rows);
    expect(gainers.map((r) => r.symbol)).toEqual(["A"]);
    expect(losers.map((r) => r.symbol)).toEqual(["B"]);
    const csv = screenerCsv(rows, () => "t");
    expect(csv.split("\n")[0]).toBe(SCREENER_CSV_HEADER);
    expect(csv.split("\n")).toHaveLength(5);
    expect(csv).toContain("C,STOCK,2026-10-27,100,30,20,10,50,bhavcopy,sample,t");
  });

  it("knows indices from stocks", () => {
    expect(symbolKind("NIFTY")).toBe("INDEX");
    expect(symbolKind("RELIANCE")).toBe("STOCK");
  });
});

describe("format helpers", () => {
  it("formats vols, vol points and symbols", async () => {
    const { fmtVol, fmtVolPts, sanitizeSymbol } = await import("../format");
    expect(fmtVol(14.234)).toBe("14.2%");
    expect(fmtVol(Number.NaN)).toBe("—");
    expect(fmtVol(null)).toBe("—");
    expect(fmtVolPts(1.25)).toBe("+1.3 pts");
    expect(fmtVolPts(-0.44)).toBe("−0.4 pts");
    expect(fmtVolPts(0)).toBe("0.0 pts");
    expect(sanitizeSymbol(" m&m ")).toBe("M&M");
    expect(sanitizeSymbol("<script>")).toBe("");
    expect(sanitizeSymbol(null)).toBe("");
  });
});
