import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYMBOL,
  SYMBOL_STORAGE_KEY,
  nextForExpiry,
  nextForSymbol,
  parseStored,
  readSearch,
  readStoredSelection,
  resolveSelection,
  sanitizeExpiry,
  sanitizeSymbol,
  serializeStored,
  writeSearch,
  writeStoredSelection,
} from "../state";
import { getExpiries } from "@/lib/options";
import { SWITCHER_INDICES, SWITCHER_STOCKS, isIndexUnderlying, knownFnoSymbol, scheduledExpiries } from "../symbols";

// Saturday 17 Oct 2026, 11:00 IST
const NOW = new Date("2026-10-17T05:30:00Z");

describe("sanitize", () => {
  it("normalises symbols and aliases", () => {
    expect(sanitizeSymbol(" banknifty ")).toBe("BANKNIFTY");
    expect(sanitizeSymbol("Nifty 50")).toBe("NIFTY");
    expect(sanitizeSymbol("m&m")).toBe("M&M");
    expect(sanitizeSymbol("BAJAJ-AUTO")).toBe("BAJAJ-AUTO");
  });
  it("rejects junk symbols", () => {
    expect(sanitizeSymbol("")).toBe("");
    expect(sanitizeSymbol("<script>")).toBe("");
    expect(sanitizeSymbol("A".repeat(25))).toBe("");
    expect(sanitizeSymbol(42)).toBe("");
    expect(sanitizeSymbol(null)).toBe("");
  });
  it("accepts ISO and human expiries", () => {
    expect(sanitizeExpiry("2026-10-27", NOW)).toBe("2026-10-27");
    expect(sanitizeExpiry("27 Oct", NOW)).toBe("2026-10-27");
    expect(sanitizeExpiry("27OCT26", NOW)).toBe("2026-10-27");
    expect(sanitizeExpiry("2026-02-30", NOW)).toBe("");
    expect(sanitizeExpiry("soon", NOW)).toBe("");
    expect(sanitizeExpiry(undefined, NOW)).toBe("");
  });
});

describe("URL round trip", () => {
  it("reads both params, with or without the leading ?", () => {
    expect(readSearch("?symbol=banknifty&expiry=2026-10-28", NOW)).toEqual({ symbol: "BANKNIFTY", expiry: "2026-10-28" });
    expect(readSearch("symbol=RELIANCE", NOW)).toEqual({ symbol: "RELIANCE", expiry: "" });
    expect(readSearch("", NOW)).toEqual({ symbol: "", expiry: "" });
  });
  it("writes params and keeps the others", () => {
    expect(writeSearch("?tab=greeks", { symbol: "NIFTY", expiry: "2026-10-20" })).toBe("?tab=greeks&symbol=NIFTY&expiry=2026-10-20");
    expect(writeSearch("?symbol=NIFTY&expiry=2026-10-20", { symbol: "SENSEX", expiry: "" })).toBe("?symbol=SENSEX");
    expect(writeSearch("", { symbol: "M&M", expiry: "" })).toBe("?symbol=M%26M");
    expect(readSearch(writeSearch("", { symbol: "M&M", expiry: "" }), NOW).symbol).toBe("M&M");
  });
});

describe("resolveSelection", () => {
  const stored = { symbol: "BANKNIFTY", expiry: "2026-10-28" };
  it("prefers the URL", () => {
    expect(resolveSelection("?symbol=SENSEX", stored, NOW)).toEqual({ symbol: "SENSEX", expiry: "", source: "url" });
  });
  it("keeps the remembered expiry for the same symbol", () => {
    expect(resolveSelection("?symbol=BANKNIFTY", stored, NOW)).toEqual({ symbol: "BANKNIFTY", expiry: "2026-10-28", source: "url" });
  });
  it("falls back to the session, then NIFTY", () => {
    expect(resolveSelection("", stored, NOW)).toEqual({ ...stored, source: "session" });
    expect(resolveSelection("", null, NOW)).toEqual({ symbol: DEFAULT_SYMBOL, expiry: "", source: "default" });
    expect(resolveSelection("?symbol=%3Cx%3E", null, NOW).symbol).toBe("NIFTY");
  });
  it("lets an explicit ?expiry= win without ?symbol=", () => {
    expect(resolveSelection("?expiry=2026-11-24", stored, NOW).expiry).toBe("2026-11-24");
    expect(resolveSelection("?expiry=2026-10-20", null, NOW)).toEqual({ symbol: "NIFTY", expiry: "2026-10-20", source: "default" });
  });
});

