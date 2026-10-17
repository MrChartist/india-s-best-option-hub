/**
 * Pure data-freshness policy for the market-data hooks (src/hooks/useMarketData.ts).
 *
 * Everything here is deterministic and React-free so it can be unit tested: how often each query
 * polls in each market session, how saved IndexedDB prices become an index list, and the
 * SourceMeta stamp every hook result carries.
 */
// Leaf modules, not the "@/lib/options" barrel: this file sits in the entry chunk.
import { formatTimeIST } from "@/lib/options/format";
import { getMarketSession, istDateString, type MarketSession } from "@/lib/options/time";
import type { IndexData } from "@/lib/mockData";
import type { PriceSnapshot } from "@/lib/localDatabase";
import type { DataSource, SourceMeta } from "@/lib/types/market";

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;

/** True during the pre-open and normal session (live data can change). */
export function isLiveSession(session: MarketSession = getMarketSession()): boolean {
  return session === "open" || session === "pre-open";
}

/** Build a SourceMeta stamp; `reason` is only included when non-empty. */
export function meta(source: SourceMeta["source"], asOf: number = Date.now(), stale = false, reason?: string): SourceMeta {
  return reason ? { source, asOf, stale, reason } : { source, asOf, stale };
}

/** Minimal shape of a chain result the polling policy needs. */
export interface ChainPollState {
  isLive?: boolean;
  source?: DataSource | string;
}

/**
 * Option chain polling: 3 s while a live chain streams in session, 15 s when the last answer was a
 * cached/after-hours chain, 20 s while showing sample data (keep trying a live source) and 5 min
 * outside the session (the chain will not change).
 */
export function chainRefetchInterval(data: ChainPollState | undefined, live: boolean = isLiveSession()): number {
  if (!live) return 5 * MINUTE;
  if (data?.isLive) return 3 * SECOND;
  if (data?.source === "sample") return 20 * SECOND;
  return 15 * SECOND;
}

/**
 * Index polling: the WebSocket feed makes polling a slow backstop (2 min); outside the session
 * prices are fixed (5 min); in session 15 s with a live source, 60 s while offline.
 */
export function indicesRefetchInterval(opts: { wsConnected: boolean; live?: boolean; isLive?: boolean }): number {
  const live = opts.live ?? isLiveSession();
  if (opts.wsConnected) return 2 * MINUTE;
  if (!live) return 5 * MINUTE;
  return opts.isLive ? 15 * SECOND : MINUTE;
}

/** VIX, sectors and breadth: 30 s live, 2 min offline or when the WebSocket carries VIX, 5 min after hours. */
export function allIndicesRefetchInterval(opts: { wsConnected: boolean; live?: boolean; isLive?: boolean }): number {
  const live = opts.live ?? isLiveSession();
  if (opts.wsConnected) return 2 * MINUTE;
  if (!live) return 5 * MINUTE;
  return opts.isLive ? 30 * SECOND : 2 * MINUTE;
}

/** Market status: 15 s in session with a live answer, otherwise once a minute (the IST clock is local). */
export function marketStatusRefetchInterval(isLive: boolean | undefined, live: boolean = isLiveSession()): number {
  return isLive && live ? 15 * SECOND : MINUTE;
}

/** Multi-expiry chain: 15 s live, 60 s in session without a live answer, 5 min after hours. */
export function chainMultiRefetchInterval(isLive: boolean | undefined, live: boolean = isLiveSession()): number {
  if (isLive) return 15 * SECOND;
  return live ? MINUTE : 5 * MINUTE;
}

/** F&O movers: 30 s live in session, 2 min in session otherwise, 5 min after hours. */
export function fnoRefetchInterval(isLive: boolean | undefined, live: boolean = isLiveSession()): number {
  if (!live) return 5 * MINUTE;
  return isLive ? 30 * SECOND : 2 * MINUTE;
}

