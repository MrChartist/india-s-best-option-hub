/** React hooks for the Futures page: overview, per-symbol history and an NSE history backfill. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchFuturesDay,
  fetchSymbolSnapshot,
  isBseSymbol,
  isOfflineReason,
  latestBhavDate,
  loadOverview,
  type FuturesMode,
} from "./api";
import { buildViews, historyDatesFor, type FuturesDay, type FuturesView } from "./model";
import { SAMPLE_SESSIONS, sampleFuturesHistory } from "./sample";
import { loadDays, saveDays, storedDates } from "./store";

/** Overview of index and stock futures (latest EOD file per symbol). */
export function useFuturesOverview(symbols: readonly string[]) {
  const key = symbols.join(",");
  return useQuery({
    queryKey: ["futures", "overview", key],
    queryFn: ({ signal }) => loadOverview(key ? key.split(",") : [], { signal }),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}

export interface BackfillState {
  running: boolean;
  done: number;
  total: number;
  failed: number;
  /** Set when the run stopped because the proxy went offline. */
  stoppedReason: string | null;
}

export interface SymbolFutures {
  days: FuturesDay[];
  views: FuturesView[];
  latest: FuturesView | null;
  mode: FuturesMode;
  isLoading: boolean;
  /** BSE contracts are not in the NSE bhavcopy. */
  unsupported: boolean;
  /** Dates that would fill the history (not yet saved). Empty in sample mode. */
  missingDates: string[];
  backfill: BackfillState;
  runBackfill: () => void;
  cancelBackfill: () => void;
}

const IDLE: BackfillState = { running: false, done: 0, total: 0, failed: 0, stoppedReason: null };

/**
 * One symbol's futures history. `pageMode` comes from the overview: in sample mode the history is
 * generated (and labelled); otherwise it is the days saved in this browser, refreshed with the
 * latest file and extendable with an explicit backfill from the NSE archive.
 */
export function useSymbolFutures(symbol: string, pageMode: FuturesMode | null): SymbolFutures {
  const sample = pageMode === "sample";
  const unsupported = isBseSymbol(symbol);
  const [version, setVersion] = useState(0);
  const [backfill, setBackfill] = useState<BackfillState>(IDLE);
  const ctrlRef = useRef<AbortController | null>(null);
  const failedRef = useRef<Set<string>>(new Set());

  const latestQ = useQuery({
    queryKey: ["futures", "latest", symbol],
    queryFn: ({ signal }) => fetchSymbolSnapshot(symbol, signal),
    enabled: pageMode !== null && !sample && !unsupported,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  // Reset per-symbol state when the symbol changes.
  useEffect(() => {
    ctrlRef.current?.abort();
    failedRef.current = new Set();
    setBackfill(IDLE);
  }, [symbol]);
  useEffect(() => () => ctrlRef.current?.abort(), []);

  const days = useMemo(() => {
    if (pageMode === null || unsupported) return [];
    if (sample) return sampleFuturesHistory(symbol, latestBhavDate(), SAMPLE_SESSIONS);
    return loadDays(symbol);
    // latestQ.dataUpdatedAt and version re-read the store after a fetch or a backfill step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, pageMode, sample, unsupported, version, latestQ.dataUpdatedAt]);

  const views = useMemo(() => buildViews(days), [days]);
  const latest = views.length ? views[views.length - 1] : null;

  const missingDates = useMemo(() => {
    if (sample || !latest?.series[0]) return [];
    const have = storedDates(symbol);
    return historyDatesFor(symbol, latest.date, latest.series[0].expiry).filter(
      (d) => !have.has(d) && !failedRef.current.has(d),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, sample, latest?.date, latest?.series[0]?.expiry, version]);

  const runBackfill = useCallback(() => {
    if (sample || missingDates.length === 0) return;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const queue = [...missingDates];
    setBackfill({ running: true, done: 0, total: queue.length, failed: 0, stoppedReason: null });
    void (async () => {
      let done = 0;
      let failed = 0;
      for (const date of queue) {
        if (ctrl.signal.aborted) return;
        const res = await fetchFuturesDay(symbol, date, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (res.day) saveDays([res.day]);
        else if (isOfflineReason(res.meta.reason)) {
          setBackfill({
            running: false,
            done,
            total: queue.length,
            failed,
            stoppedReason: res.meta.reason ?? "offline",
          });
          setVersion((v) => v + 1);
          return;
        } else {
          failed += 1;
          failedRef.current.add(date);
        }
        done += 1;
        setBackfill({ running: true, done, total: queue.length, failed, stoppedReason: null });
        if (done % 3 === 0) setVersion((v) => v + 1);
      }
      setBackfill({ running: false, done, total: queue.length, failed, stoppedReason: null });
      setVersion((v) => v + 1);
    })();
  }, [sample, missingDates, symbol]);

  const cancelBackfill = useCallback(() => {
    ctrlRef.current?.abort();
    setBackfill((b) => ({ ...b, running: false }));
    setVersion((v) => v + 1);
  }, []);

  const mode: FuturesMode = sample
    ? "sample"
    : latestQ.data?.source === "live"
      ? "live"
      : pageMode === "live" && latestQ.isLoading
        ? "live"
        : "cache";

  return {
    days,
    views,
    latest,
    mode,
    isLoading: pageMode === null || (!sample && !unsupported && latestQ.isLoading && days.length === 0),
    unsupported,
    missingDates,
    backfill,
    runBackfill,
    cancelBackfill,
  };
}
