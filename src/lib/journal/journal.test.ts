import { describe, expect, it } from "vitest";
import { calcCharges, getBrokerPreset, toISTDate } from "@/lib/options";
import { createPaperState, placeOrder } from "@/lib/paperTrading";
import {
  classifyStructure,
  dailyNet,
  dteBucket,
  equityCurve,
  fillsFromPaper,
  financialYear,
  groupStats,
  matchRoundTrips,
  mergeFills,
  parseJournal,
  parseTags,
  parseZerodha,
  sampleTradebook,
  summarise,
  timeBucket,
  turnoverCsv,
  turnoverSummary,
  zerodhaSymbol,
  type JournalFill,
} from "@/lib/journal";

const NOW = toISTDate("2026-10-17", "12:00");

function fill(p: Partial<JournalFill> & Pick<JournalFill, "id" | "side" | "qty" | "price">): JournalFill {
  return { source: "zerodha", underlying: "NIFTY", expiry: "2026-10-20", strike: 25000, type: "CE", date: "2026-10-14", ts: toISTDate("2026-10-14", "10:00").getTime(), exchange: "NSE", ...p };
}

describe("FIFO round trips", () => {
  it("matches oldest lots first and splits partial exits", () => {
    const fills = [
      fill({ id: "a", side: "BUY", qty: 65, price: 100, orderId: "o1" }),
      fill({ id: "b", side: "BUY", qty: 65, price: 120, orderId: "o2", ts: toISTDate("2026-10-14", "11:00").getTime() }),
      fill({ id: "c", side: "SELL", qty: 100, price: 130, orderId: "o3", date: "2026-10-15", ts: toISTDate("2026-10-15", "10:00").getTime() }),
    ];
    const { trips, open } = matchRoundTrips(fills, { now: NOW });
    expect(trips.map((t) => [t.qty, t.entryPrice, t.exitPrice, t.gross])).toEqual([
      [65, 100, 130, 1950],
      [35, 120, 130, 350],
    ]);
    expect(open).toEqual([expect.objectContaining({ qty: 30, price: 120, direction: "LONG" })]);
  });

  it("charges brokerage once per order and splits an order's charges by quantity", () => {
    const fills = [
      fill({ id: "a", side: "SELL", qty: 65, price: 120, orderId: "o1" }),
      fill({ id: "b", side: "SELL", qty: 65, price: 120, orderId: "o1" }),
      fill({ id: "c", side: "BUY", qty: 130, price: 60, orderId: "o2", date: "2026-10-16", ts: toISTDate("2026-10-16", "14:00").getTime() }),
    ];
    const { trips } = matchRoundTrips(fills, { now: NOW });
    expect(trips).toHaveLength(1);
    const t = trips[0];
    expect(t.direction).toBe("SHORT");
    expect(t.gross).toBe(7800);
    const broker = getBrokerPreset("zerodha");
    const expected = calcCharges([{ type: "CE", side: "SELL", price: 120, qty: 130 }], { broker, onDate: "2026-10-14" }).total + calcCharges([{ type: "CE", side: "BUY", price: 60, qty: 130 }], { broker, onDate: "2026-10-16" }).total;
    expect(t.charges).toBeCloseTo(expected, 1);
    expect(t.net).toBeCloseTo(7800 - expected, 1);
    expect(t.dte).toBe(6);
  });

  it("closes expired options at ₹0 when assumed, else leaves them open", () => {
    const fills = [fill({ id: "a", side: "SELL", qty: 65, price: 40, expiry: "2026-10-13", date: "2026-10-09" })];
    const assumed = matchRoundTrips(fills, { now: NOW });
    expect(assumed.trips[0]).toMatchObject({ assumedExpiry: true, exitPrice: 0, exitDate: "2026-10-13", gross: 2600 });
    const kept = matchRoundTrips(fills, { now: NOW, assumeExpiredWorthless: false });
    expect(kept.trips).toHaveLength(0);
    expect(kept.open).toHaveLength(1);
    expect(kept.openCharges).toBeGreaterThan(0);
  });

  it("flips through zero: the excess opens a new lot on the other side", () => {
    const fills = [fill({ id: "a", side: "BUY", qty: 65, price: 100 }), fill({ id: "b", side: "SELL", qty: 130, price: 110, ts: toISTDate("2026-10-14", "12:00").getTime() })];
    const { trips, open } = matchRoundTrips(fills, { now: toISTDate("2026-10-15", "10:00") });
    expect(trips).toHaveLength(1);
    expect(open[0]).toMatchObject({ direction: "SHORT", qty: 65 });
  });
});