/** NSE index names for the symbols the local price cache stores. */
export const CACHED_INDEX_NAMES: Readonly<Record<string, string>> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  FINNIFTY: "NIFTY FINANCIAL SERVICES",
  MIDCPNIFTY: "NIFTY MIDCAP SELECT",
};

/**
 * Turn saved price snapshots into the index list the header and dashboard show offline.
 * Order follows CACHED_INDEX_NAMES; asOf is the newest snapshot timestamp (0 when none).
 */
export function buildCachedIndices(prices: readonly PriceSnapshot[]): { data: IndexData[]; asOf: number } {
  let asOf = 0;
  const data: IndexData[] = [];
  for (const [sym, name] of Object.entries(CACHED_INDEX_NAMES)) {
    const p = prices.find((pr) => pr.symbol === sym);
    if (!p || !(p.ltp > 0)) continue;
    asOf = Math.max(asOf, p.timestamp || 0);
    data.push({
      name,
      symbol: sym,
      ltp: p.ltp,
      change: p.change,
      changePercent: p.changePercent,
      high: p.high,
      low: p.low,
      open: p.open,
      prevClose: p.close,
    });
  }
  return { data, asOf };
}

const REASON_COPY: Readonly<Record<string, string>> = {
  offline: "Proxy offline",
  "proxy-offline": "Proxy offline",
  timeout: "Proxy timed out",
  "sample-mode": "Sample mode (VITE_DATA_MODE=sample)",
  aborted: "Request cancelled",
};

/** Readable reason for a sample fallback from a proxy error message or machine reason. */
export function fallbackReason(err: unknown, fallback = "Proxy offline"): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!raw) return fallback;
  if (REASON_COPY[raw]) return REASON_COPY[raw];
  if (/unreachable|failed to fetch|network/i.test(raw)) return "Proxy offline";
  if (/timed out|timeout/i.test(raw)) return "Proxy timed out";
  if (/sample data mode/i.test(raw)) return REASON_COPY["sample-mode"];
  return raw.slice(0, 160);
}

// ── Expiry list: refresh once per IST trading day ──

/** Expiry calendars change at most once a day, so the list is fresh for 6 hours and never polled. */
export const EXPIRY_LIST_STALE_MS = 6 * 60 * MINUTE;

const IST_OFFSET_MS = 330 * MINUTE;
const DAY_MS = 24 * 60 * MINUTE;

/**
 * Milliseconds from `now` until the next IST midnight (00:00 Asia/Kolkata), plus a small `slackMs`
 * so a timer set with it fires after the date has rolled. Always > 0.
 */
export function msUntilNextISTMidnight(now: number = Date.now(), slackMs = SECOND): number {
  const istMs = now + IST_OFFSET_MS;
  const nextMidnightIst = Math.floor(istMs / DAY_MS) * DAY_MS + DAY_MS;
  return nextMidnightIst - istMs + Math.max(0, slackMs);
}

/** IST calendar date ("yyyy-mm-dd") used in the expiry-list query key, so the list refetches on the roll. */
export function istDayKey(now: number = Date.now()): string {
  return istDateString(new Date(now));
}

// ── Offline / cached labels ──

/** Sources that are a saved copy rather than a fresh read (local IndexedDB or a last-good cache). */
export function isCachedSource(source: SourceMeta["source"] | string | undefined): boolean {
  return source === "database" || source === "cache";
}

/** "Cached at 14:05 IST" for a saved copy; "" when the timestamp is unusable. */
export function cachedAtLabel(asOf: number | null | undefined): string {
  if (typeof asOf !== "number" || !Number.isFinite(asOf) || asOf <= 0) return "";
  return `Cached at ${formatTimeIST(asOf)}`;
}

/** Append the cached-at label to a fallback reason ("Proxy offline. Cached at 14:05 IST"). */
export function withCachedLabel(reason: string | undefined, asOf: number | null | undefined): string {
  const label = cachedAtLabel(asOf);
  const base = (reason ?? "").trim().replace(/[.\s]+$/, "");
  if (!label) return base;
  return base ? `${base}. ${label}` : label;
}
