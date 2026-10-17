import { describe, expect, it } from "vitest";
import {
  atmStraddleFromRows,
  eventWindow,
  eventWindowMovePct,
  measureEventMove,
  median,
  mergeResultsHistory,
  overpricedVerdict,
  pastResultsDates,
  sampleEventMoves,
  straddleAt,
  straddleImpliedVol,
  summariseEventMoves,
  termStructureExEventIv,
  type BhavcopyFoRow,
  type EventMoveObservation,
  type MarketEvent,
} from "@/lib/events";

const row = (p: Partial<BhavcopyFoRow>): BhavcopyFoRow => ({
  symbol: "TCS",
  expiry: "2026-10-27",
  strike: 3000,
  type: "CE",
  close: 0,
  settle: 0,
  oi: 0,
  chgOi: 0,
  volume: 0,
  underlyingClose: 3010,
  ...p,
});

function day(spot: number, legs: Array<[number, number, number]>, expiry = "2026-10-27"): BhavcopyFoRow[] {
  const out: BhavcopyFoRow[] = [];
  for (const [k, ce, pe] of legs) {
    out.push(row({ strike: k, type: "CE", close: ce, underlyingClose: spot, expiry }));
    out.push(row({ strike: k, type: "PE", close: pe, underlyingClose: spot, expiry }));
  }
  return out;
}

describe("event window", () => {
  it("spans the session before and after the results date", () => {
    expect(eventWindow("2026-10-16")).toEqual({ pre: "2026-10-15", post: "2026-10-19" });
    // Saturday results: Friday → Monday
    expect(eventWindow("2026-10-17")).toEqual({ pre: "2026-10-16", post: "2026-10-19" });
    // around the 20 Oct holiday
    expect(eventWindow("2026-10-19")).toEqual({ pre: "2026-10-16", post: "2026-10-21" });
    expect(eventWindow("x")).toBeNull();
  });
});

describe("straddle picking", () => {
  it("takes the strike nearest spot with both legs, falling back to settle", () => {
    const rows = [...day(3010, [[2950, 90, 30], [3000, 60, 50], [3050, 35, 75]]), row({ strike: 3000, type: "FUT", close: 3015 })];
    const q = atmStraddleFromRows(rows, "TCS", "2026-10-19");
    expect(q).toMatchObject({ strike: 3000, ce: 60, pe: 50, straddle: 110, spot: 3010, expiry: "2026-10-27" });
    const settleOnly = [row({ strike: 3000, type: "CE", close: 0, settle: 40 }), row({ strike: 3000, type: "PE", close: 45 })];
    expect(straddleAt(settleOnly, "TCS", "2026-10-27", 3000)?.straddle).toBe(85);
  });

  it("skips expiries that die before the post-event session and missing legs", () => {
    const near = day(3010, [[3000, 20, 15]], "2026-10-15");
    const next = day(3010, [[3000, 0, 50], [3050, 40, 80]], "2026-11-24");
    const q = atmStraddleFromRows([...near, ...next], "TCS", "2026-10-19");
    expect(q?.expiry).toBe("2026-11-24");
    expect(q?.strike).toBe(3050);
    expect(atmStraddleFromRows([], "TCS", "2026-10-19")).toBeNull();
  });
});

