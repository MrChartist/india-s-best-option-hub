/**
 * React Query hooks for the Volatility page and the dashboard IV widgets.
 * Every hook reports where its numbers came from so the UI can label sample or derived data.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAllIndices, useChainMulti } from "@/hooks/useMarketData";
import { getMarketParams, previousTradingDay, sampleSeed, type OHLC } from "@/lib/options";
import {
  backfillBhavcopyIv,
  cacheBhavIv,
  cachedBhavEntries,
  cachedBhavPoints,
  dailySnapshotAtm,
  fetchBhavcopyChains,
  fetchDailyBars,
  fetchVixHistory,
  loadDailyStats,
  type BackfillProgress,
} from "@/lib/volatility/api";
import { bhavTermByExpiry, mergeExpiryHistories, type ExpiryHistory } from "@/lib/volatility/atmHistory";
import { buildCompareRow, ivSpreadSeries, type CompareRow, type SpreadSeries } from "@/lib/volatility/compare";
import { sampleExpiryAtmHistory, sampleVolHistory, sampleWeeklyMonthly } from "@/lib/volatility/sampleHistory";
import { weeklyVsMonthly } from "@/lib/volatility/vix";
import {
  computeIvStats,
  dailyStatsToPoints,
  ivFromBhavChains,
  MIN_HISTORY_DAYS,
  joinSpotIv,
  lastSessionDate,
  latestBhavcopyDate,
  mergeIvPoints,
  recentTradingDays,
  vixRowsToPoints,
  type BhavExpiryChain,
  type BhavcopyIv,
  type IvPoint,
  type IvStats,
  type SpotIvRow,
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
  /** NIFTY only: India VIX was unavailable, so the chain's ATM IV30 stands in (a derived value). */
  currentIsDerived: boolean;
  /** The history is the seeded, labelled one-year sample (no real history and no live chain). */
  historyIsSample: boolean;
  /** Daily bars that belong to the sample history (null unless historyIsSample). */
  sampleBars: OHLC[] | null;
  isLoading: boolean;
  historySummary: string;
}

/**
 * IV rank inputs. NIFTY defaults to India VIX (a long, consistent 30-day series) and falls back to
 * the chain's ATM IV30, marked derived, when VIX is unavailable. Other symbols use bhavcopy IV30
 * merged with locally recorded ATM IV, compared against the IV30 from the chain.
 *
 * When there is no real history and the chain is the labelled sample, a seeded one-year sample IV
 * series (and matching bars) is generated so the analytics can be demonstrated; every consumer
 * must show a sample label when `historyIsSample` or `currentIsSample` is true.
 */
export function useIvRank(symbol: string, o?: { basis?: IvBasis; expiries?: "all" | "next3"; allowSample?: boolean }): IvRankResult {
  const sym = symbol.toUpperCase();
  const basis: IvBasis = o?.basis ?? (VIX_SYMBOLS.has(sym) ? "vix" : "iv30");
  const allowSample = o?.allowSample ?? true;
  const hist = useIvHistory(sym);
  const all = useAllIndices();
  const liveVix = all.data.vix?.value ?? 0;
  const vixHistLen = hist.data?.vix.length ?? 0;
  const vixAvailable = basis === "vix" && (liveVix > 0 || vixHistLen > 0);
  const needChain = basis !== "vix" || (!hist.isLoading && !vixAvailable);
  // An empty symbol disables the chain query while India VIX is usable.
  const chains = useVolChains(needChain ? sym : "", o?.expiries ?? "next3");

  return useMemo((): IvRankResult => {
    const h = hist.data;
    if (basis === "vix" && vixAvailable) {
      const history = h?.vix ?? [];
      const current = liveVix > 0 ? liveVix : history[history.length - 1]?.iv ?? NaN;
      return {
        basis,
        basisLabel: "India VIX",
        current,
        currentLabel: liveVix > 0 ? "India VIX (live)" : "India VIX (last close)",
        stats: computeIvStats(current, history),
        history,
        currentIsSample: false,
        currentIsDerived: false,
        historyIsSample: false,
        sampleBars: null,
        isLoading: hist.isLoading,
        historySummary: `${history.length} days of India VIX${h?.vixSource ? ` (${h.vixSource.toUpperCase()})` : ""}`,
      };
    }
    const derived = basis === "vix";
    const real = h?.iv30 ?? [];
    const current = chains.iv30;
    const sample =
      allowSample && chains.isSample && real.length < MIN_HISTORY_DAYS && Number.isFinite(current) && chains.spot > 0
        ? sampleVolHistory({ symbol: sym, spot: chains.spot, atmIv: current })
        : null;
    const history = sample && sample.iv.length ? sample.iv : real;
    const nb = h?.bhavcopy.length ?? 0;
    const ns = h?.snapshot.length ?? 0;
    return {
      basis,
      basisLabel: derived ? "ATM IV30 (India VIX unavailable)" : "ATM IV30",
      current,
      currentLabel: chains.isSample ? "IV30 (sample chain)" : derived ? "IV30 from the chain (derived)" : "IV30 from the live chain",
      // A sample chain only feeds a rank against the sample history, never against real history.
      stats: computeIvStats(chains.isSample && !sample ? NaN : current, history),
      history,
      currentIsSample: chains.isSample,
      currentIsDerived: derived,
      historyIsSample: !!sample,
      sampleBars: sample ? sample.bars : null,
      isLoading: hist.isLoading || chains.isLoading,
      historySummary: sample ? "1 year of labelled sample IV" : `${nb} bhavcopy day${nb === 1 ? "" : "s"} + ${ns} recorded day${ns === 1 ? "" : "s"}`,
    };
  }, [basis, vixAvailable, liveVix, allowSample, sym, hist.data, hist.isLoading, chains.iv30, chains.isSample, chains.isLoading, chains.spot]);
}

