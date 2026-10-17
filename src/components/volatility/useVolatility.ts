/**
 * React Query hooks for the Volatility page and the dashboard IV widgets.
 * Every hook reports where its numbers came from so the UI can label sample or derived data.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAllIndices, useChainMulti } from "@/hooks/useMarketData";
import { getMarketParams, previousTradingDay } from "@/lib/options";
import {
  backfillBhavcopyIv,
  cacheBhavIv,
  cachedBhavPoints,
  fetchBhavcopyChains,
  fetchDailyBars,
  fetchVixHistory,
  loadDailyStats,
  type BackfillProgress,
} from "@/lib/volatility/api";
import {
  computeIvStats,
  dailyStatsToPoints,
  ivFromBhavChains,
  lastSessionDate,
  latestBhavcopyDate,
  mergeIvPoints,
  recentTradingDays,
  vixRowsToPoints,
  type BhavExpiryChain,
  type BhavcopyIv,
  type IvPoint,
  type IvStats,
} from "@/lib/volatility/history";
import { buildExpirySmiles, deltaSurface, expectedMoveRows, iv30FromTerm, termShape, termStructure, type ExpiryChain } from "@/lib/volatility/surface";
import type { DailyStat } from "@/lib/snapshotStore";

export const VIX_SYMBOLS = new Set(["NIFTY"]);

// ── Multi-expiry chain → smiles, term structure, surface, expected move ──

export function useVolChains(symbol: string, expiries: "all" | "next3" = "all") {
  const q = useChainMulti(symbol, expiries);
  const data = q.data;
  const derived = useMemo(() => {
    const now = new Date();
    const r = getMarketParams().r;
    const spot = data?.spot ?? 0;
    const chains: ExpiryChain[] = (data?.expiries ?? []).map((e) => ({ expiry: e.expiry, chain: e.chain }));
    const smiles = spot > 0 ? buildExpirySmiles(chains, { spot, now, r }) : [];
    const term = termStructure(smiles, now);
    return {
      spot,
      chains,
      smiles,
      term,
      shape: termShape(term),
      iv30: iv30FromTerm(term),
      surface: deltaSurface(smiles),
      moves: spot > 0 ? expectedMoveRows(chains, smiles, spot, now) : [],
    };
  }, [data]);
  return {
    ...derived,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
    isFetching: q.isFetching,
    source: data?.source ?? "none",
    isSample: data?.source === "sample",
    isLive: data?.isLive ?? false,
    asOf: data?.asOf ?? 0,
    stale: data?.stale ?? true,
    reason: data?.reason,
  };
}

// ── Daily bars for realised vol ──

export function useDailyBars(symbol: string) {
  return useQuery({
    queryKey: ["vol-daily-bars", symbol.toUpperCase()],
    queryFn: () => fetchDailyBars(symbol, 800),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

// ── IV history ──

export interface IvHistoryData {
  vix: IvPoint[];
  bhavcopy: IvPoint[];
  snapshot: IvPoint[];
  /** bhavcopy IV30 first, then snapshot ATM IV for dates not backfilled. */
  iv30: IvPoint[];
  dailyStats: DailyStat[];
  vixSource?: string;
  vixReason?: string;
}

export function useIvHistory(symbol: string) {
  const sym = symbol.toUpperCase();
  return useQuery({
    queryKey: ["iv-history", sym],
    queryFn: async ({ signal }): Promise<IvHistoryData> => {
      const [vixRes, stats] = await Promise.all([
        VIX_SYMBOLS.has(sym) ? fetchVixHistory(400, signal) : Promise.resolve(null),
        loadDailyStats(sym, 400),
      ]);
      const bhav = cachedBhavPoints(sym);
      const snap = dailyStatsToPoints(stats);
      return {
        vix: vixRowsToPoints(vixRes?.data),
        bhavcopy: bhav,
        snapshot: snap,
        iv30: mergeIvPoints(bhav, snap),
        dailyStats: stats,
        vixSource: vixRes?.source,
        vixReason: vixRes?.reason,
      };
    },
    staleTime: 15 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

/** Bhavcopy backfill with progress; refreshes the IV history when done. */
export function useIvBackfill(symbol: string) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [running, setRunning] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    ctrl.current?.abort();
    setProgress(null);
    setRunning(false);
  }, [symbol]);

  const run = useCallback(
    async (days: number) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setRunning(true);
      try {
        const dates = recentTradingDays(latestBhavcopyDate(), days);
        await backfillBhavcopyIv(symbol, dates, { concurrency: 2, signal: c.signal, onProgress: setProgress });
      } finally {
        if (!c.signal.aborted) {
          setRunning(false);
          await qc.invalidateQueries({ queryKey: ["iv-history", symbol.toUpperCase()] });
        }
      }
    },
    [symbol, qc],
  );
  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setRunning(false);
  }, []);
  return { run, cancel, progress, running };
}

