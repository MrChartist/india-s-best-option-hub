/**
 * Indian number and time formatting. Cached Intl.NumberFormat("en-IN") instances,
 * lakh/crore grouping, U+2212 minus sign, "—" for missing values.
 */
import type { Greeks } from "./types";

export const MINUS = "−";
export const DASH = "—";

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}|${max}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-IN", { minimumFractionDigits: min, maximumFractionDigits: max });
    nfCache.set(key, f);
  }
  return f;
}

function bad(v: unknown): boolean {
  return typeof v !== "number" || !Number.isFinite(v);
}

function clampDp(d: number | undefined, dflt: number): number {
  return typeof d === "number" && Number.isFinite(d) ? Math.min(Math.max(Math.round(d), 0), 6) : dflt;
}

/** Round half away from zero at `dp` decimals, avoiding "-0". */
function roundTo(v: number, dp: number): number {
  const m = 10 ** dp;
  const r = Math.round(Math.abs(v) * m + 1e-9) / m;
  return v < 0 ? -r : r;
}

function signPrefix(v: number, signed: boolean): string {
  if (v < 0) return MINUS;
  if (signed && v > 0) return "+";
  return "";
}

/** Plain Indian-grouped number, e.g. 1,23,456.5 (U+2212 minus). */
export function formatNumberIN(v: number, decimals = 0, o?: { minDecimals?: number }): string {
  if (bad(v)) return DASH;
  const dp = clampDp(decimals, 0);
  const r = roundTo(v, dp);
  const body = nf(Math.min(o?.minDecimals ?? dp, dp), dp).format(Math.abs(r));
  return (r < 0 ? MINUS : "") + body;
}

/** "₹1,23,456.50"; NaN/null → "—". Default 2 decimals. */
export function formatINR(v: number, o?: { decimals?: number; symbol?: boolean }): string {
  if (bad(v)) return DASH;
  const dp = clampDp(o?.decimals, 2);
  const r = roundTo(v, dp);
  const sym = o?.symbol === false ? "" : "₹";
  return `${r < 0 ? MINUS : ""}${sym}${nf(dp, dp).format(Math.abs(r))}`;
}

/**
 * Default decimals for a value already in crore: 0 at or above 1,000 Cr, 1 from 100 Cr, 2 below
 * 100 Cr. Thousands of crore with paise-level precision ("67,297.69Cr") is noise.
 */
function croreDp(crore: number): number {
  const a = Math.abs(crore);
  if (a >= 1000) return 0;
  if (a >= 100) return 1;
  return 2;
}

/**
 * The one formatter for crore amounts. `crore` is already in crore units: "₹67,298 Cr",
 * "₹512.4 Cr", "₹23.10 Cr" → trailing zeros trimmed ("₹23.1 Cr"). A space always separates the
 * unit, matching how Indian finance copy reads.
 */
export function formatCrore(crore: number, o?: { decimals?: number; symbol?: boolean; signed?: boolean }): string {
  if (bad(crore)) return DASH;
  const dp = clampDp(o?.decimals, croreDp(crore));
  const r = roundTo(crore, dp);
  const sym = o?.symbol === false ? "" : "₹";
  return `${signPrefix(r, !!o?.signed)}${sym}${nf(0, dp).format(Math.abs(r))} Cr`;
}

/**
 * Compact Indian units: "950", "1.2K", "4.56L", "2.31 Cr", "67,298 Cr", "1.2 L Cr".
 * Crore tiers follow formatCrore (space before the unit, 0 dp at or above 1,000 Cr).
 */
export function formatCompactIN(v: number, o?: { decimals?: number; symbol?: boolean }): string {
  if (bad(v)) return DASH;
  const sym = o?.symbol ? "₹" : "";
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : "";
  const tiers: Array<{ div: number; suffix: string; dp: (scaled: number) => number }> = [
    { div: 1e12, suffix: " L Cr", dp: () => 2 },
    { div: 1e7, suffix: " Cr", dp: croreDp },
    { div: 1e5, suffix: "L", dp: () => 2 },
    { div: 1e3, suffix: "K", dp: () => 1 },
  ];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (a >= t.div) {
      let dp = clampDp(o?.decimals, t.dp(a / t.div));
      let scaled = roundTo(a / t.div, dp);
      let suffix = t.suffix;
      // 99,999.9 must not render as "100.0K": promote to the next tier when rounding overflows
      const up = i > 0 ? tiers[i - 1] : undefined;
      if (up && scaled * t.div >= up.div) {
        dp = clampDp(o?.decimals, up.dp(a / up.div));
        scaled = roundTo(a / up.div, dp);
        suffix = up.suffix;
      }
      return `${sign}${sym}${nf(0, dp).format(scaled)}${suffix}`;
    }
  }
  const dp = clampDp(o?.decimals, 0);
  return `${sign}${sym}${nf(0, dp).format(roundTo(a, dp))}`;
}

/** One compact unit shared by every tick on an axis. Upper-case K / L / Cr, matching formatCompactIN. */
export interface CompactAxisUnit {
  div: number;
  suffix: "" | "K" | "L" | "Cr";
  /** Maximum decimals for a tick in this unit (trailing zeros are trimmed). */
  dp: number;
}

