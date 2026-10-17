/**
 * Strategy Optimizer: shared types.
 *
 * Units follow "@/lib/options": prices are rupees per unit, IV is a DECIMAL (0.142), money values
 * for a whole position are rupees with lots × lotSize applied. All inputs are plain data so they can
 * be posted to a Web Worker.
 */
import type { OptionData } from "@/lib/mockData";
import type { OptionType, Side } from "@/lib/options";

export type StrategyKind =
  | "long_call"
  | "long_put"
  | "bull_call_spread"
  | "bear_call_spread"
  | "bull_put_spread"
  | "bear_put_spread"
  | "iron_condor"
  | "iron_fly"
  | "short_strangle"
  | "short_straddle"
  | "call_calendar"
  | "put_calendar"
  | "call_diagonal"
  | "put_diagonal"
  | "call_ratio_spread"
  | "put_ratio_spread"
  | "call_bwb"
  | "put_bwb"
  | "jade_lizard";

export type StrategyCategory = "single" | "vertical" | "condor_fly" | "straddle_strangle" | "calendar_diagonal" | "ratio_butterfly";

export type StrategyBias = "bullish" | "bearish" | "neutral" | "volatile";

export interface KindMeta {
  label: string;
  category: StrategyCategory;
  bias: StrategyBias;
  /** Structurally defined risk (every short leg covered by a long leg of the same type). */
  definedRisk: boolean;
  /** Needs a second (later) expiry. */
  multiExpiry: boolean;
}

export const KIND_META: Record<StrategyKind, KindMeta> = {
  long_call: { label: "Long call", category: "single", bias: "bullish", definedRisk: true, multiExpiry: false },
  long_put: { label: "Long put", category: "single", bias: "bearish", definedRisk: true, multiExpiry: false },
  bull_call_spread: { label: "Bull call spread", category: "vertical", bias: "bullish", definedRisk: true, multiExpiry: false },
  bear_call_spread: { label: "Bear call spread", category: "vertical", bias: "bearish", definedRisk: true, multiExpiry: false },
  bull_put_spread: { label: "Bull put spread", category: "vertical", bias: "bullish", definedRisk: true, multiExpiry: false },
  bear_put_spread: { label: "Bear put spread", category: "vertical", bias: "bearish", definedRisk: true, multiExpiry: false },
  iron_condor: { label: "Iron condor", category: "condor_fly", bias: "neutral", definedRisk: true, multiExpiry: false },
  iron_fly: { label: "Iron fly", category: "condor_fly", bias: "neutral", definedRisk: true, multiExpiry: false },
  short_strangle: { label: "Short strangle", category: "straddle_strangle", bias: "neutral", definedRisk: false, multiExpiry: false },
  short_straddle: { label: "Short straddle", category: "straddle_strangle", bias: "neutral", definedRisk: false, multiExpiry: false },
  call_calendar: { label: "Call calendar", category: "calendar_diagonal", bias: "neutral", definedRisk: true, multiExpiry: true },
  put_calendar: { label: "Put calendar", category: "calendar_diagonal", bias: "neutral", definedRisk: true, multiExpiry: true },
  call_diagonal: { label: "Call diagonal", category: "calendar_diagonal", bias: "bullish", definedRisk: true, multiExpiry: true },
  put_diagonal: { label: "Put diagonal", category: "calendar_diagonal", bias: "bearish", definedRisk: true, multiExpiry: true },
  call_ratio_spread: { label: "Call ratio spread", category: "ratio_butterfly", bias: "bullish", definedRisk: false, multiExpiry: false },
  put_ratio_spread: { label: "Put ratio spread", category: "ratio_butterfly", bias: "bearish", definedRisk: false, multiExpiry: false },
  call_bwb: { label: "Broken-wing call butterfly", category: "ratio_butterfly", bias: "bullish", definedRisk: true, multiExpiry: false },
  put_bwb: { label: "Broken-wing put butterfly", category: "ratio_butterfly", bias: "bearish", definedRisk: true, multiExpiry: false },
  jade_lizard: { label: "Jade lizard", category: "ratio_butterfly", bias: "bullish", definedRisk: false, multiExpiry: false },
};

export const ALL_KINDS = Object.keys(KIND_META) as StrategyKind[];

export const CATEGORY_ORDER: StrategyCategory[] = ["single", "vertical", "condor_fly", "straddle_strangle", "calendar_diagonal", "ratio_butterfly"];

