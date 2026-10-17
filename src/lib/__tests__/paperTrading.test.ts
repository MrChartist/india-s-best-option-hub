import { beforeEach, describe, expect, it } from "vitest";
import { calcCharges, exerciseSTT, getBrokerPreset, toISTDate } from "@/lib/options";
import {
  PAPER_KEY,
  applyFill,
  basketToOrders,
  cancelOrder,
  contractKey,
  createPaperState,
  dailyPnl,
  funds,
  limitFillPrice,
  loadPaper,
  marketFillPrice,
  parsePaperState,
  placeOrder,
  processTick,
  quoteMid,
  savePaper,
  settleExpiredPaper,
  settlementKey,
  type OrderInput,
  type PaperOrder,
  type Quote,
} from "@/lib/paperTrading";

const EXPIRY = "2026-10-27"; // a Tuesday
const NOW = toISTDate("2026-10-20", "10:00");
const AFTER_EXPIRY = toISTDate(EXPIRY, "15:31");
const SPOTS = { NIFTY: 25000 };

const q = (bid: number, ask: number, ltp = (bid + ask) / 2, source = "nse"): Quote => ({ bid, ask, ltp, source });

const base: OrderInput = { symbol: "NIFTY", expiry: EXPIRY, strike: 25000, type: "CE", side: "BUY", lots: 1, lotSize: 75, orderType: "MARKET" };

describe("fill pricing", () => {
  it("uses the mid of a two-sided quote, else LTP", () => {
    expect(quoteMid(q(100, 102))).toBe(101);
    expect(quoteMid({ bid: 0, ask: 0, ltp: 55, source: "nse" })).toBe(55);
    expect(Number.isNaN(quoteMid({ bid: 0, ask: 0, ltp: 0, source: "nse" }))).toBe(true);
  });

  it("applies slippage against the trader and rounds to the 0.05 tick", () => {
    // mid 101, 0.5% → 101.505 → buy rounds up to 101.55, sell 100.495 rounds down to 100.45
    expect(marketFillPrice(q(100, 102), "BUY", 0.5)).toBe(101.55);
    expect(marketFillPrice(q(100, 102), "SELL", 0.5)).toBe(100.45);
    expect(marketFillPrice(q(100, 102), "BUY", 0)).toBe(101);
    expect(marketFillPrice(q(0.05, 0.1), "SELL", 50)).toBe(0.05); // never below one tick
  });

  it("fills a limit only when marketable, at the better market price", () => {
    expect(limitFillPrice(q(100, 102), "BUY", 101, 0)).toBe(101);
    expect(limitFillPrice(q(100, 102), "BUY", 105, 0)).toBe(101);
    expect(Number.isNaN(limitFillPrice(q(100, 102), "BUY", 100, 0))).toBe(true);
    expect(limitFillPrice(q(100, 102), "SELL", 99, 0)).toBe(101);
    expect(Number.isNaN(limitFillPrice(q(100, 102), "SELL", 102, 0))).toBe(true);
  });
});

