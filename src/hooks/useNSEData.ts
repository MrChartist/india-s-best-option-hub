import { useQuery } from "@tanstack/react-query";
import { fetchLiveOptionChain, fetchLiveIndices, fetchMarketStatus } from "@/lib/nseApi";
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
        console.warn("NSE indices fetch failed, using mock data:", e);
      }
      return { data: indicesData, isLive: false };
    },
    refetchInterval: 30000, // 30s
    staleTime: 15000,
  });
}

// Hook for live option chain with mock fallback
export function useLiveOptionChain(symbol: string, expiry?: string) {
  return useQuery({
    queryKey: ["nse-option-chain", symbol, expiry],
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
            isLive: true,
          };
        }
      } catch (e) {
        console.warn("NSE option chain fetch failed, using mock data:", e);
      }
      // Fallback to mock
      const mock = getOptionChain(symbol);
      return {
        chain: mock.data,
        spotPrice: mock.spotPrice,
        expiries: expiryDates,
        lotSize: mock.lotSize,
        stepSize: mock.stepSize,
        maxPain: getMaxPain(mock.data),
        isLive: false,
      };
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

// Hook for market status
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
          return {
            isOpen: nseStatus?.marketStatus === "Open",
            status: nseStatus?.marketStatus || "Closed",
            isLive: true,
          };
        }
      } catch (e) {
        console.warn("Market status fetch failed:", e);
      }
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes();
      const isOpen = (h > 9 || (h === 9 && m >= 15)) && (h < 15 || (h === 15 && m <= 30));
      return { isOpen, status: isOpen ? "Open" : "Closed", isLive: false };
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
}
