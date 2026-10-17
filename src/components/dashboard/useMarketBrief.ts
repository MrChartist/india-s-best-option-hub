/**
 * Gathers the daily brief's inputs from the shared (react-query deduplicated) data hooks, so the
 * brief card and the dashboard's "Needs live data" strip read the same answer.
 */
import { useMemo } from "react";
import { useLiveOptionChain, useMarketStatus } from "@/hooks/useMarketData";
import { useParticipantsDashboard } from "@/components/participants/useParticipants";
import { ZONE_TEXT, classifyLongPct } from "@/lib/participantsApi";
import { getOILevels } from "@/lib/oiUtils";
import { briefHeadline, buildMarketBrief, type BriefItem } from "./marketBrief";
import { useDashAllIndices, useDashIndices } from "./useDashboardData";
import { usePrevDailyStat } from "./usePrevStat";
import { useNow } from "./useNow";

export interface MarketBriefResult {
  items: BriefItem[];
  headline: string;
  anySample: boolean;
  isLoading: boolean;
  /** NIFTY chain came from the sample generator. */
  chainIsSample: boolean;
  /** A previous recorded close exists for NIFTY PCR. */
  hasPrevPcr: boolean;
  hasPrevMaxPain: boolean;
  giftAvailable: boolean;
}

export function useMarketBrief(): MarketBriefResult {
  const now = useNow(60_000);
  const idx = useDashIndices();
  const all = useDashAllIndices();
  const status = useMarketStatus();
  const chain = useLiveOptionChain("NIFTY");
  const prev = usePrevDailyStat("NIFTY");
  const fii = useParticipantsDashboard(null, 20);

  const nifty = idx.data.data.find((r) => r.symbol === "NIFTY") ?? null;
  const vix = all.data.vix;
  const c = chain.data;
  const chainIsSample = c?.source === "sample";
  // Never compare sample numbers with a real recorded close.
  const prevStat = chainIsSample ? null : prev.data ?? null;
  const gift = status.data?.giftNifty;
  const giftClose = status.data?.indicativeNifty?.value;
  const fiiView = fii.data?.views.find((v) => v.participant === "FII");
  const fiiLong = fiiView?.products.futIdx.longPct ?? NaN;
  const fiiChg = fiiView?.products.futIdx.change?.longPct ?? null;

  return useMemo(() => {
    const walls = c && c.chain.length > 0 && c.spotPrice > 0 ? getOILevels(c.chain, c.spotPrice, { top: 1 }) : null;
    const zone = ZONE_TEXT[classifyLongPct(fiiLong)];
    const items = buildMarketBrief({
      now,
      nifty: nifty ? { ltp: nifty.ltp, open: nifty.open, prevClose: nifty.prevClose, sample: idx.isSample } : null,
      gift: gift && gift.lastPrice > 0 && giftClose && giftClose > 0 ? { lastPrice: gift.lastPrice, niftyClose: giftClose, changePercent: gift.changePercent } : null,
      vix: vix ? { value: vix.value, changePercent: vix.changePercent, sample: all.isSample } : null,
      pcr: c && c.totalCEOI > 0 ? { value: c.totalPEOI / c.totalCEOI, prev: prevStat?.pcr ?? null, sample: chainIsSample } : null,
      maxPain: c && c.maxPain > 0 ? { value: c.maxPain, prev: prevStat?.maxPain ?? null, spot: c.spotPrice, expiry: c.expiry, sample: chainIsSample } : null,
      fii: fii.data && Number.isFinite(fiiLong) ? { longPct: fiiLong, changePts: fiiChg, zone: zone.label, tone: zone.tone, sample: fii.data.mode === "sample" } : null,
      walls: walls && c ? { resistance: walls.resistance[0]?.strike ?? null, support: walls.support[0]?.strike ?? null, spot: c.spotPrice, sample: chainIsSample } : null,
    });
    return {
      items,
      headline: briefHeadline(items),
      anySample: items.some((x) => x.available && x.sample),
      isLoading: idx.isLoading || chain.isLoading,
      chainIsSample,
      hasPrevPcr: prevStat?.pcr != null,
      hasPrevMaxPain: prevStat?.maxPain != null,
      giftAvailable: !!gift && gift.lastPrice > 0,
    };
  }, [now, nifty, idx.isSample, idx.isLoading, gift, giftClose, vix, all.isSample, c, prevStat, chainIsSample, fii.data, fiiLong, fiiChg, chain.isLoading]);
}

