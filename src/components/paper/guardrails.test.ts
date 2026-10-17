import { afterEach, describe, expect, it, vi } from "vitest";
import { toISTDate } from "@/lib/options";
import {
  activateKillSwitch,
  compactLedger,
  createPaperSaver,
  createPaperState,
  dailyCapBreached,
  guardCheck,
  isRiskReducing,
  killSwitchActive,
  nakedShortViolations,
  nakedShorts,
  parsePaperState,
  placeOrder,
  releaseKillSwitch,
  worstCaseLoss,
  type OrderInput,
  type PaperState,
} from "@/lib/paperTrading";

const NOW = toISTDate("2026-10-14", "10:00");
const EXP = "2026-10-20";
const Q = { bid: 99, ask: 101, ltp: 100, source: "nse" };
const order = (p: Partial<OrderInput> = {}): OrderInput => ({ symbol: "NIFTY", expiry: EXP, strike: 25000, type: "CE", side: "BUY", lots: 1, lotSize: 65, orderType: "MARKET", ...p });

function withLong(): PaperState {
  return placeOrder(createPaperState(500_000, NOW), order(), { quote: Q, now: NOW, spots: { NIFTY: 25000 } }).state;
}

describe("naked shorts", () => {
  it("counts shorts not covered by a long of the same type in the same or a later expiry", () => {
    expect(nakedShorts([{ symbol: "NIFTY", expiry: EXP, type: "CE", netLots: -2 }, { symbol: "NIFTY", expiry: EXP, type: "CE", netLots: 1 }])).toEqual({ [`NIFTY|${EXP}|CE`]: 1 });
    expect(nakedShorts([{ symbol: "NIFTY", expiry: EXP, type: "CE", netLots: -1 }, { symbol: "NIFTY", expiry: "2026-10-27", type: "CE", netLots: 1 }])).toEqual({});
    expect(nakedShorts([{ symbol: "NIFTY", expiry: "2026-10-27", type: "PE", netLots: -1 }, { symbol: "NIFTY", expiry: EXP, type: "PE", netLots: 1 }])).toEqual({ "NIFTY|2026-10-27|PE": 1 });
  });
  it("flags only orders that add naked exposure", () => {
    const s = createPaperState(500_000, NOW);
    expect(nakedShortViolations(s.positions, [order({ side: "SELL" })])).toHaveLength(1);
    expect(nakedShortViolations(s.positions, [order({ side: "SELL" }), order({ strike: 25300 })])).toEqual([]);
    expect(nakedShortViolations(withLong().positions, [order({ side: "SELL" })])).toEqual([]);
  });
  it("recognises exits as risk reducing", () => {
    const s = withLong();
    expect(isRiskReducing(s.positions, [order({ side: "SELL" })])).toBe(true);
    expect(isRiskReducing(s.positions, [order({ side: "SELL", lots: 2 })])).toBe(false);
    expect(isRiskReducing(s.positions, [order()])).toBe(false);
  });
});

describe("worst-case loss", () => {
  it("uses the stop, the premium, or the combined expiry payoff", () => {
    const stop = worstCaseLoss([{ input: order({ sl: 80 }), price: 100 }]);
    expect(stop.basis).toBe("stop");
    expect(stop.loss).toBeCloseTo(20 * 65 + stop.charges, 2);
    const prem = worstCaseLoss([{ input: order(), price: 100 }]);
    expect(prem.loss).toBeCloseTo(6500 + prem.charges, 2);
    expect(worstCaseLoss([{ input: order({ side: "SELL" }), price: 100 }]).unlimited).toBe(true);
    const spread = worstCaseLoss([
      { input: order({ type: "PE", side: "SELL", strike: 24800 }), price: 90 },
      { input: order({ type: "PE", side: "BUY", strike: 24600 }), price: 40 },
    ]);
    expect(spread.unlimited).toBe(false);
    expect(spread.loss).toBeCloseTo((200 - 50) * 65 + spread.charges, 2);
  });
});

