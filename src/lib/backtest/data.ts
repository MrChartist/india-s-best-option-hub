/**
 * Backtest data: NSE F&O bhavcopy through the local proxy (/api/x/bhavcopy-fo, one file per trading
 * day) compacted into EodDay records and cached in IndexedDB, plus India VIX closes
 * (/api/x/vix-history) for the regime split.
 *
 * The cache lives in its own database (BACKTEST_DB_NAME) so it never collides with the app's other
 * stores. Every function here is safe without IndexedDB (private windows, tests): the cache then
 * lives in memory for the session.
 */
import { calendarDaysBetween, isTradingDay, nowIST, previousTradingDay } from "@/lib/options";
import type { BhavcopyFoRow, VixHistoryRow } from "@/lib/types/market";
import { tradingDaysInRange } from "./sampleData";
import type { EodChain, EodDay } from "./types";

export const BACKTEST_DB_NAME = "mc_backtest_eod_v1";
const STORE = "days";
/** v2: zero-volume strikes are stored unquoted (model-priced), so v1 compactions are dropped. */
const DB_VERSION = 2;

/** Furthest expiry kept per day (calendar days) and the strike band kept around spot. */
export const KEEP_MAX_DTE = 100;
export const KEEP_STRIKE_BAND = 0.2;

// ───────────────────────────── Compaction ─────────────────────────────

/**
 * Compact one day's bhavcopy rows for a symbol into an EodDay: expiries up to KEEP_MAX_DTE days out,
 * strikes within ±KEEP_STRIKE_BAND of spot, option close (settlement price when close is 0) and the
 * futures close per expiry. Returns null when the day has no usable rows for the symbol.
 *
 * A strike that did not trade (TtlTradgVol 0) has no tradeable close: the bhavcopy close is then a
 * stale earlier print. Such strikes are kept in the strike list (when they have open interest) but
 * stored unquoted (null), so the engine prices them with Black-76 and flags the fill as model-priced
 * instead of filling at a stale price. This rule applies only when the file carries volume at all.
 */
export function compactBhavcopy(rows: BhavcopyFoRow[], symbol: string, date: string, vix: number | null = null): EodDay | null {
  const mine = (Array.isArray(rows) ? rows : []).filter((r) => r && r.symbol === symbol && typeof r.expiry === "string" && r.expiry >= date);
  if (mine.length === 0) return null;
  let spot = 0;
  for (const r of mine) if (r.underlyingClose > 0) {
    spot = r.underlyingClose;
    break;
  }
  const byExpiry = new Map<string, BhavcopyFoRow[]>();
  for (const r of mine) {
    const dte = calendarDaysBetween(date, r.expiry);
    if (!(dte >= 0 && dte <= KEEP_MAX_DTE)) continue;
    const list = byExpiry.get(r.expiry);
    if (list) list.push(r);
    else byExpiry.set(r.expiry, [r]);
  }
  if (!(spot > 0)) {
    // No underlying close in the file: use the nearest futures close.
    const fut = mine.filter((r) => r.type === "FUT" && r.close > 0).sort((a, b) => (a.expiry < b.expiry ? -1 : 1))[0];
    spot = fut?.close ?? 0;
  }
  if (!(spot > 0)) return null;
  const lo = spot * (1 - KEEP_STRIKE_BAND);
  const hi = spot * (1 + KEEP_STRIKE_BAND);
  const chains: EodChain[] = [];
  // Files without a volume column parse to volume 0 everywhere: then fall back to trusting closes.
  const hasVolume = mine.some((r) => r.type !== "FUT" && r.volume > 0);
  for (const expiry of [...byExpiry.keys()].sort()) {
    const list = byExpiry.get(expiry) ?? [];
    const ceBy = new Map<number, number | null>();
    const peBy = new Map<number, number | null>();
    let fut: number | null = null;
    for (const r of list) {
      const px = r.close > 0 ? r.close : r.settle > 0 ? r.settle : 0;
      if (r.type === "FUT") {
        if (px > 0) fut = px;
        continue;
      }
      if (!(r.strike >= lo && r.strike <= hi)) continue;
      const untraded = hasVolume && !(r.volume > 0);
      if (untraded) {
        // Keep listed strikes with open interest so strike selection keeps the strategy's shape.
        const book = r.type === "CE" ? ceBy : peBy;
        if (r.oi > 0 && !book.has(r.strike)) book.set(r.strike, null);
        continue;
      }
      if (!(px > 0)) continue;
      (r.type === "CE" ? ceBy : peBy).set(r.strike, px);
    }
    const strikes = [...new Set([...ceBy.keys(), ...peBy.keys()])].sort((a, b) => a - b);
    if (strikes.length === 0 && fut === null) continue;
    chains.push({ expiry, strikes, ce: strikes.map((k) => ceBy.get(k) ?? null), pe: strikes.map((k) => peBy.get(k) ?? null), fut });
  }
  if (chains.length === 0) return null;
  return { date, spot: Math.round(spot * 100) / 100, vix, chains };
}

/** Map of ISO date → India VIX close. */
export function vixByDate(rows: VixHistoryRow[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows ?? []) if (r && typeof r.date === "string" && Number.isFinite(r.close) && r.close > 0) out.set(r.date.slice(0, 10), r.close);
  return out;
}

/** The last session with a published bhavcopy: today after 19:00 IST on a trading day, else the previous trading day. */
export function lastBhavcopyDate(now: Date = new Date()): string {
  const { date, hh } = nowIST(now);
  return isTradingDay(date) && hh >= 19 ? date : previousTradingDay(date);
}

