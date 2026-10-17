/**
 * Browser store of end-of-day futures snapshots (market data only; sample data is never stored).
 * Compact per-day records so a year of history for dozens of symbols fits in localStorage.
 */
import { isValidIsoDate } from "@/lib/options";
import type { FutContract, FuturesDay } from "./model";

export const FUT_STORE_KEY = "mc_futures_days_v1";
export const MAX_DAYS_PER_SYMBOL = 120;
export const MAX_SYMBOLS = 40;

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type CompactContract = [expiry: string, price: number | null, oi: number, chgOi: number, volume: number];
interface CompactDay {
  u: number | null;
  c: CompactContract[];
}
interface SymbolEntry {
  /** Last write, epoch ms (for evicting the least recently used symbol). */
  t: number;
  d: Record<string, CompactDay>;
}
type Store = Record<string, SymbolEntry>;

function defaultStorage(): KVStorage | null {
  try {
    return (globalThis as { localStorage?: KVStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function encodeDay(day: FuturesDay): CompactDay {
  return {
    u: fin(day.underlying) ? day.underlying : null,
    c: day.contracts.map((c) => [c.expiry, fin(c.price) ? c.price : null, c.oi, c.chgOi, c.volume]),
  };
}

export function decodeDay(symbol: string, date: string, raw: unknown): FuturesDay | null {
  if (!raw || typeof raw !== "object" || !isValidIsoDate(date)) return null;
  const r = raw as { u?: unknown; c?: unknown };
  if (!Array.isArray(r.c)) return null;
  const contracts: FutContract[] = [];
  for (const c of r.c) {
    if (!Array.isArray(c) || typeof c[0] !== "string" || !isValidIsoDate(c[0])) continue;
    contracts.push({
      expiry: c[0],
      price: fin(c[1]) && c[1] > 0 ? c[1] : null,
      oi: fin(c[2]) ? Math.max(0, c[2]) : 0,
      chgOi: fin(c[3]) ? c[3] : 0,
      volume: fin(c[4]) ? Math.max(0, c[4]) : 0,
    });
  }
  if (contracts.length === 0) return null;
  contracts.sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  return { symbol, date, underlying: fin(r.u) && r.u > 0 ? r.u : null, contracts };
}

function read(storage: KVStorage | null): Store {
  if (!storage) return {};
  try {
    const raw = storage.getItem(FUT_STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store, storage: KVStorage | null): void {
  if (!storage) return;
  try {
    storage.setItem(FUT_STORE_KEY, JSON.stringify(store));
  } catch {
    /* quota or private mode: history simply does not persist */
  }
}

/** Stored days for a symbol, ascending by date. */
export function loadDays(symbol: string, storage: KVStorage | null = defaultStorage()): FuturesDay[] {
  const entry = read(storage)[symbol];
  if (!entry || typeof entry !== "object" || !entry.d) return [];
  return Object.keys(entry.d)
    .sort()
    .map((date) => decodeDay(symbol, date, entry.d[date]))
    .filter((d): d is FuturesDay => d !== null);
}

/** Dates already stored for a symbol. */
export function storedDates(symbol: string, storage: KVStorage | null = defaultStorage()): Set<string> {
  const entry = read(storage)[symbol];
  return new Set(entry?.d ? Object.keys(entry.d) : []);
}

/** Merge days into the store (a date is replaced as a whole), trimming old dates and idle symbols. */
export function saveDays(
  days: readonly FuturesDay[],
  storage: KVStorage | null = defaultStorage(),
  now = Date.now(),
): void {
  if (!storage || days.length === 0) return;
  const store = read(storage);
  for (const day of days) {
    if (!day || day.contracts.length === 0 || !isValidIsoDate(day.date)) continue;
    const entry: SymbolEntry =
      store[day.symbol] && typeof store[day.symbol] === "object" && store[day.symbol].d
        ? store[day.symbol]
        : { t: now, d: {} };
    entry.d[day.date] = encodeDay(day);
    entry.t = now;
    const dates = Object.keys(entry.d).sort();
    for (const old of dates.slice(0, Math.max(0, dates.length - MAX_DAYS_PER_SYMBOL))) delete entry.d[old];
    store[day.symbol] = entry;
  }
  const symbols = Object.keys(store).sort((a, b) => (store[b]?.t ?? 0) - (store[a]?.t ?? 0));
  for (const s of symbols.slice(MAX_SYMBOLS)) delete store[s];
  write(store, storage);
}
