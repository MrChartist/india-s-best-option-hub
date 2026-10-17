import { describe, expect, it } from "vitest";
import { generateSampleChain, toISTDate } from "@/lib/options";
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import {
  premiumDomain,
  heroZeroLeg,
  analyseStraddle,
  comboLabel,
  comboSeries,
  constantIvWithSpot,
  decaySchedule,
  downsample,
  elmPerLot,
  exerciseExample,
  expiryMetrics,
  heroZeroCandidates,
  hhmmIST,
  mergeSnapshots,
  nearestOf,
  oiWalls,
  openingATM,
  parseCombos,
  pickExpirySymbol,
  settlementWindowState,
  snapMid,
  sortHeroZero,
  straddleIV76,
  straddlePrice76,
  straddleSeries,
  straddleThetaPerMinute,
  vwapSeries,
  wallDriftSeries,
} from "./expiryMath";
import { simulateExpirySession } from "./expirySample";

const leg = (strike: number, side: "CE" | "PE", ltp: number, extra: Partial<StrikeSnap> = {}): StrikeSnap => ({ strike, side, ltp, oi: 1000, vol: 100, iv: 12, bid: 0, ask: 0, ...extra });

function snap(ts: number, spot: number, rows: StrikeSnap[]): ChainSnapshot {
  return { id: String(ts), symbol: "NIFTY", expiry: "2026-11-03", ts, spot, rows };
}

const T0 = toISTDate("2026-11-03", "09:30").getTime();

describe("pickExpirySymbol", () => {
  it("picks NIFTY on a Tuesday weekly expiry", () => {
    // 3 Nov 2026 is a Tuesday (20 Oct is a holiday)
    const p = pickExpirySymbol(toISTDate("2026-11-03", "10:00"));
    expect(p.symbol).toBe("NIFTY");
    expect(p.today).toBe(true);
    expect(p.expiry).toBe("2026-11-03");
  });
  it("picks SENSEX on a Thursday weekly expiry", () => {
    const p = pickExpirySymbol(toISTDate("2026-11-05", "10:00"));
    expect(p.symbol).toBe("SENSEX");
    expect(p.today).toBe(true);
  });
  it("falls back to the soonest weekly on a non-expiry day", () => {
    const p = pickExpirySymbol(toISTDate("2026-11-04", "10:00"));
    expect(p.today).toBe(false);
    expect(p.symbol).toBe("SENSEX");
    expect(p.expiry).toBe("2026-11-05");
  });
  it("moves on after 15:30 on expiry day", () => {
    const p = pickExpirySymbol(toISTDate("2026-11-03", "15:45"));
    expect(p.expiry > "2026-11-03").toBe(true);
  });
});

describe("snapshot helpers", () => {
  it("snapMid prefers a tight mid, else LTP", () => {
    expect(snapMid({ ltp: 10, bid: 9.9, ask: 10.1 })).toBeCloseTo(10, 9);
    expect(snapMid({ ltp: 10, bid: 1, ask: 30 })).toBe(10);
    expect(snapMid({ ltp: 0, bid: 0, ask: 0 })).toBeNaN();
    expect(snapMid(undefined)).toBeNaN();
  });
  it("nearestOf and downsample", () => {
    expect(nearestOf([100, 150, 200], 160)).toBe(150);
    expect(nearestOf([], 1)).toBeNaN();
    const d = downsample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);
    expect(d).toHaveLength(4);
    expect(d[0]).toBe(1);
    expect(d[3]).toBe(10);
  });
  it("mergeSnapshots sorts and de-duplicates by gap", () => {
    const a = snap(T0, 100, [leg(100, "CE", 1)]);
    const b = snap(T0 + 5_000, 100, [leg(100, "CE", 1)]);
    const c = snap(T0 + 60_000, 100, [leg(100, "CE", 1)]);
    const m = mergeSnapshots([[c, a], [b]]);
    expect(m.map((s) => s.ts)).toEqual([T0, T0 + 60_000]);
  });
  it("hhmmIST formats IST", () => {
    expect(hhmmIST(T0)).toBe("09:30");
    expect(hhmmIST(NaN)).toBe("—");
  });
});

