import { describe, expect, it } from "vitest";
import { generateSampleChain } from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import {
  buildChainModel,
  chainToCSV,
  deltaTargets,
  liquidityScore,
  nearestStrike,
  oneSigmaPoints,
  sliceAroundATM,
  spotDividerIndex,
  buildupCode,
  buildupCounts,
} from "./chainModel";

const NOW = new Date("2026-10-15T05:00:00Z"); // 10:30 IST, Thursday
const EXPIRY = "2026-10-20";
const SPOT = 24512.3;

function sample() {
  return generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXPIRY, now: NOW, seed: 7, strikes: 41 }).chain;
}

/** NSE-style chain: IV and Greeks zeroed, as the NSE feed sends for many strikes. */
function stripped(chain: OptionData[]): OptionData[] {
  return chain.map((r) => ({
    ...r,
    ce: { ...r.ce, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0 },
    pe: { ...r.pe, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0 },
  }));
}

describe("buildChainModel", () => {
  it("returns an empty, NaN-safe model for an empty chain", () => {
    const m = buildChainModel([], { spot: 0, expiry: "", lotSize: 65, now: NOW });
    expect(m.rows).toEqual([]);
    expect(Number.isNaN(m.atmStrike)).toBe(true);
    expect(Number.isNaN(m.pcrOi)).toBe(true);
    expect(m.totals.ceOi).toBe(0);
  });

  it("finds the ATM strike from the chain (no hard-coded step)", () => {
    const m = buildChainModel(sample(), { spot: SPOT, expiry: EXPIRY, lotSize: 65, symbol: "NIFTY", now: NOW });
    expect(m.step).toBe(50);
    expect(m.atmStrike).toBe(24500);
    expect(m.rows.length).toBe(41);
  });

  it("fills IV and Greeks for an NSE-style chain and marks them derived", () => {
    const m = buildChainModel(stripped(sample()), { spot: SPOT, expiry: EXPIRY, lotSize: 65, symbol: "NIFTY", now: NOW });
    const atm = m.rows.find((r) => r.strike === m.atmStrike)!;
    expect(atm.ce.leg.iv).toBeGreaterThan(5);
    expect(atm.ce.leg.iv).toBeLessThan(40);
    expect(atm.ce.ivDerived).toBe(true);
    expect(atm.ce.greeksDerived).toBe(true);
    expect(atm.ce.leg.delta).toBeGreaterThan(0.3);
    expect(atm.ce.leg.delta).toBeLessThan(0.7);
    expect(atm.pe.leg.delta).toBeLessThan(0);
    expect(m.anyDerived).toBe(true);
  });

  it("computes a real rho with the right sign (calls positive, puts negative)", () => {
    const m = buildChainModel(sample(), { spot: SPOT, expiry: EXPIRY, lotSize: 65, symbol: "NIFTY", now: NOW });
    const atm = m.rows.find((r) => r.strike === m.atmStrike)!;
    expect(atm.ce.rho).toBeGreaterThan(0);
    expect(atm.pe.rho).toBeLessThan(0);
  });

  it("gives probabilities in [0,1] with ITM call P(ITM) > OTM call P(ITM)", () => {
    const m = buildChainModel(sample(), { spot: SPOT, expiry: EXPIRY, lotSize: 65, symbol: "NIFTY", now: NOW });
    const itm = m.rows.find((r) => r.strike === 24000)!;
    const otm = m.rows.find((r) => r.strike === 25000)!;
    expect(itm.ce.probITM).toBeGreaterThan(otm.ce.probITM);
    for (const r of m.rows) {
      for (const lv of [r.ce, r.pe]) {
        if (Number.isFinite(lv.probITM)) {
          expect(lv.probITM).toBeGreaterThanOrEqual(0);
          expect(lv.probITM).toBeLessThanOrEqual(1);
          expect(lv.probTouch).toBeGreaterThanOrEqual(lv.probITM - 1e-9);
        }
      }
    }
    expect(itm.ce.itm).toBe(true);
    expect(otm.ce.itm).toBe(false);
    expect(otm.pe.itm).toBe(true);
  });

  it("computes PCR, straddle, expected move and max OI strikes", () => {
    const m = buildChainModel(sample(), { spot: SPOT, expiry: EXPIRY, lotSize: 65, symbol: "NIFTY", now: NOW });
    expect(m.pcrOi).toBeCloseTo(m.totals.peOi / m.totals.ceOi, 10);
    expect(m.straddle.straddle).toBeGreaterThan(0);
    expect(m.expectedMove.move).toBeCloseTo(0.85 * m.straddle.straddle, 6);
    expect(m.rows.some((r) => r.strike === m.maxOiStrike.ce)).toBe(true);
    expect(m.maxOi).toBeGreaterThan(0);
    expect(Number.isFinite(m.synthFuture)).toBe(true);
    expect(m.atmIv).toBeGreaterThan(0);
  });

  it("classifies buildup only when the feed has a price change", () => {
    const noChange = (l: OptionData["ce"]) => {
      const { change: _c, pChange: _p, ...rest } = l as OptionData["ce"] & { change?: number; pChange?: number };
      return { ...rest };
    };
    const chain = sample().map((r) => ({ ...r, ce: noChange(r.ce), pe: noChange(r.pe) }));
    const row = chain.find((r) => r.strikePrice === 24500)!;
    Object.assign(row.ce, { change: 12, oiChange: 5000 });
    Object.assign(row.pe, { change: -8, oiChange: 4000 });
    const m = buildChainModel(chain, { spot: SPOT, expiry: EXPIRY, lotSize: 65, now: NOW });
    const r = m.rows.find((x) => x.strike === 24500)!;
    expect(r.ce.buildup).toBe("LONG_BUILDUP");
    expect(r.pe.buildup).toBe("SHORT_BUILDUP");
    const other = m.rows.find((x) => x.strike === 24000)!;
    expect(other.ce.buildup).toBeNull();
  });

  it("computes OI change % against the previous OI and premium traded", () => {
    const chain: OptionData[] = [
      { strikePrice: 100, ce: { ltp: 10, oi: 1200, oiChange: 200, volume: 50, iv: 20, delta: 0.5, gamma: 0.01, theta: -1, vega: 0.1, bidPrice: 9.9, askPrice: 10.1 }, pe: { ltp: 9, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 } },
    ];
    const m = buildChainModel(chain, { spot: 100, expiry: EXPIRY, lotSize: 25, now: NOW });
    expect(m.rows[0].ce.oiChgPct).toBeCloseTo(20, 8);
    expect(m.rows[0].ce.premiumTraded).toBe(50 * 25 * 10);
    expect(m.rows[0].ce.spreadPct).toBeCloseTo(2, 6);
    expect(Number.isNaN(m.rows[0].pe.oiChgPct)).toBe(true);
    expect(m.rows[0].pe.liquidity).toBe(0);
  });
});

