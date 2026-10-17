import { describe, expect, it } from "vitest";
import type { FlowPrint } from "../types";
import { hottestChains, premiumSummary, premiumTide, topPremiumContracts } from "../premiumTide";

let n = 0;
function p(o: Partial<FlowPrint>): FlowPrint {
  n++;
  return {
    id: `x${n}`,
    ts: 60_000,
    fromTs: 0,
    symbol: "NIFTY",
    expiry: "2026-10-20",
    strike: 25_000,
    type: "CE",
    dVol: 10,
    premium: 100,
    ltp: 10,
    bid: 9,
    ask: 10,
    aggressor: "ASK",
    aggressorBasis: "quote",
    dOI: 5,
    tag: "OPENING",
    dte: 4,
    moneyness: "ATM",
    spot: 25_000,
    lotSize: 1,
    ...o,
  };
}

describe("premiumTide", () => {
  const prints = [
    p({ ts: 60_000, type: "CE", aggressor: "ASK", premium: 100, spot: 25_000 }),
    p({ ts: 70_000, type: "PE", aggressor: "ASK", premium: 40, spot: 25_005 }),
    p({ ts: 120_000, type: "CE", aggressor: "BID", premium: 30, spot: 24_990 }),
    p({ ts: 125_000, type: "PE", aggressor: "MID", premium: 500, spot: 24_995 }),
  ];
  it("buckets by minute and accumulates signed premium", () => {
    const t = premiumTide(prints);
    expect(t).toEqual([
      { ts: 60_000, ce: 100, pe: 40, net: 60, spot: 25_005 },
      { ts: 120_000, ce: 70, pe: 40, net: 30, spot: 24_995 },
    ]);
  });
  it("drops spot for a multi-symbol aggregate", () => {
    const t = premiumTide([...prints, p({ symbol: "BANKNIFTY", ts: 61_000, premium: 10 })]);
    expect(t[0].spot).toBeUndefined();
    expect(t[0].ce).toBe(110);
  });
  it("handles empty input", () => {
    expect(premiumTide([])).toEqual([]);
  });
});

describe("premiumSummary / leaderboards", () => {
  const prints = [
    p({ symbol: "NIFTY", type: "CE", aggressor: "ASK", premium: 100 }),
    p({ symbol: "NIFTY", type: "PE", aggressor: "BID", premium: 50, strike: 24_900 }),
    p({ symbol: "BANKNIFTY", type: "PE", aggressor: "ASK", premium: 400, strike: 56_000 }),
    p({ symbol: "NIFTY", type: "CE", aggressor: "MID", premium: 10 }),
  ];
  it("splits premium by side", () => {
    const s = premiumSummary(prints);
    expect(s.ceBought).toBe(100);
    expect(s.peSold).toBe(50);
    expect(s.peBought).toBe(400);
    expect(s.mid).toBe(10);
    expect(s.netCe).toBe(100);
    expect(s.netPe).toBe(350);
    expect(s.net).toBe(-250);
    expect(s.total).toBe(560);
    expect(s.askShare).toBeCloseTo(500 / 560);
  });
  it("ranks underlyings and contracts by premium", () => {
    const h = hottestChains(prints);
    expect(h.map((x) => x.symbol)).toEqual(["BANKNIFTY", "NIFTY"]);
    expect(h[1].premium).toBe(160);
    expect(h[1].callShare).toBeCloseTo(110 / 160);
    const c = topPremiumContracts(prints, 2);
    expect(c.map((x) => x.key)).toEqual(["BANKNIFTY|2026-10-20|56000|PE", "NIFTY|2026-10-20|25000|CE"]);
    expect(c[1].premium).toBe(110);
    expect(c[1].prints).toBe(2);
    expect(c[1].net).toBe(100);
  });
});

import { DEFAULT_TAPE_FILTERS, activeFilterCount, filterPrints, printsToCSV } from "../filters";

describe("tape filters", () => {
  const list = [
    p({ symbol: "NIFTY", premium: 2_00_000, type: "CE", aggressor: "ASK", dte: 0, moneyness: "OTM" }),
    p({ symbol: "NIFTY", premium: 20_00_000, type: "PE", aggressor: "BID", dte: 3, moneyness: "ITM", tag: "CLOSING" }),
    p({ symbol: "SENSEX", premium: 50_00_000, type: "CE", aggressor: "MID", dte: 0, moneyness: "ATM", expiry: "2026-10-22" }),
  ];
  it("combines filters", () => {
    expect(filterPrints(list, DEFAULT_TAPE_FILTERS)).toHaveLength(3);
    expect(filterPrints(list, { ...DEFAULT_TAPE_FILTERS, minPremium: 10_00_000 })).toHaveLength(2);
    expect(filterPrints(list, { ...DEFAULT_TAPE_FILTERS, dte0: true, type: "CE" })).toHaveLength(2);
    expect(filterPrints(list, { ...DEFAULT_TAPE_FILTERS, symbol: "NIFTY", side: "BID", tag: "CLOSING" })).toHaveLength(1);
    expect(filterPrints(list, { ...DEFAULT_TAPE_FILTERS, expiry: "2026-10-22", moneyness: "ATM" })).toHaveLength(1);
    expect(activeFilterCount({ ...DEFAULT_TAPE_FILTERS, dte0: true, symbol: "NIFTY" })).toBe(2);
  });
  it("exports CSV", () => {
    const csv = printsToCSV(list).split("\n");
    expect(csv).toHaveLength(4);
    expect(csv[1].split(",")).toHaveLength(csv[0].split(",").length);
  });
});
