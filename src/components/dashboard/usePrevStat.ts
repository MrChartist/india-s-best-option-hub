import { useQuery } from "@tanstack/react-query";
import { istDateString } from "@/lib/options";
import { getDailyStats } from "@/lib/snapshotStore";

export interface PrevDailyStat {
  date: string;
  /** OI PCR at the previous recorded close; null when not recorded. */
  pcr: number | null;
  /** Max pain at the previous recorded close; null when not recorded. */
  maxPain: number | null;
}

/**
 * The most recent end-of-day stats recorded locally for a symbol before today (IST), from the
 * snapshot recorder. Null until the recorder has seen at least one earlier session.
 */
export function usePrevDailyStat(symbol: string) {
  return useQuery({
    queryKey: ["dash-prev-stat", symbol],
    queryFn: async (): Promise<PrevDailyStat | null> => {
      try {
        const stats = await getDailyStats(symbol, 7);
        const today = istDateString();
        const prev = stats
          .filter((s) => s.date < today && ((Number.isFinite(s.pcrOi) && s.pcrOi > 0) || (Number.isFinite(s.maxPain) && s.maxPain > 0)))
          .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        if (!prev) return null;
        return {
          date: prev.date,
          pcr: Number.isFinite(prev.pcrOi) && prev.pcrOi > 0 ? prev.pcrOi : null,
          maxPain: Number.isFinite(prev.maxPain) && prev.maxPain > 0 ? prev.maxPain : null,
        };
      } catch {
        return null;
      }
    },
    staleTime: 10 * 60_000,
    retry: 0,
  });
}