describe("straddle series and VWAP", () => {
  const s1 = snap(T0, 25010, [leg(25000, "CE", 100, { vol: 1000 }), leg(25000, "PE", 90, { vol: 1000 }), leg(25050, "CE", 75), leg(25050, "PE", 115)]);
  const s2 = snap(T0 + 60_000, 25040, [leg(25000, "CE", 110, { vol: 1500 }), leg(25000, "PE", 70, { vol: 1500 }), leg(25050, "CE", 80, { vol: 400 }), leg(25050, "PE", 95, { vol: 400 })]);
  const s3 = snap(T0 + 120_000, 25005, [leg(25000, "CE", 90, { vol: 2500 }), leg(25000, "PE", 80, { vol: 2500 }), leg(25050, "CE", 70), leg(25050, "PE", 110)]);

  it("floats with ATM", () => {
    const pts = straddleSeries([s1, s2, s3]);
    expect(pts.map((p) => p.strike)).toEqual([25000, 25050, 25000]);
    expect(pts[0].straddle).toBe(190);
    expect(pts[1].straddle).toBe(175);
  });
  it("fixed strike stays put", () => {
    const pts = straddleSeries([s1, s2, s3], { kind: "fixed", strike: 25000 });
    expect(pts.map((p) => p.straddle)).toEqual([190, 180, 170]);
  });
  it("VWAP weights by volume increments at the same strike", () => {
    const pts = straddleSeries([s1, s2, s3], { kind: "fixed", strike: 25000 });
    const { values, basis } = vwapSeries(pts);
    expect(basis).toBe("volume");
    expect(values[0]).toBe(190); // time average before any volume increment
    expect(values[1]).toBeCloseTo(180, 9); // only s2 weighted (1000)
    expect(values[2]).toBeCloseTo((180 * 1000 + 170 * 2000) / 3000, 9);
  });
  it("falls back to time weighting without volume", () => {
    const pts = straddleSeries([s1, s2, s3], { kind: "fixed", strike: 25050 }).map((p) => ({ ...p, vol: NaN }));
    const { values, basis } = vwapSeries(pts);
    expect(basis).toBe("time");
    expect(values[2]).toBeCloseTo((190 + 175 + 180) / 3, 9);
  });
});

describe("Black-76 straddle maths", () => {
  it("straddleIV76 round-trips", () => {
    const T = 100 / (252 * 375);
    const p = straddlePrice76(25000, 25000, T, 0.065, 0.14);
    expect(straddleIV76(p, 25000, 25000, T, 0.065)).toBeCloseTo(0.14, 5);
    const p2 = straddlePrice76(25030, 25000, T, 0.065, 0.2);
    expect(straddleIV76(p2, 25030, 25000, T, 0.065)).toBeCloseTo(0.2, 5);
  });
  it("straddleIV76 rejects below-intrinsic and bad input", () => {
    expect(straddleIV76(10, 25100, 25000, 0.001, 0.065)).toBeNaN();
    expect(straddleIV76(NaN, 25000, 25000, 0.001, 0.065)).toBeNaN();
    expect(straddleIV76(50, 25000, 25000, 0, 0.065)).toBeNaN();
  });
  it("theta per minute matches the finite-difference decay of one session minute", () => {
    const T = 120 / (252 * 375);
    const th = straddleThetaPerMinute(25000, 25000, T, 0.065, 0.14);
    const dT = 1 / (252 * 375);
    const fd = straddlePrice76(25000, 25000, T - dT, 0.065, 0.14) - straddlePrice76(25000, 25000, T, 0.065, 0.14);
    expect(th).toBeLessThan(0);
    expect(th).toBeCloseTo(fd, 1);
  });
});

