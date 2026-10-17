/**
 * React bindings for the flow store plus the small data queries the Flow page needs.
 */
import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { proxyGet } from "@/lib/api/proxyClient";
import {
  generateSampleChain,
  getExpiries,
  getLotSize,
  istDateString,
  previousTradingDay,
  toISTDate,
} from "@/lib/options";
import { getSpotPrice } from "@/lib/positionStore";
import { getSnapshots, type ChainSnapshot } from "@/lib/snapshotStore";
import {
  EMPTY_HISTORY,
  averageVolumeFromSnapshots,
  derivePrintsFromSeries,
  flowStore,
  simulateSession,
  type FeedEntry,
  type FlowState,
  type UnusualHistory,
} from "@/lib/flow";

/** Underlyings the Flow page always follows. */
export const FLOW_UNIVERSE = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

export function useFlowState(): FlowState {
  return useSyncExternalStore(flowStore.subscribe, flowStore.getState, flowStore.getState);
}

/** Labelled sample feeds (simulated session) for the given symbols, used when the user asks for a demo. */
export function useSampleFeeds(
  symbols: readonly string[],
  enabled: boolean,
  liveSpots: Record<string, number>,
): Record<string, FeedEntry> {
  const key = symbols.join(",");
  const spotKey = symbols.map((s) => Math.round(liveSpots[s] || 0)).join(",");
  return useMemo(() => {
    if (!enabled) return {};
    const out: Record<string, FeedEntry> = {};
    const now = new Date();
    for (const symbol of key.split(",").filter(Boolean)) {
      const spot = liveSpots[symbol] > 0 ? liveSpots[symbol] : getSpotPrice(symbol);
      const expiry = getExpiries(symbol, now, 1)[0]?.date ?? "";
      if (!expiry) continue;
      const lotSize = getLotSize(symbol, expiry) ?? 1;
      const { chain } = generateSampleChain({ symbol, spot, expiry, now });
      const snaps = simulateSession({ symbol, expiry, spot, chain, now });
      out[symbol] = {
        symbol,
        expiry,
        lotSize,
        mode: "sample",
        source: "sample",
        asOf: snaps[snaps.length - 1]?.ts ?? now.getTime(),
        stale: true,
        reason: "Simulated session for illustration",
        spot,
        chain,
        snaps,
        prints: derivePrintsFromSeries(snaps, lotSize),
        updatedAt: now.getTime(),
        hydrated: true,
      };
    }
    return out;
    // liveSpots is captured through spotKey so the simulation is stable between polls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, spotKey]);
}

// ── OI spurts (NSE live analysis via the proxy) ──

export interface OiSpurtRow {
  symbol: string;
  instrument?: string;
  expiry?: string;
  strike?: number;
  optionType?: "CE" | "PE" | "FUT";
  category?: string;
  ltp?: number;
  pChange?: number;
  latestOi: number;
  prevOi: number;
  chgOi: number;
  chgOiPct: number;
  volume: number;
  underlyingValue?: number;
}

export function useOiSpurts(type: "underlyings" | "contracts") {
  return useQuery({
    queryKey: ["flow-oi-spurts", type],
    queryFn: async ({ signal }) => {
      const env = await proxyGet<OiSpurtRow[]>("/api/x/oi-spurts", { type }, { signal, timeoutMs: 12_000 });
      const rows = Array.isArray(env.data) ? env.data.filter((r) => r && typeof r.symbol === "string") : [];
      return { rows, meta: env.meta };
    },
    staleTime: 60_000,
    refetchInterval: 180_000,
    retry: 0,
  });
}

// ── F&O ban list ──

export function useBanList(enabled: boolean) {
  return useQuery({
    queryKey: ["flow-ban-list"],
    queryFn: async ({ signal }) => {
      const env = await proxyGet<{ date: string; symbols: string[] }>("/api/x/ban-list", undefined, {
        signal,
        timeoutMs: 12_000,
      });
      const symbols = Array.isArray(env.data?.symbols) ? env.data.symbols.map((s) => String(s).toUpperCase()) : null;
      return { symbols, date: env.data?.date ?? "", meta: env.meta };
    },
    enabled,
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: 0,
  });
}

// ── 5-day average volume from recorded snapshots ──

/** Past trading days before `todayIso`, newest first. */
export function pastTradingDays(todayIso: string, n: number): string[] {
  const out: string[] = [];
  let d = todayIso;
  for (let i = 0; i < n; i++) {
    d = previousTradingDay(d);
    if (!d) break;
    out.push(d);
  }
  return out;
}

export function useUnusualHistory(symbol: string, expiry: string, enabled: boolean) {
  return useQuery({
    queryKey: ["flow-unusual-history", symbol, expiry, Math.floor(Date.now() / (10 * 60_000))],
    queryFn: async (): Promise<UnusualHistory> => {
      const now = Date.now();
      const today = istDateString(new Date(now));
      const t = new Date(now + 330 * 60_000);
      const raw = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
      // Outside the session compare full days (cut-off 15:30); inside it, compare at the same time of day.
      const hhmm = raw > "15:30" || raw < "09:15" ? "15:30" : raw;
      const all: ChainSnapshot[] = [];
      for (const day of pastTradingDays(today, 5)) {
        const at = toISTDate(day, hhmm).getTime();
        try {
          all.push(...(await getSnapshots(symbol, expiry, at - 30 * 60_000, at)));
        } catch {
          /* IndexedDB unavailable */
        }
      }
      if (all.length === 0) return EMPTY_HISTORY;
      return averageVolumeFromSnapshots(all, { nowTs: toISTDate(today, hhmm).getTime(), days: 5 });
    },
    enabled: enabled && !!symbol && !!expiry,
    staleTime: 10 * 60_000,
    retry: 0,
  });
}
