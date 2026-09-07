import { describe, it, expect } from "vitest";
import {
  resolveBasket, legOrderScore, orderLegs, planTranches, TRANCHE_WEIGHTS,
  trancheIntervalMs, TRANCHE_BASE_INTERVAL_MS, TRANCHE_JITTER_MS,
  isAbortConditionMet, ABORT_THRESHOLDS, classifyResidualRisk,
} from "./basketEngine.mjs";

// Rows follow src/lib/mockData.ts's OptionData shape: {strikePrice, ce, pe}.
function row(strikePrice, { ceId, peId, ceDelta, peDelta } = {}) {
  return {
    strikePrice,
    ce: { securityId: ceId, exchangeSegment: "NSE_FNO", delta: ceDelta },
    pe: { securityId: peId, exchangeSegment: "NSE_FNO", delta: peDelta },
  };
}

describe("resolveBasket — expiry roll across a week boundary", () => {
  const leg = { legId: "L1", action: "SELL", optionType: "CE", lots: 1, strikeSpec: { kind: "absolute", strike: 58000 }, expirySpec: { kind: "nearest", weeksOut: 0 } };
  const basket = { legs: [leg] };

  it("resolves weeksOut:0 to the nearest listed expiry on Monday", () => {
    const monday = { expiries: ["2026-09-09", "2026-09-16", "2026-09-23"], byExpiry: { "2026-09-09": [row(58000, { ceId: "MON-58000CE" })] } };
    const result = resolveBasket(basket, monday, 58000, 100);
    expect(result.legs[0].expiry).toBe("2026-09-09");
    expect(result.legs[0].securityId).toBe("MON-58000CE");
    expect(result.blockedForLive).toBe(false);
  });

  it("the SAME leg naturally resolves to the next contract once the old one rolls off — no special-casing of 'today'", () => {
    // Friday: 2026-09-09 has expired and dropped out of the chain's expiry list.
    const friday = { expiries: ["2026-09-16", "2026-09-23", "2026-09-30"], byExpiry: { "2026-09-16": [row(58000, { ceId: "FRI-58000CE" })] } };
    const result = resolveBasket(basket, friday, 58000, 100);
    expect(result.legs[0].expiry).toBe("2026-09-16");
    expect(result.legs[0].securityId).toBe("FRI-58000CE");
  });

  it("resolves weeksOut:1/2 and 'monthly' by position/month, and blocks (never throws) a weeksOut past the end of the chain", () => {
    const chain = {
      expiries: ["2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"],
      byExpiry: { "2026-09-16": [row(58000, { ceId: "W1" })], "2026-09-30": [row(58000, { ceId: "MONTHLY" })] },
    };
    const at = (spec) => resolveBasket({ legs: [{ ...leg, expirySpec: spec }] }, chain, 58000, 100).legs[0];
    expect(at({ kind: "nearest", weeksOut: 1 }).securityId).toBe("W1");
    expect(at({ kind: "nearest", weeksOut: "monthly" }).expiry).toBe("2026-09-30");
    const oor = at({ kind: "nearest", weeksOut: 2 }); // exists but has no chain data — falls through to a normal block
    expect(oor.blocked).toBe(true);
    const thin = resolveBasket({ legs: [{ ...leg, expirySpec: { kind: "nearest", weeksOut: 5 } }] }, chain, 58000, 100).legs[0];
    expect(thin.blocked).toBe(true);
    expect(thin.blockedReason).toMatch(/weeksOut/i);
  });
});

