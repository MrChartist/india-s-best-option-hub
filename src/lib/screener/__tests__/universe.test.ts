import { describe, expect, it } from "vitest";
import { STATIC_FNO_STOCKS, canonicalFnoSymbol, dedupeSymbols, universeFromIndices, universeFromLive, sectorOf } from "../universe";
import type { FnOStockData } from "@/lib/marketApi";

const stock = (o: Partial<FnOStockData>): FnOStockData => ({ symbol: "X", ltp: 100, change: 1, changePercent: 1, open: 99, high: 101, low: 98, previousClose: 99, volume: 1000, ...o });

describe("static universe", () => {
  it("has no duplicates and uses current names", () => {
    expect(new Set(STATIC_FNO_STOCKS).size).toBe(STATIC_FNO_STOCKS.length);
    expect(STATIC_FNO_STOCKS).toContain("ETERNAL");
    expect(STATIC_FNO_STOCKS).toContain("ADANIENSOL");
    expect(STATIC_FNO_STOCKS).not.toContain("ZOMATO");
    expect(STATIC_FNO_STOCKS).not.toContain("ADANITRANS");
    expect(STATIC_FNO_STOCKS).not.toContain("DELTACORP");
  });
  it("renames old symbols", () => {
    expect(canonicalFnoSymbol(" zomato ")).toBe("ETERNAL");
    expect(canonicalFnoSymbol("ADANITRANS")).toBe("ADANIENSOL");
    expect(canonicalFnoSymbol("RELIANCE")).toBe("RELIANCE");
    expect(dedupeSymbols(["ZOMATO", "ETERNAL", "TCS", "TCS"])).toEqual(["ETERNAL", "TCS"]);
  });
  it("sector lookup falls back sensibly", () => {
    expect(sectorOf("HDFCBANK")).toBe("Banks");
    expect(sectorOf("NIFTY")).toBe("Index");
    expect(sectorOf("UNKNOWNCO")).toBe("Other");
    expect(sectorOf("TCS", "Computers - Software")).toBe("Computers - Software");
  });
});

describe("universeFromLive", () => {
  it("drops junk, renames and dedupes", () => {
    const rows = universeFromLive([
      stock({ symbol: "ZOMATO", ltp: 250 }),
      stock({ symbol: "ETERNAL", ltp: 251 }),
      stock({ symbol: "NIFTY 50", ltp: 25000 }),
      stock({ symbol: "BAD", ltp: 0 }),
      stock({ symbol: "TCS", ltp: 3000, changePercent: NaN, previousClose: 2900, totalTradedVolume: 5000 }),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["ETERNAL", "TCS"]);
    expect(rows[0].ltp).toBe(250);
    expect(rows[1].changePct).toBeCloseTo((100 / 2900) * 100, 6);
    expect(rows[1].volume).toBe(5000);
  });
  it("builds index rows by symbol or name", () => {
    const rows = universeFromIndices([
      { symbol: "NIFTY 50", name: "NIFTY 50", ltp: 25000, changePercent: 1 },
      { symbol: "BANKNIFTY", ltp: 56000, changePercent: -0.5, prevClose: 56280 },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["NIFTY", "BANKNIFTY"]);
    expect(rows[0].kind).toBe("INDEX");
    expect(rows[1].prevClose).toBe(56280);
  });
});
