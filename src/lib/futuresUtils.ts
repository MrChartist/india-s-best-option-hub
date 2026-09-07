// Real stock/index futures row shape (from the proxy's /api/dhan-proxy?endpoint=futures-quotes)
// plus the shared buildup-signal presentation used by both the Scanner page and the
// dashboard's MostActiveFnO widget, so identical signals always render identically.

export type BuildupSignal = "Long Buildup" | "Short Buildup" | "Short Covering" | "Long Unwinding" | "Neutral";

export interface FuturesQuoteRow {
  symbol: string;
  securityId: string;
  instrumentType: "FUTSTK" | "FUTIDX";
  expiryDate: string;
  lotSize: number;
  futuresLtp: number | null;
  priceChangePercent: number | null;
  oi: number | null;
  oiChangePercent: number | null;
  volume: number | null;
  buildupSignal: BuildupSignal;
  spotLtp: number | null;
  basis: number | null;
  basisPercent: number | null;
}

// Matches the interpretation coloring already established in MostActiveFnO.tsx —
// centralized here so the Scanner and the dashboard widget never drift apart.
export const BUILDUP_COLOR: Record<BuildupSignal, string> = {
  "Long Buildup": "text-bullish",
  "Short Covering": "text-bullish",
  "Short Buildup": "text-bearish",
  "Long Unwinding": "text-bearish",
  "Neutral": "text-muted-foreground",
};

export const BUILDUP_SIGNALS: BuildupSignal[] = [
  "Long Buildup", "Short Buildup", "Short Covering", "Long Unwinding", "Neutral",
];

// From /api/dhan-proxy?endpoint=rollover — near vs next month futures OI split.
export interface RolloverRow {
  symbol: string;
  instrumentType: "FUTSTK" | "FUTIDX";
  nearExpiry: string;
  nextExpiry: string;
  daysToNearExpiry: number;
  nearOI: number;
  nextOI: number;
  nearVolume: number | null;
  nextVolume: number | null;
  rolloverPercent: number;
}
