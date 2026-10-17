/** Formatting helpers and series colours for the participants views. */
import { chartColors } from "@/lib/chartTheme";
import { formatCompactIN, formatDateIST, formatNumberIN, formatPct } from "@/lib/options";
import type { Participant } from "@/lib/participantsApi";

export const MINUS = "−";

/** Series colours per participant (CSS-variable tokens, so both themes work). */
export const PARTICIPANT_COLOR: Record<Participant, string> = {
  FII: chartColors.fii,
  DII: chartColors.dii,
  Pro: chartColors.c4,
  Client: chartColors.c1,
};

/** Contracts in compact Indian units, e.g. "1.85L"; signed adds "+". */
export function fmtContracts(v: number, signed = false): string {
  if (!Number.isFinite(v)) return "—";
  const body = formatCompactIN(v, { decimals: Math.abs(v) >= 1e5 ? 2 : 1 });
  return signed && v > 0 ? `+${body}` : body;
}

/** Full contract count with Indian grouping. */
export function fmtContractsFull(v: number, signed = false): string {
  if (!Number.isFinite(v)) return "—";
  const body = formatNumberIN(v, 0);
  return signed && v > 0 ? `+${body}` : body;
}

/** ₹ crore value, e.g. "+₹1,234 Cr". */
export function fmtCrore(v: number, o?: { signed?: boolean; decimals?: number }): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? MINUS : o?.signed && v > 0 ? "+" : "";
  return `${sign}₹${formatNumberIN(Math.abs(v), o?.decimals ?? 0)} Cr`;
}

export function fmtPct(v: number, decimals = 1, signed = false): string {
  return formatPct(v, { decimals, signed });
}

export function fmtRatio(v: number): string {
  if (v === Infinity) return "∞";
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

/** Text tone class for a signed number. */
export function toneClass(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "text-muted-foreground";
  return v > 0 ? "text-bullish" : "text-bearish";
}

export function arrow(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "";
  return v > 0 ? "▲" : "▼";
}

export function shortDate(iso: string): string {
  const full = formatDateIST(iso);
  return full.replace(/\s\d{4}$/, "");
}