describe("orders and charges", () => {
  it("fills a market buy, debits premium plus charges and books them in the ledger", () => {
    const s0 = createPaperState(500000, NOW, { slippagePct: 0 });
    const res = placeOrder(s0, base, { quote: q(100, 102), now: NOW, spots: SPOTS });
    expect(res.outcome).toBe("filled");
    const ch = calcCharges([{ type: "CE", side: "BUY", price: 101, qty: 75 }], { broker: getBrokerPreset("zerodha"), onDate: "2026-10-20" });
    expect(res.state.cash).toBeCloseTo(500000 - 101 * 75 - ch.total, 1);
    expect(res.state.positions).toHaveLength(1);
    expect(res.state.positions[0]).toMatchObject({ netLots: 1, avgPrice: 101 });
    const kinds = res.state.ledger.map((l) => l.kind);
    expect(kinds).toEqual(["DEPOSIT", "PREMIUM", "CHARGES"]);
    expect(res.state.ledger[res.state.ledger.length - 1].balance).toBeCloseTo(res.state.cash, 2);
    // The opening trade realises only its charges.
    expect(res.state.trades[0].realisedGross).toBe(0);
    expect(res.state.trades[0].realisedNet).toBeCloseTo(-ch.total, 2);
  });

  it("realises P&L net of both legs' charges on a round trip", () => {
    let s = createPaperState(500000, NOW, { slippagePct: 0 });
    s = placeOrder(s, base, { quote: q(100, 102), now: NOW, spots: SPOTS }).state;
    const later = new Date(NOW.getTime() + 3600_000);
    s = placeOrder(s, { ...base, side: "SELL" }, { quote: q(120, 122), now: later, spots: SPOTS }).state;
    expect(s.positions).toHaveLength(0);
    const gross = (121 - 101) * 75;
    const charges = s.trades.reduce((a, t) => a + t.charges, 0);
    const net = s.trades.reduce((a, t) => a + t.realisedNet, 0);
    expect(s.trades[1].realisedGross).toBeCloseTo(gross, 2);
    expect(net).toBeCloseTo(gross - charges, 1);
    expect(s.cash).toBeCloseTo(500000 + gross - charges, 0);
    expect(dailyPnl(s)["2026-10-20"]).toBeCloseTo(gross - charges, 0);
    // STT is charged on the sell side only.
    const sellCh = calcCharges([{ type: "CE", side: "SELL", price: 121, qty: 75 }], { onDate: "2026-10-20" });
    expect(sellCh.stt).toBeGreaterThan(0);
  });

  it("averages adds and flips through zero at the fill price", () => {
    let s = createPaperState(1_000_000, NOW, { slippagePct: 0 });
    s = placeOrder(s, base, { quote: q(100, 100), now: NOW, spots: SPOTS }).state;
    s = placeOrder(s, base, { quote: q(110, 110), now: NOW, spots: SPOTS }).state;
    expect(s.positions[0]).toMatchObject({ netLots: 2, avgPrice: 105 });
    s = placeOrder(s, { ...base, side: "SELL", lots: 3 }, { quote: q(120, 120), now: NOW, spots: SPOTS }).state;
    expect(s.positions[0]).toMatchObject({ netLots: -1, avgPrice: 120 });
    expect(s.trades[2].realisedGross).toBeCloseTo(2 * 75 * 15, 2);
  });

  it("rejects a market order without a quote, and sample quotes when sample fills are off", () => {
    const s0 = createPaperState(500000, NOW);
    expect(placeOrder(s0, base, { quote: null, now: NOW, spots: SPOTS }).outcome).toBe("rejected");
    const off = { ...s0, settings: { ...s0.settings, allowSampleFills: false } };
    const r = placeOrder(off, base, { quote: q(100, 102, 101, "sample"), now: NOW, spots: SPOTS });
    expect(r.outcome).toBe("rejected");
    expect(r.order.reason).toMatch(/sample/i);
  });

  it("rejects orders that exceed free funds but allows risk-reducing ones", () => {
    const s0 = createPaperState(5000, NOW, { slippagePct: 0 });
    expect(placeOrder(s0, base, { quote: q(100, 102), now: NOW, spots: SPOTS }).outcome).toBe("rejected");
    // A naked short needs SPAN-style margin well above ₹5,000.
    expect(placeOrder(s0, { ...base, side: "SELL" }, { quote: q(100, 102), now: NOW, spots: SPOTS }).outcome).toBe("rejected");
  });

  it("rests a non-marketable limit, fills it on a later tick, and can cancel", () => {
    let s = createPaperState(500000, NOW, { slippagePct: 0 });
    const r = placeOrder(s, { ...base, orderType: "LIMIT", limitPrice: 95 }, { quote: q(100, 102), now: NOW, spots: SPOTS });
    expect(r.outcome).toBe("open");
    s = r.state;
    const key = contractKey(base);
    let t = processTick(s, { [key]: q(98, 99) }, NOW, SPOTS);
    expect(t.state.orders[0].status).toBe("OPEN");
    t = processTick(s, { [key]: q(94, 95) }, NOW, SPOTS);
    expect(t.state.orders[0].status).toBe("FILLED");
    expect(t.state.orders[0].fillPrice).toBe(94.5);
    expect(t.events[0].kind).toBe("limit-filled");
    expect(cancelOrder(s, s.orders[0].id).orders[0].status).toBe("CANCELLED");
  });
});

