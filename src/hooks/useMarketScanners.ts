/**
 * Scanner/dashboard-wide query hooks added alongside the 1Cliq build
 * (futures scanner, FII/DII, rollover, global cues, MCX commodity expiry).
 * Split out of useMarketData.ts, which crossed 300 lines once these landed —
 * re-exported from there so every existing
 * `import { useFuturesScanner, ... } from "@/hooks/useMarketData"` keeps
 * working unchanged.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchCommodityExpiryList, fetchFuturesQuotes, fetchFIIDII, fetchGlobalCues, fetchRolloverData } from "@/lib/marketApi";
import type { FIIDIIData, GlobalCuesData } from "@/lib/marketApi";
import type { ExpiryDate } from "@/lib/mockData";
import { fnoStocks } from "@/lib/mockData";
import type { FuturesQuoteRow } from "@/lib/futuresUtils";
import { markProxyOnline, markProxyOffline, shouldTryProxy } from "./proxyStatus";

// ── Hook: MCX Commodity Expiry List ──
// Each commodity (CRUDEOIL, GOLD, SILVER, NATURALGAS, ...) has its own expiry
// calendar — this hits Dhan's public instrument master, not the authenticated
// option-chain API, so it stays live even when a user's access token has
// expired. Longer refetch interval than useExpiryList since commodity
// expiries only change once the current contract rolls off, not intraday.
export function useCommodityExpiry(symbol: string) {
  return useQuery({
    queryKey: ["commodity-expiry-list", symbol],
    queryFn: async () => {
      try {
        const expiries = await fetchCommodityExpiryList(symbol);
        return { expiries, isLive: expiries.length > 0 };
      } catch (e) {
        console.warn(`Commodity expiry list fetch failed for ${symbol}:`, e);
        return { expiries: [] as ExpiryDate[], isLive: false };
      }
    },
    staleTime: 600000,
    refetchInterval: 1800000,
    retry: 1,
  });
}

// ── Hook: Futures Scanner (index + full F&O stock universe) ──
// NO MOCK FALLBACK — one batched proxy call; returns [] when offline (no local
// futures data exists to fall back to, unlike useFnOStocks' IndexedDB path).
const SCANNER_INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"];
const SCANNER_UNIVERSE = [...SCANNER_INDEX_SYMBOLS, ...fnoStocks];

export function useFuturesScanner() {
  return useQuery({
    queryKey: ["futures-scanner"],
    queryFn: async (): Promise<{ rows: FuturesQuoteRow[]; isLive: boolean }> => {
      if (shouldTryProxy()) {
        try {
          const rows = await fetchFuturesQuotes(SCANNER_UNIVERSE);
          if (rows.length > 0) {
            markProxyOnline();
            return { rows, isLive: true };
          }
        } catch (e) { markProxyOffline(); console.warn("Futures scanner fetch failed:", e); }
      }
      return { rows: [], isLive: false };
    },
    refetchInterval: (query) => query.state.data?.isLive ? 20000 : 60000,
    staleTime: 15000,
    retry: 1,
  });
}

// ── Hook: FII/DII Activity ──
// NO MOCK FALLBACK — real NSE data, published once per trading day (evening).
export function useFIIDII() {
  return useQuery({
    queryKey: ["fii-dii"],
    queryFn: async (): Promise<FIIDIIData[]> => {
      if (shouldTryProxy()) {
        try {
          const data = await fetchFIIDII();
          if (data.length > 0) { markProxyOnline(); return data; }
        } catch (e) { markProxyOffline(); console.warn("FII/DII fetch failed:", e); }
      }
      return [];
    },
    refetchInterval: 30 * 60 * 1000, // updates once/day — 30min is plenty
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

// ── Hook: Rollover Analysis (near vs next month futures OI) ──
// NO MOCK FALLBACK — real Dhan quotes for both contracts; [] if unavailable.
export function useRolloverData() {
  return useQuery({
    queryKey: ["rollover-data"],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const rows = await fetchRolloverData(SCANNER_UNIVERSE);
          if (rows.length > 0) { markProxyOnline(); return { rows, isLive: true }; }
        } catch (e) { markProxyOffline(); console.warn("Rollover data fetch failed:", e); }
      }
      return { rows: [], isLive: false };
    },
    refetchInterval: (query) => query.state.data?.isLive ? 60000 : 120000,
    staleTime: 30000,
    retry: 1,
  });
}

// ── Hook: Global Market Cues (US/Asia/Crude/DXY) ──
// NO MOCK FALLBACK — real Yahoo Finance quotes, or empty if unreachable.
export function useGlobalCues() {
  return useQuery({
    queryKey: ["global-cues"],
    queryFn: async (): Promise<GlobalCuesData> => {
      if (shouldTryProxy()) {
        try {
          const data = await fetchGlobalCues();
          if (Object.keys(data).length > 0) { markProxyOnline(); return data; }
        } catch (e) { markProxyOffline(); console.warn("Global cues fetch failed:", e); }
      }
      return {};
    },
    refetchInterval: 5 * 60 * 1000, // global markets don't need second-level refresh
    staleTime: 60000,
    retry: 1,
  });
}
