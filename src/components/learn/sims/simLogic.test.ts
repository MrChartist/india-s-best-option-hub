import { describe, expect, it } from "vitest";
import { bsPrice, getChargeRates, maxProfitLoss, netPremium, type Leg } from "@/lib/options";
import {
  clockLabel,
  compareSquareOffVsExercise,
  decayByDays,
  expiryDayCurve,
  greeksCurve,
  ivRange,
  linearGrid,
  lognormalDensity,
  makeLeg,
  MARKET_CLOSE_MIN,
  MARKET_OPEN_MIN,
  minutesToClose,
  pnlTone,
  presetTemplate,
  PRESETS,
  roundTripSummary,
  straddleCurve,
  strikeLadder,
} from "./simLogic";

describe("clock helpers", () => {
  it("measures minutes to the 15:30 close", () => {
    expect(minutesToClose(MARKET_OPEN_MIN)).toBe(375);
    expect(minutesToClose(MARKET_CLOSE_MIN)).toBe(0);
    expect(minutesToClose(16 * 60)).toBe(0);
    expect(minutesToClose(NaN)).toBe(0);
    expect(clockLabel(555)).toBe("09:15");
    expect(clockLabel(930)).toBe("15:30");
  });
});

describe("expiryDayCurve", () => {
  const curve = expiryDayCurve({ spot: 25000, strike: 25000, sigma: 0.14, type: "CE" });
  it("spans 09:15 to 15:30 and ends at intrinsic", () => {
    expect(curve[0].minute).toBe(MARKET_OPEN_MIN);
    expect(curve[curve.length - 1].minute).toBe(MARKET_CLOSE_MIN);
    expect(curve[curve.length - 1].value).toBe(0);
  });
  it("decays monotonically and accelerates into the close", () => {
    for (let i = 1; i < curve.length; i++) expect(curve[i].value).toBeLessThanOrEqual(curve[i - 1].value + 1e-9);
    const firstHour = curve[0].value - curve.find((p) => p.minute === MARKET_OPEN_MIN + 60)!.value;
    const lastHour = curve.find((p) => p.minute === MARKET_CLOSE_MIN - 60)!.value - curve[curve.length - 1].value;
    expect(lastHour).toBeGreaterThan(firstHour * 2);
  });
  it("keeps intrinsic value for ITM options", () => {
    const itm = expiryDayCurve({ spot: 25200, strike: 25000, sigma: 0.14, type: "CE" });
    expect(itm[itm.length - 1].value).toBeCloseTo(200, 6);
    expect(itm[itm.length - 1].timeValue).toBe(0);
    expect(itm[0].value).toBeGreaterThan(200);
  });
});

describe("decayByDays and straddleCurve", () => {
  it("falls to intrinsic at zero days", () => {
    const d = decayByDays({ spot: 25000, strike: 25000, sigma: 0.13, type: "PE", maxDays: 10 });
    expect(d).toHaveLength(11);
    expect(d[0].days).toBe(10);
    expect(d[d.length - 1].value).toBe(0);
    expect(d[0].value).toBeGreaterThan(d[5].value);
  });
  it("straddle rises with IV and equals CE + PE", () => {
    const c = straddleCurve({ spot: 25000, days: 7, ivs: ivRange(0.1, 0.3, 5) });
    expect(c).toHaveLength(5);
    for (let i = 1; i < c.length; i++) expect(c[i].straddle).toBeGreaterThan(c[i - 1].straddle);
    const ce = bsPrice({ S: 25000, K: 25000, T: 7 / 365, r: 0.065, sigma: 0.1, type: "CE" });
    expect(c[0].ce).toBeCloseTo(ce, 8);
    expect(c[0].straddle).toBeCloseTo(c[0].ce + c[0].pe, 8);
  });
  it("ivRange is inclusive", () => {
    expect(ivRange(0.1, 0.2, 3)).toEqual([0.1, 0.15000000000000002, 0.2]);
    expect(ivRange(0.1, 0.2, 1)).toHaveLength(2);
  });
});

describe("greeksCurve", () => {
  it("call delta rises with spot between 0 and 1", () => {
    const c = greeksCurve({ strike: 25000, days: 7, sigma: 0.13, type: "CE", spots: linearGrid(25000, 0.05, 21) });
    expect(c[0].delta).toBeLessThan(0.1);
    expect(c[c.length - 1].delta).toBeGreaterThan(0.9);
    const mid = c[10];
    expect(mid.delta).toBeGreaterThan(0.45);
    expect(mid.delta).toBeLessThan(0.6);
    expect(Math.max(...c.map((p) => p.gamma))).toBeCloseTo(c.reduce((m, p) => (p.gamma > m.gamma ? p : m)).gamma, 12);
  });
});

