import { useMemo, type ReactNode } from "react";
import { useLiveIndices } from "@/hooks/useMarketData";
import { SAMPLE_SIM_SPOT, SimSpotContext, type SimSpot } from "./simSpot";

const NIFTY_NAMES = ["NIFTY", "NIFTY 50"];

/**
 * Reads the NIFTY quote once for every simulator on the page. Falls back to a round,
 * clearly labelled sample level when the proxy is offline.
 */
export default function SimSpotProvider({ children }: { children: ReactNode }) {
  const idx = useLiveIndices();
  const value = useMemo<SimSpot>(() => {
    const rows = idx.data?.data ?? [];
    const hit = rows.find((d) => NIFTY_NAMES.includes((d.symbol || "").toUpperCase()) || NIFTY_NAMES.includes((d.name || "").toUpperCase()));
    if (hit && Number.isFinite(hit.ltp) && hit.ltp > 1000) {
      const live = !!idx.data?.isLive && !idx.stale;
      return { symbol: "NIFTY", spot: Math.round(hit.ltp * 100) / 100, kind: live ? "live" : "delayed", label: live ? "Live NIFTY" : "Last saved NIFTY" };
    }
    return SAMPLE_SIM_SPOT;
  }, [idx.data, idx.stale]);
  return <SimSpotContext.Provider value={value}>{children}</SimSpotContext.Provider>;
}
