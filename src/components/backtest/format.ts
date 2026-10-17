/** Display helpers for backtest results (Indian formatting from @/lib/options). */
import { DASH, formatCompactIN, formatINR, formatNumberIN, formatPct } from "@/lib/options";

/** "+₹12,345" / "−₹4,210" (whole rupees). */
export function signedINR(v: number): string {
  if (!Number.isFinite(v)) return DASH;
  const s = formatINR(v, { decimals: 0 });
  return v > 0 ? `+${s}` : s;
}

/** "+₹1.25L" style for tiles. */
export function signedCompact(v: number): string {
  if (!Number.isFinite(v)) return DASH;
  const s = formatCompactIN(v, { symbol: true });
  return v > 0 ? `+${s}` : s;
}

export function ratio(v: number, dp = 2): string {
  if (v === Infinity) return "∞";
  return Number.isFinite(v) ? formatNumberIN(v, dp, { minDecimals: dp }) : DASH;
}

export function pct(v: number, dp = 1, signed = false): string {
  return formatPct(v, { decimals: dp, signed });
}

/** Text tone class for a signed value. */
export function tone(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "text-foreground";
  return v > 0 ? "text-bullish" : "text-bearish";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct '25" axis tick from an ISO date. */
export function monthTick(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${MONTHS[+m[2] - 1]} '${m[1].slice(2)}` : "";
}

/** "7 Oct" from an ISO date (compact table cell). */
export function dayMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : "";
}
