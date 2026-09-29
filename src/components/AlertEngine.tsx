import { useEffect, useMemo } from "react";
import { useAllIndices, useFnOStocks, useLiveIndices, useLiveOptionChain } from "@/hooks/useMarketData";
import { useWebSocketVix } from "@/hooks/useWebSocket";
import { useAlertEngine } from "@/hooks/useAlertEngine";
import { alertStore, metricKey, useAlertState, VIX_SYMBOL } from "@/lib/alerts";
import { calculatePCR, getATMIV } from "@/lib/oiUtils";

/** Pulls PCR / ATM IV for one symbol out of its option chain into the alert metrics store. */
function ChainFeed({ symbol }: { symbol: string }) {
  const { data } = useLiveOptionChain(symbol);

  useEffect(() => {
    // Only feed live chains — after-hours snapshots would trigger stale alerts.
    if (!data?.isLive || !data.chain.length) return;
    const { pcrOI } = calculatePCR(data.chain);
    const { atmIV } = getATMIV(data.chain, data.spotPrice);
    const patch: Record<string, number> = {};
    if (pcrOI > 0) patch[metricKey(symbol, "pcr")] = pcrOI;
    if (atmIV > 0) patch[metricKey(symbol, "atm_iv")] = atmIV;
    alertStore.setMetrics(patch);
  }, [data, symbol]);

  return null;
}

/**
 * Headless. Feeds live index / stock / VIX / chain readings into the alert store
 * and runs the evaluator. Mounted once in the app shell.
 */
export function AlertEngine() {
  const { alerts } = useAlertState();
  const { data: indicesResult } = useLiveIndices();
  const { data: allIndices } = useAllIndices();
  const { data: fno } = useFnOStocks();
  const { vix: wsVix } = useWebSocketVix();

  useAlertEngine();

  // Index prices + day change (live only)
  useEffect(() => {
    if (!indicesResult?.isLive) return;
    const patch: Record<string, number> = {};
    for (const idx of indicesResult.data) {
      patch[metricKey(idx.symbol, "price")] = idx.ltp;
      patch[metricKey(idx.symbol, "change_pct")] = idx.changePercent;
    }
    alertStore.setMetrics(patch);
  }, [indicesResult]);

  // F&O stock prices + day change (live only)
  useEffect(() => {
    if (!fno?.isLive) return;
    const patch: Record<string, number> = {};
    for (const s of fno.allStocks) {
      patch[metricKey(s.symbol, "price")] = s.ltp;
      patch[metricKey(s.symbol, "change_pct")] = s.changePercent;
    }
    alertStore.setMetrics(patch);
  }, [fno]);

  // VIX — WebSocket tick wins over polled value
  const vix = wsVix?.value ?? allIndices?.vix?.value;
  useEffect(() => {
    if (vix && vix > 0) alertStore.setMetrics({ [metricKey(VIX_SYMBOL, "vix")]: vix });
  }, [vix]);

  // Chain-derived metrics are only fetched for symbols that have an active PCR / IV alert
  const chainSymbols = useMemo(() => {
    const set = new Set<string>();
    for (const a of alerts) {
      if (a.active && (a.metric === "pcr" || a.metric === "atm_iv")) set.add(a.symbol);
    }
    return [...set];
  }, [alerts]);

  return (
    <>
      {chainSymbols.map((s) => (
        <ChainFeed key={s} symbol={s} />
      ))}
    </>
  );
}