describe("strategy detection", () => {
  const leg = (type: "CE" | "PE", direction: "LONG" | "SHORT", strike: number, expiry = "2026-10-20") => ({ type, direction, strike, expiry });
  it("names common structures", () => {
    expect(classifyStructure([leg("CE", "SHORT", 25500), leg("PE", "SHORT", 24500)])).toBe("Short strangle");
    expect(classifyStructure([leg("CE", "SHORT", 25000), leg("PE", "SHORT", 25000)])).toBe("Short straddle");
    expect(classifyStructure([leg("PE", "SHORT", 24800), leg("PE", "LONG", 24500)])).toBe("Bull put spread");
    expect(classifyStructure([leg("CE", "LONG", 25000), leg("CE", "SHORT", 25300)])).toBe("Bull call spread");
    expect(classifyStructure([leg("CE", "SHORT", 25500), leg("CE", "LONG", 25800), leg("PE", "SHORT", 24500), leg("PE", "LONG", 24200)])).toBe("Iron condor");
    expect(classifyStructure([leg("CE", "SHORT", 25000), leg("CE", "LONG", 25300), leg("PE", "SHORT", 25000), leg("PE", "LONG", 24700)])).toBe("Iron fly");
    expect(classifyStructure([leg("CE", "LONG", 25000), leg("CE", "SHORT", 25000, "2026-10-27")])).toBe("Calendar spread");
    expect(classifyStructure([leg("PE", "LONG", 24800)])).toBe("Long put");
  });
  it("groups legs entered within a few minutes on one underlying", () => {
    const t0 = toISTDate("2026-10-14", "10:00").getTime();
    const fills = [
      fill({ id: "c1", side: "SELL", qty: 65, price: 50, strike: 25500, ts: t0 }),
      fill({ id: "p1", side: "SELL", qty: 65, price: 45, strike: 24500, type: "PE", ts: t0 + 60_000 }),
      fill({ id: "c2", side: "BUY", qty: 65, price: 30, strike: 25500, ts: t0 + 86_400_000, date: "2026-10-15" }),
      fill({ id: "p2", side: "BUY", qty: 65, price: 20, strike: 24500, type: "PE", ts: t0 + 86_400_000, date: "2026-10-15" }),
    ];
    const { trips } = matchRoundTrips(fills, { now: NOW });
    expect(new Set(trips.map((t) => t.groupId)).size).toBe(1);
    expect(trips.every((t) => t.strategy === "Short strangle")).toBe(true);
  });
});

