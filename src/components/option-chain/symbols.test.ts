import { describe, expect, it } from "vitest";
import { SCREENER_UNIVERSE } from "@/lib/volatility/screener";
import { isKnownFnoSymbol, resolveFnoSymbol } from "./symbols";

describe("F&O symbol resolution for links", () => {
  it("accepts indices, stocks and renamed tickers", () => {
    expect(resolveFnoSymbol("nifty")).toEqual({ symbol: "NIFTY", unknown: null });
    expect(resolveFnoSymbol("SBIN")).toEqual({ symbol: "SBIN", unknown: null });
    expect(resolveFnoSymbol("zomato")).toEqual({ symbol: "ETERNAL", unknown: null });
    expect(resolveFnoSymbol("")).toEqual({ symbol: "NIFTY", unknown: null });
    expect(resolveFnoSymbol(null)).toEqual({ symbol: "NIFTY", unknown: null });
  });

  it("falls back to NIFTY for a symbol with no F&O contracts", () => {
    expect(resolveFnoSymbol("XYZ")).toEqual({ symbol: "NIFTY", unknown: "XYZ" });
    expect(isKnownFnoSymbol("XYZ")).toBe(false);
  });

  it("knows every symbol the volatility switcher offers", () => {
    for (const s of SCREENER_UNIVERSE) expect(isKnownFnoSymbol(s), s).toBe(true);
  });
});