describe("measureEventMove", () => {
  it("compares the straddle-implied move with the realised move", () => {
    const pre = day(3000, [[3000, 80, 70]]); // straddle 150 = 5% of spot
    const post = day(3090, [[3000, 100, 8]]); // stock +3%, straddle 108
    const o = measureEventMove({ symbol: "tcs", eventDate: "2026-10-16", preRows: pre, postRows: post })!;
    expect(o.preDate).toBe("2026-10-15");
    expect(o.postDate).toBe("2026-10-19");
    expect(o.straddleMovePct).toBeCloseTo(5, 10);
    expect(o.dte).toBe(12);
    // Post-event IV isolates the window: time value left after the post session is removed.
    expect(o.impliedMethod).toBe("post");
    expect(o.impliedMovePct).toBeGreaterThan(0);
    expect(o.impliedMovePct).toBeLessThan(5);
    expect(o.realisedMovePct).toBeCloseTo(3, 10);
    expect(o.signedMovePct).toBeCloseTo(3, 10);
    expect(o.moveRatio).toBeCloseTo(3 / o.impliedMovePct, 10);
    expect(o.straddlePnlPct).toBeCloseTo(-28, 10);
    expect(o.source).toBe("bhavcopy");
  });

  it("flags an underpriced move and tolerates a missing post straddle", () => {
    const pre = day(3000, [[3000, 60, 60]]); // 4%
    const post = [row({ type: "FUT", close: 2790, underlyingClose: 2790 })]; // −7%, no options rows
    const o = measureEventMove({ symbol: "TCS", eventDate: "2026-10-16", preRows: pre, postRows: post })!;
    expect(o.overpriced).toBe(false);
    expect(o.impliedMethod).toBe("straddle"); // no next expiry, no post straddle: not isolated
    expect(o.impliedMovePct).toBeCloseTo(4, 10);
    expect(o.signedMovePct).toBeCloseTo(-7, 10);
    expect(Number.isNaN(o.straddlePnlPct)).toBe(true);
  });

  it("returns null without a pre-event straddle or post close", () => {
    expect(measureEventMove({ symbol: "TCS", eventDate: "2026-10-16", preRows: [], postRows: day(3000, [[3000, 1, 1]]) })).toBeNull();
    expect(measureEventMove({ symbol: "TCS", eventDate: "2026-10-16", preRows: day(3000, [[3000, 1, 1]]), postRows: [] })).toBeNull();
  });
});

describe("event-window implied move", () => {
  it("equals the full straddle move when no time is left after the window", () => {
    // tPost = 0: the whole straddle variance sits inside the window.
    const pct = eventWindowMovePct(0.4, 5 / 365, 0.25, 0);
    expect(pct).toBeCloseTo(Math.sqrt(2 / Math.PI) * 0.4 * Math.sqrt(5 / 365) * 100, 10);
  });

  it("removes the time value left after the event and never goes negative", () => {
    const full = eventWindowMovePct(0.4, 20 / 365, 0.25, 0);
    const window = eventWindowMovePct(0.4, 20 / 365, 0.25, 16 / 365);
    expect(window).toBeLessThan(full);
    expect(eventWindowMovePct(0.2, 20 / 365, 0.5, 16 / 365)).toBe(0);
    expect(Number.isNaN(eventWindowMovePct(0.2, 0, 0.2, 0))).toBe(true);
  });

  it("recovers the ex-event IV from two expiries sharing the jump", () => {
    const exIv = 0.22;
    const jump = 0.05 * 0.05;
    const t1 = 10 / 365;
    const t2 = 38 / 365;
    const iv1 = Math.sqrt((exIv * exIv * t1 + jump) / t1);
    const iv2 = Math.sqrt((exIv * exIv * t2 + jump) / t2);
    expect(termStructureExEventIv(iv1, t1, iv2, t2)).toBeCloseTo(exIv, 10);
    expect(Number.isNaN(termStructureExEventIv(0.5, t1, 0.1, t2))).toBe(true);
  });

  it("inverts a straddle to its IV", () => {
    const iv = straddleImpliedVol(150, 3000, 3000, 12 / 365);
    // ATM straddle ≈ √(2/π)·σ√T·S, so 5% over 12 days is about 34.5% IV.
    expect(iv).toBeCloseTo(0.05 / (Math.sqrt(2 / Math.PI) * Math.sqrt(12 / 365)), 2);
    expect(Number.isNaN(straddleImpliedVol(0, 3000, 3000, 0.1))).toBe(true);
  });

  it("uses the next expiry in the pre-event rows when it is there", () => {
    const pre = [...day(3000, [[3000, 80, 70]]), ...day(3000, [[3000, 110, 100]], "2026-11-24")];
    const post = day(3090, [[3000, 100, 8]]);
    const o = measureEventMove({ symbol: "TCS", eventDate: "2026-10-16", preRows: pre, postRows: post })!;
    expect(o.impliedMethod).toBe("term");
    expect(o.impliedMovePct).toBeLessThan(o.straddleMovePct);
  });

  it("sample events are not biased towards overpriced by time value", () => {
    for (const sym of ["RELIANCE", "INFY", "TCS"]) {
      for (const o of sampleEventMoves(sym, "2026-10-17", 8)) {
        expect(o.impliedMethod).not.toBe("straddle");
        expect(o.impliedMovePct).toBeLessThan(o.straddleMovePct);
      }
    }
  });
});