describe("analytics", () => {
  const { trips } = matchRoundTrips(
    [
      fill({ id: "a", side: "BUY", qty: 65, price: 100 }),
      fill({ id: "b", side: "SELL", qty: 65, price: 140, date: "2026-10-15", ts: toISTDate("2026-10-15", "10:00").getTime() }),
      fill({ id: "c", side: "BUY", qty: 65, price: 100, strike: 25100, ts: toISTDate("2026-10-15", "14:30").getTime(), date: "2026-10-15" }),
      fill({ id: "d", side: "SELL", qty: 65, price: 80, strike: 25100, date: "2026-10-16", ts: toISTDate("2026-10-16", "10:00").getTime() }),
      fill({ id: "e", side: "BUY", qty: 65, price: 10, strike: 25200, ts: toISTDate("2026-10-16", "11:00").getTime(), date: "2026-10-16" }),
      fill({ id: "f", side: "SELL", qty: 65, price: 10.2, strike: 25200, ts: toISTDate("2026-10-16", "11:30").getTime(), date: "2026-10-16" }),
    ],
    { now: NOW },
  );

  it("summarises net of charges with expectancy, profit factor, drawdown and charges share", () => {
    const s = summarise(trips);
    expect(s.trades).toBe(3);
    expect(s.gross).toBeCloseTo(2600 - 1300 + 13, 2);
    expect(s.net).toBeCloseTo(s.gross - s.charges, 2);
    expect(s.chargesPctOfGross).toBeCloseTo((s.charges / Math.abs(s.gross)) * 100, 6);
    expect(s.expectancy).toBeCloseTo(s.net / 3, 1);
    expect(s.eatenByCharges).toBe(1);
    expect(s.wins).toBe(1);
    expect(s.maxDrawdown).toBeGreaterThan(1300);
    expect(s.profitFactor).toBeGreaterThan(1);
  });

  it("splits by DTE, weekday and time of day in natural order", () => {
    expect(dteBucket(0)).toMatch(/^0 DTE/);
    expect(dteBucket(5)).toBe("3–7 days");
    expect(timeBucket(toISTDate("2026-10-14", "09:20").getTime())).toMatch(/opening/);
    expect(timeBucket(toISTDate("2026-10-14", "14:30").getTime())).toMatch(/closing/);
    expect(timeBucket(null)).toMatch(/not in file/);
    const byDay = groupStats(trips, "weekday");
    expect(byDay.map((r) => r.key)).toEqual(["Wed", "Thu", "Fri"]);
    const byTime = groupStats(trips, "timeOfDay");
    expect(byTime[0].key).toMatch(/opening|morning/);
    const tagged = groupStats(trips, "tag", { [trips[0].id]: { tags: ["breakout", "A+"], note: "" } });
    expect(tagged.map((r) => r.key).sort()).toEqual(["A+", "Untagged", "breakout"]);
  });

  it("combines multi-leg structures into one trade and merges their tags", async () => {
    const { combineGroups, mergeGroupNotes } = await import("@/lib/journal");
    const t0 = toISTDate("2026-10-14", "10:00").getTime();
    const legs = matchRoundTrips(
      [
        fill({ id: "c1", side: "SELL", qty: 65, price: 50, strike: 25500, ts: t0 }),
        fill({ id: "p1", side: "SELL", qty: 65, price: 45, strike: 24500, type: "PE", ts: t0 + 60_000 }),
        fill({ id: "c2", side: "BUY", qty: 65, price: 30, strike: 25500, ts: t0 + 86_400_000, date: "2026-10-15" }),
        fill({ id: "p2", side: "BUY", qty: 65, price: 60, strike: 24500, type: "PE", ts: t0 + 2 * 86_400_000, date: "2026-10-16" }),
      ],
      { now: NOW },
    ).trips;
    const combined = combineGroups(legs);
    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({ strategy: "Short strangle", entryDate: "2026-10-14", exitDate: "2026-10-16" });
    expect(combined[0].net).toBeCloseTo(legs[0].net + legs[1].net, 2);
    const notes = mergeGroupNotes(legs, { [legs[0].id]: { tags: ["a"], note: "x" }, [legs[1].id]: { tags: ["b", "a"], note: "" } });
    expect(notes[combined[0].id]).toEqual({ tags: ["a", "b"], note: "x" });
    expect(groupStats(combined, "tag", notes).map((r) => r.key).sort()).toEqual(["a", "b"]);
  });

  it("builds the daily P&L map and the equity curve", () => {
    const daily = dailyNet(trips);
    expect(Object.keys(daily).sort()).toEqual(["2026-10-15", "2026-10-16"]);
    const curve = equityCurve(trips);
    expect(curve[curve.length - 1].cum).toBeCloseTo(summarise(trips).net, 1);
  });
});

