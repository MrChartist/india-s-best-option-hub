import { afterEach, describe, expect, it } from "vitest";
import * as options from "@/lib/options";
import { DEFAULT_MARKET_PARAMS, getMarketParams, setMarketParams } from "@/lib/options";

// Every runtime export published in the shared math_api contract.
const CONTRACT_EXPORTS = ["BROKER_PRESETS", "CHARGE_RATE_TABLE", "CONTRACT_SPECS", "DEFAULT_MARKET_PARAMS", "DIVIDEND_YIELD", "LOT_SIZE_HISTORY", "NSE_HOLIDAYS", "addTradingDays", "atmIV", "atmStraddle", "black76Price", "breakevens", "breakevensAfterCharges", "bsPrice", "calcCharges", "chainForward", "chargesForLegs", "classifyBuildup", "constantMaturityIV", "d1d2", "decToPct", "dteLabel", "emHitRate", "enrichChain", "estimateMargin", "exerciseSTT", "expectedMoveFromIV", "expectedMoveFromStraddle", "expectedValue", "findATMStrike", "formatCompactIN", "formatDateIST", "formatGreek", "formatINR", "formatOI", "formatPct", "formatPoints", "formatSigned", "formatStrike", "formatTimeIST", "forwardFromSpot", "forwardVol", "generateSampleChain", "getChargeRates", "getContractSpec", "getExpiries", "getLotSize", "getMarketParams", "getMarketSession", "getStrikeStep", "greeks", "greeks76", "hvCloseToClose", "hvParkinson", "hvYangZhang", "impliedForward", "impliedVol", "impliedVol76", "intrinsic", "isTradingDay", "isWeeklyExpiry", "istDateString", "ivPercentile", "ivRank", "legIV", "legPayoffAtExpiry", "maxPain", "maxPainCurve", "maxProfitLoss", "modalStrikeStep", "netPremium", "nextSessionChange", "normCdf", "normInv", "normPdf", "normalizeExpiry", "nowIST", "payoffSeries", "pctToDec", "pnlMatrix", "positionGreeks", "positionSize", "previousTradingDay", "probBetween", "probITM", "probOfReachingProfit", "probTouch", "probabilityOfProfit", "profitableIntervals", "registerContractSpecs", "rollingHV", "setMarketParams", "skewMetrics", "spotGrid", "strategyPayoffAtExpiry", "strategyValueAt", "syntheticFuture", "timeToExpiryYears", "toISTDate", "tradingDaysBetween", "volCone"];

describe("public contract", () => {
  it("exports every function and constant in the contract", () => {
    const mod = options as Record<string, unknown>;
    const missing = CONTRACT_EXPORTS.filter((n) => mod[n] === undefined);
    expect(missing).toEqual([]);
  });

  it("never throws on garbage input", () => {
    const junk: unknown[] = [undefined, null, NaN, -1, 0, "x", {}, []];
    const mod = options as Record<string, unknown>;
    for (const name of CONTRACT_EXPORTS) {
      const fn = mod[name];
      if (typeof fn !== "function" || name === "setMarketParams" || name === "registerContractSpecs") continue;
      for (const a of junk) {
        expect(() => (fn as (...args: unknown[]) => unknown)(a, a, a, a, a, a), name).not.toThrow();
      }
    }
  });
});

describe("market params", () => {
  afterEach(() => {
    try {
      localStorage.removeItem("mc_market_params");
    } catch {
      /* ignore */
    }
  });

  it("defaults, persists and sanitises", () => {
    expect(getMarketParams()).toEqual(DEFAULT_MARKET_PARAMS);
    expect(setMarketParams({ r: 0.07 }).r).toBe(0.07);
    expect(getMarketParams().r).toBe(0.07);
    expect(setMarketParams({ r: Number.NaN, dayCount: "TRADING252" })).toEqual({ r: 0.07, q: 0, dayCount: "TRADING252" });
    localStorage.setItem("mc_market_params", "{not json");
    expect(getMarketParams()).toEqual(DEFAULT_MARKET_PARAMS);
  });
});