describe("summariseEventMoves", () => {
  const obs = (implied: number, realised: number, pnl: number): EventMoveObservation => ({
    symbol: "TCS",
    eventDate: "2026-01-01",
    preDate: "",
    postDate: "",
    expiry: "",
    strike: 0,
    spotPre: 100,
    spotPost: 100 + realised,
    straddlePre: implied,
    straddlePost: implied * (1 + pnl / 100),
    dte: 7,
    straddleMovePct: implied,
    impliedMovePct: implied,
    impliedMethod: "post",
    realisedMovePct: realised,
    signedMovePct: realised,
    moveRatio: realised / implied,
    overpriced: realised < implied,
    straddlePnlPct: pnl,
    source: "bhavcopy",
  });

  it("computes the 'overpriced X% of the time' statistic", () => {
    const s = summariseEventMoves([obs(5, 2, -40), obs(6, 7, 10), obs(4, 1, -50), obs(5, 4, NaN)])!;
    expect(s.n).toBe(4);
    expect(s.overpricedCount).toBe(3);
    expect(s.overpricedPct).toBe(75);
    expect(s.avgImpliedPct).toBe(5);
    expect(s.avgRealisedPct).toBe(3.5);
    expect(s.avgEdgePct).toBe(1.5);
    expect(s.medianRatio).toBeCloseTo((0.4 + 0.8) / 2, 10);
    expect(s.avgStraddlePnlPct).toBeCloseTo(-80 / 3, 10);
    expect(s.sellerWinPct).toBeCloseTo((2 / 3) * 100, 10);
    expect(s.maxRealisedPct).toBe(7);
    expect(s.source).toBe("bhavcopy");
    expect(overpricedVerdict(s)).toBe("Straddles usually overpriced");
  });

  it("handles empty input and small samples", () => {
    expect(summariseEventMoves([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(Number.isNaN(median([]))).toBe(true);
    expect(overpricedVerdict({ n: 2, overpricedPct: 100 })).toBe("Too few events to call");
    expect(overpricedVerdict({ n: 10, overpricedPct: 50 })).toBe("Fairly priced");
    expect(overpricedVerdict({ n: 10, overpricedPct: 20 })).toBe("Straddles usually underpriced");
  });
});

describe("results history", () => {
  const nse = (symbol: string, date: string): MarketEvent => ({ id: `results:${date}:${symbol}`, date, symbol, kind: "results", category: "Results", title: "", impact: "high", region: "IN", source: "nse" });

  it("collects past NSE dates only, newest first", () => {
    const events = [nse("TCS", "2026-07-10"), nse("TCS", "2026-10-09"), nse("TCS", "2026-10-20"), { ...nse("TCS", "2026-04-10"), source: "sample" as const }, nse("INFY", "2026-07-17")];
    expect(pastResultsDates("tcs", "2026-10-17", { events, stored: ["2026-01-12", "2023-01-01", "junk"] })).toEqual(["2026-10-09", "2026-07-10", "2026-01-12"]);
  });

  it("merges new dates into stored history with a cap", () => {
    const out = mergeResultsHistory({ TCS: ["2026-01-12"], BAD: "x" as unknown as string[] }, [nse("TCS", "2026-07-10"), nse("TCS", "2026-01-12")], 2);
    expect(out.TCS).toEqual(["2026-01-12", "2026-07-10"]);
    const capped = mergeResultsHistory(out, [nse("TCS", "2026-10-09")], 2);
    expect(capped.TCS).toEqual(["2026-07-10", "2026-10-09"]);
  });
});

describe("sampleEventMoves", () => {
  it("is deterministic, labelled sample and sensible", () => {
    const a = sampleEventMoves("RELIANCE", "2026-10-17", 8);
    expect(a).toEqual(sampleEventMoves("RELIANCE", "2026-10-17", 8));
    expect(a.length).toBe(8);
    for (const o of a) {
      expect(o.source).toBe("sample");
      expect(o.eventDate < "2026-10-17").toBe(true);
      expect(o.impliedMovePct).toBeGreaterThan(1);
      expect(o.impliedMovePct).toBeLessThan(25);
      expect(o.expiry > o.postDate).toBe(true);
      expect(Number.isFinite(o.straddlePnlPct)).toBe(true);
    }
    // newest first
    expect(a[0].eventDate > a[a.length - 1].eventDate).toBe(true);
    expect(summariseEventMoves(a)?.source).toBe("sample");
    expect(sampleEventMoves("", "2026-10-17")).toEqual([]);
  });
});