describe("ITR turnover", () => {
  it("assigns Indian financial years", () => {
    expect(financialYear("2026-03-31")).toBe("FY 2025-26");
    expect(financialYear("2026-04-01")).toBe("FY 2026-27");
  });
  it("sums absolute gross P&L and writes a CSV with a summary block", () => {
    const { trips } = matchRoundTrips(
      [
        fill({ id: "a", side: "BUY", qty: 65, price: 100 }),
        fill({ id: "b", side: "SELL", qty: 65, price: 140, date: "2026-10-15" }),
        fill({ id: "c", side: "SELL", qty: 65, price: 50, strike: 25100, date: "2026-10-15" }),
        fill({ id: "d", side: "BUY", qty: 65, price: 70, strike: 25100, date: "2026-10-16" }),
      ],
      { now: NOW },
    );
    const s = turnoverSummary(trips, "FY 2026-27");
    expect(s.turnover).toBeCloseTo(2600 + 1300, 2);
    expect(s.optionsTurnover).toBe(s.turnover);
    const csv = turnoverCsv(trips, "FY 2026-27", { sample: true });
    expect(csv.split("\n")[0]).toMatch(/SAMPLE DATA/);
    expect(csv).toMatch(/F&O turnover \(INR\),3900\.00/);
    expect(csv).toMatch(/ICAI/);
  });
});

describe("sample tradebook", () => {
  it("is a deterministic Zerodha CSV that parses cleanly into labelled round trips", () => {
    const csv = sampleTradebook();
    const parsed = parseZerodha(csv);
    expect(parsed.issues).toEqual([]);
    expect(parsed.fills.length).toBeGreaterThan(60);
    const { trips, open } = matchRoundTrips(parsed.fills, { now: NOW });
    expect(open).toEqual([]);
    expect(trips.length).toBeGreaterThan(30);
    expect(new Set(trips.map((t) => t.strategy)).size).toBeGreaterThan(3);
    expect(trips.every((t) => t.entryDate >= "2026-07-01" && t.exitDate <= "2026-09-30")).toBe(true);
    expect(zerodhaSymbol("NIFTY", "2026-10-06", 25000, "CE")).toBe("NIFTY26O0625000CE");
  });
});

describe("paper trades as fills", () => {
  it("converts fills with their booked charges", () => {
    const now = toISTDate("2026-10-14", "10:00");
    const s0 = createPaperState(500000, now);
    const res = placeOrder(s0, { symbol: "NIFTY", expiry: "2026-10-20", strike: 25000, type: "CE", side: "BUY", lots: 1, lotSize: 65, orderType: "MARKET" }, { quote: { bid: 99, ask: 101, ltp: 100, source: "nse" }, now, spots: { NIFTY: 25000 } });
    const later = toISTDate("2026-10-14", "11:00");
    const res2 = placeOrder(res.state, { symbol: "NIFTY", expiry: "2026-10-20", strike: 25000, type: "CE", side: "SELL", lots: 1, lotSize: 65, orderType: "MARKET" }, { quote: { bid: 119, ask: 121, ltp: 120, source: "nse" }, now: later, spots: { NIFTY: 25000 } });
    const fills = fillsFromPaper(res2.state);
    expect(fills).toHaveLength(2);
    const { trips } = matchRoundTrips(fills, { now: NOW });
    expect(trips).toHaveLength(1);
    const charges = res2.state.trades.reduce((a, t) => a + t.charges, 0);
    expect(trips[0].charges).toBeCloseTo(charges, 2);
    expect(trips[0].net).toBeCloseTo(res2.state.trades.reduce((a, t) => a + t.realisedNet, 0), 1);
  });
});

describe("store helpers", () => {
  it("merges fills by id, parses tags and survives junk storage", () => {
    const a = fill({ id: "a", side: "BUY", qty: 65, price: 1 });
    const res = mergeFills([a], [a, fill({ id: "b", side: "SELL", qty: 65, price: 2 })]);
    expect([res.added, res.duplicates, res.fills.length]).toEqual([1, 1, 2]);
    expect(parseTags("expiry, Expiry , #revenge\nA+")).toEqual(["expiry", "revenge", "A+"]);
    expect(parseJournal("{not json").fills).toEqual([]);
    const ok = parseJournal(JSON.stringify({ version: 1, fills: [a, { id: "x" }], annotations: { a: { tags: ["x"], note: "n" } }, view: "imported" }));
    expect(ok.fills).toHaveLength(1);
    expect(ok.annotations.a.note).toBe("n");
    expect(ok.view).toBe("imported");
  });
});
