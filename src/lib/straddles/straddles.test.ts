import { describe, expect, it } from "vitest";
import { toISTDate } from "@/lib/options";
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import { decodeLegs } from "@/components/option-chain/basket";
import { analyseStraddle } from "@/components/expiry/expiryMath";
import { simulateExpirySession } from "@/components/expiry/expirySample";
import {
  dailyStraddles,
  expiryValueLine,
  isStrangle,
  legRows,
  loadBhavcopyDays,
  multiStrikeRows,
  pairBuilderUrl,
  pairLegs,
  parseSelection,
  premiumSeries,
  premiumVsSpot,
  resolvePair,
  sampleBhavcopyDays,
  selectionLabel,
  selectionToParams,
  straddleHistoryDates,
  strikesAround,
  summarisePremium,
  toStrikeMode,
  type BhavcopyFoRow,
  type StrikeSelection,
} from "./index";

const leg = (strike: number, side: "CE" | "PE", ltp: number, vol = 100): StrikeSnap => ({ strike, side, ltp, oi: 1000, vol, iv: 12, bid: 0, ask: 0 });
const snap = (ts: number, spot: number, rows: StrikeSnap[]): ChainSnapshot => ({ id: String(ts), symbol: "NIFTY", expiry: "2026-11-10", ts, spot, rows });
const T0 = toISTDate("2026-11-04", "09:30").getTime();
const MIN = 60_000;

const SNAPS: ChainSnapshot[] = [
  snap(T0, 25010, [leg(24950, "CE", 120, 100), leg(24950, "PE", 60, 100), leg(25000, "CE", 90, 100), leg(25000, "PE", 80, 100), leg(25050, "CE", 65, 100), leg(25050, "PE", 105, 100)]),
  snap(T0 + MIN, 25040, [leg(24950, "CE", 140, 200), leg(24950, "PE", 50, 200), leg(25000, "CE", 105, 300), leg(25000, "PE", 66, 300), leg(25050, "CE", 78, 200), leg(25050, "PE", 88, 200)]),
  snap(T0 + 2 * MIN, 24990, [leg(24950, "CE", 105, 400), leg(24950, "PE", 62, 400), leg(25000, "CE", 78, 500), leg(25000, "PE", 84, 700), leg(25050, "CE", 55, 300), leg(25050, "PE", 110, 300)]),
];

const params = (o: Record<string, string>) => (k: string) => o[k] ?? null;

describe("strike selection", () => {
  it("parses and round-trips search params", () => {
    expect(parseSelection(params({}))).toEqual({ kind: "atm" });
    expect(parseSelection(params({ mode: "fixed", strike: "25000" }))).toEqual({ kind: "fixed", strike: 25000 });
    expect(parseSelection(params({ mode: "pair", ce: "25200", pe: "24800" }))).toEqual({ kind: "pair", ce: 25200, pe: 24800 });
    expect(parseSelection(params({ mode: "fixed", strike: "abc" }))).toEqual({ kind: "atm" });
    expect(parseSelection(params({ mode: "pair", ce: "-5", pe: "24800" }))).toEqual({ kind: "atm" });
    const sels: StrikeSelection[] = [{ kind: "atm" }, { kind: "fixed", strike: 25050 }, { kind: "pair", ce: 25100, pe: 24900 }];
    for (const s of sels) {
      const p = selectionToParams(s);
      expect(parseSelection((k) => (p as Record<string, string | null>)[k] ?? null)).toEqual(s);
    }
  });
  it("maps to strike modes, labels and pairs", () => {
    expect(toStrikeMode({ kind: "atm" })).toEqual({ kind: "floating" });
    expect(toStrikeMode({ kind: "pair", ce: 25000, pe: 25000 })).toEqual({ kind: "fixed", strike: 25000 });
    expect(toStrikeMode({ kind: "pair", ce: 25100, pe: 24900 })).toEqual({ kind: "pair", ce: 25100, pe: 24900 });
    expect(selectionLabel({ kind: "atm" })).toMatch(/rolling/);
    expect(selectionLabel({ kind: "pair", ce: 25100, pe: 24900 })).toBe("25,100 CE + 24,900 PE");
    expect(resolvePair({ kind: "atm" }, 25000)).toEqual({ ce: 25000, pe: 25000 });
    expect(resolvePair({ kind: "atm" }, NaN).ce).toBeNaN();
    expect(isStrangle({ kind: "pair", ce: 25100, pe: 24900 })).toBe(true);
    expect(isStrangle({ kind: "fixed", strike: 25000 })).toBe(false);
  });
  it("picks strikes around a centre", () => {
    const ks = [24800, 24850, 24900, 24950, 25000, 25050, 25100];
    expect(strikesAround(ks, 25010, 2)).toEqual([24900, 24950, 25000, 25050, 25100]);
    expect(strikesAround(ks, 24790, 2)).toEqual([24800, 24850, 24900]);
    expect(strikesAround([], 25000, 2)).toEqual([]);
  });
});