// ── India VIX analytics ──

export interface VixAnalyticsData {
  /** India VIX history (or the labelled sample). */
  vix: IvPoint[];
  /** NIFTY daily bars paired with the VIX history (or the sample bars). */
  bars: OHLC[];
  isSample: boolean;
  /** Latest VIX: live when available, else the last close (sample when isSample). */
  current: number;
  currentLabel: string;
  spot: number;
  /** NIFTY ATM term structure for the weekly-vs-monthly proxy. */
  term: Array<{ expiry: string; dte: number; atmIv: number }>;
  termIsSample: boolean;
  /** Weekly vs monthly ATM IV over time (bhavcopy, or sample). */
  wmHistory: Array<{ date: string; weekly: number; monthly: number }>;
  wmHistoryIsSample: boolean;
  source?: string;
  reason?: string;
  isLoading: boolean;
}

const MIN_VIX_ROWS = 60;

export function useVixAnalytics(): VixAnalyticsData {
  const hist = useIvHistory("NIFTY");
  const bars = useDailyBars("NIFTY");
  const vol = useVolChains("NIFTY", "all");
  const all = useAllIndices();
  const liveVix = all.data.vix?.value ?? 0;

  const base = useMemo(() => {
    const vix = hist.data?.vix ?? [];
    const b = bars.data ?? [];
    const joined = vix.length && b.length ? joinSpotIv(vix, b).length : 0;
    if (joined >= MIN_VIX_ROWS) {
      const last = vix[vix.length - 1]?.iv ?? NaN;
      return {
        vix,
        bars: b,
        isSample: false,
        current: liveVix > 0 ? liveVix : last,
        currentLabel: liveVix > 0 ? "India VIX (live)" : "India VIX (last close)",
      };
    }
    const anchor = liveVix > 0 ? liveVix : Number.isFinite(vol.iv30) ? Math.round(vol.iv30 * 1.04 * 100) / 100 : NaN;
    const spot = vol.spot > 0 ? vol.spot : b[b.length - 1]?.c ?? 0;
    const s = Number.isFinite(anchor) && spot > 0 ? sampleVolHistory({ symbol: "NIFTY", spot, atmIv: anchor, seed: sampleSeed("NIFTY", "india-vix") }) : null;
    return {
      vix: s?.iv ?? [],
      bars: s?.bars ?? [],
      isSample: true,
      current: anchor,
      currentLabel: liveVix > 0 ? "India VIX (live), sample history" : "Sample India VIX",
    };
  }, [hist.data, bars.data, liveVix, vol.iv30, vol.spot]);

  const wm = useMemo(() => {
    const rows: Array<{ date: string; weekly: number; monthly: number }> = [];
    if (!vol.isSample) {
      for (const e of cachedBhavEntries("NIFTY")) {
        const w = weeklyVsMonthly(
          "NIFTY",
          e.term.map((t) => ({ expiry: t.expiry, dte: Math.round(t.T * 365), atmIv: t.atmIv })),
        );
        if (w) rows.push({ date: e.date, weekly: w.weekly.atmIv, monthly: w.monthly.atmIv });
      }
    }
    if (rows.length >= 5) return { rows, sample: false };
    if (base.isSample) return { rows: sampleWeeklyMonthly(base.vix, { seed: 5 }), sample: true };
    return { rows, sample: false };
    // vol.term is not a dependency: history comes from the bhavcopy cache only.
  }, [vol.isSample, base.isSample, base.vix]);

  return {
    ...base,
    spot: vol.spot,
    term: vol.term.map((t) => ({ expiry: t.expiry, dte: t.dte, atmIv: t.atmIv })),
    termIsSample: vol.isSample,
    wmHistory: wm.rows,
    wmHistoryIsSample: wm.sample,
    source: hist.data?.vixSource,
    reason: hist.data?.vixReason,
    isLoading: hist.isLoading || vol.isLoading || (bars.isLoading && !bars.isError),
  };
}