describe("resolveBasket — ATM+2 resolution across a spot move", () => {
  const relLeg = { legId: "L1", action: "BUY", optionType: "CE", lots: 1, strikeSpec: { kind: "relative", offset: 2 }, expirySpec: { kind: "nearest", weeksOut: 0 } };
  const chain = {
    expiries: ["2026-09-09"],
    byExpiry: { "2026-09-09": [row(58000, { ceId: "58000CE" }), row(58100, { ceId: "58100CE" }), row(58200, { ceId: "58200CE" }), row(58300, { ceId: "58300CE" })] },
  };

  it("resolves ATM+2 relative to spot=58000 as strike 58200", () => {
    const result = resolveBasket({ legs: [relLeg] }, chain, 58000, 100);
    expect(result.legs[0].strike).toBe(58200);
    expect(result.legs[0].securityId).toBe("58200CE");
  });

  it("re-resolving the SAME leg spec after a spot move yields a DIFFERENT strike — never cached from save time", () => {
    // spot moves from 58000 to 58120: ATM rounds to 58100, so ATM+2 becomes 58300.
    const result = resolveBasket({ legs: [relLeg] }, chain, 58120, 100);
    expect(result.legs[0].strike).toBe(58300);
    expect(result.legs[0].securityId).toBe("58300CE");
  });
});

describe("resolveBasket — missing-securityId rejection blocks live deploy", () => {
  const leg = { legId: "L1", action: "SELL", optionType: "PE", lots: 1, strikeSpec: { kind: "absolute", strike: 58000 }, expirySpec: { kind: "nearest", weeksOut: 0 } };

  it("blocks a leg whose resolved strike has no broker security id (paper-only)", () => {
    const chain = { expiries: ["2026-09-09"], byExpiry: { "2026-09-09": [row(58000, { peId: undefined })] } };
    const result = resolveBasket({ legs: [leg] }, chain, 58000, 100);
    expect(result.legs[0].blocked).toBe(true);
    expect(result.legs[0].securityId).toBeNull();
    expect(result.legs[0].blockedReason).toMatch(/paper-only/i);
    expect(result.blockedForLive).toBe(true);
    expect(result.blockedLegIds).toEqual(["L1"]);
  });

  it("blocks (never silently degrades to a different strike) when the resolved strike isn't in the chain at all", () => {
    const chain = { expiries: ["2026-09-09"], byExpiry: { "2026-09-09": [row(57000, { peId: "X" })] } };
    const result = resolveBasket({ legs: [leg] }, chain, 58000, 100);
    expect(result.legs[0].blocked).toBe(true);
    expect(result.legs[0].securityId).toBeNull();
    expect(result.legs[0].blockedReason).toMatch(/not found/i);
  });

  it("a mixed basket blocks live deploy as a whole even if only one leg is paper-only", () => {
    const chain = { expiries: ["2026-09-09"], byExpiry: { "2026-09-09": [row(58000, { ceId: "OK-CE", peId: undefined })] } };
    const okLeg = { legId: "OK", action: "BUY", optionType: "CE", lots: 1, strikeSpec: { kind: "absolute", strike: 58000 }, expirySpec: { kind: "nearest", weeksOut: 0 } };
    const badLeg = { legId: "BAD", action: "SELL", optionType: "PE", lots: 1, strikeSpec: { kind: "absolute", strike: 58000 }, expirySpec: { kind: "nearest", weeksOut: 0 } };
    const result = resolveBasket({ legs: [okLeg, badLeg] }, chain, 58000, 100);
    expect(result.legs.find((l) => l.legId === "OK").blocked).toBe(false);
    expect(result.legs.find((l) => l.legId === "BAD").blocked).toBe(true);
    expect(result.blockedForLive).toBe(true);
    expect(result.blockedLegIds).toEqual(["BAD"]);
  });

  it("picks the strike whose delta is closest to a delta strikeSpec's target", () => {
    const chain = { expiries: ["2026-09-09"], byExpiry: { "2026-09-09": [row(58000, { ceId: "A", ceDelta: 0.62 }), row(58100, { ceId: "B", ceDelta: 0.50 }), row(58200, { ceId: "C", ceDelta: 0.31 }), row(58300, { ceId: "D", ceDelta: 0.18 })] } };
    const deltaLeg = { legId: "L1", action: "SELL", optionType: "CE", lots: 1, strikeSpec: { kind: "delta", target: 0.3 }, expirySpec: { kind: "nearest", weeksOut: 0 } };
    const result = resolveBasket({ legs: [deltaLeg] }, chain, 58050, 100);
    expect(result.legs[0].securityId).toBe("C");
  });
});

