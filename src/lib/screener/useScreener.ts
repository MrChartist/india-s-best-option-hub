/**
 * Screener data hooks: universe + OI spurts + MWPL/ban + the rotating per-symbol scan,
 * merged into ScreenerRow[]. Falls back to clearly labelled sample rows when the live
 * F&O list is unavailable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { proxyFetchJSON, proxyGet } from "@/lib/api/proxyClient";
import { fetchChainMulti, type HistoricalCandleResponse } from "@/lib/marketApi";
import { useFnOStocks, useLiveIndices, isLiveSession } from "@/hooks/useMarketData";
import { getDailyStats, putDailyStat, computeDailyStat } from "@/lib/snapshotStore";
import { addCalendarDays, getMarketSession, istDateString, isTradingDay, nowIST } from "@/lib/options";
import { useBanData, type FeedMeta } from "./banList";
import { parseDealsPayload, parseOiSpurtsPayload, type DealRow, type OiSpurtRow } from "./bigMoney";
import {
  buildRow,
  chainMetrics,
  ivpFromHistory,
  parseBhavRows,
  summariseFutures,
  type DailyBar,
  type ScreenerRow,
} from "./metrics";
import { sampleDeals, sampleRows } from "./sample";
import {
  OFFLINE_BACKOFF_MS,
  SCAN_INTERVAL_MS,
  isChainStale,
  parseEntries,
  pickNextJob,
  prioritise,
  pruneEntries,
  scanCoverage,
  scanTtl,
  type ScanEntries,
  type ScanEntry,
  type ScanPart,
} from "./scanner";
import { universeFromIndices, universeFromLive, type UniverseRow } from "./universe";

// ── Simple feeds ──

export function useOiSpurts() {
  return useQuery({
    queryKey: ["screener", "oi-spurts"],
    queryFn: async ({ signal }): Promise<{ data: OiSpurtRow[]; meta: FeedMeta }> => {
      const env = await proxyGet<unknown>("/api/x/oi-spurts", { type: "underlyings" }, { signal });
      return { data: parseOiSpurtsPayload(env.data), meta: env.meta };
    },
    refetchInterval: () => (isLiveSession() ? 3 * 60000 : 15 * 60000),
    staleTime: 60000,
    retry: 1,
  });
}

export function useDeals(kind: "bulk" | "block") {
  return useQuery({
    queryKey: ["screener", "deals", kind],
    queryFn: async ({ signal }): Promise<{ data: DealRow[]; meta: FeedMeta }> => {
      const env = await proxyGet<unknown>(kind === "bulk" ? "/api/x/bulk-deals" : "/api/x/block-deals", undefined, {
        signal,
      });
      if (env.data !== null && Array.isArray(env.data)) return { data: parseDealsPayload(env.data), meta: env.meta };
      return {
        data: sampleDeals(kind, istDateString()),
        meta: { source: "sample", asOf: Date.now(), stale: true, reason: env.meta.reason || "Deals feed unavailable" },
      };
    },
    refetchInterval: 15 * 60000,
    staleTime: 5 * 60000,
    retry: 1,
  });
}

// ── Rotating scan ──

const CACHE_KEY = "mc_screener_scan_v1";
const CACHE_MAX_AGE = 24 * 3600000;

function loadCache(): ScanEntries {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? parseEntries(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveCache(entries: ScanEntries): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(pruneEntries(entries, Date.now(), CACHE_MAX_AGE)));
  } catch {
    /* storage full or blocked: the scan still works for this visit */
  }
}

type JobResult = { ok: true; patch: Partial<ScanEntry> } | { ok: false; offline: boolean; reason: string };

const OFFLINE_REASONS = new Set(["offline", "timeout"]);

function afterCloseToday(): boolean {
  const n = nowIST();
  const s = getMarketSession();
  return isTradingDay(n.date) && n.hh * 60 + n.mm >= 15 * 60 + 30 && (s === "closing" || s === "closed");
}

async function runChain(symbol: string, signal: AbortSignal): Promise<JobResult> {
  const env = await fetchChainMulti(symbol, "next3", signal);
  const first = env.data?.expiries.find((e) => e.chain.length > 0);
  if (!env.data || !first)
    return { ok: false, offline: OFFLINE_REASONS.has(env.meta.reason ?? ""), reason: env.meta.reason || "No chain" };
  const spot = env.data.spot;
  const m = chainMetrics(first.chain, spot, first.expiry);
  const today = istDateString();
  let ivp: number | null = null;
  try {
    const stats = await getDailyStats(symbol, 365);
    ivp = ivpFromHistory(
      m.atmIv,
      stats.filter((s) => s.date !== today).map((s) => s.atmIv),
    );
    if (!env.meta.stale && afterCloseToday() && m.atmIv !== null) {
      await putDailyStat(computeDailyStat({ symbol, date: today, spot, chain: first.chain, expiry: first.expiry }));
    }
  } catch {
    ivp = null;
  }
  return {
    ok: true,
    patch: {
      chain: {
        pcrOi: m.pcrOi,
        pcrVol: m.pcrVol,
        atmIv: m.atmIv,
        ivp,
        expiry: first.expiry,
        spot,
        source: env.meta.stale ? "cache" : env.meta.source,
        asOf: Date.now(),
      },
    },
  };
}