// ── Per-expiry ATM IV history ──

export function useExpiryAtmHistory(symbol: string, expiries: string[], isSample: boolean, sampleIv30: IvPoint[]) {
  const sym = symbol.toUpperCase();
  const key = expiries.join(",");
  const q = useQuery({
    queryKey: ["vol-expiry-atm", sym, key],
    queryFn: async (): Promise<ExpiryHistory> => {
      const bhav = bhavTermByExpiry(cachedBhavEntries(sym), expiries);
      const snaps = await dailySnapshotAtm(sym, expiries, 45);
      return mergeExpiryHistories(bhav, snaps);
    },
    enabled: !isSample && expiries.length > 0,
    staleTime: 10 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
  const sample = useMemo(() => (isSample ? sampleExpiryAtmHistory(expiries, sampleIv30, { days: 40, seed: sampleSeed(sym, "expiry-atm") }) : null), [isSample, expiries, sampleIv30, sym]);
  return { data: sample ?? q.data ?? {}, isSample: !!sample, isLoading: !isSample && q.isLoading };
}

// ── Compare ──

export function useCompareRow(symbol: string): { row: CompareRow | null; isLoading: boolean; basisLabel: string; isError: boolean } {
  const vol = useVolChains(symbol, "next3");
  const rank = useIvRank(symbol, { expiries: "next3" });
  const row = useMemo(
    () =>
      buildCompareRow({
        symbol,
        spot: vol.spot,
        chains: vol.chains,
        smiles: vol.smiles,
        iv30: vol.iv30,
        ivRank: rank.stats.ivRank,
        ivPercentile: rank.stats.ivPercentile,
        sample: vol.isSample,
        historySample: rank.historyIsSample,
      }),
    [symbol, vol.spot, vol.chains, vol.smiles, vol.iv30, vol.isSample, rank.stats.ivRank, rank.stats.ivPercentile, rank.historyIsSample],
  );
  return { row, isLoading: vol.isLoading, basisLabel: rank.basisLabel, isError: vol.isError };
}

/**
 * IV spread between two symbols' IV30 histories (b − a). Real when both have at least 20 shared
 * days of bhavcopy or recorded IV; otherwise, when the chains are sample, a coupled labelled sample.
 */
export function useIvSpread(a = "NIFTY", b = "BANKNIFTY"): { series: SpreadSeries; isSample: boolean; isLoading: boolean } {
  const ha = useIvHistory(a);
  const hb = useIvHistory(b);
  const va = useVolChains(a, "next3");
  const vb = useVolChains(b, "next3");
  const out = useMemo(() => {
    const real = ivSpreadSeries(ha.data?.iv30 ?? [], hb.data?.iv30 ?? []);
    if (real.rows.length >= MIN_HISTORY_DAYS) return { series: real, isSample: false };
    if (va.isSample && vb.isSample && Number.isFinite(va.iv30) && Number.isFinite(vb.iv30) && va.spot > 0 && vb.spot > 0) {
      const sa = sampleVolHistory({ symbol: a, spot: va.spot, atmIv: va.iv30 });
      const sb = sampleVolHistory({ symbol: b, spot: vb.spot, atmIv: vb.iv30, coupleTo: sa.iv });
      return { series: ivSpreadSeries(sa.iv, sb.iv), isSample: true };
    }
    return { series: real, isSample: false };
  }, [a, b, ha.data, hb.data, va.isSample, vb.isSample, va.iv30, vb.iv30, va.spot, vb.spot]);
  return { ...out, isLoading: ha.isLoading || hb.isLoading || va.isLoading || vb.isLoading };
}

/** Spot/IV rows for the expected-move hit rate, from the sample history when that is in use. */
export function sampleHitRows(rank: IvRankResult): SpotIvRow[] {
  return rank.historyIsSample && rank.sampleBars ? joinSpotIv(rank.history, rank.sampleBars) : [];
}
