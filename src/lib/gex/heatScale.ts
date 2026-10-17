/**
 * Heatmap cell formatting and colour-ramp choice for exposure grids.
 *
 * One unit per grid (₹ Cr for GEX / DEX), with decimals fixed by the largest |value| so every
 * cell lines up, and "<0.1" for values too small to read at that precision.
 */

export type HeatRamp = "sequential" | "diverging";

/** Smallest |value| (₹ Cr) printed as a number; anything below reads "<0.1". */
export const TINY_CR = 0.1;

/** Decimals for every cell in a ₹ Cr grid: 0 at or above 100 Cr, else 1. */
export function crDecimals(maxAbs: number): number {
  return Number.isFinite(maxAbs) && Math.abs(maxAbs) >= 100 ? 0 : 1;
}

const MINUS = "−";

/**
 * Cell text in ₹ Cr without the unit (the unit lives in the header): 1234.5 → "1,235",
 * −2.34 → "−2.3", 0.04 → "<0.1". Non-finite values return "".
 */
export function formatCrCell(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a < TINY_CR) return `<${TINY_CR}`;
  // With 0 dp a value under 1 Cr would read "0" or "1"; keep one decimal there.
  const dp = decimals === 0 && a < 1 ? 1 : Math.max(0, Math.min(2, Math.round(decimals)));
  const body = a.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v < 0 ? `${MINUS}${body}` : body;
}

/**
 * Sequential ramp when every finite, non-zero value shares one sign (e.g. the seller view, where
 * all GEX is negative); diverging when both signs are present.
 */
export function heatRamp(values: Iterable<number>): HeatRamp {
  let pos = false;
  let neg = false;
  for (const v of values) {
    if (!Number.isFinite(v) || v === 0) continue;
    if (v > 0) pos = true;
    else neg = true;
    if (pos && neg) return "diverging";
  }
  return "sequential";
}

/** Flatten a strike × expiry matrix for heatRamp / max lookups. */
export function flatValues(matrix: number[][]): number[] {
  const out: number[] = [];
  for (const row of matrix ?? []) for (const v of row ?? []) out.push(v);
  return out;
}