describe("liquidityScore", () => {
  it("scores tight, active strikes high and wide, thin ones low", () => {
    expect(liquidityScore(0.5, 1, true)).toBe(5);
    expect(liquidityScore(20, 0, true)).toBe(1);
    expect(liquidityScore(NaN, 0.5, true)).toBeGreaterThanOrEqual(1);
    expect(liquidityScore(1, 1, false)).toBe(0);
  });
});

describe("strike range and divider", () => {
  const rows = [100, 110, 120, 130, 140, 150, 160].map((strike) => ({ strike }));
  it("slices ±n strikes around ATM", () => {
    expect(sliceAroundATM(rows, 130, 10).length).toBe(7);
    expect(sliceAroundATM(rows, 130, "all")).toBe(rows);
    const s = sliceAroundATM(rows, 130, 10 as const);
    expect(s[0].strike).toBe(100);
  });
  it("falls back to the nearest strike when ATM is missing", () => {
    const r = sliceAroundATM(rows.map((x) => ({ ...x })), 133, 10);
    expect(r.length).toBe(7);
  });
  it("places the spot divider between the right strikes", () => {
    expect(spotDividerIndex(rows, 125)).toBe(2);
    expect(spotDividerIndex(rows, 90)).toBe(-1);
    expect(spotDividerIndex(rows, 170)).toBe(6);
    expect(spotDividerIndex(rows, 0)).toBe(-2);
  });
  it("finds the nearest strike", () => {
    expect(nearestStrike(rows, 127)).toBe(130);
    expect(Number.isNaN(nearestStrike([], 127))).toBe(true);
  });
});

describe("delta targets and sigma", () => {
  it("finds 16Δ and 30Δ strikes on each side", () => {
    const m = buildChainModel(sample(), { spot: SPOT, expiry: EXPIRY, lotSize: 65, now: NOW });
    const d = deltaTargets(m.rows);
    expect(d.ce16).toBeGreaterThan(d.ce30);
    expect(d.pe16).toBeLessThan(d.pe30);
    expect(d.ce30).toBeGreaterThan(SPOT);
    expect(d.pe30).toBeLessThan(SPOT);
    expect(oneSigmaPoints(m)).toBeGreaterThan(0);
  });
});

describe("chainToCSV", () => {
  it("writes a header and one line per strike", () => {
    const m = buildChainModel(sample(), { spot: SPOT, expiry: EXPIRY, lotSize: 65, now: NOW });
    const lines = chainToCSV(m.rows).split("\n");
    expect(lines.length).toBe(m.rows.length + 1);
    expect(lines[0].startsWith("Strike,CE_LTP")).toBe(true);
    expect(lines[0].split(",").length).toBe(lines[1].split(",").length);
  });
});

describe("buildup counts", () => {
  it("counts classified legs per side and maps codes", () => {
    const m = buildChainModel(generateSampleChain({ symbol: "NIFTY", spot: 24512.3, expiry: "2026-10-20", now: new Date("2026-10-15T05:00:00Z"), seed: 4, strikes: 21 }).chain, {
      spot: 24512.3,
      expiry: "2026-10-20",
      lotSize: 65,
      now: new Date("2026-10-15T05:00:00Z"),
    });
    const c = buildupCounts(m.rows);
    const manual = m.rows.filter((r) => r.ce.buildup && r.ce.buildup !== "NEUTRAL").length;
    expect(c.ce.LB + c.ce.SB + c.ce.SC + c.ce.LU).toBe(manual);
    expect(buildupCounts([])).toEqual({ ce: { LB: 0, SB: 0, SC: 0, LU: 0 }, pe: { LB: 0, SB: 0, SC: 0, LU: 0 } });
    expect(buildupCode("LONG_BUILDUP")).toBe("LB");
    expect(buildupCode("SHORT_COVERING")).toBe("SC");
    expect(buildupCode("NEUTRAL")).toBeNull();
    expect(buildupCode(null)).toBeNull();
  });
});