describe("stop-loss and target", () => {
  it("squares off a long at the stop and a short at its target", () => {
    let s = createPaperState(1_000_000, NOW, { slippagePct: 0 });
    s = placeOrder(s, { ...base, sl: 80, target: 150 }, { quote: q(100, 100), now: NOW, spots: SPOTS }).state;
    const key = contractKey(base);
    let t = processTick(s, { [key]: q(90, 90) }, NOW, SPOTS);
    expect(t.state.positions).toHaveLength(1);
    expect(t.state.positions[0].ltp).toBe(90);
    t = processTick(s, { [key]: q(79, 79) }, NOW, SPOTS);
    expect(t.state.positions).toHaveLength(0);
    expect(t.events.some((e) => e.kind === "sl")).toBe(true);
    expect(t.state.orders.at(-1)?.origin).toBe("sl");

    const peKey = contractKey({ ...base, type: "PE" });
    let s2 = createPaperState(1_000_000, NOW, { slippagePct: 0 });
    s2 = placeOrder(s2, { ...base, type: "PE", side: "SELL", target: 40, sl: 200 }, { quote: q(100, 100), now: NOW, spots: SPOTS }).state;
    const t2 = processTick(s2, { [peKey]: q(39, 39) }, NOW, SPOTS);
    expect(t2.state.positions).toHaveLength(0);
    expect(t2.events.some((e) => e.kind === "target")).toBe(true);
  });
});

describe("expiry settlement", () => {
  it("settles an ITM long at intrinsic and charges STT on exercise", () => {
    let s = createPaperState(1_000_000, NOW, { slippagePct: 0 });
    s = placeOrder(s, base, { quote: q(100, 100), now: NOW, spots: SPOTS }).state;
    const cashBefore = s.cash;
    // The last spot seen inside the expiry-day closing window is the settlement price.
    s = settleExpiredPaper(s, toISTDate(EXPIRY, "15:29"), { NIFTY: 25200 }).state;
    const res = settleExpiredPaper(s, AFTER_EXPIRY, { NIFTY: 25900 });
    expect(res.settled).toHaveLength(1);
    const stt = exerciseSTT(200, 75, EXPIRY);
    expect(stt).toBeGreaterThan(0);
    expect(res.settled[0].stt).toBeCloseTo(stt, 2);
    expect(res.state.positions).toHaveLength(0);
    expect(res.state.cash).toBeCloseTo(cashBefore + 200 * 75 - stt, 1);
    const trade = res.state.trades.at(-1);
    expect(trade?.kind).toBe("SETTLEMENT");
    expect(trade?.date).toBe(EXPIRY);
    expect(trade?.realisedNet).toBeCloseTo((200 - 100) * 75 - stt, 1);
    expect(res.state.ledger.map((l) => l.kind)).toContain("EXERCISE_STT");
  });

  it("charges no STT on a short ITM option or an OTM long, and keeps positions without a spot", () => {
    let s = createPaperState(2_000_000, NOW, { slippagePct: 0 });
    s = placeOrder(s, { ...base, side: "SELL" }, { quote: q(100, 100), now: NOW, spots: SPOTS }).state;
    s = placeOrder(s, { ...base, type: "PE", strike: 24500 }, { quote: q(20, 20), now: NOW, spots: SPOTS }).state;
    const none = settleExpiredPaper(s, AFTER_EXPIRY, {});
    expect(none.settled).toHaveLength(0);
    const res = settleExpiredPaper(s, AFTER_EXPIRY, {}, { [settlementKey("NIFTY", EXPIRY)]: 25300 });
    expect(res.settled).toHaveLength(2);
    expect(res.settled.every((e) => e.stt === 0)).toBe(true);
    const short = res.settled.find((e) => e.label.includes("CE"));
    expect(short?.realisedNet).toBeCloseTo((100 - 300) * 75, 1);
    const long = res.settled.find((e) => e.label.includes("PE"));
    expect(long?.realisedNet).toBeCloseTo(-20 * 75, 1);
  });

  it("never settles at a spot seen after the close; waits for a close instead", () => {
    let s = createPaperState(1_000_000, NOW, { slippagePct: 0 });
    s = placeOrder(s, base, { quote: q(100, 100), now: NOW, spots: SPOTS }).state;
    // A morning mark on expiry day is outside the closing window and is not used.
    s = processTick(s, {}, toISTDate(EXPIRY, "10:00"), { NIFTY: 25400 }).state;
    const later = toISTDate("2026-10-29", "11:00");
    const pending = processTick(s, {}, later, { NIFTY: 26000 });
    expect(pending.events.filter((e) => e.kind === "settled")).toHaveLength(0);
    expect(pending.state.positions).toHaveLength(1);
    // A tick in the closing window, then a much later tick at a different spot.
    s = processTick(s, {}, toISTDate(EXPIRY, "15:25"), { NIFTY: 25150 }).state;
    const res = processTick(s, {}, later, { NIFTY: 26000 });
    expect(res.state.positions).toHaveLength(0);
    expect(res.state.trades.at(-1)?.price).toBe(150);
  });

  it("keeps spot marks through save and load", () => {
    let s = createPaperState(1_000_000, NOW);
    s = processTick(s, {}, toISTDate(EXPIRY, "15:20"), { NIFTY: 25100 }).state;
    const parsed = parsePaperState(JSON.stringify(s));
    expect(parsed?.spotMarks?.[settlementKey("NIFTY", EXPIRY)]?.spot).toBe(25100);
  });

  it("cancels open orders on expired contracts during a tick", () => {
    let s = createPaperState(500000, NOW);
    s = placeOrder(s, { ...base, orderType: "LIMIT", limitPrice: 1 }, { quote: q(100, 102), now: NOW, spots: SPOTS }).state;
    const t = processTick(s, {}, AFTER_EXPIRY, {});
    expect(t.state.orders[0].status).toBe("CANCELLED");
  });

  it("rejects new orders on an expired contract", () => {
    const s = createPaperState(500000, AFTER_EXPIRY);
    expect(placeOrder(s, base, { quote: q(1, 2), now: AFTER_EXPIRY, spots: SPOTS }).order.reason).toMatch(/expired/);
  });
});

