/** Formatting helpers for the Futures page (thin wrappers over "@/lib/options" formatters). */
import { formatCompactIN, formatDateIST, formatNumberIN } from "@/lib/options";

/** Price with Indian grouping and 2 decimals, or "—". */
export function fmtPrice(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? formatNumberIN(v, 2) : "—";
}

/** Contracts in compact Indian units (1.65L), or "—". */
export function fmtOi(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v)
    ? formatCompactIN(v, { decimals: Math.abs(v) >= 1e5 ? 2 : 1 })
    : "—";
}

/** "27 Oct" (drops the year). */
export function shortDate(iso: string): string {
  return formatDateIST(iso).replace(/\s\d{4}$/, "");
}
