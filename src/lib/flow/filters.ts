/** Tape filters and CSV export for derived flow prints (pure). */
import { formatTimeIST } from "@/lib/options";
import type { Aggressor, FlowPrint, Moneyness, PrintTag } from "./types";

export interface TapeFilters {
  symbol: string; // "ALL" or an underlying
  minPremium: number;
  type: "ALL" | "CE" | "PE";
  side: "ALL" | Aggressor;
  moneyness: "ALL" | Moneyness;
  expiry: string; // "ALL" or ISO date
  tag: "ALL" | PrintTag;
  /** Only contracts expiring today (0DTE). */
  dte0: boolean;
}

export const DEFAULT_TAPE_FILTERS: TapeFilters = { symbol: "ALL", minPremium: 0, type: "ALL", side: "ALL", moneyness: "ALL", expiry: "ALL", tag: "ALL", dte0: false };

export const MIN_PREMIUM_STEPS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Any" },
  { value: 1_00_000, label: "₹1L+" },
  { value: 5_00_000, label: "₹5L+" },
  { value: 10_00_000, label: "₹10L+" },
  { value: 25_00_000, label: "₹25L+" },
  { value: 1_00_00_000, label: "₹1Cr+" },
];

export function filterPrints(prints: FlowPrint[], f: TapeFilters): FlowPrint[] {
  return (prints ?? []).filter(
    (p) =>
      (f.symbol === "ALL" || p.symbol === f.symbol) &&
      p.premium >= (f.minPremium || 0) &&
      (f.type === "ALL" || p.type === f.type) &&
      (f.side === "ALL" || p.aggressor === f.side) &&
      (f.moneyness === "ALL" || p.moneyness === f.moneyness) &&
      (f.expiry === "ALL" || p.expiry === f.expiry) &&
      (f.tag === "ALL" || p.tag === f.tag) &&
      (!f.dte0 || p.dte === 0),
  );
}

export function activeFilterCount(f: TapeFilters): number {
  let n = 0;
  for (const k of Object.keys(DEFAULT_TAPE_FILTERS) as Array<keyof TapeFilters>) if (f[k] !== DEFAULT_TAPE_FILTERS[k]) n++;
  return n;
}

export const PRINTS_CSV_HEADER = "time_ist,symbol,expiry,strike,type,side,side_basis,contracts,premium_inr,ltp,bid,ask,oi_change,tag,dte,moneyness,spot,interval_s";

export function printsToCSV(prints: FlowPrint[]): string {
  const lines = [PRINTS_CSV_HEADER];
  for (const p of prints ?? []) {
    lines.push(
      [
        formatTimeIST(p.ts, { seconds: true }).replace(" IST", ""),
        p.symbol,
        p.expiry,
        p.strike,
        p.type,
        p.aggressor,
        p.aggressorBasis,
        p.dVol,
        Math.round(p.premium),
        p.ltp,
        p.bid,
        p.ask,
        p.dOI,
        p.tag,
        p.dte,
        p.moneyness,
        p.spot,
        Math.round((p.ts - p.fromTs) / 1000),
      ].join(","),
    );
  }
  return lines.join("\n");
}
