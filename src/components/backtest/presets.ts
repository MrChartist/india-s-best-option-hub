import type { BacktestSettings } from "@/lib/backtest";

export interface BacktestPreset {
  id: string;
  label: string;
  description: string;
  patch: Partial<BacktestSettings>;
}

/** One-click starting points shown in the empty state. */
export const BACKTEST_PRESETS: readonly BacktestPreset[] = [
  {
    id: "weekly-strangle",
    label: "Weekly short strangle",
    description: "Sell 0.20Δ on both sides 7 days out, take 50%, stop at 100%.",
    patch: { templateId: "short-strangle", series: "nearest", timing: "dte", dte: 7, weekdays: [], strikeMode: "delta", delta: 0.2, profitPct: 50, stopPct: 100, maxDaysHeld: null, exitDte: null },
  },
  {
    id: "monthly-condor",
    label: "Monthly iron condor",
    description: "0.16Δ shorts with 4-strike wings 30 days out, exit at 50% or 7 DTE.",
    patch: { templateId: "iron-condor", series: "monthly", timing: "dte", dte: 30, weekdays: [], strikeMode: "delta", delta: 0.16, profitPct: 50, stopPct: 200, maxDaysHeld: null, exitDte: 7 },
  },
  {
    id: "monday-straddle",
    label: "Monday long straddle",
    description: "Buy the ATM straddle every Monday into the nearest expiry, hold 2 sessions.",
    patch: { templateId: "long-straddle", series: "nearest", timing: "weekday", dte: 1, weekdays: [1], strikeMode: "template", profitPct: 40, stopPct: 40, maxDaysHeld: 2, exitDte: null },
  },
];
