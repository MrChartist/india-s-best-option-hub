import { describe, expect, it } from "vitest";
import type { OptionData, OptionLegData } from "@/lib/mockData";
import { black76Price, generateSampleChain, istDateString, addTradingDays } from "@/lib/options";
import {
  buildGexView,
  calculateGEX,
  computeGammaLevels,
  exposureByStrike,
  gammaRegime,
  getGEXSummary,
  gexProfile,
  multiExpiryExposure,
  zeroCrossing,
} from "@/lib/gexData";

const SPOT = 25000;
const STEP = 50;
const IV = 15;
const LOT = 75;
// An expiry roughly a month out, so T is never tiny whatever day the test runs.
const EXPIRY = addTradingDays(istDateString(), 20);

function leg(K: number, type: "CE" | "PE", oi: number): OptionLegData {
  const T = 28 / 365;
  return {
    ltp: black76Price({ F: SPOT, K, T, r: 0.065, sigma: IV / 100, type }),
    oi,
    oiChange: Math.round(oi * 0.1),
    volume: 0,
    iv: IV,
    delta: 0,
    gamma: 0,
    theta: 0,
    vega: 0,
    bidPrice: 0,
    askPrice: 0,
  };
}

/**
 * Mirror-symmetric chain: call OI piles up above spot, put OI below, and
 * callOI(spot + d) === putOI(spot − d). Flat IV.
 */
function symmetricChain(n = 30): OptionData[] {
  const rows: OptionData[] = [];
  for (let i = -n; i <= n; i++) {
    const K = SPOT + i * STEP;
    const hump = (d: number) => Math.round(100_000 * Math.exp(-(((d - 4 * STEP) / (6 * STEP)) ** 2)));
    const callOi = hump(K - SPOT);
    const putOi = hump(SPOT - K);
    rows.push({ strikePrice: K, ce: leg(K, "CE", callOi), pe: leg(K, "PE", putOi) });
  }
  return rows;
}

describe("gexData: gamma flip", () => {
  it("a mirror-symmetric chain gives a flip near spot", () => {
    const levels = computeGammaLevels(symmetricChain(), SPOT, EXPIRY, LOT, { convention: "dealerLongCallShortPut" });
    expect(levels.flip).not.toBeNull();
    expect(Math.abs((levels.flip as number) - SPOT) / SPOT).toBeLessThan(0.005);
  });

  it("profile is negative below the flip and positive above it in the dealer model", () => {
    const profile = gexProfile(symmetricChain(), SPOT, EXPIRY, LOT);
    expect(profile).toHaveLength(101);
    expect(profile[0].spot).toBeCloseTo(SPOT * 0.95, 6);
    expect(profile[100].spot).toBeCloseTo(SPOT * 1.05, 6);
    expect(profile[0].totalGex).toBeLessThan(0);
    expect(profile[100].totalGex).toBeGreaterThan(0);
  });

  it("seller convention is short gamma everywhere and has no flip", () => {
    const chain = symmetricChain();
    const profile = gexProfile(chain, SPOT, EXPIRY, LOT, { convention: "sellerShortBoth" });
    expect(profile.every((p) => p.totalGex <= 0)).toBe(true);
    expect(computeGammaLevels(chain, SPOT, EXPIRY, LOT, { convention: "sellerShortBoth" }).flip).toBeNull();
  });

  it("zeroCrossing interpolates linearly and picks the crossing nearest the reference", () => {
    const pts = [
      { spot: 100, totalGex: -2 },
      { spot: 110, totalGex: 2 },
      { spot: 120, totalGex: 4 },
      { spot: 130, totalGex: -4 },
    ];
    expect(zeroCrossing(pts, 104)).toBeCloseTo(105, 9);
    expect(zeroCrossing(pts, 126)).toBeCloseTo(125, 9);
    expect(zeroCrossing([{ spot: 1, totalGex: -1 }, { spot: 2, totalGex: -3 }], 1)).toBeNull();
  });
});

