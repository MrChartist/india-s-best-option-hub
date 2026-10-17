/**
 * Historical results moves for one F&O stock: for each past results date this browser knows of
 * (NSE event calendar plus remembered dates), the pre- and post-event NSE F&O bhavcopy through
 * /api/x/bhavcopy-fo, measured with @/lib/events. Falls back to a clearly labelled sample when the
 * proxy is offline, no past results dates are known yet, or the archives do not answer.
 */
import { useQuery } from "@tanstack/react-query";
import { proxyGet } from "@/lib/api/proxyClient";
import {
  eventWindow,
  measureEventMove,
  pastResultsDates,
  sampleEventMoves,
  summariseEventMoves,
  type BhavcopyFoRow,
  type EventMoveObservation,
  type EventMoveStats,
  type MarketEvent,
  type MoveSource,
} from "@/lib/events";
import { readResultsHistory } from "./useEvents";

export interface ResultsMovesData {
  mode: MoveSource;
  symbol: string;
  observations: EventMoveObservation[];
  stats: EventMoveStats | null;
  /** Why the sample is shown (null for bhavcopy). */
  reason: string | null;
  /** Results dates tried / measured from bhavcopy. */
  requested: number;
  answered: number;
}

const OFFLINE = new Set(["proxy-offline", "offline", "sample-mode", "aborted"]);

function sample(symbol: string, today: string, reason: string, requested = 0): ResultsMovesData {
  const observations = sampleEventMoves(symbol, today, 8);
  return { mode: "sample", symbol, observations, stats: summariseEventMoves(observations), reason, requested, answered: 0 };
}

async function load(symbol: string, today: string, liveEvents: MarketEvent[] | null, signal?: AbortSignal): Promise<ResultsMovesData> {
  if (!liveEvents) return sample(symbol, today, "The NSE event calendar is unavailable, so results dates are sample dates");
  const dates = pastResultsDates(symbol, today, { events: liveEvents, stored: readResultsHistory()[symbol] }, 760, 8);
  if (dates.length === 0) {
    return sample(symbol, today, `No past ${symbol} results dates are known to this browser yet. NSE's calendar lists upcoming meetings; dates are remembered as they pass`);
  }
  const fetchDay = async (date: string) => {
    const env = await proxyGet<BhavcopyFoRow[]>("/api/x/bhavcopy-fo", { date, symbol }, { timeoutMs: 70_000, signal });
    return { rows: Array.isArray(env.data) ? env.data : null, reason: env.meta.reason };
  };
  const observations: EventMoveObservation[] = [];
  let lastReason = "";
  for (const date of dates) {
    if (signal?.aborted) break;
    const w = eventWindow(date);
    if (!w) continue;
    const [pre, post] = await Promise.all([fetchDay(w.pre), fetchDay(w.post)]);
    if (!pre.rows || !post.rows) {
      lastReason = pre.reason ?? post.reason ?? "unavailable";
      if (OFFLINE.has(lastReason)) break;
      continue;
    }
    const o = measureEventMove({ symbol, eventDate: date, preRows: pre.rows, postRows: post.rows });
    if (o) observations.push(o);
  }
  if (observations.length === 0) {
    const why = OFFLINE.has(lastReason) ? "The local proxy is not reachable" : `NSE bhavcopy archives had no usable ${symbol} straddle around its results dates${lastReason ? ` (${lastReason})` : ""}`;
    return sample(symbol, today, why, dates.length);
  }
  return { mode: "bhavcopy", symbol, observations, stats: summariseEventMoves(observations), reason: null, requested: dates.length, answered: observations.length };
}

export function useResultsMoves(o: { symbol: string; today: string; liveEvents: MarketEvent[] | null; enabled: boolean }) {
  const live = !!o.liveEvents;
  return useQuery({
    queryKey: ["events", "results-moves", o.symbol, o.today, live ? "nse" : "sample"],
    queryFn: ({ signal }) => load(o.symbol, o.today, o.liveEvents, signal),
    enabled: o.enabled && !!o.symbol,
    staleTime: live ? 6 * 3_600_000 : Infinity,
    retry: 0,
  });
}
