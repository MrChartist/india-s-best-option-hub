import { describe, expect, it } from "vitest";
import {
  formatCompactIN,
  formatCrore,
  formatDateIST,
  formatGreek,
  formatINR,
  formatOI,
  formatPct,
  formatPoints,
  formatSigned,
  formatStrike,
  formatTimeIST,
  toISTDate,
} from "@/lib/options";

const M = "−";

describe("Indian number formatting", () => {
  it("groups in lakh / crore", () => {
    expect(formatINR(99999)).toBe("₹99,999.00");
    expect(formatINR(100000)).toBe("₹1,00,000.00");
    expect(formatINR(10000000)).toBe("₹1,00,00,000.00");
    expect(formatINR(123456.5)).toBe("₹1,23,456.50");
    expect(formatINR(-1234.5)).toBe(`${M}₹1,234.50`);
    expect(formatINR(-0.001)).toBe("₹0.00");
    expect(formatINR(1234, { decimals: 0, symbol: false })).toBe("1,234");
  });

  it("returns an em dash for missing values", () => {
    expect(formatINR(NaN)).toBe("—");
    expect(formatINR(null as unknown as number)).toBe("—");
    expect(formatCompactIN(Infinity)).toBe("—");
    expect(formatPct(NaN)).toBe("—");
    expect(formatGreek("delta", NaN)).toBe("—");
  });

  it("compacts at the boundaries", () => {
    expect(formatCompactIN(950)).toBe("950");
    expect(formatCompactIN(1200)).toBe("1.2K");
    expect(formatCompactIN(99999)).toBe("1L");
    expect(formatCompactIN(100000)).toBe("1L");
    expect(formatCompactIN(456000)).toBe("4.56L");
    expect(formatCompactIN(9999999)).toBe("1 Cr");
    expect(formatCompactIN(10000000)).toBe("1 Cr");
    expect(formatCompactIN(23100000, { symbol: true })).toBe("₹2.31 Cr");
    expect(formatCompactIN(1.2e12)).toBe("1.2 L Cr");
    expect(formatCompactIN(-45600)).toBe(`${M}45.6K`);
  });

  it("formats crore amounts with a spaced unit and scale-aware decimals", () => {
    expect(formatCompactIN(67297.69e7, { symbol: true })).toBe("₹67,298 Cr");
    expect(formatCompactIN(2393.35e7, { symbol: true })).toBe("₹2,393 Cr");
    expect(formatCompactIN(512.44e7, { symbol: true })).toBe("₹512.4 Cr");
    expect(formatCompactIN(99999.9e7)).toBe("1 L Cr");
    expect(formatCrore(67297.69)).toBe("₹67,298 Cr");
    expect(formatCrore(23.456)).toBe("₹23.46 Cr");
    expect(formatCrore(-1234, { signed: true })).toBe(`${M}₹1,234 Cr`);
    expect(formatCrore(1234, { signed: true })).toBe("+₹1,234 Cr");
    expect(formatCrore(NaN)).toBe("—");
  });

  it("formats percentages, signs, points, OI, greeks and strikes", () => {
    expect(formatPct(-0.5)).toBe(`${M}0.50%`);
    expect(formatPct(1.2, { signed: true })).toBe("+1.20%");
    expect(formatPct(0, { signed: true })).toBe("0.00%");
    expect(formatSigned(1234.5)).toBe("+1,234.50");
    expect(formatSigned(-12)).toBe(`${M}12.00`);
    expect(formatPoints(125.4)).toBe("+125.40 pts");
    expect(formatOI(1250)).toBe("1.3K");
    expect(formatOI(1250, { unit: "qty", lotSize: 65 })).toBe("81.3K");
    expect(formatGreek("delta", -0.45678)).toBe(`${M}0.457`);
    expect(formatGreek("gamma", 0.000123456)).toBe("0.00012");
    expect(formatStrike(24500)).toBe("24,500");
    expect(formatStrike(112.5)).toBe("112.5");
  });

  it("formats IST time and dates", () => {
    expect(formatTimeIST(toISTDate("2026-10-20", "14:32"))).toBe("14:32 IST");
    expect(formatTimeIST(toISTDate("2026-10-20", "09:05:07"), { seconds: true })).toBe("09:05:07 IST");
    expect(formatDateIST("2026-10-20")).toBe("20 Oct 2026");
    expect(formatDateIST(new Date("2026-09-30T20:00:00Z"))).toBe("1 Oct 2026");
    expect(formatDateIST("nonsense")).toBe("—");
  });
});
