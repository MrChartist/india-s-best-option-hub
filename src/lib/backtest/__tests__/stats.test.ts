import { describe, expect, it } from "vitest";
import { CSV_HEADER, computeStats, legsSummary, maxStreak, profitFactor, splitByReason, splitByVix, splitByWeekday, tradesToCsv, vixRegime, withDrawdown } from "../stats";
import type { Trade } from "../types";

function trade(id: number, net: number, patch: Partial<Trade> = {}): Trade {
  return {
    id,
    entryDate: "2026-02-02",
    exitDate: "2026-02-03",
    expiry: "2026-02-03",
    entryDte: 1,
    entrySpot: 25_000,
    exitSpot: 25_000,
    vix: 14,
    weekday: 1,
    legs: [{ type: "CE", side: "SELL", strike: 25_000, expiry: "2026-02-03", lots: 1, lotSize: 65, entry: 100, exit: 50 }],
    netPremium: 6500,
    basis: 6500,
    basisKind: "premium",
    margin: 150_000,
    gross: net + 50,
    charges: 50,
    net,
    daysHeld: 1,
    reason: "expiry",
    mae: 0,
    mfe: 0,
    modelFills: 0,
    ...patch,
  };
}

describe("streaks and ratios", () => {
  const ts = [trade(1, 100), trade(2, -50), trade(3, -20), trade(4, 0), trade(5, 300), trade(6, -10)];
  it("max consecutive losses count break-even trades as losses", () => {
    expect(maxStreak(ts, (t) => t.net <= 0)).toBe(3);
    expect(maxStreak(ts, (t) => t.net > 0)).toBe(1);
  });
  it("profit factor", () => {
    expect(profitFactor(ts)).toBeCloseTo(400 / 80, 10);
    expect(profitFactor([trade(1, 10)])).toBe(Infinity);
    expect(profitFactor([])).toBeNaN();
  });
});

describe("drawdown and stats", () => {
  const eq = withDrawdown([
    { date: "2026-01-01", equity: 100, pnl: 0, inTrade: false },
    { date: "2026-01-02", equity: 120, pnl: 20, inTrade: true },
    { date: "2026-01-03", equity: 90, pnl: -10, inTrade: true },
    { date: "2026-01-04", equity: 130, pnl: 30, inTrade: false },
  ]);
  it("tracks the drop from the running peak", () => {
    expect(eq.map((p) => p.drawdown)).toEqual([0, 0, -30, 0]);
    expect(eq[2].drawdownPct).toBeCloseTo(-25, 10);
  });
  it("summarises trades", () => {
    const s = computeStats([trade(1, 20), trade(2, -10), trade(3, 20)], eq, 100);
    expect(s.trades).toBe(3);
    expect(s.winRate).toBeCloseTo(66.667, 2);
    expect(s.expectancy).toBeCloseTo(10, 10);
    expect(s.avgWin).toBe(20);
    expect(s.avgLoss).toBe(-10);
    expect(s.payoffRatio).toBe(2);
    expect(s.maxDrawdown).toBe(30);
    expect(s.maxDrawdownPct).toBeCloseTo(25, 10);
    expect(s.returnPct).toBe(30);
    expect(s.charges).toBe(150);
    expect(s.exposurePct).toBe(50);
    expect(s.best).toBe(20);
    expect(s.worst).toBe(-10);
    expect(s.recoveryFactor).toBe(1);
  });
  it("is safe with no trades", () => {
    const s = computeStats([], [], 100);
    expect(s.trades).toBe(0);
    expect(s.winRate).toBeNaN();
    expect(s.maxDrawdown).toBe(0);
  });
});

describe("splits", () => {
  it("classifies VIX regimes", () => {
    expect([vixRegime(11.9), vixRegime(12), vixRegime(16), vixRegime(20), vixRegime(null), vixRegime(Number.NaN)]).toEqual(["low", "normal", "elevated", "high", "unknown", "unknown"]);
  });
  it("groups trades by regime, weekday and exit reason", () => {
    const ts = [trade(1, 10, { vix: 11 }), trade(2, -5, { vix: 22, weekday: 5, reason: "stop" }), trade(3, 7, { vix: 11, weekday: 5 })];
    expect(splitByVix(ts).map((r) => [r.key, r.trades])).toEqual([["low", 2], ["high", 1]]);
    expect(splitByWeekday(ts).map((r) => [r.label, r.trades, r.net])).toEqual([["Monday", 1, 10], ["Friday", 2, 2]]);
    expect(splitByReason(ts).map((r) => r.key)).toEqual(["stop", "expiry"]);
  });
});

describe("csv", () => {
  it("writes a header, one row per trade and the data label", () => {
    const csv = tradesToCsv([trade(1, 1234.567)], "NIFTY", "sample");
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split(",")).toHaveLength(CSV_HEADER.length);
    expect(lines[1]).toContain("1234.57");
    expect(lines[1]).toContain("Sample (not market data)");
  });
  it("quotes cells with commas or quotes", () => {
    const csv = tradesToCsv([trade(1, 1)], 'NI,"FTY', "bhavcopy");
    expect(csv).toContain('"NI,""FTY"');
  });
  it("labels later-expiry legs", () => {
    const t = trade(1, 0, { legs: [{ type: "CE", side: "SELL", strike: 25_000, expiry: "2026-02-03", lots: 1, lotSize: 65, entry: 1, exit: 1 }, { type: "CE", side: "BUY", strike: 25_000, expiry: "2026-02-10", lots: 1, lotSize: 65, entry: 1, exit: 1 }] });
    expect(legsSummary(t)).toBe("S 1x 25000 CE · B 1x 25000 CE @ 2026-02-10");
  });
});
