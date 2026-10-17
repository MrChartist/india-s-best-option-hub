/** Number formatting and copy shared by the OI, max pain and PCR screens. */
import { formatCompactIN } from "@/lib/options";

export const EDU_NOTE = "Data for education and research. Not investment advice.";

/** Compact Indian OI: 1.2K, 4.56L, 2.31Cr; "—" for NaN. */
export function fmtOI(v: number): string {
  return formatCompactIN(v);
}

/** Signed compact OI change: "+1.2L" / "−45.0K". */
export function fmtOIChange(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  return `${v > 0 ? "+" : ""}${formatCompactIN(v)}`;
}

/** Strike in Indian grouping without decimals. */
export function fmtStrike(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function fmtRatio(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return "—";
  return v.toFixed(dp);
}