/** Trading days for a lookback of `months` ending at `end`. */
export function lookbackDates(end: string, months: number): string[] {
  const m = Math.max(1, Math.min(24, Math.round(months)));
  const y = +end.slice(0, 4);
  const mo = +end.slice(5, 7) - m;
  const startY = y + Math.floor((mo - 1) / 12);
  const startM = ((((mo - 1) % 12) + 12) % 12) + 1;
  const day = Math.min(+end.slice(8, 10), 28);
  const start = `${startY}-${String(startM).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return tradingDaysInRange(start, end);
}

// ───────────────────────────── Cache ─────────────────────────────

/** A cached day: the compact record, or `empty` when the exchange published no rows for the symbol. */
export type CachedDay = { date: string; day: EodDay | null };

export interface DayCache {
  get(symbol: string, date: string): Promise<CachedDay | undefined>;
  put(symbol: string, entry: CachedDay): Promise<void>;
  clear(): Promise<void>;
}

const key = (symbol: string, date: string) => `${symbol}:${date}`;

export function memoryCache(): DayCache {
  const m = new Map<string, CachedDay>();
  return {
    get: async (s, d) => m.get(key(s, d)),
    put: async (s, e) => void m.set(key(s, e.date), e),
    clear: async () => m.clear(),
  };
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(BACKTEST_DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        // Days compacted by an older version used stale closes for untraded strikes: rebuild them.
        if (ev.oldVersion < 2 && db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** IndexedDB-backed cache with an in-memory fallback when the database cannot be opened. */
export function indexedDbCache(): DayCache {
  const mem = memoryCache();
  const db = () => (dbPromise ??= openDb());
  const run = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> =>
    db().then(
      (d) =>
        new Promise<T | undefined>((resolve) => {
          if (!d) return resolve(undefined);
          try {
            const req = fn(d.transaction(STORE, mode).objectStore(STORE));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        }),
    );
  return {
    async get(symbol, date) {
      const hit = await mem.get(symbol, date);
      if (hit) return hit;
      const v = await run<CachedDay>("readonly", (s) => s.get(key(symbol, date)) as IDBRequest<CachedDay>);
      if (v && typeof v === "object" && v.date === date) {
        await mem.put(symbol, v);
        return v;
      }
      return undefined;
    },
    async put(symbol, entry) {
      await mem.put(symbol, entry);
      await run("readwrite", (s) => s.put(entry, key(symbol, entry.date)));
    },
    async clear() {
      await mem.clear();
      await run("readwrite", (s) => s.clear());
    },
  };
}

// ───────────────────────────── Loader ─────────────────────────────

export interface FetchDayResult {
  /** Rows for the day, or null when the proxy did not answer. An empty array means no file / no rows. */
  rows: BhavcopyFoRow[] | null;
  reason?: string;
}

export interface LoadProgress {
  done: number;
  total: number;
  cached: number;
}

export interface LoadResult {
  days: EodDay[];
  requested: number;
  /** Days answered by the proxy or the cache (including days with no rows). */
  answered: number;
  cached: number;
  /** Last failure reason when some days could not be fetched. */
  reason: string | null;
}

/** Reasons that mean the proxy is not there at all, so fetching further days is pointless. */
const FATAL = new Set(["proxy-offline", "offline", "sample-mode", "network", "proxy-unreachable"]);

/**
 * Load days from the cache, fetching misses through `fetchDay` with limited concurrency.
 * Stops early when the first fetches show the proxy is offline. Throws an AbortError when cancelled.
 */
export async function loadDays(o: {
  symbol: string;
  dates: string[];
  fetchDay: (date: string) => Promise<FetchDayResult>;
  cache: DayCache;
  signal?: AbortSignal;
  onProgress?: (p: LoadProgress) => void;
  concurrency?: number;
}): Promise<LoadResult> {
  const { symbol, dates, cache } = o;
  const found = new Map<string, EodDay>();
  let answered = 0;
  let cached = 0;
  let done = 0;
  let reason: string | null = null;
  let fatal = false;
  const misses: string[] = [];
  const abortIfNeeded = () => {
    if (o.signal?.aborted) throw new DOMException("Backtest data load cancelled", "AbortError");
  };
  for (const d of dates) {
    abortIfNeeded();
    const hit = await cache.get(symbol, d);
    if (hit) {
      cached += 1;
      answered += 1;
      done += 1;
      if (hit.day) found.set(d, hit.day);
    } else misses.push(d);
  }
  o.onProgress?.({ done, total: dates.length, cached });
  // Newest first: if the archive stops answering part-way, the recent end is the useful part.
  misses.sort((a, b) => (a < b ? 1 : -1));
  let next = 0;
  const worker = async () => {
    while (next < misses.length && !fatal) {
      abortIfNeeded();
      const date = misses[next++];
      const res = await o.fetchDay(date);
      abortIfNeeded();
      done += 1;
      if (res.rows === null) {
        reason = res.reason ?? "no-answer";
        if (FATAL.has(reason) && answered === 0) fatal = true;
      } else {
        answered += 1;
        const day = compactBhavcopy(res.rows, symbol, date);
        await cache.put(symbol, { date, day });
        if (day) found.set(date, day);
      }
      o.onProgress?.({ done, total: dates.length, cached });
    }
  };
  const n = Math.max(1, Math.min(o.concurrency ?? 4, misses.length));
  await Promise.all(Array.from({ length: n }, worker));
  abortIfNeeded();
  const days = [...found.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return { days, requested: dates.length, answered, cached, reason };
}

/** Attach VIX closes to days (cached days are stored without VIX so a later VIX fetch fills them). */
export function attachVix(days: EodDay[], vix: Map<string, number>): EodDay[] {
  return days.map((d) => ({ ...d, vix: vix.get(d.date) ?? d.vix ?? null }));
}
