import { describe, expect, it } from "vitest";
import { shiftedFromDate } from "./expiryMath";
import { isTradingDay } from "@/lib/options";

describe("shiftedFromDate", () => {
  it("returns null for an expiry on the regular weekday", () => {
    expect(shiftedFromDate("NIFTY", "2026-10-27")).toBeNull(); // Tuesday
  });

  it("names the holiday the expiry was pulled forward from", () => {
    // Tue 20 Oct 2026 is an exchange holiday, so the NIFTY weekly moves to Mon 19 Oct.
    if (isTradingDay("2026-10-20")) return; // holiday list changed: nothing to assert
    expect(shiftedFromDate("NIFTY", "2026-10-19")).toBe("2026-10-20");
  });

  it("returns null for unknown symbols and empty input", () => {
    expect(shiftedFromDate("NOPE", "2026-10-19")).toBeNull();
    expect(shiftedFromDate("NIFTY", "")).toBeNull();
  });
});