describe("grids", () => {
  it("builds a strike ladder around ATM", () => {
    expect(strikeLadder(25010, 50, 2)).toEqual([24900, 24950, 25000, 25050, 25100]);
    expect(strikeLadder(0, 50, 2)).toEqual([]);
  });
  it("linearGrid spans ± pct", () => {
    const g = linearGrid(100, 0.1, 3);
    expect(g[0]).toBeCloseTo(90);
    expect(g[2]).toBeCloseTo(110);
  });
  it("lognormal density integrates to about 1", () => {
    const F = 25000;
    const grid = linearGrid(F, 0.3, 4001);
    const dx = grid[1] - grid[0];
    const area = grid.reduce((s, x) => s + lognormalDensity(x, F, 0.15, 30 / 365) * dx, 0);
    expect(area).toBeCloseTo(1, 3);
    expect(lognormalDensity(-1, F, 0.15, 0.1)).toBe(0);
  });
});

describe("legs and presets", () => {
  const now = new Date("2026-10-15T05:00:00Z"); // 10:30 IST
  it("prices legs at model fair value", () => {
    const l = makeLeg({ symbol: "NIFTY", type: "CE", side: "BUY", strike: 25000, expiry: "2026-10-20", lotSize: 65, spot: 25000, sigma: 0.13, now });
    expect(l.premium).toBeGreaterThan(100);
    expect(l.premium).toBeLessThan(250);
    expect(Math.round(l.premium * 20)).toBeCloseTo(l.premium * 20, 6);
    expect(l.lots).toBe(1);
  });
  it("every preset template builds a sensible strategy", () => {
    for (const p of PRESETS) {
      const legs: Leg[] = presetTemplate(p.id).map((t) =>
        makeLeg({ symbol: "NIFTY", type: t.type, side: t.side, strike: 25000 + t.offset * 50, expiry: "2026-10-20", lotSize: 65, spot: 25000, sigma: 0.13, now }),
      );
      expect(legs.length).toBeGreaterThan(0);
      const mpl = maxProfitLoss(legs);
      if (p.id === "ironCondor") {
        expect(mpl.unlimitedLoss).toBe(false);
        expect(netPremium(legs).type).toBe("CREDIT");
      }
      if (p.id === "shortStraddle") expect(mpl.unlimitedLoss).toBe(true);
      if (p.id === "longCall") expect(mpl.unlimitedProfit).toBe(true);
    }
  });
});

describe("charges helpers", () => {
  it("exercise STT matches the dated rate", () => {
    const c = compareSquareOffVsExercise({ exitPrice: 81, intrinsic: 80, qty: 130, onDate: "2026-04-01" });
    expect(c.exerciseStt).toBeCloseTo(80 * 130 * getChargeRates("2026-04-01").sttOptionExercise, 8);
    expect(c.squareOff.stt).toBeCloseTo(81 * 130 * 0.0015, 8);
    expect(c.difference).toBeCloseTo(c.exerciseStt - c.squareOff.total, 8);
    const old = compareSquareOffVsExercise({ exitPrice: 80, intrinsic: 80, qty: 130, onDate: "2025-10-01" });
    expect(old.exerciseStt).toBeCloseTo(80 * 130 * 0.00125, 8);
  });
  it("round trip nets charges from gross", () => {
    const r = roundTripSummary({ entry: 100, exit: 115, qty: 130, onDate: "2026-04-01" });
    expect(r.gross).toBeCloseTo(1950, 8);
    expect(r.net).toBeCloseTo(r.gross - r.charges.total, 8);
    expect(r.charges.brokerage).toBe(40);
    expect(r.chargesPctOfGross).toBeGreaterThan(0);
    expect(roundTripSummary({ entry: 100, exit: 90, qty: 65, onDate: "2026-04-01" }).chargesPctOfGross).toBeNaN();
  });
  it("pnlTone", () => {
    expect(pnlTone(5)).toBe("bullish");
    expect(pnlTone(-5)).toBe("bearish");
    expect(pnlTone(0)).toBeUndefined();
    expect(pnlTone(NaN)).toBeUndefined();
  });
});

describe("sample spot and ATM centring", () => {
  it("takes the simulator spot from the sample chain", async () => {
    const { sampleSimSpot } = await import("./simLogic");
    const now = new Date("2026-10-15T05:00:00Z");
    expect(sampleSimSpot(24250, now)).toBe(24250);
    expect(sampleSimSpot(0, now)).toBe(0);
  });

  it("finds the ATM strike index in a ladder", async () => {
    const { atmIndex, strikeLadder } = await import("./simLogic");
    const ladder = strikeLadder(24260, 50, 3);
    expect(ladder[atmIndex(ladder, 24260)]).toBe(24250);
    expect(atmIndex([], 24260)).toBe(-1);
    expect(atmIndex(ladder, Number.NaN)).toBe(-1);
  });
});
