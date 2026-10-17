import { describe, expect, it } from "vitest";
import { BROKER_PRESETS, black76Price, bsPrice, calcCharges, forwardFromSpot, getChargeRates, intrinsic, type Leg } from "@/lib/options";
import {
  analyseTrade,
  breakevenExitPrice,
  futuresBasis,
  holidayShiftFrom,
  maxLossPerLotFromLegs,
  priceOption,
  resolveBroker,
  rowQty,
  searchSpecs,
  squareOffVsExpire,
  sumBreakdowns,
  toNum,
  toneOf,
  tradeFills,
  upcomingExpiries,
  type TradeRow,
} from "./calcLogic";

const zerodha = BROKER_PRESETS[0];
const DATE_2026 = "2026-06-15";

const row = (p: Partial<TradeRow> = {}): TradeRow => ({ id: "a", instrument: "CE", side: "BUY", entry: 100, exit: 130, lots: 2, lotSize: 65, exchange: "NSE", ...p });

describe("toNum", () => {
  it("parses Indian grouping, rupee sign and unicode minus", () => {
    expect(toNum("1,23,456.50")).toBe(123456.5);
    expect(toNum("₹ 2,000")).toBe(2000);
    expect(toNum("−12.5")).toBe(-12.5);
    expect(toNum(7)).toBe(7);
  });
  it("returns NaN for empty or junk input", () => {
    expect(toNum("")).toBeNaN();
    expect(toNum("-")).toBeNaN();
    expect(toNum("abc")).toBeNaN();
    expect(toNum(undefined)).toBeNaN();
    expect(toNum(Infinity)).toBeNaN();
  });
});

describe("toneOf", () => {
  it("maps sign to tone", () => {
    expect(toneOf(5)).toBe("bullish");
    expect(toneOf(-5)).toBe("bearish");
    expect(toneOf(0)).toBe("default");
    expect(toneOf(NaN)).toBe("default");
  });
});

describe("resolveBroker", () => {
  it("returns presets by id and falls back to the first preset", () => {
    expect(resolveBroker("dhan", { perOrder: 0 }).name).toBe("Dhan");
    expect(resolveBroker("nope", { perOrder: 0 }).id).toBe(BROKER_PRESETS[0].id);
  });
  it("builds a custom broker with percent brokerage capped at the cap", () => {
    const b = resolveBroker("custom", { perOrder: 20, pctOfTurnover: 0.03, cap: 15 });
    expect(b.pctOfTurnover).toBeCloseTo(0.0003, 10);
    expect(b.cap).toBe(15);
    const flat = resolveBroker("custom", { perOrder: NaN });
    expect(flat.perOrder).toBe(0);
    expect(flat.pctOfTurnover).toBeUndefined();
  });
});

describe("trade rows", () => {
  it("computes quantity and fills", () => {
    expect(rowQty(row())).toBe(130);
    expect(rowQty(row({ lots: 0 }))).toBe(0);
    const fills = tradeFills(row());
    expect(fills).toHaveLength(2);
    expect(fills[1]).toMatchObject({ side: "SELL", price: 130, qty: 130 });
    expect(tradeFills(row({ exit: NaN }))).toHaveLength(1);
    expect(tradeFills(row({ lotSize: NaN }))).toHaveLength(0);
  });

  it("net P&L equals gross minus calcCharges for the same fills", () => {
    const r = row();
    const res = analyseTrade(r, zerodha, DATE_2026);
    const charges = calcCharges(tradeFills(r), { broker: zerodha, onDate: DATE_2026 });
    expect(res.gross).toBeCloseTo(30 * 130, 8);
    expect(res.charges.total).toBeCloseTo(charges.total, 8);
    expect(res.net).toBeCloseTo(res.gross - charges.total, 8);
    // STT on the sell leg at the 2026 rate
    expect(res.charges.stt).toBeCloseTo(130 * 130 * getChargeRates(DATE_2026).sttOptionSell, 8);
  });

  it("short trades profit when price falls", () => {
    const res = analyseTrade(row({ side: "SELL", entry: 100, exit: 60 }), zerodha, DATE_2026);
    expect(res.gross).toBeCloseTo(40 * 130, 8);
    expect(res.breakevenExit).toBeLessThan(100);
  });

  it("breakeven exit makes net P&L zero", () => {
    for (const side of ["BUY", "SELL"] as const) {
      const r = row({ side });
      const be = breakevenExitPrice(r, zerodha, DATE_2026);
      const at = analyseTrade({ ...r, exit: be }, zerodha, DATE_2026);
      expect(Math.abs(at.net)).toBeLessThan(1e-4);
    }
  });

  it("open positions have no P&L but still show entry charges", () => {
    const res = analyseTrade(row({ exit: NaN }), zerodha, DATE_2026);
    expect(res.hasExit).toBe(false);
    expect(res.net).toBeNaN();
    expect(res.charges.total).toBeGreaterThan(0);
  });

  it("invalid rows are flagged", () => {
    const res = analyseTrade(row({ entry: NaN }), zerodha, DATE_2026);
    expect(res.valid).toBe(false);
    expect(res.charges.total).toBe(0);
  });

  it("sums breakdowns component-wise", () => {
    const a = calcCharges(tradeFills(row()), { broker: zerodha, onDate: DATE_2026 });
    const s = sumBreakdowns([a, a]);
    expect(s.total).toBeCloseTo(2 * a.total, 10);
    expect(s.stt).toBeCloseTo(2 * a.stt, 10);
  });
});

