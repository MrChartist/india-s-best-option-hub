import { formatCrore, MINUS } from "@/lib/options";

export { crDecimals, formatCrCell } from "@/lib/gex";

/**
 * Format a value already in ₹ crore, always in crore so every GEX number reads in one unit:
 * 1234.5 → "₹1,235 Cr", −0.42 → "−₹0.42 Cr", 0.004 → "<₹0.01 Cr".
 */
export function fmtCr(v: number, o?: { signed?: boolean }): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a > 0 && a < 0.005) return `${v < 0 ? MINUS : o?.signed ? "+" : ""}<₹0.01 Cr`;
  return formatCrore(v, { signed: o?.signed });
}

export function fmtLevel(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-IN");
}

export function pctFrom(level: number | null | undefined, spot: number): string {
  if (level === null || level === undefined || !Number.isFinite(level) || !(spot > 0)) return "";
  const p = ((level - spot) / spot) * 100;
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return `${sign}${Math.abs(p).toFixed(2)}%`;
}

export const EDU_NOTE = "Data for education and research. Not investment advice.";