describe("legOrderScore / orderLegs — entry and exit are exact mirrors", () => {
  const hedge = { legId: "H", action: "BUY", optionType: "CE", lots: 1 };
  const short = { legId: "S", action: "SELL", optionType: "CE", lots: 1 };

  it("entry places the risk-reducing (BUY) leg before the short; exit reverses it", () => {
    expect(legOrderScore(hedge, "entry")).toBeLessThan(legOrderScore(short, "entry"));
    expect(legOrderScore(short, "exit")).toBeLessThan(legOrderScore(hedge, "exit"));
  });

  it("orderLegs(l,'exit') === orderLegs(l,'entry').reverse() — simple case, single leg, and empty basket", () => {
    expect(orderLegs([hedge, short], "exit")).toEqual([...orderLegs([hedge, short], "entry")].reverse());
    expect(orderLegs([hedge], "exit")).toEqual([...orderLegs([hedge], "entry")].reverse());
    expect(orderLegs([], "exit")).toEqual([...orderLegs([], "entry")].reverse());
  });

  it("holds exactly with ties on both sides (2 hedges + 2 shorts), regardless of input order", () => {
    const legs = [
      { legId: "H1", action: "BUY", optionType: "CE", lots: 1 },
      { legId: "H2", action: "BUY", optionType: "PE", lots: 2 },
      { legId: "S1", action: "SELL", optionType: "CE", lots: 1 },
      { legId: "S2", action: "SELL", optionType: "PE", lots: 2 },
    ];
    expect(orderLegs(legs, "exit")).toEqual([...orderLegs(legs, "entry")].reverse());
    const shuffled = [legs[2], legs[0], legs[3], legs[1]];
    expect(orderLegs(shuffled, "exit")).toEqual([...orderLegs(shuffled, "entry")].reverse());
  });

  it("rejects an unknown direction rather than silently ordering nothing", () => {
    expect(() => legOrderScore(hedge, "sideways")).toThrow(/Invalid direction/);
  });
});