describe("squareOffVsExpire", () => {
  const base = { type: "CE" as const, strike: 25000, settlement: 25120, premiumNow: 118, entryPremium: 60, qty: 65, broker: zerodha, brokerageOnExercise: true, onDate: DATE_2026 };

  it("compares both routes consistently", () => {
    const r = squareOffVsExpire(base);
    expect(r.valid).toBe(true);
    expect(r.intrinsicPerUnit).toBe(120);
    expect(r.expire.stt).toBeCloseTo(120 * 65 * getChargeRates(DATE_2026).sttOptionExercise, 8);
    expect(r.advantage).toBeCloseTo(r.squareOff.net - r.expire.net, 8);
    expect(r.squareOff.pnl).toBeCloseTo(r.squareOff.net - 60 * 65, 8);
  });

  it("threshold premium makes both routes equal", () => {
    const r = squareOffVsExpire(base);
    const at = squareOffVsExpire({ ...base, premiumNow: r.squareOffThreshold });
    expect(Math.abs(at.advantage)).toBeLessThan(1e-4);
    expect(squareOffVsExpire({ ...base, premiumNow: r.squareOffThreshold + 1 }).better).toBe("SQUARE_OFF");
    expect(squareOffVsExpire({ ...base, premiumNow: r.squareOffThreshold - 1 }).better).toBe("EXPIRE");
  });

  it("an OTM option has no exercise cost", () => {
    const r = squareOffVsExpire({ ...base, settlement: 24900, premiumNow: 0.05 });
    expect(r.itm).toBe(false);
    expect(r.expire.total).toBe(0);
  });

  it("flags invalid input", () => {
    expect(squareOffVsExpire({ ...base, qty: NaN }).valid).toBe(false);
  });
});

describe("futuresBasis", () => {
  it("fair futures gives zero mispricing and implied q equal to q", () => {
    const S = 25000;
    const T = 30 / 365;
    const F = forwardFromSpot(S, T, 0.065, 0.013);
    const b = futuresBasis(S, F, T, 0.065, 0.013);
    expect(b.valid).toBe(true);
    expect(b.mispricing).toBeCloseTo(0, 8);
    expect(b.impliedDivYieldPct).toBeCloseTo(1.3, 8);
    expect(b.continuousPct).toBeCloseTo(5.2, 8);
    expect(b.state).toBe("PREMIUM");
  });
  it("simple annualised carry", () => {
    const b = futuresBasis(100, 101, 0.25, 0.06, 0);
    expect(b.basis).toBe(1);
    expect(b.basisPct).toBeCloseTo(1, 10);
    expect(b.annualisedPct).toBeCloseTo(4, 10);
  });
  it("discount and invalid input", () => {
    expect(futuresBasis(100, 99, 0.1, 0.06, 0).state).toBe("DISCOUNT");
    expect(futuresBasis(0, 99, 0.1, 0.06, 0).valid).toBe(false);
  });
});

