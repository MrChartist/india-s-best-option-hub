/**
 * Dashboard data hooks: the live hooks from useMarketData, with a clearly labelled sample snapshot
 * when the live source has finished loading and returned nothing. While a live request is still in
 * flight the hooks report loading, so sample numbers never flash before real ones.
 */
import { useMemo } from "react";
import { useAllIndices, useFnOStocks, useLiveIndices } from "@/hooks/useMarketData";
import { useNow } from "@/hooks/useNow";
import { istDateString } from "@/lib/options";
import type { FnOStockData } from "@/lib/marketApi";
import type { IndexData } from "@/lib/mockData";
import { SAMPLE_REASON, sampleMarketSnapshot, summariseStocks, type SampleMarketSnapshot } from "./sampleMarket";

let snapshot: { day: string; data: SampleMarketSnapshot } | null = null;
/**
 * The sample snapshot is deterministic, so it is built once per IST trading date rather than
 * once per page load: a tab left open past midnight rebuilds it (and its as-of time) for the new day.
 */
export function getSampleSnapshot(day: string = istDateString(new Date())): SampleMarketSnapshot {
  if (!snapshot || snapshot.day !== day) snapshot = { day, data: sampleMarketSnapshot() };
  return snapshot.data;
}

/** IST calendar date, re-read every minute so sample memos rebuild when the day rolls over. */
function useIstDay(): string {
  return istDateString(useNow(60_000));
}

const NO_SPARK: Record<string, number[]> = {};

const joinReason = (live: string | undefined) => (live && !/sample/i.test(live) ? `${live}. ${SAMPLE_REASON}` : SAMPLE_REASON);

/** Index quotes: live, saved, or sample. `spark` carries the sample intraday path per symbol. */
export function useDashIndices() {
  const r = useLiveIndices();
  const day = useIstDay();
  const fallback = !r.isLoading && r.data.data.length === 0;
  const liveReason = r.data.reason;
  const sample = useMemo(() => {
    if (!fallback) return null;
    const s = getSampleSnapshot(day);
    const asOf = Date.now();
    const data: IndexData[] = s.indices.map(({ path: _path, ...rest }) => rest);
    return {
      data: { data, isLive: false, source: "sample" as const, asOf, stale: true, reason: joinReason(liveReason) },
      isLoading: false,
      source: "sample" as const,
      asOf,
      stale: true,
      isSample: true,
      spark: Object.fromEntries(s.indices.map((i) => [i.symbol, i.path])) as Record<string, number[]>,
    };
  }, [fallback, liveReason, day]);
  return sample ?? { ...r, isSample: false, spark: NO_SPARK };
}

/**
 * VIX, sectors and advance/decline. Falls back to the sample snapshot only when the whole live
 * snapshot is empty, so a partial live feed is never mixed with sample numbers.
 */
export function useDashAllIndices() {
  const r = useAllIndices();
  const day = useIstDay();
  const d = r.data;
  const empty = !r.isLoading && !d.vix && d.advances + d.declines + d.unchanged === 0 && (d.sectors?.length ?? 0) === 0;
  const liveReason = d.reason;
  const sample = useMemo(() => {
    if (!empty) return null;
    const s = getSampleSnapshot(day);
    const asOf = Date.now();
    return {
      data: { vix: s.vix, sectors: s.sectors, ...s.breadth, isLive: false, source: "sample" as const, asOf, stale: true, reason: joinReason(liveReason) },
      isLoading: false,
      source: "sample" as const,
      asOf,
      stale: true,
      isSample: true,
    };
  }, [empty, liveReason, day]);
  return sample ?? { ...r, isSample: false };
}

type FnoQuery = ReturnType<typeof useFnOStocks>;

export interface DashFnoData {
  gainers: FnOStockData[];
  losers: FnOStockData[];
  mostActive: Array<FnOStockData & { oi: number; oiChange: number; oiInterpretation: string }>;
  allStocks: FnOStockData[];
  isLive: boolean;
  source: "nse" | "tradingview" | "database" | "none" | "sample";
  asOf: number;
  stale: boolean;
  reason?: string;
}

/** F&O stock quotes (movers, most active, breadth): live, saved, or sample. */
export function useDashFno(): Omit<FnoQuery, "data"> & { data: DashFnoData | undefined; isSample: boolean } {
  const q = useFnOStocks();
  const day = useIstDay();
  const fallback = !q.isLoading && (!q.data || q.data.allStocks.length === 0);
  const data = useMemo((): DashFnoData | undefined => {
    if (!fallback) return q.data as DashFnoData | undefined;
    const s = getSampleSnapshot(day);
    const allStocks: FnOStockData[] = s.stocks;
    return { ...summariseStocks(allStocks), allStocks, isLive: false, source: "sample", asOf: Date.now(), stale: true, reason: joinReason(q.data?.reason) };
  }, [fallback, q.data, day]);
  return { ...q, data, isSample: fallback };
}
