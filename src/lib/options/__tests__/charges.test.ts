import { describe, expect, it } from "vitest";
import {
  BROKER_PRESETS,
  calcCharges,
  chargesForLegs,
  estimateMargin,
  exerciseSTT,
  getChargeRates,
  positionSize,
  toISTDate,
  type Fill,
  type Leg,
} from "@/lib/options";

// Hand-computed contract note: sell 1 lot (65) NIFTY CE @ ₹100, buy back @ ₹80, Zerodha.
// Turnover: sell 6,500 + buy 5,200 = 11,700
const trade: Fill[] = [
  { type: "CE", side: "SELL", price: 100, qty: 65 },
  { type: "CE", side: "BUY", price: 80, qty: 65 },
];

describe("charges", () => {
  it("uses the dated rate table", () => {
    expect(getChargeRates("2025-06-01").sttOptionSell).toBe(0.001);
    expect(getChargeRates("2026-04-01").sttOptionSell).toBe(0.0015);
    expect(getChargeRates("2026-04-01").sttFutSell).toBe(0.0005);
    expect(getChargeRates("2020-01-01").effectiveFrom).toBe("2024-10-01");
  });

  it("matches a hand-computed contract note (rates from 1 Apr 2026)", () => {
    const c = calcCharges(trade, { onDate: "2026-10-16" });
    expect(c.brokerage).toBeCloseTo(40, 10); // 2 orders × ₹20
    expect(c.stt).toBeCloseTo(9.75, 10); // 0.15% × 6,500
    expect(c.exchange).toBeCloseTo(4.09851, 8); // 0.03503% × 11,700
    expect(c.sebi).toBeCloseTo(0.0117, 10); // ₹10/crore
    expect(c.stamp).toBeCloseTo(0.156, 10); // 0.003% × 5,200
    expect(c.gst).toBeCloseTo(7.9398378, 7); // 18% × (40 + 4.09851 + 0.0117)
    expect(c.total).toBeCloseTo(61.9560478, 6);
  });

  it("applies the pre-April-2026 STT", () => {
    const c = calcCharges(trade, { onDate: "2025-10-16" });
    expect(c.stt).toBeCloseTo(6.5, 10);
    expect(c.total).toBeCloseTo(58.7060478, 6);
  });

  it("handles futures, BSE, custom broker and exercise STT", () => {
    const fut = calcCharges([{ type: "FUT", side: "SELL", price: 25000, qty: 65 }], { onDate: "2026-10-16" });
    expect(fut.stt).toBeCloseTo(0.0005 * 25000 * 65, 8);
    const bse = calcCharges([{ type: "CE", side: "BUY", price: 100, qty: 20, exchange: "BSE" }], { onDate: "2026-10-16" });
    expect(bse.exchange).toBeCloseTo(0.000325 * 2000, 10);
    const custom = BROKER_PRESETS.find((b) => b.id === "custom");
    expect(calcCharges(trade, { broker: custom }).brokerage).toBe(0);
    expect(exerciseSTT(50, 65, "2026-10-27")).toBeCloseTo(0.0015 * 50 * 65, 10);
    expect(exerciseSTT(-1, 65)).toBe(0);
  });

  it("charges for legs (entry only vs round trip)", () => {
    const legs: Leg[] = [{ symbol: "NIFTY", type: "CE", side: "SELL", strike: 25000, expiry: "2026-10-27", lots: 1, lotSize: 65, premium: 100 }];
    const entry = chargesForLegs(legs);
    const rt = chargesForLegs(legs, { roundTrip: true });
    expect(entry.brokerage).toBe(20);
    expect(rt.brokerage).toBe(40);
    expect(rt.total).toBeGreaterThan(entry.total);
  });
});

