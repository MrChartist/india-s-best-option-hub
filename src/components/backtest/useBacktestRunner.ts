/**
 * Loads the data for a backtest (NSE bhavcopy through the local proxy, cached in IndexedDB, or the
 * labelled sample) and runs the engine in a Web Worker with progress and cancel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { proxyGet } from "@/lib/api/proxyClient";
import { calendarDaysBetween } from "@/lib/options";
import type { BhavcopyFoRow } from "@/lib/types/market";
import { fetchVixHistory } from "@/lib/volatility/api";
import {
  attachVix,
  indexedDbCache,
  isAbortError,
  lastBhavcopyDate,
  loadDays,
  lookbackDates,
  runBacktest,
  sampleWindow,
  toConfig,
  vixByDate,
  type BacktestOutput,
  type BacktestProgress,
  type BacktestSettings,
  type DayCache,
  type LoadProgress,
  type RunMode,
} from "@/lib/backtest";

export interface DataNote {
  kind: "sample" | "bhavcopy";
  /** Why the sample ran when NSE bhavcopy was asked for. */
  fallbackReason?: string;
  requested?: number;
  answered?: number;
  cached?: number;
  /** India VIX closes were unavailable, so the regime split shows "Unknown". */
  vixMissing?: boolean;
}

export interface RunResult {
  output: BacktestOutput;
  mode: RunMode;
  data: DataNote;
  finishedAt: number;
  durationMs: number;
  /** The form settings this run used (to flag edits made since). */
  settings: BacktestSettings;
}

export type RunnerState =
  | { status: "idle" }
  | { status: "loading"; load: LoadProgress | null }
  | { status: "running"; progress: BacktestProgress | null }
  | { status: "error"; message: string };

function reasonText(reason: string | null | undefined): string {
  if (!reason) return "NSE archives did not answer";
  if (reason === "proxy-offline" || reason === "offline") return "The local proxy is not reachable";
  if (reason === "sample-mode") return "The app is running in sample-data mode";
  if (reason === "timeout") return "NSE archives timed out";
  return `NSE archives did not answer (${reason})`;
}

/** Below this many sessions a bhavcopy run would say little, so the sample runs instead (and says why). */
const MIN_SESSIONS = 15;

export function useBacktestRunner() {
  const [state, setState] = useState<RunnerState>({ status: "idle" });
  const [result, setResult] = useState<RunResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<DayCache | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
  }, []);

  const run = useCallback(async (settings: BacktestSettings) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const started = Date.now();
    try {
      let note: DataNote = { kind: "sample" };
      let input: Parameters<typeof runBacktest>[0] = { config: toConfig(settings, sampleWindow(settings.months)), data: { kind: "sample" } };

      if (settings.data === "bhavcopy") {
        setState({ status: "loading", load: null });
        const end = lastBhavcopyDate();
        const dates = lookbackDates(end, settings.months);
        const span = dates.length ? calendarDaysBetween(dates[0], end) + 15 : 120;
        const vixP = fetchVixHistory(span, ac.signal);
        cacheRef.current ??= indexedDbCache();
        const symbol = settings.symbol;
        const res = await loadDays({
          symbol,
          dates,
          cache: cacheRef.current,
          signal: ac.signal,
          concurrency: 4,
          onProgress: (p) => setState({ status: "loading", load: p }),
          fetchDay: async (date) => {
            const env = await proxyGet<BhavcopyFoRow[]>("/api/x/bhavcopy-fo", { date, symbol }, { timeoutMs: 70_000, signal: ac.signal });
            return { rows: Array.isArray(env.data) ? env.data : null, reason: env.meta.reason };
          },
        });
        if (res.days.length >= MIN_SESSIONS) {
          const vix = await vixP;
          const map = vixByDate(vix.data);
          note = { kind: "bhavcopy", requested: res.requested, answered: res.answered, cached: res.cached, vixMissing: map.size === 0 };
          input = {
            config: toConfig(settings, { from: res.days[0].date, to: res.days[res.days.length - 1].date }),
            data: { kind: "dataset", dataset: { symbol, source: "bhavcopy", days: attachVix(res.days, map) } },
          };
        } else {
          note = {
            kind: "sample",
            fallbackReason: res.days.length > 0 ? `Only ${res.days.length} NSE bhavcopy sessions loaded` : reasonText(res.reason),
            requested: res.requested,
            answered: res.answered,
          };
        }
      }
      if (ac.signal.aborted) return;
      setState({ status: "running", progress: null });
      const { output, mode } = await runBacktest(input, { signal: ac.signal, onProgress: (p) => setState({ status: "running", progress: p }) });
      if (ac.signal.aborted) return;
      setResult({ output, mode, data: note, finishedAt: Date.now(), durationMs: Date.now() - started, settings });
      setState({ status: "idle" });
    } catch (err) {
      if (isAbortError(err) || ac.signal.aborted) return;
      setState({ status: "error", message: err instanceof Error ? err.message : "The backtest could not finish" });
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, []);

  const clearCache = useCallback(async () => {
    cacheRef.current ??= indexedDbCache();
    await cacheRef.current.clear();
  }, []);

  return { state, result, run, cancel, clearCache };
}
