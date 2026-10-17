import { describe, expect, it } from "vitest";
import type { BhavcopyFoRow } from "@/lib/types/market";
import { compactBhavcopy } from "@/lib/backtest/data";
import { hashId53, parseQtyUnits, parseWithSpec } from "@/lib/journal/parsers/engine";
import { DHAN_SPEC } from "@/lib/journal/parsers/dhan";
import { calcCharges, expectedMoveSigma, marginFundsRequired, estimateMargin } from "@/lib/options";
import { getSpotPrice } from "@/lib/positionStore";
import { sampleIndices } from "@/components/dashboard/sampleMarket";
import { sampleRows } from "@/lib/screener/sample";
import { sampleSpot } from "@/lib/futures/sample";
import { sampleParticipantHistory } from "@/lib/participantsApi";
import { worstCaseLoss } from "@/lib/paperTrading";

const row = (p: Partial<BhavcopyFoRow>): BhavcopyFoRow => ({ symbol: "NIFTY", expiry: "2026-02-10", strike: 25_000, type: "CE", close: 100, settle: 101, oi: 10, chgOi: 0, volume: 5, underlyingClose: 25_010, ...p });

describe("backtest compaction ignores stale closes of untraded strikes", () => {
  it("stores zero-volume strikes unquoted but keeps them listed when they have OI", () => {
    const d = compactBhavcopy([row({}), row({ strike: 25_500, close: 12, volume: 0, oi: 50 }), row({ strike: 26_000, close: 3, volume: 0, oi: 0 })], "NIFTY", "2026-02-03")!;
    const c = d.chains[0];
    expect(c.strikes).toEqual([25_000, 25_500]);
    expect(c.ce).toEqual([100, null]);
  });
  it("trusts closes when the file has no volume at all", () => {
    const d = compactBhavcopy([row({ volume: 0 }), row({ strike: 25_500, close: 12, volume: 0 })], "NIFTY", "2026-02-03")!;
    expect(d.chains[0].ce).toEqual([100, 12]);
  });
});

describe("journal fill ids and quantities", () => {
  const csv = (lines: string[]) => ["Date,Time,Security Name,Buy/Sell,Quantity,Trade Price", ...lines].join("\n");
  const a = "2026-10-01,10:00:00,NIFTY 06 OCT 25000 CALL,BUY,65,100";
  const b = "2026-10-01,10:05:00,NIFTY 06 OCT 25000 CALL,SELL,65,110";
  it("gives the same id to the same trade at a different line of an overlapping export", () => {
    const one = parseWithSpec(csv([a, b]), DHAN_SPEC).fills.map((f) => f.id);
    const wider = parseWithSpec(csv(["2026-09-30,10:00:00,NIFTY 06 OCT 25100 CALL,BUY,65,90", a, b]), DHAN_SPEC).fills.map((f) => f.id);
    expect(one).toHaveLength(2);
    for (const id of one) expect(wider).toContain(id);
  });
  it("keeps identical rows within one file as separate fills", () => {
    const ids = parseWithSpec(csv([a, a]), DHAN_SPEC).fills.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);
  });
  it("hashes to 53 bits", () => {
    expect(hashId53("x")).not.toBe(hashId53("y"));
    expect(parseInt(hashId53("abc"), 36)).toBeLessThan(2 ** 53);
  });
  it("reads units/lots pairs and converts a lot count", () => {
    expect(parseQtyUnits("65/1", "Quantity/Lot", "NIFTY", "2026-10-27")).toBe(65);
    expect(parseQtyUnits("2", "Quantity/Lot", "NIFTY", "2026-10-27")).toBe(130);
    expect(parseQtyUnits("130", "Quantity/Lot", "NIFTY", "2026-10-27")).toBe(130);
    expect(parseQtyUnits("2", "Quantity", "NIFTY", "2026-10-27")).toBe(2);
  });
});

describe("one sample session across pages", () => {
  it("screener, futures and chain sample spots agree", () => {
    const rows = sampleRows();
    for (const sym of ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "RELIANCE", "SUNPHARMA", "HDFCBANK"]) {
      const r = rows.find((x) => x.symbol === sym);
      expect(r?.ltp, sym).toBe(getSpotPrice(sym));
      expect(sampleSpot(sym), sym).toBe(getSpotPrice(sym));
    }
    for (const idx of sampleIndices()) {
      expect(idx.ltp).toBe(getSpotPrice(idx.symbol));
      // The day's range trades beyond both the open and the last price.
      expect(idx.high).toBeGreaterThan(Math.max(idx.open, idx.ltp));
      expect(idx.low).toBeLessThan(Math.min(idx.open, idx.ltp));
    }
  });
  it("the latest participant sample day does not depend on how many days are asked for", () => {
    const last = (n: number) => sampleParticipantHistory(n, "2026-10-16").filter((r) => r.date === "2026-10-16");
    expect(last(20)).toEqual(last(60));
    expect(sampleParticipantHistory(20, "2026-10-16")).toHaveLength(80);
  });
});

describe("helpers", () => {
  it("expectedMoveSigma applies each floor explicitly", () => {
    expect(expectedMoveSigma(0.2, 1)).toBeCloseTo(0.2);
    expect(expectedMoveSigma(0.2, 0)).toBeCloseTo(0.2 * Math.sqrt(1 / 365));
    expect(expectedMoveSigma(0, 1, { minSigma: 0.01 })).toBeCloseTo(0.01);
    expect(expectedMoveSigma(0.1, 0, { minSd: 0.02 })).toBe(0.02);
  });
  it("paper worst-case charges use BSE rates for SENSEX", () => {
    const leg = (symbol: string) => ({ input: { symbol, expiry: "2026-10-22", strike: 80_000, type: "CE" as const, side: "BUY" as const, lots: 1, lotSize: 20 }, price: 200 });
    const bse = worstCaseLoss([leg("SENSEX")] as never).charges;
    const nseRate = calcCharges([{ type: "CE", side: "BUY", price: 200, qty: 20, exchange: "NSE" }, { type: "CE", side: "SELL", price: 200, qty: 20, exchange: "NSE" }]).total;
    const bseRate = calcCharges([{ type: "CE", side: "BUY", price: 200, qty: 20, exchange: "BSE" }, { type: "CE", side: "SELL", price: 200, qty: 20, exchange: "BSE" }]).total;
    expect(bse).toBeCloseTo(Math.round(bseRate * 100) / 100, 2);
    expect(bseRate).not.toBeCloseTo(nseRate, 4);
  });
  it("funds required is below margin.total for a debit spread", () => {
    const legs = [
      { symbol: "NIFTY", type: "CE" as const, side: "BUY" as const, strike: 25_000, expiry: "2026-10-27", lots: 1, lotSize: 65, premium: 200 },
      { symbol: "NIFTY", type: "CE" as const, side: "SELL" as const, strike: 25_200, expiry: "2026-10-27", lots: 1, lotSize: 65, premium: 110 },
    ];
    const m = estimateMargin(legs, { spot: 25_050, now: new Date("2026-10-17T05:00:00Z"), sigma: 0.13 });
    expect(marginFundsRequired(m)).toBeLessThanOrEqual(m.total);
  });
});
