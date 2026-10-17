/**
 * Shared types for the options math core.
 *
 * Units (internal): sigma is a decimal (0.14), T is in years, r and q are
 * decimals (0.065), prices are rupees per unit (not per lot). The NSE leg field
 * OptionLegData.iv is in PERCENT; convert at the edge with pctToDec / decToPct.
 */

export type OptionType = "CE" | "PE";
export type Side = "BUY" | "SELL";
export type Exchange = "NSE" | "BSE";

/** Spot-based Black-Scholes-Merton input (continuous dividend yield q). */
export interface PricingInput {
  S: number;
  K: number;
  T: number;
  r: number;
  q?: number;
  sigma: number;
  type: OptionType;
}

/** Forward-based Black-76 input. */
export interface Black76Input {
  F: number;
  K: number;
  T: number;
  r: number;
  sigma: number;
  type: OptionType;
}

/**
 * theta = rupees per CALENDAR day; thetaTrading = per trading day (theta*365/252);
 * vega and rho per 1 vol point / 1% rate; vanna per 1 vol point;
 * charm = delta change per calendar day; vomma = vega change per vol point.
 */
export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  thetaTrading: number;
  vega: number;
  rho: number;
  vanna: number;
  charm: number;
  vomma: number;
}

export interface Leg {
  id?: string;
  symbol: string;
  type: OptionType | "FUT";
  side: Side;
  strike: number;
  /** ISO yyyy-mm-dd */
  expiry: string;
  lots: number;
  lotSize: number;
  /** Entry price per unit (rupees). For FUT this is the entry futures price. */
  premium: number;
  /** decimal */
  iv?: number;
  enabled?: boolean;
}

export interface MarketParams {
  r: number;
  q: number;
  dayCount: "ACT365" | "TRADING252";
}

/** A closed spot interval; `to` may be Infinity. */
export interface Interval {
  from: number;
  to: number;
}

export const ZERO_GREEKS: Readonly<Greeks> = Object.freeze({
  delta: 0,
  gamma: 0,
  theta: 0,
  thetaTrading: 0,
  vega: 0,
  rho: 0,
  vanna: 0,
  charm: 0,
  vomma: 0,
});

export const NAN_GREEKS: Readonly<Greeks> = Object.freeze({
  delta: NaN,
  gamma: NaN,
  theta: NaN,
  thetaTrading: NaN,
  vega: NaN,
  rho: NaN,
  vanna: NaN,
  charm: NaN,
  vomma: NaN,
});

/** +1 for BUY, -1 for SELL. */
export function sideSign(side: Side): 1 | -1 {
  return side === "SELL" ? -1 : 1;
}

/** Leg is active unless explicitly disabled. */
export function isLegEnabled(leg: Leg): boolean {
  return leg.enabled !== false;
}

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