// ── Previous session from the bhavcopy (yesterday overlays) ──

export interface PrevSessionData {
  date: string;
  chains: BhavExpiryChain[];
  iv: BhavcopyIv | null;
}

export function usePrevSessionBhav(symbol: string, enabled = true) {
  const sym = symbol.toUpperCase();
  const date = previousTradingDay(lastSessionDate());
  return useQuery({
    queryKey: ["vol-prev-bhav", sym, date],
    queryFn: async ({ signal }): Promise<PrevSessionData | null> => {
      const chains = await fetchBhavcopyChains(sym, date, signal);
      if (!chains || chains.length === 0) return null;
      const iv = ivFromBhavChains(chains, date, getMarketParams().r);
      cacheBhavIv(sym, iv);
      return { date, chains, iv };
    },
    enabled,
    staleTime: 6 * 3600_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

// ── IV rank / percentile for a symbol ──

export type IvBasis = "vix" | "iv30";

export interface IvRankResult {
  basis: IvBasis;
  basisLabel: string;
  current: number;
  currentLabel: string;
  stats: IvStats;
  history: IvPoint[];
  /** The current value came from the labelled sample chain. */
  currentIsSample: boolean;
  isLoading: boolean;
  historySummary: string;
}

/**
 * IV rank inputs. NIFTY defaults to India VIX (a long, consistent 30-day series); other symbols use
 * bhavcopy IV30 merged with locally recorded ATM IV, compared against the live IV30 from the chain.
 */
export function useIvRank(symbol: string, o?: { basis?: IvBasis; expiries?: "all" | "next3" }): IvRankResult {
  const sym = symbol.toUpperCase();
  const basis: IvBasis = o?.basis ?? (VIX_SYMBOLS.has(sym) ? "vix" : "iv30");
  const hist = useIvHistory(sym);
  const all = useAllIndices();
  // An empty symbol disables the chain query when VIX is the basis.
  const chains = useVolChains(basis === "vix" ? "" : sym, o?.expiries ?? "next3");

  return useMemo(() => {
    const h = hist.data;
    if (basis === "vix") {
      const history = h?.vix ?? [];
      const live = all.data.vix?.value;
      const current = live && live > 0 ? live : history[history.length - 1]?.iv ?? NaN;
      return {
        basis,
        basisLabel: "India VIX",
        current,
        currentLabel: live && live > 0 ? "India VIX (live)" : "India VIX (last close)",
        stats: computeIvStats(current, history),
        history,
        currentIsSample: false,
        isLoading: hist.isLoading,
        historySummary: `${history.length} days of India VIX${h?.vixSource ? ` (${h.vixSource.toUpperCase()})` : ""}`,
      };
    }
    const history = h?.iv30 ?? [];
    const current = chains.iv30;
    const nb = h?.bhavcopy.length ?? 0;
    const ns = h?.snapshot.length ?? 0;
    return {
      basis,
      basisLabel: "ATM IV30",
      current,
      currentLabel: chains.isSample ? "IV30 (sample chain)" : "IV30 from the live chain",
      // A sample chain must never feed a rank.
      stats: computeIvStats(chains.isSample ? NaN : current, history),
      history,
      currentIsSample: chains.isSample,
      isLoading: hist.isLoading || chains.isLoading,
      historySummary: `${nb} bhavcopy day${nb === 1 ? "" : "s"} + ${ns} recorded day${ns === 1 ? "" : "s"}`,
    };
  }, [basis, hist.data, hist.isLoading, all.data.vix, chains.iv30, chains.isSample, chains.isLoading]);
}
