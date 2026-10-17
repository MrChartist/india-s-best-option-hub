/**
 * Renderless live-chain subscription. React hooks cannot be called in a loop, so a page renders one
 * <ChainFeed> per (symbol, expiry) it needs and collects the snapshots with useChainFeeds().
 */
import { useEffect } from "react";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { feedKey, type FeedSnapshot } from "./helpers";

export function ChainFeed({ symbol, expiry, onUpdate }: { symbol: string; expiry: string; onUpdate: (s: FeedSnapshot) => void }) {
  const q = useLiveOptionChain(symbol, expiry || undefined);
  const d = q.data;
  useEffect(() => {
    onUpdate({
      key: feedKey(symbol, expiry),
      symbol,
      expiry,
      expiryMatch: !!d && (!expiry || d.expiry === expiry),
      spot: d?.spotPrice ?? NaN,
      chain: d?.chain ?? [],
      source: d?.source ?? "none",
      isLive: !!d?.isLive,
      stale: d?.stale ?? true,
      asOf: d?.asOf ?? 0,
      reason: d?.reason,
      loading: q.isLoading,
      error: q.isError,
    });
  }, [d, q.isLoading, q.isError, symbol, expiry, onUpdate]);
  return null;
}
