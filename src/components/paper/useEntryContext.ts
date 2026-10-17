/**
 * Builds the entry context stamped on every paper trade: IV percentile, India VIX, DTE and contract IV.
 *
 * IVP uses the underlying's own cached bhavcopy IV history when at least 20 days exist; otherwise it
 * falls back to the India VIX percentile over one year (marked with basis "vix").
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAllIndices } from "@/hooks/useMarketData";
import { ivPercentile } from "@/lib/options";
import { dteAt, type EntryContext } from "@/lib/paperTrading";
import { fetchVixHistory, cachedBhavPoints } from "@/lib/volatility/api";
import { computeIvStats, MIN_HISTORY_DAYS } from "@/lib/volatility/history";

export function useEntryContext(): {
  contextFor: (o: { symbol: string; expiry: string; ivPct?: number | null; atmIvPct?: number | null; spot?: number | null }) => EntryContext;
  vix: number | null;
  vixSource: "live" | "history" | null;
} {
  const indices = useAllIndices();
  const hist = useQuery({
    queryKey: ["paper-vix-history-1y"],
    queryFn: () => fetchVixHistory(400),
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 12 * 60 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
  const closes = useMemo(() => (hist.data?.data ?? []).slice(-252).map((r) => r.close).filter((c) => c > 0), [hist.data]);
  const liveVix = indices.data.vix?.value && indices.data.vix.value > 0 ? indices.data.vix.value : null;
  const vix = liveVix ?? (closes.length ? closes[closes.length - 1] : null);
  const vixSource: "live" | "history" | null = liveVix ? "live" : closes.length ? "history" : null;

  const contextFor = useCallback(
    (o: { symbol: string; expiry: string; ivPct?: number | null; atmIvPct?: number | null; spot?: number | null }): EntryContext => {
      let ivp: number | null = null;
      let ivpBasis: EntryContext["ivpBasis"] = null;
      const points = cachedBhavPoints(o.symbol);
      if (o.atmIvPct && o.atmIvPct > 0 && points.length >= MIN_HISTORY_DAYS) {
        const st = computeIvStats(o.atmIvPct, points);
        if (st.ivPercentile !== null) {
          ivp = st.ivPercentile;
          ivpBasis = "symbol";
        }
      }
      if (ivp === null && vix !== null && closes.length >= MIN_HISTORY_DAYS) {
        const p = ivPercentile(vix, closes);
        if (p !== null) {
          ivp = p;
          ivpBasis = "vix";
        }
      }
      return {
        ivp: ivp !== null ? Math.round(ivp * 10) / 10 : null,
        ivpBasis,
        vix: vix !== null ? Math.round(vix * 100) / 100 : null,
        dte: dteAt(o.expiry),
        iv: o.ivPct && o.ivPct > 0 ? Math.round(o.ivPct * 10) / 10 : null,
        spot: o.spot && o.spot > 0 ? o.spot : null,
      };
    },
    [vix, closes],
  );

  return { contextFor, vix, vixSource };
}
