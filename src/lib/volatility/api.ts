/**
 * Volatility data loaders (browser IO). Pure maths lives in history.ts / smile.ts / surface.ts.
 *
 * Sources:
 *  - /api/x/vix-history   India VIX daily closes (NSE, Yahoo fallback)
 *  - /api/x/bhavcopy-fo   NSE F&O bhavcopy rows for one symbol and date (IV solved client-side)
 *  - /api/yahoo-chart     daily OHLC for realised vol
 *  - snapshotStore        locally recorded chain snapshots and end-of-day stats
 *
 * Solved bhavcopy IVs are cached per symbol and date in localStorage (small: one number set per date).
 */
import { proxyGet } from "@/lib/api/proxyClient";
import { fetchLiveOptionChain, fetchYahooChart } from "@/lib/marketApi";
import { addCalendarDays, getMarketParams, istDateString, nowIST, previousTradingDay, type OHLC } from "@/lib/options";
import { getDailyStats, getSnapshotTimes, getSnapshots, snapshotToChain, type ChainSnapshot, type DailyStat } from "@/lib/snapshotStore";
import type { BhavcopyFoRow, VixHistoryRow } from "@/lib/types/market";
import { bhavcopyChains, candlesToBars, ivFromBhavChains, lastSessionDate, type BhavExpiryChain, type BhavcopyIv, type IvPoint } from "./history";
import type { ExpiryHistory, ExpiryIvPoint } from "./atmHistory";
import { chainAtmIv, pickScreenerExpiry, symbolKind, withChange, type ScreenerRow } from "./screener";

// ── Fetchers ──

export interface Sourced<T> {
  data: T;
  source: string;
  asOf: number;
  stale: boolean;
  reason?: string;
}

export async function fetchVixHistory(days = 400, signal?: AbortSignal): Promise<Sourced<VixHistoryRow[]>> {
  const env = await proxyGet<VixHistoryRow[]>("/api/x/vix-history", { days }, { timeoutMs: 30000, signal });
  const rows = Array.isArray(env.data) ? env.data.filter((r) => r && typeof r.date === "string" && Number.isFinite(r.close)) : [];
  return { data: rows, source: env.meta.source, asOf: env.meta.asOf, stale: env.meta.stale, reason: env.meta.reason };
}

/** Bhavcopy option rows for one symbol on one date. `data` is null when the proxy is unreachable. */
export async function fetchBhavcopy(symbol: string, date: string, signal?: AbortSignal): Promise<{ data: BhavcopyFoRow[] | null; reason?: string }> {
  const env = await proxyGet<BhavcopyFoRow[]>("/api/x/bhavcopy-fo", { symbol: symbol.toUpperCase(), date }, { timeoutMs: 60000, signal });
  return { data: Array.isArray(env.data) ? env.data : null, reason: env.meta.reason };
}

export async function fetchBhavcopyChains(symbol: string, date: string, signal?: AbortSignal): Promise<BhavExpiryChain[] | null> {
  const res = await fetchBhavcopy(symbol, date, signal);
  return res.data ? bhavcopyChains(res.data, symbol) : null;
}

/** Daily bars for `days` calendar days. Throws when the proxy or Yahoo is unavailable. */
export async function fetchDailyBars(symbol: string, days = 800): Promise<OHLC[]> {
  const to = istDateString();
  const from = addCalendarDays(to, -Math.max(30, Math.floor(days)));
  const res = await fetchYahooChart(symbol.toUpperCase(), "D", from, to);
  const bars = candlesToBars(res?.data);
  if (bars.length === 0) throw new Error("No daily candles returned");
  return bars;
}

export async function loadDailyStats(symbol: string, days = 400): Promise<DailyStat[]> {
  try {
    return await getDailyStats(symbol, days);
  } catch {
    return [];
  }
}

/** The snapshot closest to `targetTs` within ±`tolMs`, or null. */
export async function snapshotNear(symbol: string, expiry: string, targetTs: number, tolMs: number): Promise<ChainSnapshot | null> {
  try {
    const snaps = await getSnapshots(symbol, expiry, targetTs - tolMs, targetTs + tolMs);
    if (snaps.length === 0) return null;
    return snaps.reduce((best, s) => (Math.abs(s.ts - targetTs) < Math.abs(best.ts - targetTs) ? s : best));
  } catch {
    return null;
  }
}

