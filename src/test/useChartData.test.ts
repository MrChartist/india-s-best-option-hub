import { describe, it, expect } from "vitest";
import { parseColumnarCandles } from "@/hooks/useChartData";

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
      open: [100, null as unknown as number, 110],
      high: [105, null as unknown as number, 112],
      low: [99, null as unknown as number, 108],
      close: [104, null as unknown as number, 111],
      volume: [1000, 0, 1500],
      timestamp: [1779200000, 1779286400, 1779372800],
    });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.close)).toEqual([104, 111]);
  });

  it("normalises millisecond timestamps down to seconds", () => {
    const result = parseColumnarCandles({
      close: [104],
      timestamp: [1779200000000], // ms
    });
    expect(result[0].time).toBe(1779200000); // seconds
  });

  it("accepts ISO string timestamps (Dhan start_Time)", () => {
    const result = parseColumnarCandles({
      close: [250],
      start_Time: ["2026-06-11 09:15:00"],
    });
    expect(result).toHaveLength(1);
    expect(typeof result[0].time).toBe("number");
    expect(result[0].time).toBeGreaterThan(1_700_000_000);
  });

  it("falls back high/low/open to close when a column is missing", () => {
    const result = parseColumnarCandles({
      close: [200, 210],
      timestamp: [1779200000, 1779286400],
    });
    expect(result[0]).toMatchObject({ open: 200, high: 200, low: 200, close: 200 });
  });

  it("sorts out-of-order candles ascending by time", () => {
    const result = parseColumnarCandles({
      close: [3, 1, 2],
      timestamp: [1779372800, 1779200000, 1779286400],
    });
    expect(result.map((c) => c.close)).toEqual([1, 2, 3]);
  });
});
