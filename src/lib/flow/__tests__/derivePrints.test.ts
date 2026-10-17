import { describe, expect, it } from "vitest";
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import { toISTDate } from "@/lib/options";
import {
  calendarDaysBetween,
  classifyAggressor,
  classifyMoneyness,
  classifyTag,
  derivePrints,
  derivePrintsFromSeries,
  quoteAggressor,
  signedPremium,
  tickAggressor,
} from "../derivePrints";

const T0 = toISTDate("2026-10-16", "10:00").getTime();

function row(strike: number, side: "CE" | "PE", o: Partial<StrikeSnap> = {}): StrikeSnap {
  return { strike, side, ltp: 100, oi: 10_000, vol: 5_000, iv: 14, bid: 99, ask: 101, ...o };
}

function snap(ts: number, rows: StrikeSnap[], spot = 25_010, expiry = "2026-10-20"): ChainSnapshot {
  return { id: `NIFTY|${expiry}|${ts}`, symbol: "NIFTY", expiry, ts, spot, rows };
}

describe("quoteAggressor", () => {
  it("classifies by position inside the spread", () => {
    expect(quoteAggressor(101, 99, 101)).toBe("ASK");
    expect(quoteAggressor(102, 99, 101)).toBe("ASK");
    expect(quoteAggressor(100.6, 99, 101)).toBe("ASK"); // 80% of spread
    expect(quoteAggressor(99, 99, 101)).toBe("BID");
    expect(quoteAggressor(99.4, 99, 101)).toBe("BID"); // 20% of spread
    expect(quoteAggressor(100, 99, 101)).toBe("MID");
  });
  it("returns null for unusable quotes", () => {
    expect(quoteAggressor(100, 0, 101)).toBeNull();
    expect(quoteAggressor(100, 101, 101)).toBeNull();
    expect(quoteAggressor(100, 102, 101)).toBeNull();
    expect(quoteAggressor(0, 99, 101)).toBeNull();
  });
});

describe("tickAggressor / classifyAggressor", () => {
  it("uses the tick test when there is no quote", () => {
    expect(tickAggressor(105, 100)).toBe("ASK");
    expect(tickAggressor(95, 100)).toBe("BID");
    expect(tickAggressor(100, 100)).toBe("MID");
    expect(classifyAggressor({ ltp: 105, bid: 0, ask: 0 }, 100)).toEqual({ aggressor: "ASK", basis: "tick" });
    expect(classifyAggressor({ ltp: 105, bid: 104, ask: 105 }, 110)).toEqual({ aggressor: "ASK", basis: "quote" });
    expect(classifyAggressor({ ltp: 105, bid: 0, ask: 0 }, 0)).toEqual({ aggressor: "MID", basis: "none" });
  });
});

describe("classifyTag", () => {
  it("tags opening, closing and churn", () => {
    expect(classifyTag(500, 1000)).toBe("OPENING");
    expect(classifyTag(-500, 1000)).toBe("CLOSING");
    expect(classifyTag(50, 1000)).toBe("UNKNOWN"); // below 10% of volume
    expect(classifyTag(100, 1000)).toBe("OPENING"); // exactly 10%
    expect(classifyTag(0, 0)).toBe("UNKNOWN");
    expect(classifyTag(300, 1000, 0.5)).toBe("UNKNOWN");
  });
});

describe("classifyMoneyness", () => {
  it("handles CE and PE around spot", () => {
    expect(classifyMoneyness(25_000, "CE", 25_010, 25_000)).toBe("ATM");
    expect(classifyMoneyness(24_900, "CE", 25_010, 25_000)).toBe("ITM");
    expect(classifyMoneyness(25_100, "CE", 25_010, 25_000)).toBe("OTM");
    expect(classifyMoneyness(25_100, "PE", 25_010, 25_000)).toBe("ITM");
    expect(classifyMoneyness(24_900, "PE", 25_010, 25_000)).toBe("OTM");
  });
});

