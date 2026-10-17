import { useMemo } from "react";
import { useLiveIndices } from "@/hooks/useMarketData";
import { getContractSpec } from "@/lib/options";

/**
 * Round illustrative levels used only when no quote is available. Always shown with a
 * "Sample" badge and editable; never presented as a live price.
 */
const SAMPLE_SPOT: Record<string, number> = {
  NIFTY: 25000,
  BANKNIFTY: 56000,
  FINNIFTY: 26500,
  MIDCPNIFTY: 13000,
  NIFTYNXT50: 68000,
  SENSEX: 82000,
  BANKEX: 63000,
};

const NAME_ALIASES: Record<string, string[]> = {
  NIFTY: ["NIFTY", "NIFTY 50"],
  BANKNIFTY: ["BANKNIFTY", "NIFTY BANK"],
  FINNIFTY: ["FINNIFTY", "NIFTY FINANCIAL SERVICES", "NIFTY FIN SERVICE"],
  MIDCPNIFTY: ["MIDCPNIFTY", "NIFTY MIDCAP SELECT", "NIFTY MID SELECT"],
  NIFTYNXT50: ["NIFTYNXT50", "NIFTY NEXT 50"],
  SENSEX: ["SENSEX", "BSE SENSEX"],
  BANKEX: ["BANKEX", "BSE BANKEX"],
};

export interface SpotHint {
  /** NaN when nothing is known (stocks without a quote). */
  spot: number;
  kind: "live" | "delayed" | "sample" | "none";
  label: string;
  isLoading: boolean;
}

/** Best available spot for an underlying: live/delayed index quote, else a labelled sample level. */
export function useSpotHint(symbol: string): SpotHint {
  const idx = useLiveIndices();
  return useMemo(() => {
    const sym = symbol.toUpperCase();
    const names = NAME_ALIASES[sym] ?? [sym];
    const hit = (idx.data?.data ?? []).find((d) => names.includes((d.symbol || "").toUpperCase()) || names.includes((d.name || "").toUpperCase()));
    if (hit && hit.ltp > 0) {
      const live = idx.data?.isLive && !idx.stale;
      return { spot: hit.ltp, kind: live ? "live" : "delayed", label: live ? "Live" : "Last saved", isLoading: false };
    }
    const sample = SAMPLE_SPOT[sym];
    if (sample) return { spot: sample, kind: "sample", label: "Sample spot", isLoading: idx.isLoading };
    const spec = getContractSpec(sym);
    return { spot: NaN, kind: "none", label: spec?.kind === "STOCK" ? "Enter price" : "No quote", isLoading: idx.isLoading };
  }, [idx.data, idx.stale, idx.isLoading, symbol]);
}
