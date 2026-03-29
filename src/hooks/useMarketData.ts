import { useQuery } from "@tanstack/react-query";
import { fetchLiveOptionChain, fetchLiveIndices, fetchMarketStatus, fetchExpiryList, fetchAllIndices, fetchLiveFnOStocks, fetchProxyHealth } from "@/lib/marketApi";
import type { FnOStockData } from "@/lib/marketApi";
import { getMaxPain } from "@/lib/oiUtils";
import { getLotSize } from "@/lib/positionStore";
import type { OptionData, IndexData, ExpiryDate } from "@/lib/mockData";
import { useWebSocketIndices, useWebSocketVix, useWebSocketStatus } from "@/hooks/useWebSocket";
import { useMemo, useEffect, useState, useRef } from "react";
import {
  getAllPriceSnapshots,
  getCandleHistory,
  getDatabaseStats,
  type PriceSnapshot,
} from "@/lib/localDatabase";

// ── Shared state: tracks whether proxy is reachable ──
let proxyStatus: "unknown" | "online" | "offline" = "unknown";
let proxyCheckTime = 0;

function markProxyOnline() { proxyStatus = "online"; proxyCheckTime = Date.now(); }
function markProxyOffline() { proxyStatus = "offline"; proxyCheckTime = Date.now(); }
function shouldTryProxy(): boolean {
  if (proxyStatus === "unknown") return true;
  if (proxyStatus === "online") return true;
  return Date.now() - proxyCheckTime > 30000;
}

// ── Local database cache singleton ──
let cachedPrices: PriceSnapshot[] | null = null;
let cachedPricesLoaded = false;
let cachedPricesPromise: Promise<PriceSnapshot[]> | null = null;

async function getCachedPricesOnce(): Promise<PriceSnapshot[]> {
  if (cachedPrices !== null) return cachedPrices;
  if (cachedPricesPromise) return cachedPricesPromise;
  cachedPricesPromise = getAllPriceSnapshots().then((p) => {
    cachedPrices = p;
    cachedPricesLoaded = true;
    return p;
  }).catch(() => {
    cachedPrices = [];
    cachedPricesLoaded = true;
    return [];
  });
  return cachedPricesPromise;
}

// Build indices from cached price snapshots
function buildCachedIndices(prices: PriceSnapshot[]): IndexData[] {
  const indexSymbols = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
  const nameMap: Record<string, string> = {
    NIFTY: "NIFTY 50",
    BANKNIFTY: "BANK NIFTY",
    FINNIFTY: "FIN NIFTY",
    MIDCPNIFTY: "MIDCAP NIFTY",
  };
  return indexSymbols
    .map((sym) => {
      const p = prices.find((pr) => pr.symbol === sym);
      if (!p) return null;
      return {
        name: nameMap[sym] || sym,
        symbol: sym,
        ltp: p.ltp,
        change: p.change,
        changePercent: p.changePercent,
        high: p.high,
        low: p.low,
        open: p.open,
        prevClose: p.close,
      };
    })
    .filter(Boolean) as IndexData[];
}

// ── Hook: Live Indices (WebSocket primary, polling fallback, DB cache tertiary) ──
// NO MOCK FALLBACK — returns empty array when offline
export function useLiveIndices() {
  const { indices: wsIndices, isConnected: wsConnected } = useWebSocketIndices();

  const pollingQuery = useQuery({
    queryKey: ["nse-indices"],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const data = await fetchLiveIndices();
          if (data && data.length > 0) { markProxyOnline(); return { data, isLive: true }; }
        } catch (e) { markProxyOffline(); console.warn("Indices fetch failed:", e); }
      }
      // Try local DB prices
      const dbPrices = await getCachedPricesOnce();
      const dbIndices = buildCachedIndices(dbPrices);
      if (dbIndices.length > 0) {
        return { data: dbIndices, isLive: false, source: "database" as const };
      }
      // NO MOCK — return empty
      return { data: [] as IndexData[], isLive: false };
    },
    refetchInterval: wsConnected ? 120000 : ((query) => query.state.data?.isLive ? 15000 : 60000),
    staleTime: 10000,
    retry: 1,
  });

  // Merge WebSocket data over polling data
  const mergedData = useMemo(() => {
    if (wsIndices.length > 0) {
      const polledData = pollingQuery.data?.data || [];
      const merged = wsIndices.map((wsIdx) => {
        const polled = polledData.find((p: any) => p.symbol === wsIdx.symbol);
        return {
          name: wsIdx.name,
          symbol: wsIdx.symbol,
          ltp: wsIdx.ltp,
          change: wsIdx.change,
          changePercent: wsIdx.changePercent,
          open: wsIdx.open || polled?.open || wsIdx.ltp,
          high: wsIdx.high || polled?.high || wsIdx.ltp,
          low: wsIdx.low || polled?.low || wsIdx.ltp,
          prevClose: wsIdx.prevClose || polled?.prevClose || wsIdx.ltp,
        };
      });

      for (const p of polledData) {
        if (!merged.find((m: any) => m.symbol === p.symbol)) {
          merged.push(p);
        }
      }

      return { data: merged, isLive: true };
    }

    return pollingQuery.data || { data: [] as IndexData[], isLive: false };
  }, [wsIndices, pollingQuery.data]);

  return {
    data: mergedData,
    isLoading: pollingQuery.isLoading && wsIndices.length === 0,
  };
}

