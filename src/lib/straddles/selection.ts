/**
 * Strike selection for the Straddles page: a rolling ATM straddle, a fixed strike, or a custom
 * CE/PE pair (strangles, skewed pairs). Round-trips through URL search params so a chart can be
 * shared.
 */
import { formatStrike } from "@/lib/options";
import type { StrikeMode } from "@/components/expiry/expiryMath";

export type StrikeSelection = { kind: "atm" } | { kind: "fixed"; strike: number } | { kind: "pair"; ce: number; pe: number };

const posNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 && n < 1e7 ? n : NaN;
};

/** Read a selection from search params (mode=atm|fixed|pair, strike, ce, pe). Invalid input falls back to ATM. */
export function parseSelection(get: (key: string) => string | null): StrikeSelection {
  const mode = (get("mode") || "").toLowerCase();
  if (mode === "fixed") {
    const strike = posNum(get("strike"));
    if (Number.isFinite(strike)) return { kind: "fixed", strike };
  }
  if (mode === "pair") {
    const ce = posNum(get("ce"));
    const pe = posNum(get("pe"));
    if (Number.isFinite(ce) && Number.isFinite(pe)) return { kind: "pair", ce, pe };
  }
  return { kind: "atm" };
}

/** Search-param values for a selection; null removes the key. */
export function selectionToParams(sel: StrikeSelection): Record<"mode" | "strike" | "ce" | "pe", string | null> {
  if (sel.kind === "fixed") return { mode: "fixed", strike: String(sel.strike), ce: null, pe: null };
  if (sel.kind === "pair") return { mode: "pair", strike: null, ce: String(sel.ce), pe: String(sel.pe) };
  return { mode: null, strike: null, ce: null, pe: null };
}

/** The expiry-math strike mode for a selection. */
export function toStrikeMode(sel: StrikeSelection): StrikeMode {
  if (sel.kind === "fixed") return { kind: "fixed", strike: sel.strike };
  if (sel.kind === "pair") return sel.ce === sel.pe ? { kind: "fixed", strike: sel.ce } : { kind: "pair", ce: sel.ce, pe: sel.pe };
  return { kind: "floating" };
}

/** CE and PE strikes for a selection, using `atm` for the rolling mode. NaN strikes when unresolved. */
export function resolvePair(sel: StrikeSelection, atm: number): { ce: number; pe: number } {
  if (sel.kind === "fixed") return { ce: sel.strike, pe: sel.strike };
  if (sel.kind === "pair") return { ce: sel.ce, pe: sel.pe };
  return Number.isFinite(atm) && atm > 0 ? { ce: atm, pe: atm } : { ce: NaN, pe: NaN };
}

/** True when the CE and PE strikes differ (a strangle or skewed pair rather than a straddle). */
export function isStrangle(sel: StrikeSelection): boolean {
  return sel.kind === "pair" && sel.ce !== sel.pe;
}

/** "ATM straddle (rolling)", "25,000 straddle", "25,200 CE + 24,800 PE". */
export function selectionLabel(sel: StrikeSelection): string {
  if (sel.kind === "fixed") return `${formatStrike(sel.strike)} straddle`;
  if (sel.kind === "pair") return sel.ce === sel.pe ? `${formatStrike(sel.ce)} straddle` : `${formatStrike(sel.ce)} CE + ${formatStrike(sel.pe)} PE`;
  return "ATM straddle (rolling)";
}

/** Strikes centred on `centre`: up to n on each side, ascending. Falls back to the n·2+1 nearest when centre is off the grid. */
export function strikesAround(strikes: number[], centre: number, n: number): number[] {
  const sorted = [...new Set((strikes ?? []).filter((k) => Number.isFinite(k) && k > 0))].sort((a, b) => a - b);
  if (sorted.length === 0 || !Number.isFinite(centre)) return [];
  let idx = 0;
  for (let i = 0; i < sorted.length; i++) if (Math.abs(sorted[i] - centre) < Math.abs(sorted[idx] - centre)) idx = i;
  const k = Math.max(0, Math.floor(n));
  return sorted.slice(Math.max(0, idx - k), idx + k + 1);
}