describe("gexData: walls", () => {
  it("call wall sits above spot and put wall below", () => {
    const levels = computeGammaLevels(symmetricChain(), SPOT, EXPIRY, LOT);
    expect(levels.callWall).toBeGreaterThan(SPOT);
    expect(levels.putWall).toBeLessThan(SPOT);
    expect(Number.isFinite(levels.absGamma)).toBe(true);
  });

  it("walls are on the correct sides for the labelled sample chain with zeroed Greeks", () => {
    const { chain } = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXPIRY, seed: 3 });
    const stripped = chain.map((r) => ({
      ...r,
      ce: { ...r.ce, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0 },
      pe: { ...r.pe, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0 },
    }));
    const levels = computeGammaLevels(stripped, SPOT, EXPIRY, LOT);
    expect(levels.callWall).toBeGreaterThanOrEqual(SPOT);
    expect(levels.putWall).toBeLessThanOrEqual(SPOT);
    const rows = exposureByStrike(stripped, SPOT, EXPIRY, LOT);
    expect(rows.some((r) => r.callGex > 0)).toBe(true);
  });

  it("walls do not depend on the sign convention", () => {
    const chain = symmetricChain();
    const a = computeGammaLevels(chain, SPOT, EXPIRY, LOT, { convention: "dealerLongCallShortPut" });
    const b = computeGammaLevels(chain, SPOT, EXPIRY, LOT, { convention: "sellerShortBoth" });
    expect(b.callWall).toBe(a.callWall);
    expect(b.putWall).toBe(a.putWall);
    expect(b.absGamma).toBe(a.absGamma);
  });

  it("returns NaN walls and a null flip for an empty chain", () => {
    const l = computeGammaLevels([], SPOT, EXPIRY, LOT);
    expect(Number.isNaN(l.callWall)).toBe(true);
    expect(l.flip).toBeNull();
  });
});

describe("gexData: units", () => {
  it("scales linearly with lot size", () => {
    const chain = symmetricChain();
    const a = exposureByStrike(chain, SPOT, EXPIRY, 75);
    const b = exposureByStrike(chain, SPOT, EXPIRY, 150);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].netGex).toBeCloseTo(a[i].netGex * 2, 6);
      expect(b[i].dex).toBeCloseTo(a[i].dex * 2, 6);
      expect(b[i].vex).toBeCloseTo(a[i].vex * 2, 6);
      expect(b[i].cex).toBeCloseTo(a[i].cex * 2, 6);
    }
    const pa = gexProfile(chain, SPOT, EXPIRY, 75);
    const pb = gexProfile(chain, SPOT, EXPIRY, 150);
    expect(pb[37].totalGex).toBeCloseTo(pa[37].totalGex * 2, 6);
  });

  it("qty-unit OI is not multiplied by lot size again", () => {
    const chain = symmetricChain();
    const asQty = chain.map((r) => ({ ...r, ce: { ...r.ce, oi: r.ce.oi * LOT }, pe: { ...r.pe, oi: r.pe.oi * LOT } }));
    const a = exposureByStrike(chain, SPOT, EXPIRY, LOT, { oiUnit: "contracts" });
    const b = exposureByStrike(asQty, SPOT, EXPIRY, LOT, { oiUnit: "qty" });
    for (let i = 0; i < a.length; i++) expect(b[i].netGex).toBeCloseTo(a[i].netGex, 6);
  });

  it("GEX is in ₹ crore per 1% move with the expected magnitude", () => {
    // One ATM call, 1 lakh contracts: gamma ≈ pdf(d1)/(F σ √T).
    const chain: OptionData[] = [{ strikePrice: SPOT, ce: leg(SPOT, "CE", 100_000), pe: leg(SPOT, "PE", 0) }];
    const [row] = exposureByStrike(chain, SPOT, EXPIRY, LOT);
    expect(row.callGex).toBeGreaterThan(0);
    expect(row.putGex).toBe(0);
    // Rough bound: gamma ~ 0.4/(25000 × 0.15 × 0.28) ≈ 3.8e-4 → 3.8e-4 × 7.5e6 × 6.25e8 × 0.01 / 1e7 ≈ 1,780 Cr.
    expect(row.callGex).toBeGreaterThan(800);
    expect(row.callGex).toBeLessThan(4000);
    // Long call delta-notional ≈ 0.5 × 7.5e6 × 25000 / 1e7 ≈ 9,375 Cr.
    expect(row.dex).toBeGreaterThan(7000);
    expect(row.dex).toBeLessThan(12000);
  });
});