describe("analyseStraddle on a sample expiry session", () => {
  const snaps = simulateExpirySession({ symbol: "NIFTY", expiry: "2026-11-03", spot: 25000, now: toISTDate("2026-11-03", "15:25") });

  it("simulates a full expiry session that decays", () => {
    expect(snaps.length).toBeGreaterThan(100);
    expect(snaps[0].ts).toBe(toISTDate("2026-11-03", "09:15").getTime());
    expect(snaps[snaps.length - 1].spot).toBeCloseTo(25000, 0);
    const a = analyseStraddle(snaps, { expiry: "2026-11-03", r: 0.065, mode: { kind: "fixed", strike: openingATM(snaps) } });
    expect(a.points.length).toBe(snaps.length);
    expect(a.open!.straddle).toBeGreaterThan(a.last!.straddle);
    expect(a.sigmaOpen).toBeGreaterThan(0.03);
    expect(a.theory.length).toBeGreaterThan(10);
    // theory is monotone non-increasing and ends at intrinsic (expiry close)
    for (let i = 1; i < a.theory.length; i++) expect(a.theory[i].theory).toBeLessThanOrEqual(a.theory[i - 1].theory + 1e-9);
    expect(a.theory[a.theory.length - 1].theory).toBeLessThan(Math.abs(a.open!.spot - a.theoryStrike) + 10);
    expect(a.theory[a.theory.length - 1].theory).toBeLessThan(a.open!.straddle * 0.5);
    const last = a.last!;
    expect(last.straddle).toBeGreaterThanOrEqual(Math.abs(last.spot - last.strike) - 1);
    const floating = analyseStraddle(snaps, { expiry: "2026-11-03", r: 0.065 });
    expect(floating.decayPct).toBeGreaterThan(0.5);
    const withSpot = constantIvWithSpot(a.points, { expiry: "2026-11-03", r: 0.065, sigma: a.sigmaOpen, strike: a.theoryStrike });
    expect(withSpot[0]).toBeCloseTo(a.open!.straddle, 4);
    const sched = decaySchedule(a, { expiry: "2026-11-03", r: 0.065 });
    expect(sched.length).toBeGreaterThan(5);
    expect(sched[0].remainingPct).toBeLessThan(1);
    expect(sched[sched.length - 1].remainingPct).toBeLessThan(sched[0].remainingPct);
  });

  it("is deterministic", () => {
    const again = simulateExpirySession({ symbol: "NIFTY", expiry: "2026-11-03", spot: 25000, now: toISTDate("2026-11-03", "15:25") });
    expect(again[10].rows[5].ltp).toBe(snaps[10].rows[5].ltp);
  });

  it("drift series has max pain and walls", () => {
    const d = wallDriftSeries(snaps, 30);
    expect(d.length).toBeGreaterThan(5);
    expect(d.length).toBeLessThanOrEqual(30);
    expect(Number.isFinite(d[0].maxPain)).toBe(true);
  });

  it("combos price straddles and strangles at fixed strikes", () => {
    const base = openingATM(snaps);
    const st = comboSeries(snaps, { id: "a", kind: "straddle", offset: 0, expiry: "near" }, base);
    const sg = comboSeries(snaps, { id: "b", kind: "strangle", offset: 100, expiry: "near" }, base);
    expect(st.length).toBe(snaps.length);
    expect(sg[0].value).toBeLessThan(st[0].value);
  });
});

describe("combos", () => {
  it("parseCombos validates and caps", () => {
    const raw = [
      { id: "a", kind: "straddle", offset: 0, expiry: "near" },
      { id: "a", kind: "straddle", offset: 50, expiry: "near" },
      { id: "b", kind: "strangle", offset: -100, expiry: "near" },
      { id: "c", kind: "strangle", offset: 100, expiry: "next" },
      { id: "d", kind: "bogus", offset: 0, expiry: "near" },
      "junk",
      { id: "e", kind: "straddle", offset: 100, expiry: "near" },
      { id: "f", kind: "straddle", offset: -100, expiry: "near" },
      { id: "g", kind: "straddle", offset: 200, expiry: "near" },
    ];
    const c = parseCombos(raw);
    expect(c.map((x) => x.id)).toEqual(["a", "c", "e", "f"]);
    expect(parseCombos("x")).toEqual([]);
  });
  it("labels", () => {
    expect(comboLabel({ id: "a", kind: "straddle", offset: 0, expiry: "near" }, 25000)).toBe("ATM straddle (25000)");
    expect(comboLabel({ id: "a", kind: "straddle", offset: -100, expiry: "next" })).toBe("ATM−100 straddle · next exp");
    expect(comboLabel({ id: "a", kind: "strangle", offset: 100, expiry: "near" }, 25000)).toBe("±100 strangle (24900/25100)");
  });
});

