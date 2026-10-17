/**
 * Types for the end-of-day options backtester.
 *
 * Units: prices are rupees per unit (not per lot), dates are ISO yyyy-mm-dd in IST, money totals
 * are rupees for the whole position (price × lots × lot size), and percentages are 0–100.
 */
import type { OptionType, Side } from "@/lib/options";

/** One expiry's end-of-day option closes on one day, stored column-wise to stay compact. */
export interface EodChain {
  expiry: string;
  /** Ascending strikes. */
  strikes: number[];
  /** CE close per strike (null when the strike did not trade or was not listed). */
  ce: Array<number | null>;
  /** PE close per strike. */
  pe: Array<number | null>;
  /** Futures close for this expiry, when listed. */
  fut: number | null;
}

export interface EodDay {
  date: string;
  /** Underlying index close. */
  spot: number;
  /** India VIX close (null when unknown). */
  vix: number | null;
  chains: EodChain[];
}

export type DatasetSource = "sample" | "bhavcopy";

export interface EodDataset {
  symbol: string;
  source: DatasetSource;
  /** Ascending by date. */
  days: EodDay[];
}

export type EntryTiming = "dte" | "weekday";
export type StrikeMode = "template" | "atm" | "delta" | "premium";
export type ExpirySeries = "nearest" | "monthly";

export interface BacktestConfig {
  symbol: string;
  templateId: string;
  /** Base lots; ratio legs multiply it. */
  lots: number;
  series: ExpirySeries;
  /** "dte": one trade per expiry, entered N calendar days before it. "weekday": enter on the chosen weekdays. */
  timing: EntryTiming;
  /** dte timing: calendar days before expiry. weekday timing: minimum calendar DTE of the traded expiry. */
  dte: number;
  /** ISO weekdays 1 (Mon) – 5 (Fri) allowed for entry. Empty = every weekday. */
  weekdays: number[];
  strikeMode: StrikeMode;
  /** ATM ± N mode: strikes out of the money for the anchor legs. */
  atmOffset: number;
  /** Delta mode: target |Δ| for the anchor legs (0.05 – 0.5). */
  delta: number;
  /** Premium mode: target premium per unit (₹) for the anchor legs. */
  premium: number;
  /** Exit when the gross profit reaches this % of the basis (null = off). */
  profitPct: number | null;
  /** Exit when the gross loss reaches this % of the basis (null = off). */
  stopPct: number | null;
  /** Exit after this many trading days in the trade (null = off). */
  maxDaysHeld: number | null;
  /** Exit at the close once calendar DTE is at or below this (null = off). */
  exitDte: number | null;
  brokerId: string;
  /** Slippage per fill as a % of the premium (worse price on every fill). */
  slippagePct: number;
  /** Starting capital (₹) for the equity curve and return figures. */
  capital: number;
  from: string;
  to: string;
}

export type ExitReason = "target" | "stop" | "time" | "dte" | "expiry" | "end";

export interface TradeLeg {
  type: OptionType | "FUT";
  side: Side;
  /** 0 for futures. */
  strike: number;
  expiry: string;
  lots: number;
  lotSize: number;
  entry: number;
  exit: number;
  /** Decimal IV at entry (when it could be implied). */
  iv?: number;
  /** The entry or exit price came from the model because the strike had no close that day. */
  modelEntry?: boolean;
  modelExit?: boolean;
}

export interface Trade {
  id: number;
  entryDate: string;
  exitDate: string;
  /** Front (traded) expiry. */
  expiry: string;
  /** Calendar DTE at entry. */
  entryDte: number;
  entrySpot: number;
  exitSpot: number;
  /** India VIX at entry. */
  vix: number | null;
  /** ISO weekday of the entry day. */
  weekday: number;
  legs: TradeLeg[];
  /** Net premium at entry for the whole position: positive = credit received, negative = debit paid. */
  netPremium: number;
  /** Rupee base for the profit-target and stop-loss percentages. */
  basis: number;
  basisKind: "premium" | "margin";
  /** Estimated funds blocked at entry (SPAN-style estimate). */
  margin: number;
  gross: number;
  charges: number;
  net: number;
  /** Trading days from entry to exit. */
  daysHeld: number;
  reason: ExitReason;
  /** Worst and best gross mark-to-market seen at a close while the trade was open. */
  mae: number;
  mfe: number;
  /** Fills priced by the model rather than an exchange close. */
  modelFills: number;
}

export interface EquityPoint {
  date: string;
  /** Capital + realised + open mark-to-market (net of charges paid so far). */
  equity: number;
  /** Cumulative net P&L. */
  pnl: number;
  /** Drop from the running peak (₹, ≤ 0). */
  drawdown: number;
  /** Drop from the running peak as a % of that peak (≤ 0). */
  drawdownPct: number;
  /** A position was open at this close. */
  inTrade: boolean;
}

export interface BacktestStats {
  trades: number;
  wins: number;
  losses: number;
  /** 0–100 (NaN with no trades). */
  winRate: number;
  netPnl: number;
  grossPnl: number;
  charges: number;
  avgWin: number;
  avgLoss: number;
  /** Average net P&L per trade. */
  expectancy: number;
  /** Gross profit of winners ÷ gross loss of losers (net of charges). Infinity with no losers. */
  profitFactor: number;
  /** avgWin ÷ |avgLoss|. */
  payoffRatio: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  /** Largest peak-to-trough fall of the daily equity curve (₹, positive). */
  maxDrawdown: number;
  /** As a % of the peak (positive). */
  maxDrawdownPct: number;
  /** Net P&L ÷ capital × 100. */
  returnPct: number;
  /** Annualised return on capital (compounded), NaN for under a month of data. */
  cagrPct: number;
  /** Annualised Sharpe of daily equity changes (risk-free 0), NaN with too few days. */
  sharpe: number;
  avgDaysHeld: number;
  best: number;
  worst: number;
  /** Net P&L ÷ |max drawdown|. */
  recoveryFactor: number;
  /** Days with an open position ÷ days in the test × 100. */
  exposurePct: number;
}

export interface SplitRow {
  key: string;
  label: string;
  hint?: string;
  trades: number;
  winRate: number;
  net: number;
  expectancy: number;
  profitFactor: number;
}

export interface SkipCounts {
  /** Entry days where the expiry (or the next one, for calendars) was missing from the data. */
  noChain: number;
  /** Entries dropped because a leg could not be priced at all. */
  noPrice: number;
  /** Entry signals skipped because a trade was already open. */
  busy: number;
}

export interface BacktestOutput {
  symbol: string;
  source: DatasetSource;
  templateId: string;
  templateName: string;
  config: BacktestConfig;
  trades: Trade[];
  equity: EquityPoint[];
  stats: BacktestStats;
  byVix: SplitRow[];
  byWeekday: SplitRow[];
  byReason: SplitRow[];
  skipped: SkipCounts;
  /** First and last day actually simulated, and the number of days. */
  range: { from: string; to: string; days: number };
  /** Lot sizes the traded expiries used, in order of first use. */
  lotSizes: Array<{ expiry: string; lotSize: number }>;
  /** Plain-language caveats from the run (missing expiry-day files, model-priced fills …). */
  warnings: string[];
}

export interface BacktestProgress {
  phase: "prepare" | "simulate" | "stats";
  done: number;
  total: number;
  trades: number;
}

/** What the worker needs: the config plus either a dataset or a request to generate the sample. */
export type BacktestData = { kind: "sample" } | { kind: "dataset"; dataset: EodDataset };

export interface BacktestInput {
  config: BacktestConfig;
  data: BacktestData;
}