/** The unit for an axis whose largest |tick| is `maxAbs`: Cr from 1 crore, L from 1 lakh, K from 1,000. */
export function compactAxisUnit(maxAbs: number): CompactAxisUnit {
  const a = bad(maxAbs) ? 0 : Math.abs(maxAbs);
  const tiers: Array<{ div: number; suffix: CompactAxisUnit["suffix"] }> = [
    { div: 1e7, suffix: "Cr" },
    { div: 1e5, suffix: "L" },
    { div: 1e3, suffix: "K" },
  ];
  const t = tiers.find((x) => a >= x.div) ?? { div: 1, suffix: "" as const };
  const scaled = a / t.div;
  // Enough decimals that the smaller ticks stay distinct: 2.2L / 1.65L / 1.1L / 0.55L.
  const dp = t.div === 1 ? (a >= 100 ? 0 : a >= 1 ? 1 : 2) : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return { div: t.div, suffix: t.suffix, dp };
}

/** Format one tick in a fixed unit ("1.65L", "0.55L", "−75K", "0"); typographic minus, no space. */
export function formatCompactInUnit(v: number, unit: CompactAxisUnit): string {
  if (bad(v)) return "";
  if (v === 0) return "0";
  const r = roundTo(v / unit.div, unit.dp);
  if (r === 0) return "0";
  return `${r < 0 ? MINUS : ""}${nf(0, unit.dp).format(Math.abs(r))}${unit.suffix}`;
}

/**
 * Shared-unit axis formatter: every tick on the axis uses the unit picked from the axis extent, so
 * an OI axis reads "2.2L, 1.65L, 1.1L, 0.55L" rather than mixing "1.1L" with "55K". Pass the largest
 * |value| (or the domain bounds) on the axis.
 */
export function compactAxisFormatter(...extent: number[]): (v: number) => string {
  const maxAbs = extent.reduce((m, x) => (bad(x) ? m : Math.max(m, Math.abs(x))), 0);
  const unit = compactAxisUnit(maxAbs);
  return (v: number) => formatCompactInUnit(v, unit);
}

/** "12.34%" / "+1.20%" / "−0.50%". v is already in percent units. */
export function formatPct(v: number, o?: { decimals?: number; signed?: boolean }): string {
  if (bad(v)) return DASH;
  const dp = clampDp(o?.decimals, 2);
  const r = roundTo(v, dp);
  return `${signPrefix(r, !!o?.signed)}${nf(dp, dp).format(Math.abs(r))}%`;
}

/** "+1,234.50" / "−12.00" / "0.00". */
export function formatSigned(v: number, decimals = 2): string {
  if (bad(v)) return DASH;
  const dp = clampDp(decimals, 2);
  const r = roundTo(v, dp);
  return `${signPrefix(r, true)}${nf(dp, dp).format(Math.abs(r))}`;
}

/** Index points with sign, e.g. "+125.40 pts". */
export function formatPoints(v: number, decimals = 2): string {
  if (bad(v)) return DASH;
  return `${formatSigned(v, decimals)} pts`;
}

/** Open interest in compact Indian units; unit "qty" multiplies contracts by lotSize. */
export function formatOI(contracts: number, o?: { unit?: "contracts" | "qty"; lotSize?: number }): string {
  if (bad(contracts)) return DASH;
  const n = o?.unit === "qty" && o.lotSize && o.lotSize > 0 ? contracts * o.lotSize : contracts;
  return formatCompactIN(n);
}

const GREEK_DP: Record<keyof Greeks, number> = {
  delta: 3,
  gamma: 5,
  theta: 2,
  thetaTrading: 2,
  vega: 2,
  rho: 2,
  vanna: 4,
  charm: 4,
  vomma: 4,
};

/** Greek with sensible precision (delta 3 dp, gamma 5 dp, theta/vega/rho 2 dp). */
export function formatGreek(kind: keyof Greeks, v: number): string {
  if (bad(v)) return DASH;
  const dp = GREEK_DP[kind] ?? 2;
  const r = roundTo(v, dp);
  return `${r < 0 ? MINUS : ""}${nf(dp, dp).format(Math.abs(r))}`;
}

/** Strike with Indian grouping; keeps decimals only when present ("24,500", "112.5"). */
export function formatStrike(v: number): string {
  if (bad(v)) return DASH;
  return formatNumberIN(v, Number.isInteger(v) ? 0 : 2, { minDecimals: 0 });
}

let timeFmt: Intl.DateTimeFormat | null = null;
let timeFmtSec: Intl.DateTimeFormat | null = null;
let dateFmt: Intl.DateTimeFormat | null = null;

function toDate(d: Date | number | string | undefined): Date | null {
  if (d === undefined) return new Date();
  if (typeof d === "string") {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00+05:30` : d;
    const x = new Date(iso);
    return Number.isFinite(x.getTime()) ? x : null;
  }
  const x = d instanceof Date ? d : new Date(d);
  return Number.isFinite(x.getTime()) ? x : null;
}

/** "14:32 IST" (24-hour). */
export function formatTimeIST(d?: Date | number, o?: { seconds?: boolean }): string {
  const x = toDate(d);
  if (!x) return DASH;
  let f: Intl.DateTimeFormat;
  if (o?.seconds) {
    f = timeFmtSec ??= new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } else {
    f = timeFmt ??= new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  return `${f.format(x)} IST`;
}

/** "20 Oct 2026" in IST. ISO dates (yyyy-mm-dd) are treated as IST calendar dates. */
export function formatDateIST(d: Date | number | string): string {
  const x = toDate(d);
  if (!x) return DASH;
  dateFmt ??= new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  return dateFmt.format(x).replace("Sept", "Sep");
}

/** English ordinal for an integer: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 102nd. Non-integers round; "—" when not finite. */
export function ordinal(n: number): string {
  if (bad(n)) return DASH;
  const i = Math.round(n);
  const abs = Math.abs(i);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${i < 0 ? MINUS : ""}${abs}${suffix}`;
}
