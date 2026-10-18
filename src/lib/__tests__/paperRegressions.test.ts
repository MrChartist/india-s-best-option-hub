import { beforeEach, describe, expect, it } from "vitest";
import { toISTDate } from "@/lib/options";
import {
  PAPER_KEY,
  createPaperSaver,
  createPaperState,
  exportPaperState,
  paperChangeIsMaterial,
  parsePaperState,
  placeOrder,
  processTick,
  setPositionRisk,
  worstCaseLoss,
  type OrderInput,
  type PaperState,
  type Quote,
} from "@/lib/paperTrading";

const EXPIRY = "2026-10-27";
const NOW = toISTDate("2026-10-20", "10:00");
const SPOTS = { NIFTY: 25000 };
const q = (bid: number, ask: number, ltp = (bid + ask) / 2): Quote => ({ bid, ask, ltp, source: "nse" });
const base: OrderInput = { symbol: "NIFTY", expiry: EXPIRY, strike: 25000, type: "CE", side: "BUY", lots: 1, lotSize: 75, orderType: "MARKET" };
const KEY = "NIFTY|2026-10-27|25000|CE";

beforeEach(() => localStorage.clear());

describe("stop-loss and target side", () => {
  it("rejects a sell whose stop is below the fill, and a buy whose stop is above it", () => {
    const s0 = createPaperState(1_000_000, NOW);
    const sell = placeOrder(s0, { ...base, side: "SELL", sl: 1 }, { quote: q(99, 101), now: NOW, spots: SPOTS });
    expect(sell.outcome).toBe("rejected");
    expect(sell.message).toMatch(/Stop-loss must be above the entry for a sell/);
    expect(sell.state.positions).toHaveLength(0);
    const buy = placeOrder(s0, { ...base, sl: 150 }, { quote: q(99, 101), now: NOW, spots: SPOTS });
    expect(buy.outcome).toBe("rejected");
    expect(buy.message).toMatch(/Stop-loss must be below the entry for a buy/);
  });

  it("rejects targets on the wrong side, and limit orders checked against the limit price", () => {
    const s0 = createPaperState(1_000_000, NOW);
    expect(placeOrder(s0, { ...base, target: 50 }, { quote: q(99, 101), now: NOW, spots: SPOTS }).message).toMatch(/Target must be above the entry for a buy/);
    expect(placeOrder(s0, { ...base, side: "SELL", target: 150 }, { quote: q(99, 101), now: NOW, spots: SPOTS }).message).toMatch(/Target must be below the entry for a sell/);
    const lim = placeOrder(s0, { ...base, orderType: "LIMIT", limitPrice: 90, sl: 95 }, { quote: q(99, 101), now: NOW, spots: SPOTS });
    expect(lim.outcome).toBe("rejected");
    // Correct sides still fill.
    const ok = placeOrder(s0, { ...base, side: "SELL", sl: 130, target: 60 }, { quote: q(99, 101), now: NOW, spots: SPOTS });
    expect(ok.outcome).toBe("filled");
  });

  it("worst-case loss treats a wrong-side stop as no stop, not zero risk", () => {
    const r = worstCaseLoss([{ input: { ...base, side: "SELL", sl: 1 }, price: 100 }]);
    expect(r.unlimited).toBe(true);
    const long = worstCaseLoss([{ input: { ...base, sl: 150 }, price: 100 }]);
    expect(long.basis).toBe("premium");
    expect(long.loss).toBeGreaterThan(100 * 75);
  });
});

