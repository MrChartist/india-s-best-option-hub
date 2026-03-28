import { useQuery } from "@tanstack/react-query";
import { fetchLiveOptionChain, fetchLiveIndices, fetchMarketStatus, fetchExpiryList } from "@/lib/marketApi";
import { getOptionChain, indicesData, expiryDates, getMaxPain } from "@/lib/mockData";
import type { OptionData, IndexData, ExpiryDate } from "@/lib/mockData";

// Hook for live indices data with mock fallback
export function useLiveIndices() {
  return useQuery({
    queryKey: ["nse-indices"],
    queryFn: async () => {
      try {
        const data = await fetchLiveIndices();
        if (data && data.length > 0) return { data, isLive: true };
      } catch (e) {
        console.warn("Indices fetch failed, using mock data:", e);
      }
      return { data: indicesData, isLive: false };
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

// Hook for GIFT Nifty + market status combined
export function useMarketStatus() {
  return useQuery({
    queryKey: ["nse-market-status"],
    queryFn: async () => {
      try {
        const data = await fetchMarketStatus();
        if (data?.marketState) {
          const nseStatus = data.marketState.find((m: any) =>
            m.market === "Capital Market" || m.market === "CM"
          );

          // Extract GIFT Nifty data
          const giftNifty = data.giftnifty ? {
            lastPrice: data.giftnifty.LASTPRICE || 0,
            change: data.giftnifty.DAYCHANGE || 0,
            changePercent: data.giftnifty.PERCHANGE || 0,
            expiry: data.giftnifty.EXPIRYDATE || "",
            timestamp: data.giftnifty.TIMESTMP || "",
            contractsTraded: data.giftnifty.CONTRACTSTRADED || 0,
          } : null;

          // Extract indicative Nifty
          const indicativeNifty = data.indicativenifty50 ? {
            value: data.indicativenifty50.finalClosingValue || data.indicativenifty50.closingValue || 0,
            change: data.indicativenifty50.change || 0,
            changePercent: data.indicativenifty50.perChange || 0,
            status: data.indicativenifty50.status || "",
          } : null;

          return {
            isOpen: nseStatus?.marketStatus === "Open",
            status: nseStatus?.marketStatus || "Closed",
            isLive: true,
            giftNifty,
            indicativeNifty,
          };
        }
      } catch (e) {
        console.warn("Market status fetch failed:", e);
      }
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes();
      const isOpen = (h > 9 || (h === 9 && m >= 15)) && (h < 15 || (h === 15 && m <= 30));
      return { isOpen, status: isOpen ? "Open" : "Closed", isLive: false, giftNifty: null, indicativeNifty: null };
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

// Hook for live option chain — Dhan primary, NSE fallback, mock last resort
export function useLiveOptionChain(symbol: string, expiry?: string) {
  return useQuery({
    queryKey: ["live-option-chain", symbol, expiry],
    queryFn: async () => {
      try {
        const result = await fetchLiveOptionChain(symbol, expiry);
        if (result && result.chain.length > 0) {
          const stepSize = result.chain.length > 1
            ? Math.abs(result.chain[1].strikePrice - result.chain[0].strikePrice)
            : 50;
          const lotSizeMap: Record<string, number> = {
            NIFTY: 25, BANKNIFTY: 15, FINNIFTY: 25, MIDCPNIFTY: 50,
          };
          return {
            chain: result.chain,
            spotPrice: result.spotPrice,
            expiries: result.expiries,
            lotSize: lotSizeMap[symbol] || 500,
            stepSize,
            maxPain: getMaxPain(result.chain),
            totalCEOI: result.totalCEOI,
            totalPEOI: result.totalPEOI,
            isLive: true,
            source: result.source || "live",
          };
        }
      } catch (e) {
        console.warn("Live option chain fetch failed, using mock data:", e);
      }
      const mock = getOptionChain(symbol);
      return {
        chain: mock.data,
        spotPrice: mock.spotPrice,
        expiries: expiryDates,
        lotSize: mock.lotSize,
        stepSize: mock.stepSize,
        maxPain: getMaxPain(mock.data),
        totalCEOI: 0,
        totalPEOI: 0,
        isLive: false,
        source: "mock" as const,
      };
    },
    refetchInterval: 5000,
    staleTime: 3000,
  });
}

// Hook for expiry list from Dhan
export function useExpiryList(symbol: string) {
  return useQuery({
    queryKey: ["expiry-list", symbol],
    queryFn: async () => {
      try {
        const expiries = await fetchExpiryList(symbol);
        if (expiries.length > 0) return { expiries, isLive: true };
      } catch (e) {
        console.warn("Expiry list fetch failed:", e);
      }
      return { expiries: expiryDates, isLive: false };
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });
}
