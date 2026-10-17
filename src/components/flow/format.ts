/** Display helpers for the flow components (thin wrappers over @/lib/options formatting). */
import { formatCompactIN, formatTimeIST, MINUS } from "@/lib/options";

/** "₹12.4L" / "−₹3.1Cr" */
export function fmtRs(v: number, signed = false): string {
  if (!Number.isFinite(v)) return "—";
  const body = formatCompactIN(Math.abs(v), { symbol: true });
  if (v < 0) return `${MINUS}${body}`;
  return signed && v > 0 ? `+${body}` : body;
}

/** "14:32" (IST, no suffix) for chart ticks and dense tables. */
export function hhmm(ts: number, seconds = false): string {
  return formatTimeIST(ts, { seconds }).replace(" IST", "");
}

export function signClass(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "text-muted-foreground";
  return v > 0 ? "text-bullish" : "text-bearish";
}