describe("gexData: multi-expiry and aggregation", () => {
  it("builds a strike × expiry matrix with NaN for unlisted strikes", () => {
    const near = symmetricChain(10);
    const far = symmetricChain(20);
    const exp2 = addTradingDays(EXPIRY, 20);
    const rows = multiExpiryExposure([{ expiry: EXPIRY, chain: near }, { expiry: exp2, chain: far }], SPOT, LOT, "oi");
    expect(rows).toHaveLength(41);
    const edge = rows[0];
    expect(Number.isNaN(edge[EXPIRY])).toBe(true);
    expect(Number.isFinite(edge[exp2])).toBe(true);
    const atm = rows.find((r) => r.strike === SPOT);
    expect(atm?.[EXPIRY]).toBe(near.find((r) => r.strikePrice === SPOT)!.ce.oi * 2);
    const gexRows = multiExpiryExposure([{ expiry: EXPIRY, chain: near }], SPOT, LOT, "gex");
    expect(gexRows.length).toBe(21);
  });

  it("buildGexView sums expiries and matches single-chain results", () => {
    const chain = symmetricChain();
    const single = buildGexView([{ expiry: EXPIRY, chain, lotSize: LOT }], SPOT);
    const levels = computeGammaLevels(chain, SPOT, EXPIRY, LOT);
    expect(single.levels.callWall).toBe(levels.callWall);
    expect(single.levels.flip).toBeCloseTo(levels.flip as number, 6);
    const doubled = buildGexView([{ expiry: EXPIRY, chain, lotSize: LOT }, { expiry: EXPIRY, chain, lotSize: LOT }], SPOT);
    expect(doubled.totals.netGex).toBeCloseTo(single.totals.netGex * 2, 6);
    const seller = buildGexView([{ expiry: EXPIRY, chain, lotSize: LOT }], SPOT, { convention: "sellerShortBoth" });
    expect(seller.levels.flip).toBeNull();
    expect(seller.dealerFlip).toBeCloseTo(levels.flip as number, 6);
    expect(seller.regime).toBe("amplified");
  });

  it("gammaRegime classifies with a neutral band", () => {
    expect(gammaRegime(10, 100)).toBe("damped");
    expect(gammaRegime(-10, 100)).toBe("amplified");
    expect(gammaRegime(1, 100)).toBe("neutral");
  });
});

describe("gexData: legacy API", () => {
  it("calculateGEX recomputes Greeks when an expiry is given and getGEXSummary finds a flip", () => {
    const chain = symmetricChain();
    const rows = calculateGEX(SPOT, chain, LOT, { expiry: EXPIRY });
    expect(rows.some((r) => r.callGEX > 0)).toBe(true);
    const summary = getGEXSummary(rows, SPOT, gexProfile(chain, SPOT, EXPIRY, LOT));
    expect(Math.abs(summary.flipPoint - SPOT) / SPOT).toBeLessThan(0.005);
    // Without an expiry the zero NSE Greeks give zero GEX (legacy behaviour).
    expect(calculateGEX(SPOT, chain, LOT).every((r) => r.netGEX === 0)).toBe(true);
  });
});
