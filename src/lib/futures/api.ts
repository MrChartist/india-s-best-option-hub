/**
 * Futures data loaders: NSE F&O bhavcopy rows through the local proxy (gated by the proxy
 * reachability check, so an offline proxy fails fast), stored day by day in this browser, with a
 * clearly labelled sample fallback when neither live nor saved data exists.
 */
import { proxyGet, type ProxyMeta } from "@/lib/api/proxyClient";
import { getContractSpec, isTradingDay, istDateString, nowIST, previousTradingDay } from "@/lib/options";
import { parseBhavRows } from "@/lib/screener/metrics";
import { futuresDayFromBhav, type FuturesDay } from "./model";
import { SAMPLE_SESSIONS, sampleFuturesHistory } from "./sample";
import { loadDays, saveDays } from "./store";

export type FuturesMode = "live" | "cache" | "sample";

export const INDEX_FUTURES: readonly string[] = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
/** Liquid stock futures shown in the overview (any F&O stock can be opened from the search). */
export const STOCK_FUTURES: readonly string[] = [
  "RELIANCE",
  "HDFCBANK",
  "ICICIBANK",
  "INFY",
  "TCS",
  "SBIN",
  "AXISBANK",
  "KOTAKBANK",
  "LT",
  "ITC",
  "BHARTIARTL",
  "BAJFINANCE",
  "MARUTI",
  "SUNPHARMA",
  "HINDUNILVR",
  "TATASTEEL",
];

/** Reasons that mean the proxy (not one file) is unreachable: stop asking for more files. */
const OFFLINE = new Set(["offline", "timeout", "proxy-offline", "sample-mode", "aborted"]);

export function isOfflineReason(reason: string | undefined): boolean {
  return !!reason && OFFLINE.has(reason);
}

/** True for symbols whose futures are not in the NSE bhavcopy (BSE contracts). */
export function isBseSymbol(symbol: string): boolean {
  return getContractSpec(symbol)?.exchange === "BSE";
}

/** Latest trade date whose bhavcopy should exist: today after 19:00 IST on a trading day, else the previous session. */
export function latestBhavDate(now: Date = new Date()): string {
  const t = nowIST(now);
  if (isTradingDay(t.date) && t.hh >= 19) return t.date;
  return previousTradingDay(t.date);
}

export interface DayResult {
  day: FuturesDay | null;
  meta: ProxyMeta;
}

/** One symbol's futures for a date (latest file when `date` is omitted). */
export async function fetchFuturesDay(
  symbol: string,
  date: string | undefined,
  signal?: AbortSignal,
): Promise<DayResult> {
  const env = await proxyGet<unknown>("/api/x/bhavcopy-fo", { symbol, date }, { signal, timeoutMs: 60000 });
  const rows = parseBhavRows(env.data);
  if (!rows) return { day: null, meta: env.meta };
  const tradeDate = date ?? istDateString(new Date(env.meta.asOf));
  const day = futuresDayFromBhav(symbol, tradeDate, rows);
  return { day: day.contracts.length > 0 ? day : null, meta: env.meta };
}

export interface SymbolSnapshot {
  symbol: string;
  latest: FuturesDay | null;
  prev: FuturesDay | null;
  source: FuturesMode;
}

/**
 * Latest snapshot plus the previous session (for price change) for one symbol. Saves what it
 * fetches; falls back to the newest saved days when the file cannot be fetched.
 */
export async function fetchSymbolSnapshot(
  symbol: string,
  signal?: AbortSignal,
): Promise<SymbolSnapshot & { offline: boolean; reason?: string }> {
  const res = await fetchFuturesDay(symbol, undefined, signal);
  if (res.day) {
    const day = res.day;
    saveDays([day]);
    let prev =
      loadDays(symbol)
        .filter((d) => d.date < day.date)
        .pop() ?? null;
    const expectedPrev = previousTradingDay(day.date);
    if (!prev || prev.date !== expectedPrev) {
      const p = await fetchFuturesDay(symbol, expectedPrev, signal);
      if (p.day) {
        saveDays([p.day]);
        prev = p.day;
      }
    }
    return {
      symbol,
      latest: day,
      prev,
      source: res.meta.stale || res.meta.source === "cache" ? "cache" : "live",
      offline: false,
    };
  }
  const saved = loadDays(symbol);
  const latest = saved.pop() ?? null;
  return {
    symbol,
    latest,
    prev: saved.pop() ?? null,
    source: "cache",
    offline: isOfflineReason(res.meta.reason),
    reason: res.meta.reason,
  };
}

export interface Overview {
  snapshots: SymbolSnapshot[];
  mode: FuturesMode;
  /** Newest trade date among the snapshots. */
  asOfDate: string | null;
  reason?: string;
}

/** Sample snapshots for every symbol (latest and previous sample day). */
export function sampleOverview(symbols: readonly string[], end: string, reason?: string): Overview {
  const snapshots = symbols.map((symbol) => {
    const h = sampleFuturesHistory(symbol, end, SAMPLE_SESSIONS);
    return { symbol, latest: h[h.length - 1] ?? null, prev: h[h.length - 2] ?? null, source: "sample" as const };
  });
  return { snapshots, mode: "sample", asOfDate: snapshots[0]?.latest?.date ?? end, reason };
}

/**
 * Overview for a list of symbols, fetched a few at a time. If the proxy is unreachable and
 * nothing is saved, every row is sample data (never a mix of sample and market rows).
 */
export async function loadOverview(
  symbols: readonly string[],
  opts: { signal?: AbortSignal; concurrency?: number; now?: Date } = {},
): Promise<Overview> {
  const nse = symbols.filter((s) => !isBseSymbol(s));
  const results: Array<SymbolSnapshot & { offline: boolean; reason?: string }> = [];
  let offline = false;
  let reason: string | undefined;
  let next = 0;
  const worker = async () => {
    while (next < nse.length && !offline) {
      const symbol = nse[next++];
      const r = await fetchSymbolSnapshot(symbol, opts.signal);
      results.push(r);
      if (r.offline) {
        offline = true;
        reason = r.reason;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, nse.length)) }, worker));

  const order = new Map(nse.map((s, i) => [s, i]));
  // Symbols never reached because the proxy went offline still get their saved copy.
  for (const s of nse) {
    if (results.some((r) => r.symbol === s)) continue;
    const saved = loadDays(s);
    const latest = saved.pop() ?? null;
    results.push({ symbol: s, latest, prev: saved.pop() ?? null, source: "cache", offline: true });
  }
  results.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));

  const withData = results.filter((r) => r.latest);
  if (withData.length === 0)
    return sampleOverview(nse, latestBhavDate(opts.now), reason ?? "The NSE F&O bhavcopy could not be loaded.");
  const anyLive = withData.some((r) => r.source === "live");
  const asOfDate =
    withData
      .map((r) => r.latest!.date)
      .sort()
      .pop() ?? null;
  return {
    snapshots: results.map(({ symbol, latest, prev, source }) => ({ symbol, latest, prev, source })),
    mode: anyLive ? "live" : "cache",
    asOfDate,
    reason: anyLive
      ? undefined
      : reason
        ? `NSE unreachable (${reason}). Showing days saved in this browser.`
        : "Showing days saved in this browser.",
  };
}
