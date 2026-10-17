import { formatCompactIN } from "@/lib/options";

/** Format a value already in ₹ crore: 1234.5 → "₹1,235Cr", −0.42 → "−₹42.00L". */
export function fmtCr(v: number, o?: { signed?: boolean }): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const txt = formatCompactIN(v * 1e7, { symbol: true, decimals: a >= 1000 ? 0 : a >= 10 ? 1 : 2 });
  return o?.signed && v > 0 ? `+${txt}` : txt;
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