describe("margin estimate", () => {
  const now = toISTDate("2026-10-20", "11:00");
  const mk = (p: Partial<Leg> & Pick<Leg, "type" | "side" | "strike" | "premium">): Leg => ({ symbol: "NIFTY", expiry: "2026-10-27", lots: 1, lotSize: 65, iv: 0.13, ...p });

  it("short straddle uses scenarios plus exposure", () => {
    const m = estimateMargin([mk({ type: "CE", side: "SELL", strike: 25000, premium: 180 }), mk({ type: "PE", side: "SELL", strike: 25000, premium: 170 })], { spot: 25000, now });
    expect(m.method).toBe("scenario-approx");
    expect(m.isEstimate).toBe(true);
    expect(m.exposure).toBeCloseTo(0.02 * 25000 * 130, 6);
    expect(m.span).toBeGreaterThan(0);
    expect(m.elmExpiryDay).toBe(0);
    expect(m.premiumReceived).toBeCloseTo(350 * 65, 8);
  });

  it("iron condor is defined-risk with a hedge benefit", () => {
    const ic = [
      mk({ type: "PE", side: "BUY", strike: 24300, premium: 40 }),
      mk({ type: "PE", side: "SELL", strike: 24500, premium: 80 }),
      mk({ type: "CE", side: "SELL", strike: 25500, premium: 70 }),
      mk({ type: "CE", side: "BUY", strike: 25700, premium: 30 }),
    ];
    const m = estimateMargin(ic, { spot: 25000, now });
    expect(m.method).toBe("defined-risk");
    expect(m.definedRisk).toBe(true);
    expect(m.span).toBeLessThanOrEqual(120 * 65 + 1e-6);
    expect(m.hedgeBenefit).toBeGreaterThan(0);
    expect(m.nakedTotal).toBeGreaterThan(m.total);
  });

  it("long-only needs just the premium; expiry day adds ELM", () => {
    const lo = estimateMargin([mk({ type: "CE", side: "BUY", strike: 25000, premium: 200 })], { spot: 25000, now });
    expect(lo.method).toBe("long-only");
    expect(lo.total).toBeCloseTo(13000, 8);
    const expiryDay = toISTDate("2026-10-27", "10:00");
    const m = estimateMargin([mk({ type: "PE", side: "SELL", strike: 25000, premium: 60 })], { spot: 25000, now: expiryDay });
    expect(m.elmExpiryDay).toBeCloseTo(0.02 * 25000 * 65, 6);
  });

  it("empty input", () => {
    expect(estimateMargin([], { spot: 25000 }).total).toBe(0);
  });
});

describe("position sizing", () => {
  it("sizes lots from a risk budget", () => {
    expect(positionSize({ capital: 500000, riskPct: 2, maxLossPerLot: 3000, lotSize: 65 })).toEqual({ lots: 3, riskAmount: 10000, capitalAtRisk: 9000 });
    expect(positionSize({ capital: 500000, riskPct: 2, maxLossPerLot: 0, lotSize: 65 }).lots).toBe(0);
    expect(positionSize({ capital: -1, riskPct: 2, maxLossPerLot: 10, lotSize: 65 }).lots).toBe(0);
  });
});

describe("estimateMargin debit spreads", () => {
  it("does not charge the net debit twice (span + premium paid)", async () => {
    const { estimateMargin } = await import("@/lib/options");
    const expiry = "2026-10-27";
    const now = new Date("2026-10-17T05:00:00Z");
    const legs = [
      { symbol: "NIFTY", type: "CE", side: "BUY", strike: 25000, premium: 200, lots: 1, lotSize: 65, iv: 0.14, expiry, enabled: true },
      { symbol: "NIFTY", type: "CE", side: "SELL", strike: 25200, premium: 110, lots: 1, lotSize: 65, iv: 0.14, expiry, enabled: true },
    ] as unknown as Parameters<typeof estimateMargin>[0];
    const m = estimateMargin(legs, { spot: 25000, now });
    expect(m.definedRisk).toBe(true);
    expect(m.span).toBe(0);
    expect(m.total).toBeCloseTo(m.exposure + 200 * 65, 6);
  });
});