describe("hero-zero, OI walls, metrics and rules", () => {
  const now = toISTDate("2026-11-03", "13:00");
  const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry: "2026-11-03", now, seed: 7, strikes: 60 });

  it("hero-zero keeps cheap OTM options with sane probabilities", () => {
    const rows = heroZeroCandidates(chain, { spot: 25000, expiry: "2026-11-03", now, r: 0.065 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.ltp).toBeLessThan(10);
      expect(r.type === "CE" ? r.strike > 25000 : r.strike < 25000).toBe(true);
      if (Number.isFinite(r.pop)) {
        expect(r.pop).toBeGreaterThanOrEqual(0);
        expect(r.pop).toBeLessThanOrEqual(r.probITM + 1e-12);
      }
    }
    const byVol = sortHeroZero(rows, "volume");
    for (let i = 1; i < byVol.length; i++) expect(byVol[i].volume).toBeLessThanOrEqual(byVol[i - 1].volume);
  });
  it("hero-zero uses the session-open LTP for gain when there is no previous close", () => {
    // Drop the day change so only the session-open reference is available.
    const noPrev = chain.map((r) => ({ ...r, ce: { ...r.ce, pChange: 0 }, pe: { ...r.pe, pChange: 0 } }));
    const first = new Map<string, number>();
    const rows0 = heroZeroCandidates(noPrev, { spot: 25000, expiry: "2026-11-03", now, r: 0.065 });
    const r0 = rows0[0];
    first.set(`${r0.strike}|${r0.type}`, r0.ltp / 2);
    const rows = heroZeroCandidates(noPrev, { spot: 25000, expiry: "2026-11-03", now, r: 0.065, openLtp: first });
    const hit = rows.find((r) => r.strike === r0.strike && r.type === r0.type)!;
    expect(hit.changeBasis).toBe("session-open");
    expect(hit.changePct).toBeCloseTo(100, 6);
  });
  it("premium axis pads ₹10 per unit, scaled per lot and floored at zero", () => {
    const [lo, hi] = premiumDomain(1);
    expect(lo(100.4)).toBe(90);
    expect(hi(150.2)).toBe(161);
    expect(lo(4)).toBe(0);
    const [lo75] = premiumDomain(75);
    expect(lo75(7500)).toBe(6750);
  });
  it("hero-zero rows become one long basket lot", () => {
    expect(heroZeroLeg("nifty", "2026-11-03", { strike: 25600, type: "CE", ltp: 3.456, iv: 0.18234 })).toEqual({
      symbol: "NIFTY",
      expiry: "2026-11-03",
      strike: 25600,
      type: "CE",
      side: "BUY",
      lots: 1,
      premium: 3.46,
      iv: 0.1823,
    });
    expect(heroZeroLeg("NIFTY", "2026-11-03", { strike: 24400, type: "PE", ltp: 2, iv: NaN }).iv).toBeNull();
  });
  it("hero-zero returns nothing after expiry", () => {
    expect(heroZeroCandidates(chain, { spot: 25000, expiry: "2026-11-03", now: toISTDate("2026-11-03", "15:45"), r: 0.065 })).toEqual([]);
  });
  it("OI walls sit on the right side of spot", () => {
    const w = oiWalls(chain, 25000);
    expect(w.callWall).toBeGreaterThanOrEqual(25000);
    expect(w.putWall).toBeLessThanOrEqual(25000);
    expect(w.calls.length).toBe(3);
    expect(Number.isFinite(w.maxPain)).toBe(true);
    expect(w.pcr).toBeGreaterThan(0);
    expect(oiWalls([], 25000).callWall).toBeNaN();
  });
  it("expiry metrics", () => {
    const m = expiryMetrics(chain, { spot: 25000, expiry: "2026-11-03", now, r: 0.065 });
    expect(m.straddle).toBeGreaterThan(0);
    expect(m.emStraddle).toBeCloseTo(0.85 * m.straddle, 9);
    expect(m.atmIv).toBeGreaterThan(1);
    expect(m.dailyMovePct).toBeCloseTo(m.atmIv / Math.sqrt(252), 9);
  });
  it("rules: ELM and exercise STT", () => {
    expect(elmPerLot(25000, 65)).toBeCloseTo(32500, 6);
    expect(elmPerLot(NaN, 65)).toBeNaN();
    const ex = exerciseExample(25012, 50, 65, "2026-11-03")!;
    expect(ex.strike).toBe(24950);
    expect(ex.intrinsic).toBeCloseTo(62, 9);
    expect(ex.sttExercise).toBeCloseTo(62 * 65 * ex.exerciseRate, 9);
    expect(exerciseExample(0, 50, 65)).toBeNull();
  });
  it("settlement window", () => {
    expect(settlementWindowState(toISTDate("2026-11-03", "14:00"), "2026-11-03")).toBe("before");
    expect(settlementWindowState(toISTDate("2026-11-03", "15:10"), "2026-11-03")).toBe("averaging");
    expect(settlementWindowState(toISTDate("2026-11-03", "15:31"), "2026-11-03")).toBe("settled");
    expect(settlementWindowState(toISTDate("2026-11-02", "15:10"), "2026-11-03")).toBe("not-today");
  });
});