describe("transitions", () => {
  const cur = { symbol: "NIFTY", expiry: "2026-10-20" };
  it("clears the expiry on a new symbol only", () => {
    expect(nextForSymbol(cur, "banknifty")).toEqual({ symbol: "BANKNIFTY", expiry: "" });
    expect(nextForSymbol(cur, "nifty")).toEqual(cur);
    expect(nextForSymbol(cur, "")).toBeNull();
  });
  it("sets, clears and rejects expiries", () => {
    expect(nextForExpiry(cur, "27 Oct", NOW)).toEqual({ symbol: "NIFTY", expiry: "2026-10-27" });
    expect(nextForExpiry(cur, "", NOW)).toEqual({ symbol: "NIFTY", expiry: "" });
    expect(nextForExpiry(cur, null, NOW)).toEqual({ symbol: "NIFTY", expiry: "" });
    expect(nextForExpiry(cur, "later", NOW)).toBeNull();
  });
});

describe("storage", () => {
  it("parses defensively", () => {
    expect(parseStored(serializeStored({ symbol: "RELIANCE", expiry: "2026-10-27" }))).toEqual({ symbol: "RELIANCE", expiry: "2026-10-27" });
    expect(parseStored('{"symbol":"NIFTY","expiry":"bad"}')).toEqual({ symbol: "NIFTY", expiry: "" });
    expect(parseStored("{not json")).toBeNull();
    expect(parseStored('{"symbol":""}')).toBeNull();
    expect(parseStored(null)).toBeNull();
  });
  it("never throws when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(readStoredSelection(blocked)).toBeNull();
    expect(() => writeStoredSelection(blocked, { symbol: "NIFTY", expiry: "" })).not.toThrow();
    expect(readStoredSelection(null)).toBeNull();
  });
  it("writes under the documented key", () => {
    const mem = new Map<string, string>();
    writeStoredSelection({ setItem: (k, v) => void mem.set(k, v) }, { symbol: "SENSEX", expiry: "" });
    expect(readStoredSelection({ getItem: (k) => mem.get(k) ?? null })).toEqual({ symbol: "SENSEX", expiry: "" });
    expect([...mem.keys()]).toEqual([SYMBOL_STORAGE_KEY]);
  });
});

describe("switcher lists", () => {
  it("lists indices first and stocks without duplicates", () => {
    expect(SWITCHER_INDICES.slice(0, 2)).toEqual(["NIFTY", "BANKNIFTY"]);
    expect(SWITCHER_INDICES).toContain("SENSEX");
    expect(SWITCHER_STOCKS).toContain("RELIANCE");
    expect(SWITCHER_STOCKS).not.toContain("NIFTY");
    expect(new Set(SWITCHER_STOCKS).size).toBe(SWITCHER_STOCKS.length);
  });
  it("recognises known underlyings and renames", () => {
    expect(knownFnoSymbol("reliance")).toBe("RELIANCE");
    expect(knownFnoSymbol("bank nifty")).toBe("BANKNIFTY");
    expect(knownFnoSymbol("ZOMATO")).toBe("ETERNAL");
    expect(knownFnoSymbol("CHAIN")).toBe("");
    expect(isIndexUnderlying("NIFTY")).toBe(true);
    expect(isIndexUnderlying("RELIANCE")).toBe(false);
  });
  it("builds scheduled expiries from the shared calendar", () => {
    const list = scheduledExpiries("NIFTY", NOW, 4);
    expect(list).toHaveLength(4);
    expect(list.map((e) => e.value)).toEqual(getExpiries("NIFTY", NOW, 4).map((e) => e.date));
    expect(list[0].label).toMatch(/Oct/);
    expect(list.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.value))).toBe(true);
  });
});
