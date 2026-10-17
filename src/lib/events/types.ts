/**
 * Typed event model for the events calendar: macro releases, results, corporate actions,
 * expiries and exchange holidays, all keyed by an IST calendar date (yyyy-mm-dd).
 */

/** Filterable event families. */
export type EventKind = "results" | "corporate" | "india-macro" | "global-macro" | "expiry" | "holiday";

export const EVENT_KINDS: readonly EventKind[] = ["results", "india-macro", "global-macro", "expiry", "corporate", "holiday"];

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  results: "Results",
  corporate: "Corporate actions",
  "india-macro": "India macro",
  "global-macro": "Global macro",
  expiry: "Expiries",
  holiday: "Holidays & sessions",
};

/** Where an event came from. Everything except "nse" is static, computed or sample. */
export type EventSource =
  /** Hand-compiled schedule (RBI, Budget, MoSPI, Fed, BLS); always flagged `verify`. */
  | "schedule"
  /** Computed from the exchange calendar in @/lib/options (holidays, SEBI expiry rules). */
  | "exchange-calendar"
  /** NSE corporate event calendar through the local proxy. */
  | "nse"
  /** Illustrative sample dates, shown only when the proxy cannot answer. */
  | "sample";

export type EventImpact = "high" | "medium" | "low";

export type EventRegion = "IN" | "US";

export interface MarketEvent {
  /** Stable id: `${kind}:${date}:${slug}`. */
  id: string;
  /** IST calendar date, yyyy-mm-dd. */
  date: string;
  /** IST clock time "HH:MM" when known. */
  time?: string;
  kind: EventKind;
  /** Short sub-type, e.g. "RBI MPC", "CPI", "FOMC", "Monthly expiry", "Board meeting". */
  category: string;
  title: string;
  detail?: string;
  /** The underlying most affected (a stock for results, NIFTY for India macro, …). */
  symbol?: string;
  /** Other underlyings the event applies to (e.g. every index expiring on a monthly date). */
  symbols?: string[];
  /** Company name for corporate events. */
  company?: string;
  impact: EventImpact;
  region: EventRegion;
  source: EventSource;
  /** The date is compiled or estimated and should be checked against the official source. */
  verify?: boolean;
  /** Built from a provisional exchange list (e.g. 2027 holidays). */
  provisional?: boolean;
  /** The symbol has stock options on NSE. */
  fno?: boolean;
  /** Affects every underlying (macro releases, holidays, the NSE monthly expiry): kept when filtering by symbol. */
  marketWide?: boolean;
}

/** Raw row from the proxy's /api/x/event-calendar route. */
export interface NseEventCalendarRow {
  symbol: string;
  company: string;
  purpose: string;
  description: string;
  date: string;
}

export interface EventRange {
  /** Inclusive ISO date. */
  from: string;
  /** Inclusive ISO date. */
  to: string;
}
