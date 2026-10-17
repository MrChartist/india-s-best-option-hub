/** Display helpers for volatility values (percent units). */
import { formatPct } from "@/lib/options";

/** IV / HV in percent with one decimal ("14.2%"), or an em dash. */
export function fmtVol(v: number | null | undefined, decimals = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : formatPct(v, { decimals });
}

/** Signed vol points ("+1.2 pts", "−0.4 pts"), or an em dash. */
export function fmtVolPts(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const r = Math.round(v * 10 ** decimals) / 10 ** decimals;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(decimals)} pts`;
}

/** Upper-case, trimmed, and limited to characters NSE symbols use. "" when invalid. */
export function sanitizeSymbol(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9&-]{1,20}$/.test(s) ? s : "";
}