describe("derivePrints", () => {
  const prev = snap(T0, [row(25_000, "CE"), row(25_000, "PE"), row(25_100, "CE"), row(24_900, "PE")]);
  const curr = snap(T0 + 60_000, [
    row(25_000, "CE", { vol: 6_000, oi: 10_600, ltp: 101, bid: 100, ask: 101 }), // ask, opening
    row(25_000, "PE", { vol: 5_400, oi: 9_700, ltp: 98, bid: 98, ask: 100 }), // bid, closing
    row(25_100, "CE", { vol: 5_000 }), // no volume → no print
    row(24_900, "PE", { vol: 5_200, oi: 10_005, ltp: 100, bid: 99, ask: 101 }), // mid, churn
  ]);
  const prints = derivePrints(prev, curr, 65);

  it("emits one print per contract that traded, largest premium first", () => {
    expect(prints.map((p) => `${p.strike}${p.type}`)).toEqual(["25000CE", "25000PE", "24900PE"]);
  });

  it("computes dVol, premium, dOI, aggressor and tag", () => {
    const ce = prints[0];
    expect(ce.dVol).toBe(1_000);
    expect(ce.premium).toBe(1_000 * 101 * 65);
    expect(ce.dOI).toBe(600);
    expect(ce.aggressor).toBe("ASK");
    expect(ce.tag).toBe("OPENING");
    expect(ce.moneyness).toBe("ATM");
    expect(ce.dte).toBe(4);
    const pe = prints[1];
    expect(pe.aggressor).toBe("BID");
    expect(pe.tag).toBe("CLOSING");
    const churn = prints[2];
    expect(churn.aggressor).toBe("MID");
    expect(churn.tag).toBe("UNKNOWN");
    expect(churn.moneyness).toBe("OTM");
  });

  it("signs premium by aggressor", () => {
    expect(signedPremium(prints[0])).toBeGreaterThan(0);
    expect(signedPremium(prints[1])).toBeLessThan(0);
    expect(signedPremium(prints[2])).toBe(0);
  });

  it("refuses to diff across sessions, symbols, expiries or backwards in time", () => {
    const nextDay = snap(toISTDate("2026-10-19", "09:20").getTime(), curr.rows);
    expect(derivePrints(prev, nextDay, 65)).toEqual([]);
    expect(derivePrints(curr, prev, 65)).toEqual([]);
    expect(derivePrints(prev, { ...curr, expiry: "2026-10-27" }, 65)).toEqual([]);
    expect(derivePrints(prev, { ...curr, symbol: "BANKNIFTY" }, 65)).toEqual([]);
    expect(derivePrints(prev, { ...curr, ts: T0 + 45 * 60_000 }, 65)).toEqual([]); // gap > 30 min
  });

  it("skips volume resets and zero LTP", () => {
    const reset = snap(T0 + 60_000, [row(25_000, "CE", { vol: 10 }), row(25_000, "PE", { vol: 6_000, ltp: 0 })]);
    expect(derivePrints(prev, reset, 65)).toEqual([]);
  });

  it("dte is 0 on expiry day", () => {
    const a = snap(toISTDate("2026-10-20", "10:00").getTime(), [row(25_000, "CE")], 25_000);
    const b = snap(toISTDate("2026-10-20", "10:01").getTime(), [row(25_000, "CE", { vol: 6_000 })], 25_000);
    expect(derivePrints(a, b, 65)[0].dte).toBe(0);
  });

  it("derivePrintsFromSeries walks consecutive pairs", () => {
    const third = snap(T0 + 120_000, curr.rows.map((r) => ({ ...r, vol: r.vol + 100 })));
    const all = derivePrintsFromSeries([third, prev, curr], 65);
    expect(all.length).toBe(3 + 4);
    expect(all[0].ts).toBe(T0 + 120_000);
  });
});

describe("calendarDaysBetween", () => {
  it("counts calendar days", () => {
    expect(calendarDaysBetween("2026-10-16", "2026-10-20")).toBe(4);
    expect(calendarDaysBetween("2026-10-20", "2026-10-20")).toBe(0);
    expect(Number.isNaN(calendarDaysBetween("bad", "2026-10-20"))).toBe(true);
  });
});