describe("planTranches — front-loaded 6/6/4/4, never an even split", () => {
  it("splits 20 lots exactly into the 6/6/4/4 weights", () => {
    expect(planTranches(20)).toEqual([6, 6, 4, 4]);
    expect(TRANCHE_WEIGHTS).toEqual([6, 6, 4, 4]);
  });

  it("sums to the requested total for arbitrary sizes, always 4 tranches", () => {
    for (const total of [1, 2, 3, 7, 13, 41]) {
      const tranches = planTranches(total);
      expect(tranches).toHaveLength(4);
      expect(tranches.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("front-loads small baskets into the earliest tranches instead of splitting evenly", () => {
    expect(planTranches(2)).toEqual([1, 1, 0, 0]); // even split (0.5 each) is impossible; remainder goes front-first
    expect(planTranches(1)).toEqual([1, 0, 0, 0]);
  });

  it("rejects a non-positive or fractional lot count", () => {
    expect(() => planTranches(0)).toThrow();
    expect(() => planTranches(-3)).toThrow();
    expect(() => planTranches(2.5)).toThrow();
  });
});

describe("trancheIntervalMs — 1500ms +/-300ms jitter", () => {
  it("is exactly the base interval when rng returns 0.5 (no jitter), and bounded at the rng extremes", () => {
    expect(trancheIntervalMs(() => 0.5)).toBe(TRANCHE_BASE_INTERVAL_MS);
    expect(trancheIntervalMs(() => 0)).toBe(TRANCHE_BASE_INTERVAL_MS - TRANCHE_JITTER_MS);
    expect(trancheIntervalMs(() => 1)).toBe(TRANCHE_BASE_INTERVAL_MS + TRANCHE_JITTER_MS);
  });

  it("stays within [1200, 1800] for any rng in [0,1)", () => {
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
      const ms = trancheIntervalMs(() => r);
      expect(ms).toBeGreaterThanOrEqual(1200);
      expect(ms).toBeLessThanOrEqual(1800);
    }
  });
});

describe("isAbortConditionMet", () => {
  it("does not abort when every metric is inside its threshold", () => {
    const r = isAbortConditionMet({ underlyingDriftPct: 0.1, netCostDriftPct: 0.5, spreadWidenMultiple: 1.2, ltpAgeMs: 1000 });
    expect(r).toEqual({ abort: false, reasons: [] });
  });

  it("aborts on each individual threshold, and not at the exact boundary", () => {
    expect(isAbortConditionMet({ underlyingDriftPct: 0.41 }).abort).toBe(true);
    expect(isAbortConditionMet({ underlyingDriftPct: -0.41 }).abort).toBe(true);
    expect(isAbortConditionMet({ underlyingDriftPct: 0.4 }).abort).toBe(false);
    expect(isAbortConditionMet({ netCostDriftPct: 1.51 }).abort).toBe(true);
    expect(isAbortConditionMet({ netCostDriftPct: 1.5 }).abort).toBe(false);
    expect(isAbortConditionMet({ spreadWidenMultiple: 2.01 }).abort).toBe(true);
    expect(isAbortConditionMet({ spreadWidenMultiple: 2 }).abort).toBe(false);
    expect(isAbortConditionMet({ anyLegRejected: true }).abort).toBe(true);
    expect(isAbortConditionMet({ ltpAgeMs: 5001 }).abort).toBe(true);
    expect(isAbortConditionMet({ ltpAgeMs: 5000 }).abort).toBe(false);
  });

  it("collects every tripped reason, not just the first, and exposes the documented thresholds", () => {
    const r = isAbortConditionMet({ underlyingDriftPct: 1, netCostDriftPct: 5, anyLegRejected: true });
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
    expect(ABORT_THRESHOLDS).toEqual({ underlyingDriftPct: 0.4, netCostDriftPct: 1.5, spreadWidenMultiple: 2, staleLtpMs: 5000 });
  });
});

describe("classifyResidualRisk", () => {
  it("classifies a naked short with no offsetting long as undefined risk, armed to auto-unwind", () => {
    const r = classifyResidualRisk([{ action: "SELL", optionType: "CE", lots: 2 }]);
    expect(r).toEqual({ risk: "undefined", autoUnwindMs: 10000, defaultAction: "unwind", nakedTypes: ["CE"] });
  });

  it("classifies a fully offset short (short == long, same optionType) as defined risk", () => {
    const r = classifyResidualRisk([{ action: "SELL", optionType: "CE", lots: 2 }, { action: "BUY", optionType: "CE", lots: 2 }]);
    expect(r).toEqual({ risk: "defined" });
  });

  it("a long put does NOT offset a naked call — risk stays undefined for the CE side", () => {
    const r = classifyResidualRisk([{ action: "SELL", optionType: "CE", lots: 1 }, { action: "BUY", optionType: "PE", lots: 1 }]);
    expect(r.risk).toBe("undefined");
    expect(r.nakedTypes).toEqual(["CE"]);
  });

  it("an empty or all-long residual is defined risk; a partial hedge (long < short) stays undefined", () => {
    expect(classifyResidualRisk([])).toEqual({ risk: "defined" });
    expect(classifyResidualRisk([{ action: "BUY", optionType: "CE", lots: 3 }])).toEqual({ risk: "defined" });
    const partial = classifyResidualRisk([{ action: "SELL", optionType: "PE", lots: 3 }, { action: "BUY", optionType: "PE", lots: 1 }]);
    expect(partial.risk).toBe("undefined");
  });
});