describe("guardCheck", () => {
  it("requires a max loss within the % of capital limit and above the worst case", () => {
    const s = createPaperState(500_000, NOW);
    const legs = [{ input: order(), price: 100 }];
    expect(guardCheck(s, legs, null, { now: NOW }).blockers.join(" ")).toMatch(/most you are willing to lose/);
    expect(guardCheck(s, legs, 20_000, { now: NOW }).blockers.join(" ")).toMatch(/4\.00% of capital/);
    expect(guardCheck(s, legs, 5_000, { now: NOW }).blockers.join(" ")).toMatch(/Worst case/);
    const ok = guardCheck(s, legs, 7_000, { now: NOW });
    expect(ok.ok).toBe(true);
    expect(ok.maxLossPct).toBeCloseTo(1.4, 6);
  });
  it("blocks naked shorts in beginner mode and unlimited risk always", () => {
    const s = createPaperState(500_000, NOW);
    const naked = guardCheck(s, [{ input: order({ side: "SELL", sl: 150 }), price: 100 }], 5_000, { now: NOW });
    expect(naked.blockers.join(" ")).toMatch(/Beginner mode/);
    const pro: PaperState = { ...s, settings: { ...s.settings, guardrails: { beginnerMode: false, maxRiskPct: 2, dailyLossCap: null } } };
    expect(guardCheck(pro, [{ input: order({ side: "SELL", sl: 150 }), price: 100 }], 5_000, { now: NOW }).ok).toBe(true);
    expect(guardCheck(pro, [{ input: order({ side: "SELL" }), price: 100 }], 5_000, { now: NOW }).blockers.join(" ")).toMatch(/unlimited/);
  });
  it("kill switch and daily cap block new risk but never exits", () => {
    const s = withLong();
    const killed = activateKillSwitch(s, NOW);
    expect(killSwitchActive(killed, NOW)).toBe(true);
    expect(killSwitchActive(killed, toISTDate("2026-10-15", "09:16"))).toBe(false);
    expect(guardCheck(killed, [{ input: order({ strike: 25100 }), price: 100 }], 7_000, { now: NOW }).blockers[0]).toMatch(/kill switch/);
    expect(guardCheck(killed, [{ input: order({ side: "SELL" }), price: 100 }], null, { now: NOW }).ok).toBe(true);
    expect(releaseKillSwitch(killed).killSwitch).toBeUndefined();

    const losing: PaperState = { ...s, positions: s.positions.map((p) => ({ ...p, ltp: p.avgPrice - 200 })) };
    expect(dailyCapBreached(losing, NOW)).toBe(true);
    expect(guardCheck(losing, [{ input: order({ strike: 25100 }), price: 100 }], 7_000, { now: NOW }).blockers[0]).toMatch(/daily cap/);
  });
  it("keeps guardrails and the kill switch through save and load", () => {
    const s = activateKillSwitch(withLong(), NOW);
    const back = parsePaperState(JSON.stringify(s));
    expect(back?.killSwitch?.until).toBe(s.killSwitch?.until);
    expect(back?.settings.guardrails).toEqual({ beginnerMode: true, maxRiskPct: 2, dailyLossCap: 10_000 });
    const legacy = parsePaperState(JSON.stringify({ ...s, settings: { slippagePct: 1, brokerId: "dhan", allowSampleFills: true } }));
    expect(legacy?.settings.guardrails?.beginnerMode).toBe(true);
  });
});

describe("debounced saver", () => {
  afterEach(() => vi.useRealTimers());
  it("writes the latest state once after the delay, and flushes on demand", () => {
    vi.useFakeTimers();
    const save = vi.fn(() => true);
    const saver = createPaperSaver({ delayMs: 1000, save });
    const a = createPaperState(1, NOW);
    const b = createPaperState(2, NOW);
    saver.schedule(a);
    vi.advanceTimersByTime(500);
    saver.schedule(b);
    vi.advanceTimersByTime(900);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(b);
    saver.schedule(a);
    expect(saver.pending()).toBe(true);
    expect(saver.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saver.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("reports a failed write", () => {
    const onError = vi.fn();
    const saver = createPaperSaver({ save: () => false, onError });
    saver.schedule(createPaperState(1, NOW));
    expect(saver.flush()).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("ledger archiving", () => {
  it("folds rows older than 90 days into one summary per month and keeps the balance trail", () => {
    let s = createPaperState(500_000, toISTDate("2026-05-04", "09:30"));
    const quote = (ltp: number) => ({ bid: ltp - 1, ask: ltp + 1, ltp, source: "nse" });
    const trade = (date: string, side: "BUY" | "SELL", px: number) => {
      s = placeOrder(s, order({ expiry: "2026-12-29", side }), { quote: quote(px), now: toISTDate(date, "10:00"), spots: { NIFTY: 25000 } }).state;
    };
    trade("2026-05-05", "BUY", 100);
    trade("2026-05-20", "SELL", 120);
    trade("2026-06-10", "BUY", 90);
    trade("2026-10-01", "SELL", 95);
    const before = s.ledger.length;
    const now = toISTDate("2026-10-17", "12:00");
    const c = compactLedger(s, now);
    const archived = c.ledger.filter((e) => e.kind === "ARCHIVE");
    expect(archived.map((e) => e.date.slice(0, 7))).toEqual(["2026-05", "2026-06"]);
    expect(c.ledger[0].kind).toBe("DEPOSIT");
    expect(c.ledger.length).toBeLessThan(before);
    expect(c.ledger[c.ledger.length - 1].balance).toBe(s.ledger[s.ledger.length - 1].balance);
    const may = archived[0];
    expect(may.archived?.count).toBe(4);
    expect(may.amount).toBeCloseTo(s.ledger.filter((e) => e.date.startsWith("2026-05") && e.kind !== "DEPOSIT").reduce((a, e) => a + e.amount, 0), 2);
    expect(compactLedger(c, now)).toBe(c);
    expect(c.trades).toBe(s.trades);
  });
});