describe("expiries and lookup", () => {
  it("detects holiday-shifted expiries by weekday", () => {
    // Monday 2026-11-23 for a Tuesday-expiry contract → scheduled 2026-11-24
    expect(holidayShiftFrom({ expiryWeekday: 2 }, "2026-11-23")).toBe("2026-11-24");
    expect(holidayShiftFrom({ expiryWeekday: 2 }, "2026-11-24")).toBe("");
    expect(holidayShiftFrom({ expiryWeekday: 2 }, "bad")).toBe("");
  });
  it("lists upcoming NIFTY expiries with lot sizes", () => {
    const list = upcomingExpiries("NIFTY", new Date("2026-10-17T06:00:00Z"), 6);
    expect(list).toHaveLength(6);
    expect(list.every((e) => e.date > "2026-10-16")).toBe(true);
    expect(list.some((e) => e.type === "monthly")).toBe(true);
    for (const e of list) if (!e.shiftedFrom) expect(new Date(`${e.date}T00:00:00Z`).getUTCDay()).toBe(2);
  });
  it("searches symbols and names, symbol prefix first", () => {
    const r = searchSpecs("bank");
    expect(r.length).toBeGreaterThan(2);
    expect(r[0].symbol.startsWith("BANK")).toBe(true);
    expect(searchSpecs("reliance")[0].symbol).toBe("RELIANCE");
    expect(searchSpecs("zzzz")).toHaveLength(0);
    expect(searchSpecs("")[0].kind).toBe("INDEX");
  });
});

describe("maxLossPerLotFromLegs", () => {
  const leg = (p: Partial<Leg>): Leg => ({ symbol: "NIFTY", type: "PE", side: "SELL", strike: 25000, expiry: "2026-10-27", lots: 2, lotSize: 65, premium: 100, ...p });
  it("bull put spread: (width − credit) × lot", () => {
    const r = maxLossPerLotFromLegs([leg({}), leg({ side: "BUY", strike: 24800, premium: 40 })]);
    expect(r.unlimited).toBe(false);
    expect(r.baseLots).toBe(2);
    expect(r.perLot).toBeCloseTo((200 - 60) * 65, 6);
  });
  it("naked call is unlimited", () => {
    const r = maxLossPerLotFromLegs([leg({ type: "CE" })]);
    expect(r.unlimited).toBe(true);
  });
  it("empty legs", () => {
    expect(maxLossPerLotFromLegs([]).perLot).toBeNaN();
  });
});

describe("priceOption", () => {
  it("matches the library pricers for both models", () => {
    const bs = priceOption({ model: "BS", underlying: 25000, strike: 25100, T: 0.05, r: 0.065, q: 0.013 }, 0.14, "CE");
    expect(bs.price).toBeCloseTo(bsPrice({ S: 25000, K: 25100, T: 0.05, r: 0.065, q: 0.013, sigma: 0.14, type: "CE" }), 10);
    expect(bs.intrinsic).toBe(intrinsic(25000, 25100, "CE"));
    const b76 = priceOption({ model: "B76", underlying: 25100, strike: 25000, T: 0.05, r: 0.065, q: 0 }, 0.14, "PE");
    expect(b76.price).toBeCloseTo(black76Price({ F: 25100, K: 25000, T: 0.05, r: 0.065, sigma: 0.14, type: "PE" }), 10);
    expect(b76.forward).toBe(25100);
  });
});

describe("calendar date helpers", () => {
  it("round-trips ISO dates through local calendar dates", async () => {
    const { isoToCalendarDate, calendarDateToIso } = await import("./calcLogic");
    const d = isoToCalendarDate("2026-10-20");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(9);
    expect(d?.getDate()).toBe(20);
    expect(calendarDateToIso(d)).toBe("2026-10-20");
    expect(calendarDateToIso(new Date(2027, 0, 5))).toBe("2027-01-05");
  });

  it("rejects malformed and impossible dates", async () => {
    const { isoToCalendarDate, calendarDateToIso } = await import("./calcLogic");
    expect(isoToCalendarDate("2026-02-30")).toBeNull();
    expect(isoToCalendarDate("20-10-2026")).toBeNull();
    expect(isoToCalendarDate("")).toBeNull();
    expect(isoToCalendarDate(undefined)).toBeNull();
    expect(calendarDateToIso(null)).toBe("");
    expect(calendarDateToIso(new Date(Number.NaN))).toBe("");
  });
});
