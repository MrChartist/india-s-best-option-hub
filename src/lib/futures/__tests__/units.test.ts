import { describe, expect, it } from "vitest";
import { futuresDayFromBhav } from "../model";
import { getLotSize } from "@/lib/options";
import type { BhavRow } from "@/lib/screener/metrics";

const row = (p: Partial<BhavRow>): BhavRow => ({
  symbol: "NIFTY",
  expiry: "2026-10-27",
  strike: 0,
  type: "FUT",
  close: 25080,
  settle: 0,
  oi: 0,
  chgOi: 0,
  volume: 0,
  underlyingClose: 25000,
  ...p,
});

describe("futuresDayFromBhav units", () => {
  const lot = getLotSize("NIFTY", "2026-10-27") ?? 0;

  it("converts UDiFF quantity to contracts with the expiry's lot size", () => {
    expect(lot).toBeGreaterThan(0);
    const day = futuresDayFromBhav("NIFTY", "2026-10-16", [row({ oi: 1000 * lot, chgOi: -40 * lot, volume: 250 * lot })]);
    expect(day.contracts[0]).toMatchObject({ oi: 1000, chgOi: -40, volume: 250 });
  });

  it("leaves input that is already in contracts alone", () => {
    const day = futuresDayFromBhav("NIFTY", "2026-10-16", [row({ oi: 1234, chgOi: 5, volume: 9 })], { unit: "contracts" });
    expect(day.contracts[0]).toMatchObject({ oi: 1234, chgOi: 5, volume: 9 });
  });
});