/** The last snapshot recorded between fromTs and toTs, or null. */
export async function lastSnapshotBetween(symbol: string, expiry: string, fromTs: number, toTs: number): Promise<ChainSnapshot | null> {
  try {
    const snaps = await getSnapshots(symbol, expiry, fromTs, toTs);
    return snaps.length ? snaps[snaps.length - 1] : null;
  } catch {
    return null;
  }
}

export { snapshotToChain };

/**
 * ATM IV per expiry from the last snapshot recorded on each IST day over the last `days` days.
 * Reads timestamps first so only one snapshot per day and expiry is loaded. Never throws.
 */
export async function dailySnapshotAtm(symbol: string, expiries: string[], days = 30, now: Date = new Date()): Promise<ExpiryHistory> {
  const out: ExpiryHistory = {};
  const toTs = now.getTime();
  const fromTs = toTs - days * 86_400_000;
  const r = getMarketParams().r;
  for (const expiry of expiries) {
    try {
      const times = await getSnapshotTimes(symbol, expiry, fromTs, toTs);
      const lastPerDay = new Map<string, number>();
      for (const ts of times) {
        const d = nowIST(new Date(ts)).date;
        if ((lastPerDay.get(d) ?? 0) < ts) lastPerDay.set(d, ts);
      }
      const pts: ExpiryIvPoint[] = [];
      for (const [date, ts] of lastPerDay) {
        const snaps = await getSnapshots(symbol, expiry, ts, ts);
        const snap = snaps[snaps.length - 1];
        if (!snap || !(snap.spot > 0)) continue;
        const iv = chainAtmIv(snapshotToChain(snap), snap.spot, expiry, new Date(snap.ts), r);
        if (Number.isFinite(iv) && iv > 0) pts.push({ date, iv, source: "snapshot" });
      }
      if (pts.length) out[expiry] = pts.sort((a, b) => (a.date < b.date ? -1 : 1));
    } catch {
      /* no snapshots for this expiry */
    }
  }
  return out;
}

// ── Bhavcopy IV cache (localStorage) ──

const CACHE_PREFIX = "mc_vol_bhav_v1:";
const MAX_CACHE_DATES = 500;

interface CachedEntry {
  /** iv30 percent, or null when that date had no usable data. */
  v: number | null;
  /** Underlying close. */
  s?: number;
  /** Term: [expiry, T, atmIv%][] */
  t?: Array<[string, number, number]>;
  at: number;
}

type CacheMap = Record<string, CachedEntry>;

function readCache(symbol: string): CacheMap {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + symbol.toUpperCase());
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as CacheMap) : {};
  } catch {
    return {};
  }
}

function writeCache(symbol: string, map: CacheMap): void {
  try {
    const keys = Object.keys(map).sort();
    const trimmed: CacheMap = {};
    for (const k of keys.slice(-MAX_CACHE_DATES)) trimmed[k] = map[k];
    localStorage.setItem(CACHE_PREFIX + symbol.toUpperCase(), JSON.stringify(trimmed));
  } catch {
    /* storage full or blocked: the cache is a convenience only */
  }
}

function toEntry(iv: BhavcopyIv): CachedEntry {
  return {
    v: Number.isFinite(iv.iv30) ? iv.iv30 : null,
    s: Number.isFinite(iv.spot) ? iv.spot : undefined,
    t: iv.term.map((x) => [x.expiry, Math.round(x.T * 1e6) / 1e6, x.atmIv]),
    at: Date.now(),
  };
}

function fromEntry(date: string, e: CachedEntry): BhavcopyIv {
  return {
    date,
    iv30: e.v ?? NaN,
    spot: e.s ?? NaN,
    term: (e.t ?? []).map(([expiry, T, atmIv]) => ({ expiry, T, F: NaN, atmIv })),
  };
}