// ── Hook: Market Status + GIFT Nifty ──
export function useMarketStatus() {
  return useQuery({
    queryKey: ["nse-market-status"],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const data = await fetchMarketStatus();
          if (data?.marketState) {
            markProxyOnline();
            const nseStatus = data.marketState.find((m: any) => m.market === "Capital Market" || m.market === "CM");
            const giftNifty = data.giftnifty ? {
              lastPrice: data.giftnifty.LASTPRICE || 0, change: data.giftnifty.DAYCHANGE || 0,
              changePercent: data.giftnifty.PERCHANGE || 0, expiry: data.giftnifty.EXPIRYDATE || "",
              timestamp: data.giftnifty.TIMESTMP || "", contractsTraded: data.giftnifty.CONTRACTSTRADED || 0,
            } : null;
            const indicativeNifty = data.indicativenifty50 ? {
              value: data.indicativenifty50.finalClosingValue || data.indicativenifty50.closingValue || 0,
              change: data.indicativenifty50.change || 0, changePercent: data.indicativenifty50.perChange || 0,
              status: data.indicativenifty50.status || "",
            } : null;
            return { isOpen: nseStatus?.marketStatus === "Open", status: nseStatus?.marketStatus || "Closed", isLive: true, giftNifty, indicativeNifty };
          }
        } catch (e) { markProxyOffline(); console.warn("Market status fetch failed:", e); }
      }
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes();
      const isOpen = (h > 9 || (h === 9 && m >= 15)) && (h < 15 || (h === 15 && m <= 30));
      return { isOpen, status: isOpen ? "Open" : "Closed", isLive: false, giftNifty: null, indicativeNifty: null };
    },
    refetchInterval: (query) => query.state.data?.isLive ? 15000 : 60000,
    staleTime: 10000,
    retry: 0,
  });
}

// ── Hook: Live Option Chain ──
// NO MOCK FALLBACK — returns null when live data unavailable
export function useLiveOptionChain(symbol: string, expiry?: string) {
  return useQuery({
    queryKey: ["live-option-chain", symbol, expiry],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const result = await fetchLiveOptionChain(symbol, expiry);
          if (result && result.chain.length > 0) {
            markProxyOnline();
            const stepSize = result.chain.length > 1 ? Math.abs(result.chain[1].strikePrice - result.chain[0].strikePrice) : 50;
            return {
              chain: result.chain, spotPrice: result.spotPrice, expiries: result.expiries,
              lotSize: getLotSize(symbol), stepSize, maxPain: getMaxPain(result.chain),
              totalCEOI: result.totalCEOI, totalPEOI: result.totalPEOI,
              isLive: true, source: result.source || "live",
            };
          }
        } catch (e) { markProxyOffline(); console.warn("Option chain fetch failed:", e); }
      }
      // NO MOCK — return null so UI shows "unable to load" instead of fake data
      return null;
    },
    refetchInterval: (query) => query.state.data?.isLive ? 3000 : 15000,
    staleTime: 2000,
    retry: 1,
  });
}

// ── Hook: Expiry List ──
// NO MOCK FALLBACK — returns empty array
export function useExpiryList(symbol: string) {
  return useQuery({
    queryKey: ["expiry-list", symbol],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const expiries = await fetchExpiryList(symbol);
          if (expiries.length > 0) { markProxyOnline(); return { expiries, isLive: true }; }
        } catch (e) { markProxyOffline(); console.warn("Expiry list fetch failed:", e); }
      }
      return { expiries: [] as ExpiryDate[], isLive: false };
    },
    staleTime: 60000,
    refetchInterval: 120000,
    retry: 1,
  });
}

// ── Hook: All Indices (VIX + Sectors + Advance/Decline) ──
// NO MOCK FALLBACK — returns null values when offline
export function useAllIndices() {
  const { vix: wsVix } = useWebSocketVix();
  const wsConnected = useWebSocketStatus();

  const pollingQuery = useQuery({
    queryKey: ["nse-all-indices"],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const data = await fetchAllIndices();
          if (data) { markProxyOnline(); return { ...data, isLive: true }; }
        } catch (e) { markProxyOffline(); console.warn("All indices fetch failed:", e); }
      }
      // NO MOCK — return empty/null values
      return {
        vix: null,
        sectors: [],
        advances: 0,
        declines: 0,
        unchanged: 0,
        isLive: false,
      };
    },
    refetchInterval: wsConnected ? 120000 : ((query) => query.state.data?.isLive ? 30000 : 120000),
    staleTime: 15000,
    retry: 1,
  });

  // Merge WebSocket VIX over polled VIX
  const mergedData = useMemo(() => {
    const base = pollingQuery.data || {
      vix: null, sectors: [], advances: 0, declines: 0, unchanged: 0, isLive: false,
    };

    if (wsVix) {
      return {
        ...base,
        vix: wsVix,
        isLive: true,
      };
    }

    return base;
  }, [pollingQuery.data, wsVix]);

  return { data: mergedData, isLoading: pollingQuery.isLoading };
}

