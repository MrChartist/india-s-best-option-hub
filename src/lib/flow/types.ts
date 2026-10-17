/**
 * Shared types for derived options flow.
 *
 * NSE does not publish trade-level (tick) data for options. Everything in src/lib/flow is
 * DERIVED from successive option-chain snapshots: the change in cumulative volume and OI between
 * two polls of the same chain. A "print" here is an interval aggregate, not a single trade.
 */
import type { OptionType } from "@/lib/options";

export type Aggressor = "ASK" | "BID" | "MID";
export type PrintTag = "OPENING" | "CLOSING" | "UNKNOWN";
export type Moneyness = "ITM" | "ATM" | "OTM";

export interface FlowPrint {
  /** Stable key: symbol|expiry|strike|type|ts */
  id: string;
  /** Epoch ms of the later snapshot (end of the interval). */
  ts: number;
  /** Epoch ms of the earlier snapshot (start of the interval). */
  fromTs: number;
  symbol: string;
  /** ISO yyyy-mm-dd */
  expiry: string;
  strike: number;
  type: OptionType;
  /** Contracts traded in the interval (change in cumulative volume). */
  dVol: number;
  /** ₹ premium traded in the interval: dVol × ltp × lotSize. */
  premium: number;
  ltp: number;
  bid: number;
  ask: number;
  aggressor: Aggressor;
  /** How the aggressor was inferred: quote position, or tick test when there is no usable quote. */
  aggressorBasis: "quote" | "tick" | "none";
  /** Change in open interest over the interval (contracts). */
  dOI: number;
  tag: PrintTag;
  /** Calendar days from the print date (IST) to expiry; 0 on expiry day. */
  dte: number;
  moneyness: Moneyness;
  /** Underlying at the end of the interval. */
  spot: number;
  lotSize: number;
}

/** One point of a Premium Tide series (cumulative signed ₹ premium). */
export interface TidePoint {
  ts: number;
  /** Cumulative call premium: ask-side minus bid-side. */
  ce: number;
  /** Cumulative put premium: ask-side minus bid-side. */
  pe: number;
  /** ce − pe: positive when bullish premium dominates. */
  net: number;
  /** Underlying at the bucket close (undefined for a market aggregate). */
  spot?: number;
}