/** Cached bhavcopy IV30 points for a symbol (no network). */
export function cachedBhavPoints(symbol: string): IvPoint[] {
  const map = readCache(symbol);
  return Object.entries(map)
    .filter(([, e]) => e && typeof e.v === "number" && e.v > 0)
    .map(([date, e]) => ({ date, iv: e.v as number, source: "bhavcopy" as const }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Every cached bhavcopy date with its solved term structure (no network), oldest first. */
export function cachedBhavEntries(symbol: string): BhavcopyIv[] {
  return Object.entries(readCache(symbol))
    .filter(([, e]) => e && Array.isArray(e.t) && e.t.length > 0)
    .map(([date, e]) => fromEntry(date, e))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function cachedBhavDates(symbol: string): Set<string> {
  return new Set(Object.keys(readCache(symbol)));
}

export function cachedBhavIv(symbol: string, date: string): BhavcopyIv | null {
  const e = readCache(symbol)[date];
  return e ? fromEntry(date, e) : null;
}

/** Store an already-solved bhavcopy IV (for callers that fetched the chains themselves). */
export function cacheBhavIv(symbol: string, iv: BhavcopyIv): void {
  const map = readCache(symbol);
  map[iv.date] = toEntry(iv);
  writeCache(symbol, map);
}

/** Solve and cache the bhavcopy IV for one date. Returns null when the proxy is unreachable (nothing cached). */
export async function bhavcopyIv(symbol: string, date: string, signal?: AbortSignal): Promise<BhavcopyIv | null> {
  const hit = cachedBhavIv(symbol, date);
  if (hit) return hit;
  const chains = await fetchBhavcopyChains(symbol, date, signal);
  if (!chains) return null;
  const iv = ivFromBhavChains(chains, date, getMarketParams().r);
  cacheBhavIv(symbol, iv);
  return iv;
}

export interface BackfillProgress {
  done: number;
  total: number;
  added: number;
  failed: number;
}

/**
 * Fill missing dates (newest first) with bhavcopy IV30, `concurrency` requests at a time.
 * Stops early after three consecutive proxy failures. Returns the progress summary.
 */
export async function backfillBhavcopyIv(
  symbol: string,
  dates: string[],
  o?: { concurrency?: number; signal?: AbortSignal; onProgress?: (p: BackfillProgress) => void },
): Promise<BackfillProgress> {
  const have = cachedBhavDates(symbol);
  const todo = dates.filter((d) => !have.has(d));
  const progress: BackfillProgress = { done: 0, total: todo.length, added: 0, failed: 0 };
  o?.onProgress?.({ ...progress });
  let idx = 0;
  let consecutiveFails = 0;
  const worker = async () => {
    while (idx < todo.length) {
      if (o?.signal?.aborted || consecutiveFails >= 3) return;
      const d = todo[idx++];
      try {
        const res = await bhavcopyIv(symbol, d, o?.signal);
        if (res) {
          consecutiveFails = 0;
          if (Number.isFinite(res.iv30)) progress.added++;
        } else {
          consecutiveFails++;
          progress.failed++;
        }
      } catch {
        consecutiveFails++;
        progress.failed++;
      }
      progress.done++;
      o?.onProgress?.({ ...progress });
    }
  };
  const n = Math.max(1, Math.min(4, o?.concurrency ?? 2));
  await Promise.all(Array.from({ length: n }, worker));
  return progress;
}

// ── Screener scan ──

/**
 * One screener row: live chain for the first expiry ≥ 7 days out, compared with the same expiry's
 * ATM IV solved from the previous session's bhavcopy. Throws when no live chain is available
 * (the screener never falls back to sample data).
 */
export async function scanScreenerSymbol(symbol: string, now: Date = new Date()): Promise<ScreenerRow> {
  const sym = symbol.toUpperCase();
  let res = await fetchLiveOptionChain(sym);
  const expiries = res.expiries.map((e) => e.value).filter(Boolean);
  const wanted = pickScreenerExpiry(expiries.length ? expiries : [res.expiry], now);
  if (wanted && wanted !== res.expiry) {
    try {
      res = await fetchLiveOptionChain(sym, wanted);
    } catch {
      /* keep the nearest-expiry chain */
    }
  }
  const expiry = res.expiry || wanted;
  const r = getMarketParams().r;
  const iv = chainAtmIv(res.chain, res.spotPrice, expiry, now, r);
  if (!Number.isFinite(iv)) throw new Error("No usable ATM IV");

  let prevIv: number | null = null;
  const prevDate = previousTradingDay(lastSessionDate(now));
  const cached = cachedBhavIv(sym, prevDate);
  const fromTerm = (b: BhavcopyIv | null) => b?.term.find((t) => t.expiry === expiry)?.atmIv ?? null;
  prevIv = fromTerm(cached);
  if (prevIv === null) {
    const chains = await fetchBhavcopyChains(sym, prevDate);
    if (chains && chains.length) {
      const solved = ivFromBhavChains(chains, prevDate, r);
      cacheBhavIv(sym, solved);
      prevIv = fromTerm(solved);
    }
  }
  return withChange({
    symbol: sym,
    kind: symbolKind(sym),
    expiry,
    spot: res.spotPrice,
    iv,
    prevIv,
    prevSource: prevIv === null ? null : "bhavcopy",
    sample: false,
    asOf: res.asOf || Date.now(),
  });
}
