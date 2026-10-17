import { describe, expect, it } from "vitest";
import {
  axisProps,
  chartColors,
  gridProps,
  payoffFills,
  seriesColor,
  signedColor,
  tokenColor,
  tooltipStyle,
  zeroCrossOffset,
  resolveTokenColor,
} from "./chartTheme";
import { nextToggleMode, parseThemeMode, resolveTheme } from "@/hooks/useTheme";

describe("chartTheme", () => {
  it("builds token colours with and without alpha", () => {
    expect(tokenColor("bullish")).toBe("hsl(var(--bullish))");
    expect(tokenColor("--bearish", 0.2)).toBe("hsl(var(--bearish) / 0.2)");
    expect(tokenColor("primary", 4)).toBe("hsl(var(--primary) / 1)");
    expect(tokenColor("primary", Number.NaN)).toBe("hsl(var(--primary))");
  });

  it("follows the Indian CE/PE convention", () => {
    expect(chartColors.call).toBe("hsl(var(--chart-call))");
    expect(chartColors.put).toBe("hsl(var(--chart-put))");
  });

  it("never hard-codes hex colours", () => {
    const all = JSON.stringify({ chartColors, tooltipStyle, axisProps, gridProps, payoffFills });
    expect(all).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("cycles the series palette, including negative indices", () => {
    expect(seriesColor(0)).toBe(chartColors.c1);
    expect(seriesColor(6)).toBe(chartColors.c1);
    expect(seriesColor(-1)).toBe(chartColors.c6);
    expect(seriesColor(Number.NaN)).toBe(chartColors.c1);
  });

  it("colours signed values", () => {
    expect(signedColor(5)).toBe(chartColors.bullish);
    expect(signedColor(-5)).toBe(chartColors.bearish);
    expect(signedColor(0)).toBe(chartColors.muted);
    expect(signedColor(Number.NaN)).toBe(chartColors.muted);
  });

  it("finds the zero-cross gradient offset", () => {
    expect(zeroCrossOffset([100, -100])).toBeCloseTo(0.5);
    expect(zeroCrossOffset([300, -100])).toBeCloseTo(0.75);
    expect(zeroCrossOffset([10, 20])).toBe(1);
    expect(zeroCrossOffset([-10, -20])).toBe(0);
    expect(zeroCrossOffset([])).toBe(0.5);
    expect(zeroCrossOffset([Number.NaN, 50, -50])).toBeCloseTo(0.5);
  });

  it("resolves tokens from computed style with a fallback", () => {
    document.documentElement.style.setProperty("--test-token", "10 20% 30%");
    expect(resolveTokenColor("test-token")).toBe("hsl(10 20% 30%)");
    expect(resolveTokenColor("test-token", "x", 0.5)).toBe("hsl(10 20% 30% / 0.5)");
    expect(resolveTokenColor("missing-token", "fallback")).toBe("fallback");
  });
});

describe("theme mode helpers", () => {
  it("resolves system mode from the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("parses stored values defensively", () => {
    expect(parseThemeMode("dark")).toBe("dark");
    expect(parseThemeMode("system")).toBe("system");
    expect(parseThemeMode(null)).toBe("system");
    expect(parseThemeMode("neon")).toBe("system");
  });

  it("toggles to an explicit opposite theme", () => {
    expect(nextToggleMode("dark")).toBe("light");
    expect(nextToggleMode("light")).toBe("dark");
  });
});