describe("funds, basket and persistence", () => {
  beforeEach(() => localStorage.clear());

  it("reports equity as cash plus marked positions", () => {
    let s = createPaperState(500000, NOW, { slippagePct: 0 });
    s = placeOrder(s, base, { quote: q(100, 100), now: NOW, spots: SPOTS }).state;
    s = processTick(s, { [contractKey(base)]: q(110, 110) }, NOW, SPOTS).state;
    const f = funds(s, SPOTS, NOW);
    expect(f.positionsValue).toBeCloseTo(110 * 75, 2);
    expect(f.unrealised).toBeCloseTo(10 * 75, 2);
    expect(f.equity).toBeCloseTo(s.cash + 110 * 75, 2);
    expect(f.margin).toBe(0); // long-only: nothing blocked beyond premium already paid
  });

  it("converts basket legs to market orders and skips unknown lot sizes", () => {
    const { orders, skipped } = basketToOrders(
      [
        { symbol: "NIFTY", expiry: EXPIRY, strike: 25000, type: "CE", side: "SELL", lots: 2, premium: 100 },
        { symbol: "UNKNOWN", expiry: EXPIRY, strike: 100, type: "PE", side: "BUY", lots: 1, premium: 5 },
      ],
      (s) => (s === "NIFTY" ? 75 : undefined),
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ lots: 2, lotSize: 75, orderType: "MARKET", origin: "basket" });
    expect(skipped).toEqual(["UNKNOWN 100 PE"]);
  });

  it("round-trips through storage and rejects malformed JSON", () => {
    let s = createPaperState(300000, NOW);
    s = placeOrder(s, base, { quote: q(100, 102), now: NOW, spots: SPOTS }).state;
    expect(savePaper(s)).toBe(true);
    expect(localStorage.getItem(PAPER_KEY)).toBeTruthy();
    const back = loadPaper();
    expect(back?.cash).toBeCloseTo(s.cash, 2);
    expect(back?.positions[0].key).toBe(contractKey(base));
    expect(parsePaperState("{not json")).toBeNull();
    expect(parsePaperState(JSON.stringify({ version: 2 }))).toBeNull();
    const bad = parsePaperState(JSON.stringify({ ...s, positions: [{ symbol: "X" }], settings: { slippagePct: 99 } }));
    expect(bad?.positions).toHaveLength(0);
    expect(bad?.settings.slippagePct).toBe(0.5);
  });

  it("applyFill does not mutate the input state", () => {
    const s = createPaperState(500000, NOW);
    const order: PaperOrder = { ...base, id: "x", status: "OPEN", origin: "ticket", createdAt: 0, updatedAt: 0 };
    const snapshot = JSON.stringify(s);
    applyFill(s, order, 100, NOW);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
