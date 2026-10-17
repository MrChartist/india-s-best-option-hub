/**
 * One session of snapshots and prints for an underlying, for the levels-over-time and hedging
 * pressure cards. Uses the shared flow feed (live, recorded or sample) and falls back to a
 * clearly labelled simulated session when fewer than two real snapshots exist yet.
 */
import { useMemo } from "react";
import { derivePrintsFromSeries, simulateSession, type FeedEntry, type FeedMode, type FlowPrint } from "@/lib/flow";
import type { ChainSnapshot } from "@/lib/snapshotStore";

export interface SessionSeries {
  symbol: string;
  expiry: string;
  lotSize: number;
  snaps: ChainSnapshot[];
  prints: FlowPrint[];
  /** "sample" whenever any number shown is simulated. */
  mode: FeedMode;
  /** True when a live / recorded feed had too few snapshots and a simulation stands in. */
  fallback: boolean;
  /** Real snapshots recorded so far (0 for a pure sample feed). */
  realSnapCount: number;
  asOf?: number;
  reason?: string;
}

export function useSessionSeries(symbol: string, feed: FeedEntry | null | undefined): SessionSeries | null {
  const sym = symbol.toUpperCase();
  const needsFallback = !!feed && feed.mode !== "sample" && feed.snaps.length < 2;
  const spotKey = feed ? Math.round(feed.spot) : 0;

  const simulated = useMemo(() => {
    if (!feed || !needsFallback || feed.chain.length === 0 || !(feed.spot > 0)) return null;
    const snaps = simulateSession({ symbol: sym, expiry: feed.expiry, spot: feed.spot, chain: feed.chain });
    return { snaps, prints: derivePrintsFromSeries(snaps, feed.lotSize) };
    // Rebuild only when the series or the rounded spot changes, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, feed?.expiry, feed?.lotSize, needsFallback, spotKey]);

  return useMemo(() => {
    if (!feed) return null;
    if (needsFallback) {
      if (!simulated) return null;
      return {
        symbol: sym,
        expiry: feed.expiry,
        lotSize: feed.lotSize,
        snaps: simulated.snaps,
        prints: simulated.prints,
        mode: "sample",
        fallback: true,
        realSnapCount: feed.snaps.length,
        reason: "Not enough snapshots recorded yet, so a simulated session stands in",
      };
    }
    return {
      symbol: sym,
      expiry: feed.expiry,
      lotSize: feed.lotSize,
      snaps: feed.snaps,
      prints: feed.prints,
      mode: feed.mode,
      fallback: false,
      realSnapCount: feed.mode === "sample" ? 0 : feed.snaps.length,
      asOf: feed.asOf,
      reason: feed.reason,
    };
  }, [feed, needsFallback, simulated, sym]);
}