describe("intraday series", () => {
  it("rolls the ATM strike and computes a volume VWAP", () => {
    const { points, vwap, summary } = premiumSeries(SNAPS, { kind: "floating" });
    expect(points.map((p) => p.strike)).toEqual([25000, 25050, 25000]);
    expect(points[0].straddle).toBe(170);
    expect(summary.strikeChanges).toBe(2);
    expect(summary.high).toBe(170);
    expect(summary.low).toBe(162);
    expect(summary.change).toBe(-8);
    expect(summary.changePct).toBeCloseTo(-8 / 1.7, 9);
    expect(vwap.values).toHaveLength(3);
    expect(summary.vwap).toBe(vwap.values[2]);
    expect(summary.impliedMove).toBeCloseTo(0.85 * 162, 9);
  });
  it("prices a custom CE/PE pair at fixed strikes with VWAP on volume", () => {
    const { points, vwap, summary } = premiumSeries(SNAPS, toStrikeMode({ kind: "pair", ce: 25050, pe: 24950 }));
    expect(points.map((p) => p.straddle)).toEqual([125, 128, 117]);
    expect(points.every((p) => p.strike === 25050 && p.peStrike === 24950)).toBe(true);
    // volume increments: (200+200) − (100+100) = 200 at 128, then (300+400) − 400 = 300 at 117
    expect(vwap.basis).toBe("volume");
    expect(vwap.values[2]).toBeCloseTo((200 * 128 + 300 * 117) / 500, 9);
    expect(summary.impliedMove).toBeNaN();
    expect(summary.ceShare).toBeCloseTo(55 / 117, 9);
  });
  it("skips the model for split pairs but keeps it for straddles", () => {
    const split = analyseStraddle(SNAPS, { expiry: "2026-11-10", r: 0.065, mode: { kind: "pair", ce: 25050, pe: 24950 } });
    expect(split.points).toHaveLength(3);
    expect(split.theory).toEqual([]);
    expect(split.thetaPerMin).toBeNaN();
    const fixed = analyseStraddle(SNAPS, { expiry: "2026-11-10", r: 0.065, mode: { kind: "fixed", strike: 25000 } });
    expect(Number.isFinite(fixed.sigmaOpen)).toBe(true);
  });
  it("builds leg rows, premium vs spot and the expiry value line", () => {
    const { points } = premiumSeries(SNAPS, { kind: "fixed", strike: 25000 });
    const rows = legRows(points, 75);
    expect(rows[0]).toEqual({ ts: T0, ce: 90 * 75, pe: 80 * 75, combined: 170 * 75, spot: 25010 });
    const sc = premiumVsSpot(points);
    expect(sc.map((p) => p.t)).toEqual([0, 0.5, 1]);
    const line = expiryValueLine(25050, 24950, 24800, 25200, 1, 4);
    expect(line.find((p) => p.spot === 25000)?.expiry).toBe(0);
    expect(line.find((p) => p.spot === 25200)?.expiry).toBe(150);
    expect(line.find((p) => p.spot === 24800)?.expiry).toBe(150);
    expect(expiryValueLine(NaN, 1, 0, 1)).toEqual([]);
    expect(summarisePremium([]).last).toBeNull();
  });
  it("compares several fixed strikes in rupees and rebased", () => {
    const r = multiStrikeRows(SNAPS, [24950, 25000, 25050, 26000], { view: "rupees", mult: 2 });
    expect(r.series.map((s) => s.strike)).toEqual([24950, 25000, 25050]);
    expect(r.rows[0].k25000).toBe(340);
    const p = multiStrikeRows(SNAPS, [25000], { view: "pct" });
    expect(p.rows[0].k25000).toBe(100);
    expect(p.rows[2].k25000).toBeCloseTo((162 / 170) * 100, 9);
    expect(p.series[0].changePct).toBeCloseTo(((162 - 170) / 170) * 100, 9);
  });
  it("works on the anchored sample session for a non-expiry day", () => {
    const snaps = simulateExpirySession({ symbol: "NIFTY", spot: 25_000, expiry: "2026-11-10", now: toISTDate("2026-11-04", "13:00") });
    const { summary } = premiumSeries(snaps, { kind: "floating" });
    expect(summary.last?.straddle).toBeGreaterThan(100);
    expect(Number.isFinite(summary.vwap)).toBe(true);
  });
});

