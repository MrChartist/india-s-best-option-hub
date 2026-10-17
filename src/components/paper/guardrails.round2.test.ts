import { afterEach, describe, expect, it, vi } from "vitest";
import { toISTDate } from "@/lib/options";
import {
  createPaperSaver,
  createPaperState,
  dailyCapBreached,
  guardCheck,
  nakedShorts,
  placeOrder,
  processTick,
  todayPnl,
  worstCaseLoss,
  type OrderInput,
  type PaperState,
} from "@/lib/paperTrading";

const DAY1 = toISTDate("2026-10-14", "10:00");
const DAY2 = toISTDate("2026-10-15", "09:20");
const EXP = "2026-10-27";
const Q = { bid: 99, ask: 101, ltp: 100, source: "nse" };
const order = (p: Partial<OrderInput> = {}): OrderInput => ({ symbol: "NIFTY", expiry: EXP, strike: 25000, type: "CE", side: "BUY", lots: 1, lotSize: 65, orderType: "MARKET", ...p });

function longOn(day: Date): PaperState {
  return placeOrder(createPaperState(500_000, day), order(), { quote: Q, now: day, spots: { NIFTY: 25000 } }).state;
}

describe("daily loss cap measures today only", () => {
  it("does not count an overnight loss from earlier sessions", () => {
    // Bought on day 1, closed day 1 marked 250 below entry (a big loss, but yesterday's).
    let s = longOn(DAY1);
    s = { ...s, positions: s.positions.map((p) => ({ ...p, ltp: p.avgPrice - 250 })) };
    expect(dailyCapBreached(s, DAY1)).toBe(true);
    // Day 2, first tick at the same mark: today's P&L is flat, the cap is not breached.
    const key = s.positions[0].key;
    const mark = s.positions[0].ltp ?? 0;
    const t = processTick(s, { [key]: { bid: mark - 0.5, ask: mark + 0.5, ltp: mark, source: "nse" } }, DAY2, { NIFTY: 25000 }).state;
    expect(t.dayStart?.date).toBe("2026-10-15");
    expect(Math.abs(todayPnl(t, DAY2))).toBeLessThan(1);
    expect(dailyCapBreached(t, DAY2)).toBe(false);
    // A further 10-point drop today is today's loss.
    const lower = { ...t, positions: t.positions.map((p) => ({ ...p, ltp: mark - 10 })) };
    expect(todayPnl(lower, DAY2)).toBeCloseTo(-650, 0);
  });

  it("falls back to positions opened today when no snapshot exists yet", () => {
    let s = longOn(DAY1);
    s = { ...s, dayStart: undefined, positions: s.positions.map((p) => ({ ...p, ltp: p.avgPrice - 250 })) };
    expect(todayPnl(s, DAY2)).toBe(0);
  });
});

describe("worst-case loss across expiries", () => {
  it("treats a later-expiry long of the same type as cover for a calendar", () => {
    const cal = worstCaseLoss([
      { input: order({ side: "SELL", expiry: "2026-10-20" }), price: 80 },
      { input: order({ side: "BUY", expiry: EXP }), price: 120 },
    ]);
    expect(cal.unlimited).toBe(false);
    expect(nakedShorts([{ symbol: "NIFTY", expiry: "2026-10-20", type: "CE", netLots: -1 }, { symbol: "NIFTY", expiry: EXP, type: "CE", netLots: 1 }])).toEqual({});
    // Net debit 40 × 65 is the bound at the front expiry.
    expect(cal.loss).toBeCloseTo(40 * 65 + cal.charges, 2);
  });
  it("keeps a reverse calendar (far short) unlimited", () => {
    const rev = worstCaseLoss([
      { input: order({ side: "BUY", expiry: "2026-10-20" }), price: 80 },
      { input: order({ side: "SELL", expiry: EXP }), price: 120 },
    ]);
    expect(rev.unlimited).toBe(true);
  });
});

describe("cover nets units, not lots", () => {
  it("one long lot of 65 does not cover one short lot of 75", () => {
    const n = nakedShorts([
      { symbol: "NIFTY", expiry: "2026-10-20", type: "CE", netLots: -1, lotSize: 75 },
      { symbol: "NIFTY", expiry: EXP, type: "CE", netLots: 1, lotSize: 65 },
    ]);
    expect(n["NIFTY|2026-10-20|CE"]).toBeCloseTo(10 / 75, 6);
  });
});

describe("max-risk % uses equity", () => {
  it("a depleted account gets a smaller per-trade limit", () => {
    const s = createPaperState(500_000, DAY1);
    const poorer: PaperState = { ...s, cash: 250_000 };
    const legs = [{ input: order(), price: 100 }];
    expect(guardCheck(s, legs, 7_000, { now: DAY1 }).maxLossPct).toBeCloseTo(1.4, 6);
    expect(guardCheck(poorer, legs, 7_000, { now: DAY1 }).maxLossPct).toBeCloseTo(2.8, 6);
  });
});

describe("saver max wait", () => {
  afterEach(() => vi.useRealTimers());
  it("writes at least every maxWaitMs under a steady stream of changes", () => {
    vi.useFakeTimers();
    const save = vi.fn(() => true);
    const saver = createPaperSaver({ delayMs: 1000, maxWaitMs: 3000, save });
    const s = createPaperState(1, DAY1);
    for (let i = 0; i < 10; i++) {
      saver.schedule(s);
      vi.advanceTimersByTime(500);
    }
    // 5 s of changes every 500 ms: a pure trailing debounce would not have written at all.
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
