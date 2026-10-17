/**
 * useEvents({ from, to, symbol? }): every event in an IST date range. Static parts (macro schedule,
 * exchange holidays, expiries) are computed in the browser; results and corporate actions come from
 * the proxy's NSE event-calendar route, or a clearly labelled sample season when it cannot answer.
 *
 * Real NSE results dates are also remembered in this browser so the results-move statistics can
 * look back at past quarters (a per-viewer cache; the page works without it).
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { proxyGet } from "@/lib/api/proxyClient";
import { isValidIsoDate as isValidDate } from "@/lib/options";
import {
  filterEvents,
  mergeEvents,
  mergeResultsHistory,
  normaliseCalendarRows,
  sampleResultsEvents,
  staticEvents,
  type MarketEvent,
  type NseEventCalendarRow,
} from "@/lib/events";

export type CorporateMode = "live" | "sample";

export interface CorporateFeed {
  mode: CorporateMode;
  /** Normalised NSE events (empty in sample mode). */
  events: MarketEvent[];
  asOf: number | null;
  stale: boolean;
  /** Why the sample is shown. */
  reason: string | null;
  /** First and last date the NSE calendar returned. */
  coverage: { from: string; to: string } | null;
}

export interface UseEventsOptions {
  from: string;
  to: string;
  /** Keep only this underlying's events plus market-wide ones (macro, holidays, the NSE monthly expiry). */
  symbol?: string;
  enabled?: boolean;
}

export interface UseEventsResult {
  events: MarketEvent[];
  /** Results / corporate provenance. */
  corporate: CorporateFeed | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
}

const HISTORY_KEY = "mrc.events.results-history.v1";

/** Stored per-symbol NSE results dates ({} when storage is unavailable). */
export function readResultsHistory(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function writeResultsHistory(events: MarketEvent[]): void {
  try {
    const next = mergeResultsHistory(readResultsHistory(), events);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: history simply does not accumulate */
  }
}

function reasonText(reason: string | undefined): string {
  if (reason === "sample-mode") return "The app is in sample-data mode";
  if (reason === "proxy-offline" || reason === "offline") return "The local proxy is not reachable";
  if (reason === "timeout") return "NSE took too long to answer";
  if (reason === "empty") return "NSE returned an empty event calendar";
  return reason ? `NSE did not answer (${reason})` : "NSE did not answer";
}

async function loadCorporate(signal?: AbortSignal): Promise<CorporateFeed> {
  const env = await proxyGet<NseEventCalendarRow[]>("/api/x/event-calendar", undefined, { timeoutMs: 20_000, signal });
  const events = normaliseCalendarRows(env.data);
  if (!env.data || events.length === 0) {
    return { mode: "sample", events: [], asOf: null, stale: false, reason: reasonText(env.data ? "empty" : env.meta.reason), coverage: null };
  }
  const dates = events.map((e) => e.date).sort();
  return {
    mode: "live",
    events,
    asOf: env.meta.asOf,
    stale: env.meta.stale,
    reason: null,
    coverage: { from: dates[0], to: dates[dates.length - 1] },
  };
}

/** The shared NSE corporate calendar query (one fetch for every caller). */
export function useCorporateCalendar(enabled = true) {
  return useQuery({
    queryKey: ["events", "nse-event-calendar"],
    queryFn: ({ signal }) => loadCorporate(signal),
    enabled,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 0,
  });
}

export function useEvents({ from, to, symbol, enabled = true }: UseEventsOptions): UseEventsResult {
  const valid = isValidDate(from) && isValidDate(to) && from <= to;
  const q = useCorporateCalendar(enabled && valid);
  const feed = q.data;

  useEffect(() => {
    if (feed?.mode === "live") writeResultsHistory(feed.events);
  }, [feed]);

  const range = useMemo(() => ({ from, to }), [from, to]);
  const base = useMemo(() => (valid ? staticEvents(range) : []), [valid, range]);
  const corporate = useMemo(() => {
    if (!valid || !feed) return [];
    if (feed.mode === "live") return feed.events.filter((e) => e.date >= from && e.date <= to);
    return sampleResultsEvents(range);
  }, [valid, feed, from, to, range]);

  const events = useMemo(() => {
    const all = mergeEvents(base, corporate);
    return symbol ? filterEvents(all, { symbol }) : all;
  }, [base, corporate, symbol]);

  return {
    events,
    corporate: feed,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    refetch: () => void q.refetch(),
  };
}