export const CATEGORY_LABELS: Record<StrategyCategory, string> = {
  single: "Calls & puts",
  vertical: "Vertical spreads",
  condor_fly: "Condors & flies",
  straddle_strangle: "Straddles & strangles",
  calendar_diagonal: "Calendars & diagonals",
  ratio_butterfly: "Ratios & butterflies",
};

export type Pricing = "mid" | "natural";

export interface CandidateLeg {
  type: OptionType;
  side: Side;
  strike: number;
  expiry: string;
  /** Lots per one unit of the strategy (2 for the short leg of a 1×2 ratio). */
  ratio: number;
  /** Fill price used for scoring (mid or natural), rupees per unit. */
  premium: number;
  /** Decimal IV from the chain, or null when unknown (back-solved later). */
  iv: number | null;
  oi: number;
  /** (ask − bid) / mid, or null without a two-sided quote. */
  spreadPct: number | null;
  /** True when no two-sided quote existed and LTP was used. */
  noQuote: boolean;
}

export interface Candidate {
  id: string;
  kind: StrategyKind;
  category: StrategyCategory;
  legs: CandidateLeg[];
}

export interface OptimizerSettings {
  targetPrice: number;
  /** ISO yyyy-mm-dd (IST). Clamped to [today, front expiry]. */
  targetDate: string;
  /** Rupees of capital (estimated margin) available. */
  budget: number;
  maxLots: number;
  definedRiskOnly: boolean;
  /** Strikes either side of ATM to use for the short/centre legs. */
  strikesAroundAtm: number;
  /** Minimum OI as a fraction of the chain's largest OI (0.03 = 3%). */
  minOiPct: number;
  /** Maximum bid/ask spread as a fraction of mid (0.08 = 8%). */
  maxSpreadPct: number;
  /** Minimum premium per leg in rupees. */
  minPremium: number;
  pricing: Pricing;
  /** Strategy kinds to scan; null or empty = all. */
  kinds: StrategyKind[] | null;
}

export interface OptimizerChain {
  expiry: string;
  chain: OptionData[];
}

export interface OptimizerInput extends OptimizerSettings {
  symbol: string;
  spot: number;
  lotSize: number;
  front: OptimizerChain;
  /** Next expiry, for calendars and diagonals. */
  back?: OptimizerChain | null;
  /** Epoch ms used as "now" (keeps worker and main thread consistent). */
  nowMs: number;
  /** Risk-free rate (decimal). */
  r: number;
}

export interface ScoredCandidate extends Candidate {
  label: string;
  lots: number;
  lotSize: number;
  /** Gross P&L at the target price and date (rupees). */
  profitAtTarget: number;
  /** Round-trip charges estimate (rupees). */
  charges: number;
  /** profitAtTarget − charges. */
  netProfit: number;
  /** Estimated margin / capital required (rupees). */
  capital: number;
  /** netProfit / capital. */
  roi: number;
  /** Probability of profit (0..1) at the target date. */
  pop: number;
  maxProfit: number;
  /** ≤ 0. */
  maxLoss: number;
  unlimitedProfit: boolean;
  unlimitedLoss: boolean;
  /** Max profit/loss read off a price grid (calendars and diagonals). */
  maxIsEstimate: boolean;
  /** + credit received, − debit paid (rupees). */
  netPremium: number;
  breakevens: number[];
  definedRisk: boolean;
  hedgeBenefit: number;
  /** At least one leg had no two-sided quote. */
  quoteWarning: boolean;
}

export interface RankedCandidate extends ScoredCandidate {
  roiNorm: number;
  utility: number;
  rank: number;
}

export interface OptimizerStats {
  enumerated: number;
  liquidityRejected: number;
  riskSkipped: number;
  overBudget: number;
  unprofitable: number;
  feasible: number;
  durationMs: number;
  /** Calendars/diagonals were skipped (no usable second expiry). */
  multiExpirySkipped: boolean;
}

export interface OptimizerContext {
  /** Forward to the front expiry. */
  forward: number;
  /** ATM IV, decimal. */
  atmIv: number;
  /** Years to the front expiry. */
  tExpiry: number;
  /** Years to the target date. */
  tTarget: number;
  /** Epoch ms of the valuation instant (target date, 15:30 IST, or now). */
  atDateMs: number;
  atExpiry: boolean;
  /** 1σ range to the target date. */
  lower: number;
  upper: number;
}

export interface OptimizerOutput {
  results: ScoredCandidate[];
  stats: OptimizerStats;
  context: OptimizerContext;
}

export interface OptimizerProgress {
  done: number;
  total: number;
  phase: "enumerate" | "score";
}