const bc = (strike: number, type: "CE" | "PE", close: number, under: number, extra: Partial<BhavcopyFoRow> = {}): BhavcopyFoRow => ({
  symbol: "NIFTY",
  expiry: "2026-11-24",
  strike,
  type,
  close,
  settle: close,
  oi: 5000,
  chgOi: 100,
  volume: 2000,
  underlyingClose: under,
  ...extra,
});

describe("daily straddles from bhavcopy", () => {
  const days = [
    { date: "2026-11-03", rows: [bc(25000, "CE", 300, 25020), bc(25000, "PE", 280, 25020), bc(25100, "CE", 250, 25020), bc(25100, "PE", 330, 25020)] },
    { date: "2026-11-02", rows: [bc(25000, "CE", 320, 25080), bc(25000, "PE", 260, 25080), bc(25100, "CE", 270, 25080), bc(25100, "PE", 300, 25080)] },
    { date: "2026-11-04", rows: [bc(25000, "CE", 0, 24990, { settle: 290 }), bc(25000, "PE", 300, 24990), bc(25100, "CE", 240, 24990)] },
  ];
  it("sorts days, rolls the ATM to each close and uses settle when close is zero", () => {
    const rows = dailyStraddles(days, { kind: "atm" });
    expect(rows.map((r) => r.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(rows.map((r) => r.ceStrike)).toEqual([25100, 25000, 25000]);
    expect(rows[0].combined).toBe(570);
    expect(rows[1].change).toBe(10); // the rolling ATM compares across strikes
    expect(rows[2].combined).toBe(590);
    expect(rows[2].change).toBe(10);
    expect(rows[2].impliedMove).toBeCloseTo(0.85 * 590, 9);
    expect(rows[1].combinedPct).toBeCloseTo((580 / 25020) * 100, 9);
  });
  it("prices fixed strikes and custom pairs, skipping days without both legs", () => {
    const fixed = dailyStraddles(days, { kind: "fixed", strike: 25100 });
    expect(dailyStraddles([days[1], days[0]], { kind: "pair", ce: 25100, pe: 25000 })[1].change).toBe(0);
    expect(fixed.map((r) => r.date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(fixed[1].changePct).toBeCloseTo((10 / 570) * 100, 9);
    const pair = dailyStraddles(days, { kind: "pair", ce: 25100, pe: 25000 });
    expect(pair.map((r) => r.combined)).toEqual([530, 530, 540]);
    expect(pair[0].impliedMove).toBeNaN();
    expect(pair[0].volume).toBe(4000);
  });
  it("lists history dates and builds a deterministic sample", () => {
    const dates = straddleHistoryDates(toISTDate("2026-11-04", "12:00"), 5, "2026-11-24");
    expect(dates).toHaveLength(5);
    expect(dates[dates.length - 1]).toBe("2026-11-03");
    const after = straddleHistoryDates(toISTDate("2026-11-04", "19:30"), 5);
    expect(after[after.length - 1]).toBe("2026-11-04");
    const s1 = sampleBhavcopyDays({ symbol: "NIFTY", expiry: "2026-11-24", spot: 25000, dates });
    const s2 = sampleBhavcopyDays({ symbol: "NIFTY", expiry: "2026-11-24", spot: 25000, dates });
    expect(s1).toEqual(s2);
    expect(s1).toHaveLength(5);
    const rows = dailyStraddles(s1, { kind: "atm" });
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.combined).toBeGreaterThan(0);
      expect(Math.abs(r.ceStrike - r.underlyingClose)).toBeLessThanOrEqual(25);
    }
    expect(sampleBhavcopyDays({ symbol: "NIFTY", expiry: "2026-11-24", spot: 0, dates })).toEqual([]);
    // The session day closes on the same sample chain as the intraday session.
    const now = toISTDate("2026-11-04", "13:00");
    const withToday = [...dates.slice(1), "2026-11-04"];
    const anchored = dailyStraddles(sampleBhavcopyDays({ symbol: "NIFTY", expiry: "2026-11-24", spot: 25_000, dates: withToday, now }), { kind: "atm" });
    const session = simulateExpirySession({ symbol: "NIFTY", spot: 25_000, expiry: "2026-11-24", now });
    const lastPt = premiumSeries(session, { kind: "floating" }).summary.last!;
    expect(anchored[anchored.length - 1].underlyingClose).toBe(25_000);
    expect(anchored[anchored.length - 1].combined).toBeCloseTo(lastPt.straddle, 0); // LTP close vs mid: within half a rupee
  });
  it("loads bhavcopy two days at a time and stops when the proxy is offline", async () => {
    const calls: string[] = [];
    const ok = await loadBhavcopyDays(["a", "b", "c"], async (d) => {
      calls.push(d);
      return d === "b" ? { data: null, reason: "http-404" } : { data: [bc(25000, "CE", 1, 25000)] };
    });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(ok.answered).toBe(2);
    expect(ok.days.map((d) => d.date)).toEqual(["a", "c"]);
    const calls2: string[] = [];
    const off = await loadBhavcopyDays(["a", "b", "c", "d"], async (d) => {
      calls2.push(d);
      return { data: null, reason: "proxy-offline" };
    });
    expect(calls2).toEqual(["a", "b"]);
    expect(off.answered).toBe(0);
    expect(off.reason).toBe("proxy-offline");
  });
});

describe("builder hand-off", () => {
  it("builds CE and PE legs and a builder link", () => {
    const legs = pairLegs({ symbol: "nifty", expiry: "2026-11-10", ce: { strike: 25100, premium: 101.234, ivPct: 13.2 }, pe: { strike: 24900, premium: 95, ivPct: 0 }, side: "SELL" });
    expect(legs).toEqual([
      { symbol: "NIFTY", expiry: "2026-11-10", strike: 25100, type: "CE", side: "SELL", lots: 1, premium: 101.23, iv: 0.132 },
      { symbol: "NIFTY", expiry: "2026-11-10", strike: 24900, type: "PE", side: "SELL", lots: 1, premium: 95, iv: null },
    ]);
    const url = pairBuilderUrl({ symbol: "NIFTY", expiry: "2026-11-10", ce: { strike: 25000, premium: 100 }, pe: { strike: 25000, premium: 90 }, side: "BUY", lots: 2 });
    expect(url.startsWith("/strategy-builder?legs=")).toBe(true);
    const decoded = decodeLegs(decodeURIComponent(url.split("legs=")[1].split("&")[0]));
    expect(decoded).toHaveLength(2);
    expect(decoded[0].lots).toBe(2);
    expect(pairLegs({ symbol: "NIFTY", expiry: "2026-11-10", ce: { strike: 25000, premium: NaN }, pe: { strike: 25000, premium: 90 }, side: "BUY" })).toEqual([]);
    expect(pairBuilderUrl({ symbol: "", expiry: "2026-11-10", ce: { strike: 25000, premium: 1 }, pe: { strike: 25000, premium: 1 }, side: "BUY" })).toBe("");
  });
});
