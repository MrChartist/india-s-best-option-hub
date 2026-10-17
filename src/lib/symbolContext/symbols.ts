/**
 * The F&O underlyings the header switcher and the omnibox know about, plus the scheduled expiry
 * list for one underlying. Pure: no React.
 *
 * The expiry list comes from the exchange calendar in @/lib/options (SEBI weekday rules with NSE/BSE
 * holidays), not from a live chain, so callers label it "scheduled" and let a live chain override it.
 */
import { CONTRACT_SPECS, dteLabel, formatDateIST, getExpiries, getContractSpec, normalizeSymbol } from "@/lib/options";
import { FNO_INDICES, STATIC_FNO_STOCKS, canonicalFnoSymbol } from "@/lib/screener/universe";

/** Indices first, in the order traders reach for them. */
export const SWITCHER_INDICES: readonly string[] = (() => {
  const preferred = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "NIFTYNXT50"];
  const known = new Set([...FNO_INDICES, ...Object.values(CONTRACT_SPECS).filter((s) => s.kind === "INDEX").map((s) => s.symbol)]);
  const ordered = preferred.filter((s) => known.has(s));
  for (const s of known) if (!ordered.includes(s)) ordered.push(s);
  return ordered;
})();

/** F&O stocks, alphabetical (static fallback list; the live NSE list may differ slightly). */
export const SWITCHER_STOCKS: readonly string[] = (() => {
  const idx = new Set(SWITCHER_INDICES);
  const all = new Set<string>(STATIC_FNO_STOCKS);
  for (const s of Object.values(CONTRACT_SPECS)) if (s.kind === "STOCK") all.add(s.symbol);
  return [...all].filter((s) => !idx.has(s)).sort();
})();

const KNOWN = new Set<string>([...SWITCHER_INDICES, ...SWITCHER_STOCKS]);

/** Canonical symbol when it is a known F&O underlying (aliases and renames applied), else "". */
export function knownFnoSymbol(raw: string): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const a = normalizeSymbol(raw);
  if (KNOWN.has(a)) return a;
  const b = canonicalFnoSymbol(a);
  return KNOWN.has(b) ? b : "";
}

export function isIndexUnderlying(symbol: string): boolean {
  const s = normalizeSymbol(symbol);
  return getContractSpec(s)?.kind === "INDEX" || SWITCHER_INDICES.includes(s);
}

export interface ExpiryOption {
  /** ISO yyyy-mm-dd. */
  value: string;
  /** "28 Oct 2026". */
  label: string;
  type: "weekly" | "monthly";
  /** "2d 4h", "12 days", "Expiry today · 3h 12m" (dteLabel from the shared calendar). */
  dte: string;
}

/** Upcoming scheduled expiries for a symbol (exchange calendar, holidays applied). */
export function scheduledExpiries(symbol: string, now: Date = new Date(), count = 8): ExpiryOption[] {
  return getExpiries(symbol, now, count).map((e) => ({
    value: e.date,
    label: formatDateIST(e.date),
    type: e.type,
    dte: dteLabel(e.date, now),
  }));
}
