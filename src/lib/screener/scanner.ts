/**
 * Rotating per-symbol scan (pure scheduling logic).
 *
 * The screener needs per-stock data that NSE only serves one symbol at a time: the option
 * chain (PCR, ATM IV), the F&O bhavcopy rows (futures basis, rollover, OI change) and daily
 * candles (HV, 5-day volume). We walk the universe in priority order and start at most one
 * request every SCAN_INTERVAL_MS, so a full pass is slow but polite to the exchange.
 */
import type { DailyBar, FuturesSummary } from "./metrics";

export const SCAN_INTERVAL_MS = 3000;
export const OFFLINE_BACKOFF_MS = 30000;
export const FAILURE_COOLDOWN_MS = 10 * 60000;

export type ScanPart = "chain" | "futures" | "history";
export const SCAN_PARTS: readonly ScanPart[] = ["chain", "futures", "history"];

export interface ChainScan {
  pcrOi: number | null;
  pcrVol: number | null;
  atmIv: number | null;
  ivp: number | null;
  expiry: string;
  spot: number;
  source: string;
  asOf: number;
}

export interface FuturesScan extends FuturesSummary {
  asOf: number;
}

export interface HistoryScan {
  bars: DailyBar[];
  asOf: number;
}

export interface ScanEntry {
  chain?: ChainScan;
  futures?: FuturesScan;
  history?: HistoryScan;
  /** Epoch ms of the last failed attempt per part. */
  failedAt?: Partial<Record<ScanPart, number>>;
}

export type ScanEntries = Record<string, ScanEntry>;

export interface ScanTtl {
  chain: number;
  futures: number;
  history: number;
}

/** Chains refresh every 5 minutes in session and hourly otherwise; EOD data every 6 h / 12 h. */
export function scanTtl(liveSession: boolean): ScanTtl {
  return { chain: liveSession ? 5 * 60000 : 60 * 60000, futures: 6 * 3600000, history: 12 * 3600000 };
}

export function partAsOf(entry: ScanEntry | undefined, part: ScanPart): number | null {
  const p = entry?.[part];
  return p && Number.isFinite(p.asOf) ? p.asOf : null;
}

export function needsPart(entry: ScanEntry | undefined, part: ScanPart, now: number, ttl: ScanTtl): boolean {
  const failed = entry?.failedAt?.[part];
  if (failed && now - failed < FAILURE_COOLDOWN_MS) return false;
  const asOf = partAsOf(entry, part);
  return asOf === null || now - asOf > ttl[part];
}

export function isChainStale(entry: ScanEntry | undefined, now: number, ttl: ScanTtl): boolean {
  const asOf = partAsOf(entry, "chain");
  return asOf !== null && now - asOf > ttl.chain;
}

/**
 * Next job: the first symbol in priority order with a missing or expired part.
 * Parts are tried chain → futures → history for each symbol. `skip` lets the caller
 * exclude parts that do not apply (for example volume history for indices).
 */
export function pickNextJob(
  symbols: readonly string[],
  entries: ScanEntries,
  now: number,
  ttl: ScanTtl,
  skip?: (symbol: string, part: ScanPart) => boolean,
): { symbol: string; part: ScanPart } | null {
  for (const symbol of symbols) {
    const e = entries[symbol];
    for (const part of SCAN_PARTS) {
      if (skip?.(symbol, part)) continue;
      if (needsPart(e, part, now, ttl)) return { symbol, part };
    }
  }
  return null;
}

/** Symbols whose chain metrics are present (fresh or stale) out of the list. */
export function scanCoverage(symbols: readonly string[], entries: ScanEntries, now: number, ttl: ScanTtl): { done: number; fresh: number; total: number } {
  let done = 0;
  let fresh = 0;
  for (const s of symbols) {
    const asOf = partAsOf(entries[s], "chain");
    if (asOf === null) continue;
    done += 1;
    if (now - asOf <= ttl.chain) fresh += 1;
  }
  return { done, fresh, total: symbols.length };
}

/** Order the universe: the caller's priority list first (visible rows), then everything else. */
export function prioritise(priority: readonly string[], all: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...priority, ...all]) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Drop parts older than maxAgeMs (used before persisting). */
export function pruneEntries(entries: ScanEntries, now: number, maxAgeMs: number): ScanEntries {
  const out: ScanEntries = {};
  for (const [sym, e] of Object.entries(entries)) {
    const next: ScanEntry = {};
    for (const part of SCAN_PARTS) {
      const asOf = partAsOf(e, part);
      if (asOf !== null && now - asOf <= maxAgeMs) (next as Record<ScanPart, unknown>)[part] = e[part];
    }
    if (next.chain || next.futures || next.history) out[sym] = next;
  }
  return out;
}

/** Defensive parse of a persisted cache (anything malformed is dropped). */
export function parseEntries(raw: unknown): ScanEntries {
  if (!raw || typeof raw !== "object") return {};
  const out: ScanEntries = {};
  for (const [sym, e] of Object.entries(raw as Record<string, unknown>)) {
    if (!e || typeof e !== "object" || !/^[A-Z0-9&-]{1,20}$/.test(sym)) continue;
    const src = e as Record<string, unknown>;
    const next: ScanEntry = {};
    for (const part of SCAN_PARTS) {
      const p = src[part];
      if (p && typeof p === "object" && Number.isFinite((p as { asOf?: unknown }).asOf)) {
        if (part === "history" && !Array.isArray((p as { bars?: unknown }).bars)) continue;
        (next as Record<ScanPart, unknown>)[part] = p;
      }
    }
    if (next.chain || next.futures || next.history) out[sym] = next;
  }
  return out;
}
