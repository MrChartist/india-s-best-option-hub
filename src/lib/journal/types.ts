/**
 * Trade journal data model.
 *
 * A broker tradebook (or the paper account) becomes a list of executed fills. Fills are matched FIFO per
 * contract into round trips; each round trip carries gross P&L, charges from the shared charges table
 * ("@/lib/options" calcCharges), net P&L and the context used for edge analytics (strategy, DTE at
 * entry, weekday and time of day in IST).
 */
import type { Exchange, OptionType, Side } from "@/lib/options";

export type JournalSource = "zerodha" | "dhan" | "upstox" | "angel" | "paper" | "sample";

export const SOURCE_LABEL: Record<JournalSource, string> = {
  zerodha: "Zerodha",
  dhan: "Dhan",
  upstox: "Upstox",
  angel: "Angel One",
  paper: "Paper account",
  sample: "Sample tradebook",
};

export type InstrumentType = OptionType | "FUT";

export interface ParsedContract {
  /** Underlying, upper case (NIFTY, RELIANCE, ...). */
  underlying: string;
  /** ISO yyyy-mm-dd. */
  expiry: string;
  /** 0 for futures. */
  strike: number;
  type: InstrumentType;
}

export interface JournalFill extends ParsedContract {
  /** Stable id: broker trade id when present, else a hash of the row. */
  id: string;
  source: JournalSource;
  /** Exchange order id; fills sharing it are one order for brokerage. */
  orderId?: string;
  side: Side;
  /** Units (not lots). */
  qty: number;
  /** Price per unit (₹). */
  price: number;
  /** IST trade date, ISO. */
  date: string;
  /** Epoch ms of the execution; null when the tradebook has no time. */
  ts: number | null;
  exchange: Exchange;
  /** Paper-trade expiry settlements: no order, charges are exercise STT only. */
  settlement?: boolean;
  /** Charges already known for this fill (paper trades), used instead of recomputing. */
  knownCharges?: number;
  /** Raw instrument label from the file, for display. */
  label?: string;
}

export interface ParseIssue {
  /** 1-based line number in the file. */
  line: number;
  message: string;
}

export interface ParseResult {
  source: JournalSource;
  fills: JournalFill[];
  issues: ParseIssue[];
  /** Data rows read (excluding the header). */
  rows: number;
}

export interface RoundTrip extends ParsedContract {
  /** Stable id: contract + first entry fill id + slice index. */
  id: string;
  source: JournalSource;
  direction: "LONG" | "SHORT";
  qty: number;
  entryDate: string;
  entryTs: number | null;
  exitDate: string;
  exitTs: number | null;
  entryPrice: number;
  exitPrice: number;
  gross: number;
  charges: number;
  net: number;
  /** Calendar days from entry to expiry. */
  dte: number;
  /** Exit was an assumed expiry at ₹0 (the tradebook has no closing trade for an expired contract). */
  assumedExpiry: boolean;
  /** Exit came from a paper-account expiry settlement. */
  settled: boolean;
  /** Auto-detected structure of the legs opened together (e.g. "Short strangle"). */
  strategy: string;
  /** Legs opened together share this group id. */
  groupId: string;
}

export interface OpenLot extends ParsedContract {
  source: JournalSource;
  direction: "LONG" | "SHORT";
  qty: number;
  price: number;
  date: string;
}

export interface Annotation {
  tags: string[];
  note: string;
}