async function runFutures(symbol: string, signal: AbortSignal): Promise<JobResult> {
  const env = await proxyGet<unknown>("/api/x/bhavcopy-fo", { symbol }, { signal, timeoutMs: 30000 });
  const rows = parseBhavRows(env.data);
  if (!rows)
    return { ok: false, offline: OFFLINE_REASONS.has(env.meta.reason ?? ""), reason: env.meta.reason || "No bhavcopy" };
  const asOfIso = istDateString(new Date(env.meta.asOf));
  return { ok: true, patch: { futures: { ...summariseFutures(rows, asOfIso), asOf: Date.now() } } };
}

async function runHistory(symbol: string, signal: AbortSignal): Promise<JobResult> {
  try {
    const today = istDateString();
    // Same request as fetchYahooChart, with the scan's AbortSignal so pause/unmount cancels it.
    const res = await proxyFetchJSON<HistoricalCandleResponse>(
      "/api/yahoo-chart",
      { symbol, interval: "D", fromDate: addCalendarDays(today, -70), toDate: today },
      { withDhan: false, signal },
    );
    const d = res.data;
    const ts = d.timestamp ?? d.start_Time ?? [];
    const bars: DailyBar[] = [];
    ts.forEach((t, i) => {
      const sec = typeof t === "number" ? t : Number(t);
      const close = d.close?.[i];
      if (!Number.isFinite(sec) || close === null || close === undefined || !Number.isFinite(close)) return;
      const ms = sec > 1e12 ? sec : sec * 1000;
      bars.push({ date: istDateString(new Date(ms)), close, volume: Number(d.volume?.[i] ?? 0) || 0 });
    });
    if (bars.length === 0) return { ok: false, offline: false, reason: "No candles" };
    return { ok: true, patch: { history: { bars: bars.slice(-60), asOf: Date.now() } } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "History unavailable";
    return { ok: false, offline: msg === "Proxy unreachable" || msg === "Proxy request timed out", reason: msg };
  }
}

export interface ScanProgress {
  done: number;
  fresh: number;
  total: number;
  current: { symbol: string; part: ScanPart } | null;
  paused: boolean;
  offlineReason: string | null;
  lastRunAt: number | null;
}

export function useRotatingScan(order: readonly string[], enabled: boolean) {
  const [entries, setEntries] = useState<ScanEntries>(() => loadCache());
  const [paused, setPaused] = useState(false);
  const [current, setCurrent] = useState<{ symbol: string; part: ScanPart } | null>(null);
  const [offlineReason, setOfflineReason] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const entriesRef = useRef(entries);
  const orderRef = useRef(order);
  const lastStartRef = useRef(0);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  // Persist (debounced). A change still pending when the page hides or the Screener unmounts is
  // flushed then, so a result that landed in the last 2 s is not rescanned on the next visit.
  const dirtyRef = useRef(false);
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    dirtyRef.current = true;
    const t = setTimeout(() => {
      dirtyRef.current = false;
      saveCache(entries);
    }, 2000);
    return () => clearTimeout(t);
  }, [entries]);
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      saveCache(entriesRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    if (!enabled || paused) {
      setCurrent(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, SCAN_INTERVAL_MS);
        return;
      }
      const t0 = Date.now();
      const ttl = scanTtl(isLiveSession());
      const job = pickNextJob(orderRef.current, entriesRef.current, t0, ttl);
      if (!job) {
        setCurrent(null);
        timer = setTimeout(tick, 15000);
        return;
      }
      setCurrent(job);
      lastStartRef.current = t0;
      let res: JobResult;
      try {
        res =
          job.part === "chain"
            ? await runChain(job.symbol, ctrl.signal)
            : job.part === "futures"
              ? await runFutures(job.symbol, ctrl.signal)
              : await runHistory(job.symbol, ctrl.signal);
      } catch (e) {
        res = { ok: false, offline: false, reason: e instanceof Error ? e.message : "Scan failed" };
      }
      if (cancelled) return;
      setLastRunAt(Date.now());
      if (res.ok) {
        const patch = res.patch;
        setOfflineReason(null);
        setEntries((prev) => {
          const old = prev[job.symbol] ?? {};
          const failedAt = { ...(old.failedAt ?? {}) };
          delete failedAt[job.part];
          return { ...prev, [job.symbol]: { ...old, ...patch, failedAt } };
        });
      } else if (res.offline) {
        setOfflineReason(res.reason);
      } else {
        setEntries((prev) => {
          const old = prev[job.symbol] ?? {};
          return { ...prev, [job.symbol]: { ...old, failedAt: { ...(old.failedAt ?? {}), [job.part]: Date.now() } } };
        });
      }
      const wait = !res.ok && res.offline ? OFFLINE_BACKOFF_MS : Math.max(0, SCAN_INTERVAL_MS - (Date.now() - t0));
      timer = setTimeout(tick, wait);
    };

    const sinceLast = Date.now() - lastStartRef.current;
    timer = setTimeout(tick, Math.max(500, SCAN_INTERVAL_MS - sinceLast));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      ctrl.abort();
    };
  }, [enabled, paused]);

  const now = lastRunAt ?? Date.now();
  const ttl = scanTtl(isLiveSession());
  const cov = scanCoverage(order, entries, now, ttl);
  const progress: ScanProgress = { ...cov, current, paused, offlineReason, lastRunAt };
  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => setPaused(false), []);
  const clear = useCallback(() => {
    setEntries({});
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }, []);
  return { entries, progress, pause, resume, clear };
}

