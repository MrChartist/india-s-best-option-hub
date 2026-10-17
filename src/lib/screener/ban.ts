/**
 * F&O ban period and MWPL helpers (pure).
 *
 * NSE rule: a stock enters the ban period when combined open interest across exchanges
 * crosses 95% of its market-wide position limit (MWPL). During the ban only position-reducing
 * trades are allowed. It leaves the ban once OI falls below 80% of MWPL at the end of a day.
 */
import { canonicalFnoSymbol } from "./universe";
import { MWPL_BAN_PCT, MWPL_DANGER_PCT, MWPL_EXIT_PCT, MWPL_NEAR_PCT } from "./metrics";

export interface BanListData {
  /** Trade date the ban list applies to (ISO). */
  date: string;
  symbols: string[];
}

export interface MwplRow {
  symbol: string;
  mwplPct: number;
  mwpl?: number;
  oi?: number;
  limitNextDay?: number;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";

/** Validate the /api/x/ban-list payload. */
export function parseBanPayload(data: unknown): BanListData | null {
  if (!isObj(data) || !Array.isArray(data.symbols)) return null;
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const s of data.symbols) {
    if (typeof s !== "string") continue;
    const c = canonicalFnoSymbol(s);
    if (c && !seen.has(c)) {
      seen.add(c);
      symbols.push(c);
    }
  }
  return { date: typeof data.date === "string" ? data.date : "", symbols: symbols.sort() };
}

/** Validate the /api/x/mwpl payload; returns rows sorted by MWPL % descending. */
export function parseMwplPayload(data: unknown): MwplRow[] {
  if (!Array.isArray(data)) return [];
  const out: MwplRow[] = [];
  const seen = new Set<string>();
  for (const d of data) {
    if (!isObj(d) || typeof d.symbol !== "string" || !finite(d.mwplPct)) continue;
    const symbol = canonicalFnoSymbol(d.symbol);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const row: MwplRow = { symbol, mwplPct: d.mwplPct };
    if (finite(d.mwpl)) row.mwpl = d.mwpl;
    if (finite(d.oi)) row.oi = d.oi;
    if (finite(d.limitNextDay)) row.limitNextDay = d.limitNextDay;
    out.push(row);
  }
  return out.sort((a, b) => b.mwplPct - a.mwplPct);
}

/** Non-banned stocks at or above the near-ban threshold, highest first. */
export function nearBanList(mwpl: readonly MwplRow[], banned: readonly string[], threshold = MWPL_NEAR_PCT): Array<{ symbol: string; mwplPct: number }> {
  const b = new Set(banned);
  return mwpl
    .filter((r) => r.mwplPct >= threshold && !b.has(r.symbol))
    .map((r) => ({ symbol: r.symbol, mwplPct: r.mwplPct }))
    .sort((a, c) => c.mwplPct - a.mwplPct);
}

export type BanOutlookTone = "bearish" | "warning" | "bullish" | "neutral";

/** Plain-language outlook for the next session, based on the NSE entry/exit thresholds. */
export function banOutlook(mwplPct: number | null, banned: boolean): { label: string; tone: BanOutlookTone } {
  if (banned) {
    if (mwplPct !== null && mwplPct < MWPL_EXIT_PCT) return { label: "Likely to exit ban next session", tone: "bullish" };
    if (mwplPct === null) return { label: "In ban · MWPL not available", tone: "bearish" };
    return { label: `Stays in ban until OI < ${MWPL_EXIT_PCT}% of MWPL`, tone: "bearish" };
  }
  if (mwplPct === null) return { label: "MWPL not available", tone: "neutral" };
  if (mwplPct >= MWPL_BAN_PCT) return { label: "Crossed 95%: likely in ban next session", tone: "bearish" };
  if (mwplPct >= MWPL_DANGER_PCT) return { label: "Above 85%: close to the ban", tone: "warning" };
  if (mwplPct >= MWPL_NEAR_PCT) return { label: "Above 80%: watch", tone: "warning" };
  return { label: "Normal", tone: "neutral" };
}

// ── Ban history (observed on this device) ──

export type BanHistory = BanListData[];

/** Insert or replace one day's ban list, keep the latest `keep` days, oldest first. */
export function mergeBanHistory(history: readonly BanListData[], entry: BanListData, keep = 30): BanHistory {
  if (!entry.date) return [...history];
  const map = new Map<string, BanListData>();
  for (const h of history) if (h && typeof h.date === "string" && Array.isArray(h.symbols)) map.set(h.date, { date: h.date, symbols: [...h.symbols] });
  map.set(entry.date, { date: entry.date, symbols: [...entry.symbols] });
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-keep);
}

/** First date of the current, unbroken run of observed ban days for a symbol (null if not in the latest list). */
export function banSince(symbol: string, history: readonly BanListData[]): string | null {
  if (history.length === 0) return null;
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!sorted[sorted.length - 1].symbols.includes(symbol)) return null;
  let since = sorted[sorted.length - 1].date;
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (!sorted[i].symbols.includes(symbol)) break;
    since = sorted[i].date;
  }
  return since;
}

export interface BanCalendarDay {
  date: string;
  symbols: string[];
  entered: string[];
  exited: string[];
}

/** Entry and exit events per observed day (compared with the previous observed day). */
export function banCalendar(history: readonly BanListData[], days = 10): BanCalendarDay[] {
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: BanCalendarDay[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = i > 0 ? new Set(sorted[i - 1].symbols) : null;
    const now = new Set(cur.symbols);
    out.push({
      date: cur.date,
      symbols: [...cur.symbols].sort(),
      entered: prev ? cur.symbols.filter((s) => !prev.has(s)).sort() : [],
      exited: prev ? sorted[i - 1].symbols.filter((s) => !now.has(s)).sort() : [],
    });
  }
  return out.slice(-days);
}