describe("parsePaperState rejects malformed orders and positions", () => {
  it("drops an imported OPEN limit BUY with negative lots so it can never fill", () => {
    const s0 = createPaperState(1_000_000, NOW);
    const raw = JSON.parse(exportPaperState(s0));
    raw.orders.push({ id: "o-bad", symbol: "NIFTY", expiry: EXPIRY, strike: 25000, type: "CE", side: "BUY", lots: -2, lotSize: 75, orderType: "LIMIT", limitPrice: 200, status: "OPEN", origin: "ticket", createdAt: 1, updatedAt: 1 });
    raw.orders.push({ id: "o-frac", symbol: "NIFTY", expiry: EXPIRY, strike: 25000, type: "CE", side: "BUY", lots: 1.5, lotSize: 75, orderType: "MARKET", status: "FILLED", origin: "ticket", createdAt: 1, updatedAt: 1 });
    raw.orders.push({ id: "o-nolimit", symbol: "NIFTY", expiry: EXPIRY, strike: 25000, type: "CE", side: "BUY", lots: 1, lotSize: 75, orderType: "LIMIT", status: "OPEN", origin: "ticket", createdAt: 1, updatedAt: 1 });
    raw.orders.push({ id: "o-status", symbol: "NIFTY", expiry: EXPIRY, strike: 25000, type: "CE", side: "BUY", lots: 1, lotSize: 75, orderType: "MARKET", status: "WHATEVER", origin: "ticket", createdAt: 1, updatedAt: 1 });
    raw.positions.push({ symbol: "NIFTY", expiry: EXPIRY, strike: 25000, type: "PE", netLots: 0.5, lotSize: 75, avgPrice: 100, openedAt: 1 });
    raw.positions.push({ symbol: "NIFTY", expiry: EXPIRY, strike: 25100, type: "PE", netLots: 1, lotSize: 75, avgPrice: 100, openedAt: 1, sl: "x", target: -5 });
    const parsed = parsePaperState(JSON.stringify(raw)) as PaperState;
    expect(parsed).not.toBeNull();
    expect(parsed.orders).toHaveLength(0);
    expect(parsed.positions).toHaveLength(1);
    expect(parsed.positions[0].sl).toBeUndefined();
    expect(parsed.positions[0].target).toBeUndefined();
    const res = processTick(parsed, { [KEY]: q(99, 101) }, NOW, SPOTS);
    expect(res.state.cash).toBe(1_000_000);
    expect(res.events).toHaveLength(0);
  });
});

describe("two tabs on one paper account", () => {
  function withPosition(): PaperState {
    const s0 = createPaperState(1_000_000, NOW);
    return placeOrder(s0, base, { quote: q(99, 101), now: NOW, spots: SPOTS }).state;
  }

  it("a mark-only price tick is not a material change; fills and SL edits are", () => {
    const s1 = withPosition();
    const tick = processTick(s1, { [KEY]: q(104, 106) }, new Date(NOW.getTime() + 3_000), SPOTS).state;
    expect(tick).not.toBe(s1);
    expect(paperChangeIsMaterial(s1, tick)).toBe(false);
    expect(paperChangeIsMaterial(s1, setPositionRisk(s1, KEY, { sl: 80 }))).toBe(true);
    expect(paperChangeIsMaterial(s1, placeOrder(s1, base, { quote: q(99, 101), now: NOW, spots: SPOTS }).state)).toBe(true);
    expect(paperChangeIsMaterial(null, s1)).toBe(true);
  });

  it("deferred mark-only states never count as pending and never write on their own", () => {
    const writes: PaperState[] = [];
    const saver = createPaperSaver({ delayMs: 0, save: (s) => (writes.push(s), true) });
    const s1 = withPosition();
    saver.defer(s1);
    expect(saver.pending()).toBe(false);
    // A real change is still pending and carries the latest marks.
    const s2 = setPositionRisk(s1, KEY, { sl: 80 });
    saver.schedule(s2);
    expect(saver.pending()).toBe(true);
    const s3 = processTick(s2, { [KEY]: q(104, 106) }, new Date(NOW.getTime() + 3_000), SPOTS).state;
    saver.defer(s3);
    expect(saver.flush()).toBe(true);
    expect(writes).toEqual([s3]);
    // Deferred marks are written on the page-hide flush.
    saver.defer(s1);
    saver.flush();
    expect(writes).toHaveLength(2);
    expect(localStorage.getItem(PAPER_KEY)).toBeNull();
  });
});
