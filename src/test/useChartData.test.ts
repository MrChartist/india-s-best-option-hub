import { describe, it, expect } from "vitest";
import { parseColumnarCandles, lookupSecurity, findDuplicateSecurityIds, istDaysAgo, SECURITY_MAP } from "@/hooks/useChartData";

describe("parseColumnarCandles", () => {
  it("returns empty array for null/undefined/malformed input", () => {
    expect(parseColumnarCandles(null)).toHaveLength(0);
    expect(parseColumnarCandles(undefined)).toHaveLength(0);
    expect(parseColumnarCandles({})).toHaveLength(0);
    expect(parseColumnarCandles({ close: undefined })).toHaveLength(0);
  });

  it("parses a Dhan/Yahoo columnar payload into sorted OHLCV candles", () => {
    const result = parseColumnarCandles({
      open: [100, 102],
      high: [105, 106],
      low: [99, 101],
      close: [104, 103],
      volume: [1000, 2000],
      timestamp: [1779200000, 1779286400],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ open: 100, high: 105, low: 99, close: 104, volume: 1000 });
    expect(result[0].time).toBe(1779200000);
  });

  it("skips Yahoo's null gaps (non-trading slots) instead of emitting broken candles", () => {
    const result = parseColumnarCandles({
      open: [100, null, 110],
      high: [105, null, 112],
      low: [99, null, 108],
      close: [104, null, 111],
      volume: [1000, 0, 1500],
      timestamp: [1779200000, 1779286400, 1779372800],
    });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.close)).toEqual([104, 111]);
  });

  it("normalises millisecond timestamps down to seconds", () => {
    const result = parseColumnarCandles({ close: [104], timestamp: [1779200000000] });
    expect(result[0].time).toBe(1779200000);
  });

  it("reads zone-less date-time strings (Dhan start_Time) as IST", () => {
    const result = parseColumnarCandles({ close: [250], start_Time: ["2026-06-11 09:15:00"] });
    expect(result).toHaveLength(1);
    // 09:15 IST = 03:45 UTC
    expect(result[0].time).toBe(Date.UTC(2026, 5, 11, 3, 45) / 1000);
  });

  it("respects an explicit offset in timestamp strings", () => {
    const result = parseColumnarCandles({ close: [1], timestamp: ["2026-06-11T03:45:00Z"] });
    expect(result[0].time).toBe(Date.UTC(2026, 5, 11, 3, 45) / 1000);
  });

  it("drops candles whose timestamp cannot be parsed", () => {
    expect(parseColumnarCandles({ close: [1, 2], timestamp: ["not a date", 1779200000] })).toHaveLength(1);
  });

  it("falls back high/low/open to close when a column is missing", () => {
    const result = parseColumnarCandles({ close: [200, 210], timestamp: [1779200000, 1779286400] });
    expect(result[0]).toMatchObject({ open: 200, high: 200, low: 200, close: 200 });
  });

  it("sorts out-of-order candles ascending by time", () => {
    const result = parseColumnarCandles({ close: [3, 1, 2], timestamp: [1779372800, 1779200000, 1779286400] });
    expect(result.map((c) => c.close)).toEqual([1, 2, 3]);
  });
});

describe("SECURITY_MAP", () => {
  it("has no duplicate security ids within a segment", () => {
    expect(findDuplicateSecurityIds()).toEqual([]);
  });

  it("detects duplicates when present", () => {
    expect(
      findDuplicateSecurityIds({
        A: { secId: "1", exchSeg: "NSE_EQ", instrument: "EQUITY" },
        B: { secId: "1", exchSeg: "NSE_EQ", instrument: "EQUITY" },
        C: { secId: "1", exchSeg: "IDX_I", instrument: "INDEX" },
      }),
    ).toEqual(["A/B"]);
  });

  it("keeps Bajaj Finserv and Bajaj Auto distinct and resolves aliases", () => {
    expect(lookupSecurity("BAJAJFINSV")?.secId).not.toBe(lookupSecurity("BAJAJ-AUTO")?.secId);
    expect(lookupSecurity("bajfinsv")).toBe(SECURITY_MAP.BAJAJFINSV);
    expect(lookupSecurity("M_M")).toBe(SECURITY_MAP["M&M"]);
    expect(lookupSecurity("m&m")?.secId).toBe("2031");
    expect(lookupSecurity("UNKNOWN")).toBeUndefined();
  });
});

describe("istDaysAgo", () => {
  it("uses the IST calendar date", () => {
    // 20:00 UTC on 16 Oct is 01:30 IST on 17 Oct
    const now = new Date("2026-10-16T20:00:00Z");
    expect(istDaysAgo(0, now)).toBe("2026-10-17");
    expect(istDaysAgo(1, now)).toBe("2026-10-16");
  });
});
