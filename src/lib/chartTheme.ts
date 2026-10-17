/**
 * Recharts theme for the Mr. Chartist design language.
 *
 * Every value is a CSS-variable reference ("hsl(var(--chart-call))"), so charts follow
 * light/dark mode automatically without re-rendering. Use these instead of hex values.
 *
 * Indian convention: CE OI = resistance = bearish/red, PE OI = support = bullish/green.
 */
import type { CSSProperties } from "react";

/** Build a colour string from a token name, with optional alpha (0..1). */
export function tokenColor(name: string, alpha?: number): string {
  const clean = name.replace(/^--/, "");
  if (alpha === undefined || !Number.isFinite(alpha)) return `hsl(var(--${clean}))`;
  const a = Math.min(1, Math.max(0, alpha));
  return `hsl(var(--${clean}) / ${a})`;
}

export const chartColors = {
  /** Spot / primary series (orange-500) */
  primary: tokenColor("chart-1"),
  spot: tokenColor("chart-1"),
  /** Implied volatility (options navy) */
  iv: tokenColor("chart-2"),
  /** India VIX */
  vix: tokenColor("chart-3"),
  /** Call (CE) side: resistance, bearish */
  call: tokenColor("chart-call"),
  /** Put (PE) side: support, bullish */
  put: tokenColor("chart-put"),
  bullish: tokenColor("bullish"),
  bearish: tokenColor("bearish"),
  warning: tokenColor("warning"),
  info: tokenColor("info"),
  product: tokenColor("product"),
  fii: tokenColor("chart-fii"),
  dii: tokenColor("chart-6"),
  grid: tokenColor("chart-grid"),
  axis: tokenColor("chart-axis"),
  muted: tokenColor("muted-foreground"),
  foreground: tokenColor("foreground"),
  background: tokenColor("background"),
  card: tokenColor("card"),
  border: tokenColor("border"),
  c1: tokenColor("chart-1"),
  c2: tokenColor("chart-2"),
  c3: tokenColor("chart-3"),
  c4: tokenColor("chart-4"),
  c5: tokenColor("chart-5"),
  c6: tokenColor("chart-6"),
} as const;

export type ChartColorKey = keyof typeof chartColors;

/** Ordered categorical palette for multi-series charts (cycle with seriesColor). */
export const chartSeries: readonly string[] = [
  chartColors.c1,
  chartColors.c2,
  chartColors.c3,
  chartColors.c4,
  chartColors.c5,
  chartColors.c6,
];

export function seriesColor(index: number): string {
  const n = chartSeries.length;
  const i = Number.isFinite(index) ? ((Math.trunc(index) % n) + n) % n : 0;
  return chartSeries[i];
}

/** Colour for a signed value: positive bullish, negative bearish, zero muted. */
export function signedColor(value: number): string {
  if (!Number.isFinite(value) || value === 0) return chartColors.muted;
  return value > 0 ? chartColors.bullish : chartColors.bearish;
}

/** Recharts <Tooltip contentStyle={tooltipStyle} /> */
export const tooltipStyle: CSSProperties = {
  background: "hsl(var(--popover) / 0.96)",
  border: "1px solid hsl(var(--border))",
  borderRadius: 10,
  boxShadow: "var(--shadow-float)",
  color: "hsl(var(--popover-foreground))",
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 12,
  fontFeatureSettings: '"tnum" 1, "zero" 1',
  padding: "8px 10px",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
};

/** Recharts <Tooltip labelStyle={tooltipLabelStyle} /> */
export const tooltipLabelStyle: CSSProperties = {
  color: "hsl(var(--muted-foreground))",
  fontSize: 11,
  fontWeight: 650,
  letterSpacing: "0.04em",
  marginBottom: 4,
};

/** Recharts <Tooltip itemStyle={tooltipItemStyle} /> */
export const tooltipItemStyle: CSSProperties = {
  color: "hsl(var(--popover-foreground))",
  padding: "1px 0",
};

/** Recharts <Tooltip cursor={tooltipCursor} /> for line/area charts */
export const tooltipCursor = { stroke: tokenColor("muted-foreground", 0.45), strokeWidth: 1, strokeDasharray: "3 3" };

/** Recharts <Tooltip cursor={barCursor} /> for bar charts */
export const barCursor = { fill: tokenColor("foreground", 0.05) };

/** Spread onto both <XAxis {...axisProps} /> and <YAxis {...axisProps} /> */
export const axisProps = {
  stroke: chartColors.axis,
  tick: { fill: chartColors.axis, fontSize: 11, fontFamily: "Inter, system-ui, sans-serif" },
  tickLine: false,
  axisLine: { stroke: chartColors.grid },
  tickMargin: 6,
} as const;

/** <CartesianGrid {...gridProps} /> */
export const gridProps = {
  stroke: chartColors.grid,
  strokeDasharray: "3 3",
  vertical: false,
} as const;

/** <Legend wrapperStyle={legendStyle} /> */
export const legendStyle: CSSProperties = {
  fontSize: 11,
  color: "hsl(var(--muted-foreground))",
  paddingTop: 6,
};

/** <ReferenceLine {...referenceLineProps} /> e.g. spot or zero line */
export const referenceLineProps = {
  stroke: chartColors.primary,
  strokeDasharray: "4 4",
  strokeWidth: 1,
} as const;

/** Payoff chart fills: profit zone green wash, loss zone red wash, expiry/T+0 lines. */
export const payoffFills = {
  profit: tokenColor("bullish", 0.18),
  profitStroke: chartColors.bullish,
  loss: tokenColor("bearish", 0.18),
  lossStroke: chartColors.bearish,
  expiryLine: chartColors.foreground,
  todayLine: chartColors.primary,
  zeroLine: tokenColor("muted-foreground", 0.6),
  spotLine: chartColors.primary,
  breakeven: chartColors.warning,
  expectedMoveBand: tokenColor("info", 0.08),
} as const;

/**
 * Split a payoff series into a gradient offset so one <Area> can be green above
 * zero and red below. Returns the fraction (0..1, top to bottom) where y crosses 0.
 */
export function zeroCrossOffset(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return 0.5;
  const max = Math.max(...finite);
  const min = Math.min(...finite);
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}

/**
 * Read a token as a concrete colour string (for canvas libraries that cannot resolve
 * CSS variables). Falls back to the given value outside the browser.
 */
export function resolveTokenColor(name: string, fallback = "hsl(0 0% 50%)", alpha?: number): string {
  if (typeof window === "undefined" || typeof document === "undefined") return fallback;
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(`--${name.replace(/^--/, "")}`)
      .trim();
    if (!raw) return fallback;
    return alpha === undefined ? `hsl(${raw})` : `hsl(${raw} / ${Math.min(1, Math.max(0, alpha))})`;
  } catch {
    return fallback;
  }
}