// ── Hook: F&O Stocks (Top Movers + Most Active) ──
// NO MOCK FALLBACK — returns empty arrays when offline
export function useFnOStocks() {
  return useQuery({
    queryKey: ["nse-fno-stocks"],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const stocks = await fetchLiveFnOStocks();
          if (stocks.length > 0) {
            markProxyOnline();
            const gainers = [...stocks].filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
            const losers = [...stocks].filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
            const mostActive = [...stocks].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 10).map(s => ({
              ...s, oi: s.openInterest || 0, oiChange: s.oiChange || 0,
              oiInterpretation: getOIInterpretation(s.changePercent, s.oiChange || 0),
            }));
            const hasOI = stocks.some(s => (s.openInterest || 0) > 0);
            const source = hasOI ? "nse" as const : "tradingview" as const;
            return { gainers, losers, mostActive, allStocks: stocks, isLive: true, source };
          }
        } catch (e) { markProxyOffline(); console.warn("F&O stocks fetch failed:", e); }
      }
      // Try local DB price snapshots
      const dbPrices = await getCachedPricesOnce();
      if (dbPrices.length > 0) {
        const dbStocks: FnOStockData[] = dbPrices
          .filter(p => p.ltp > 0 && p.symbol)
          .map(p => ({
            symbol: p.symbol,
            ltp: p.ltp,
            change: p.change,
            changePercent: p.changePercent,
            open: p.open,
            high: p.high,
            low: p.low,
            previousClose: p.close,
            volume: p.volume,
            totalTradedVolume: p.volume,
            openInterest: p.oi,
            oiChange: 0,
          }));
        if (dbStocks.length > 0) {
          const gainers = [...dbStocks].filter(s => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
          const losers = [...dbStocks].filter(s => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
          const mostActive = [...dbStocks].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 10).map(s => ({
            ...s, oi: s.openInterest || 0, oiChange: s.oiChange || 0,
            oiInterpretation: getOIInterpretation(s.changePercent, s.oiChange || 0),
          }));
          return { gainers, losers, mostActive, allStocks: dbStocks, isLive: false, source: "database" as const };
        }
      }
      // NO MOCK — return empty
      return { gainers: [], losers: [], mostActive: [], allStocks: [] as FnOStockData[], isLive: false, source: "none" as const };
    },
    refetchInterval: (query) => query.state.data?.isLive ? 30000 : 120000,
    staleTime: 15000,
    retry: 1,
  });
}

// ── Hook: Candle history for charts ──
export function useStoredCandles(symbol: string, interval: string = "5") {
  const KNOWN_INDEX_MAP: Record<string, string> = {
    NIFTY: "13",
    BANKNIFTY: "25",
    FINNIFTY: "27",
    MIDCPNIFTY: "442",
    INDIAVIX: "26",
  };

  return useQuery({
    queryKey: ["stored-candles", symbol, interval],
    queryFn: async () => {
      const secId = KNOWN_INDEX_MAP[symbol.toUpperCase()] || symbol;
      const history = await getCandleHistory(secId, interval);
      if (!history?.candles?.length) return null;

      return {
        symbol: history.symbol,
        interval: history.interval,
        lastUpdated: history.lastUpdated,
        candles: history.candles.map(c => ({
          time: c.timestamp,
          date: new Date(c.timestamp).toLocaleString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            day: "numeric",
            month: "short",
          }),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          oi: c.oi,
        })),
      };
    },
    staleTime: 60000,
    retry: 0,
  });
}

function getOIInterpretation(changePercent: number, oiChange: number): string {
  if (changePercent > 0 && oiChange > 0) return "Long Buildup";
  if (changePercent < 0 && oiChange > 0) return "Short Buildup";
  if (changePercent > 0 && oiChange < 0) return "Short Covering";
  if (changePercent < 0 && oiChange < 0) return "Long Unwinding";
  return "Neutral";
}

export function resetProxyStatus() { proxyStatus = "unknown"; proxyCheckTime = 0; }

/**
 * Invalidate the local price cache so next fetch
 * re-reads from IndexedDB (call after DB update).
 */
export function invalidateLocalPriceCache() {
  cachedPrices = null;
  cachedPricesLoaded = false;
  cachedPricesPromise = null;
}


// ── Hook: Proxy Health ──
export function useProxyHealth() {
  return useQuery({
    queryKey: ["proxy-health"],
    queryFn: async () => {
      try {
        const health = await fetchProxyHealth();
        return { ...health, reachable: true };
      } catch {
        return { reachable: false, status: "offline" };
      }
    },
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 0,
  });
}