// ── Merged rows ──

export type UniverseSource = "nse" | "database" | "sample";

export interface ScreenerData {
  rows: ScreenerRow[];
  isSample: boolean;
  isLoading: boolean;
  universeSource: UniverseSource;
  universeAsOf: number;
  universeStale: boolean;
  universeReason?: string;
  mwplLive: boolean;
  scan: ReturnType<typeof useRotatingScan>;
  ban: ReturnType<typeof useBanData>;
  spurtsMeta: FeedMeta | null;
}

function byVolume(a: UniverseRow, b: UniverseRow) {
  if (a.kind !== b.kind) return a.kind === "INDEX" ? -1 : 1;
  return b.volume - a.volume;
}

export function useScreenerData(priority: readonly string[]): ScreenerData {
  const fno = useFnOStocks();
  const indices = useLiveIndices();
  const spurts = useOiSpurts();
  const ban = useBanData();

  const universe = useMemo(() => {
    const stocks = universeFromLive(fno.data?.allStocks ?? []);
    if (stocks.length === 0) return [];
    return [...universeFromIndices(indices.data?.data ?? []), ...stocks].sort(byVolume);
  }, [fno.data?.allStocks, indices.data?.data]);

  const liveMode = universe.length > 0;
  const universeSymbols = useMemo(() => universe.map((u) => u.symbol), [universe]);
  const prioKey = priority.slice(0, 60).join(",");
  const order = useMemo(
    () => prioritise(prioKey ? prioKey.split(",") : [], universeSymbols),
    [prioKey, universeSymbols],
  );
  const scan = useRotatingScan(order, liveMode);

  const mwplLive = !!ban.mwplMeta && ban.mwplMeta.source !== "sample";
  const banLive = !!ban.banMeta && ban.banMeta.source !== "sample";

  const rows = useMemo((): ScreenerRow[] => {
    if (!liveMode) return sampleRows();
    const today = istDateString();
    const ttl = scanTtl(isLiveSession());
    const now = Date.now();
    const spurtMap = new Map((spurts.data?.data ?? []).map((s) => [s.symbol, s.chgOiPct]));
    const mwplMap = new Map(mwplLive ? ban.mwpl.map((m) => [m.symbol, m.mwplPct]) : []);
    const banned = new Set(banLive ? (ban.ban?.symbols ?? []) : []);
    return universe.map((u) => {
      const e = scan.entries[u.symbol];
      return buildRow({
        symbol: u.symbol,
        kind: u.kind,
        sector: u.sector,
        ltp: u.ltp,
        changePct: u.changePct,
        volume: u.volume,
        spurtOiChgPct: spurtMap.get(u.symbol) ?? null,
        chain: e?.chain
          ? {
              pcrOi: e.chain.pcrOi,
              atmIv: e.chain.atmIv,
              ivp: e.chain.ivp,
              stale: isChainStale(e, now, ttl),
              asOf: e.chain.asOf,
            }
          : null,
        futures: e?.futures ?? null,
        bars: e?.history?.bars ?? null,
        todayIso: today,
        mwplPct: mwplMap.get(u.symbol) ?? null,
        banned: banned.has(u.symbol),
      });
    });
  }, [liveMode, universe, scan.entries, spurts.data, ban.mwpl, ban.ban, mwplLive, banLive]);

  const src = fno.data?.source;
  const universeSource: UniverseSource = !liveMode
    ? "sample"
    : src === "database"
      ? "database"
      : "nse";

  return {
    rows,
    isSample: !liveMode,
    isLoading: fno.isLoading,
    universeSource,
    universeAsOf: fno.data?.asOf ?? Date.now(),
    universeStale: !liveMode || !!fno.data?.stale,
    universeReason: !liveMode ? fno.data?.reason || "Live F&O list unavailable" : fno.data?.reason,
    mwplLive,
    scan,
    ban,
    spurtsMeta: spurts.data?.meta ?? null,
  };
}
