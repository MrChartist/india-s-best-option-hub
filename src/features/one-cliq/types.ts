/** Types for the 1Cliq one-click execution terminal. */

import type { ExchangeSegment } from "@/lib/instrumentKeys";

export type OptionType = "CE" | "PE";
export type Side = "BUY" | "SELL";
export type OrderVariant = "MARKET" | "MARKET_PROTECT" | "LIMIT";
export type ProductType = "INTRADAY" | "MARGIN";

/** Whether a trigger distance is measured in spot points, premium, or percent. */
export type TriggerUnit = "SPOT_PTS" | "PREMIUM" | "PCT";

/** Everything in the instrument + execution control rows. Persisted per user. */
export interface TerminalConfig {
  exchange: "NSE" | "BSE" | "MCX";
  segment: "OPTIONS" | "FUTURES";
  symbol: string;
  expiry: string;
  callStrike: number;
  putStrike: number;
  lots: number;
  productType: ProductType;
  orderVariant: OrderVariant;
  /** Market-protection band: a market order sent as a limit at LTP ± this %. */
  protectionPct: number;
  slEnabled: boolean;
  slValue: number;
  slUnit: TriggerUnit;
  targetEnabled: boolean;
  targetValue: number;
  targetUnit: TriggerUnit;
}

/** A resolved, tradable option leg. */
export interface TerminalLeg {
  optionType: OptionType;
  strike: number;
  securityId?: string;
  exchangeSegment: ExchangeSegment;
  /** Absent until the instrument master resolves it — blocks live orders. */
  lotSize?: number;
}

/** Live quote for one instrument, as shown in the CE / spot / PE strip. */
export interface LegQuote {
  ltp: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  change: number | null;
  changePercent: number | null;
  /** ms since the last tick for this instrument; null when never seen. */
  ageMs: number | null;
  bid?: number | null;
  ask?: number | null;
}

/** What the terminal is about to do, before it does it. */
export interface OrderIntent {
  intentId: string;
  symbol: string;
  optionType: OptionType;
  strike: number;
  side: Side;
  lots: number;
  securityId?: string;
  exchangeSegment: ExchangeSegment;
  variant: OrderVariant;
  /** Reference price at the moment of intent — the fill model prices off this. */
  refPrice: number;
  bid?: number | null;
  ask?: number | null;
  expiry: string;
}

export type FillStatus = "FILLED" | "PARTIAL" | "REJECTED";

export interface FillResult {
  status: FillStatus;
  /** Lots actually filled. Below intent.lots means a partial. */
  lots: number;
  price: number;
  slippage: number;
  latencyMs: number;
  reason?: string;
}

/** One line in the terminal's message log — mirrors 1Cliq's "Message:" line. */
export interface TerminalMessage {
  id: string;
  at: number;
  tone: "info" | "success" | "warning" | "error";
  text: string;
}

export type ArmState = "SAFE" | "HOT";

/** Execution mode. PAPER runs the identical path with a simulated broker. */
export type ExecMode = "PAPER" | "LIVE";
