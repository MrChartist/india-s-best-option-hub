import { useEffect } from "react";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { istDateString } from "@/lib/options";
import { getLatestSnapshots, recordSnapshot } from "@/lib/snapshotStore";
import { RING_CAPACITY, flowStore } from "@/lib/flow";

/**
 * Invisible component: polls one underlying's option chain (react-query dedupes the request with
 * any other consumer) and feeds every new poll into the shared flow store. Recorded snapshots from
 * IndexedDB for the same session are merged in once, and live polls are persisted when possible.
 */
export function FlowFeeder({ symbol, persist = true }: { symbol: string; persist?: boolean }) {
  const { data } = useLiveOptionChain(symbol);

  // Hold the feed while this feeder is mounted: a stale after-hours chain keeps the same data
  // reference, so updatedAt freezes and the idle pruner would otherwise drop a feed still in use.
  // The release returned by retain() drops the feed once the last feeder for it unmounts.
  useEffect(() => flowStore.retain(symbol), [symbol]);

  useEffect(() => {
    if (!data || !data.expiry || data.chain.length === 0) return;
    flowStore.ingest({
      symbol,
      expiry: data.expiry,
      lotSize: data.lotSize,
      spot: data.spotPrice,
      chain: data.chain,
      source: data.source,
      asOf: data.asOf,
      stale: data.stale,
      isLive: data.isLive,
      reason: data.reason,
    });
    if (persist && data.isLive && !data.stale && data.source !== "sample") {
      recordSnapshot(symbol, data.expiry, data.spotPrice, data.chain).catch(() => undefined);
    }
  }, [data, symbol, persist]);

  const expiry = data?.expiry ?? "";
  const isSample = data?.source === "sample";
  useEffect(() => {
    if (!expiry || isSample) return;
    let cancelled = false;
    getLatestSnapshots(symbol, expiry, RING_CAPACITY)
      .then((snaps) => {
        if (cancelled) return;
        const lastDay = snaps.length ? istDateString(new Date(snaps[snaps.length - 1].ts)) : "";
        flowStore.hydrate(
          symbol.toUpperCase(),
          expiry,
          snaps.filter((s) => istDateString(new Date(s.ts)) === lastDay),
        );
      })
      .catch(() => {
        if (!cancelled) flowStore.hydrate(symbol.toUpperCase(), expiry, []);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, expiry, isSample]);

  return null;
}
