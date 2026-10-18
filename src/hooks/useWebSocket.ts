/**
 * React hooks over the MarketWebSocket singleton (live Dhan feed relayed by the proxy).
 * Ticks are keyed by "segment:securityId"; index hooks resolve symbols to IDX_I keys.
 */
import { useState, useEffect, useMemo } from "react";
import { marketWS, indexTickKey, type FeedStatus, type TickData } from "@/lib/websocketClient";

/** True when the Dhan feed is live (ticks flowing through the proxy). */
export function useWebSocketStatus(): boolean {
  const [isConnected, setIsConnected] = useState(() => marketWS.isDhanConnected);
  useEffect(() => marketWS.onStatus(setIsConnected), []);
  return isConnected;
}

/** Proxy and Dhan feed status separately, plus the last Dhan disconnect reason. */
export function useFeedStatus(): FeedStatus {
  const [status, setStatus] = useState<FeedStatus>(() => marketWS.getStatus());
  useEffect(() => marketWS.onFeedStatus(setStatus), []);
  return status;
}

/** Latest tick for a "segment:securityId" key. */
export function useTickByKey(key: string | undefined): TickData | null {
  const [tick, setTick] = useState<TickData | null>(() => (key ? marketWS.getLatest(key) ?? null : null));
  useEffect(() => {
    if (!key) {
      setTick(null);
      return;
    }
    setTick(marketWS.getLatest(key) ?? null);
    return marketWS.subscribe(key, setTick);
  }, [key]);
  return tick;
}

/** Latest tick for an index symbol (NIFTY, BANKNIFTY, SENSEX, INDIAVIX …). */
export function useWebSocketTick(symbol: string): TickData | null {
  return useTickByKey(indexTickKey(symbol));
}

export interface WebSocketIndexData {
  symbol: string;
  name: string;
  ltp: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
}

const INDEX_NAMES: Record<string, string> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  FINNIFTY: "NIFTY FINANCIAL SERVICES",
  MIDCPNIFTY: "NIFTY MIDCAP SELECT",
  SENSEX: "SENSEX",
  BANKEX: "BANKEX",
};

/** Minimum interval between index tick commits to React state. */
const INDEX_TICK_FLUSH_MS = 250;

export function useWebSocketIndices(): { indices: WebSocketIndexData[]; isConnected: boolean } {
  const isConnected = useWebSocketStatus();
  const [tickMap, setTickMap] = useState<Map<string, TickData>>(() => new Map());

  useEffect(() => {
    // Ticks for six indices can arrive many times a second. Buffer them and commit at most once per
    // INDEX_TICK_FLUSH_MS so the header and merged index list re-render a few times a second, not per tick.
    const pending = new Map<string, TickData>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (pending.size === 0) return;
      const batch = new Map(pending);
      pending.clear();
      setTickMap((prev) => {
        const next = new Map(prev);
        for (const [k, v] of batch) next.set(k, v);
        return next;
      });
    };
    const unsubs: Array<() => void> = [];
    for (const symbol of Object.keys(INDEX_NAMES)) {
      const key = indexTickKey(symbol);
      if (!key) continue;
      unsubs.push(
        marketWS.subscribe(key, (data) => {
          pending.set(key, data);
          if (timer === null) timer = setTimeout(flush, INDEX_TICK_FLUSH_MS);
        }),
      );
    }
    return () => {
      unsubs.forEach((u) => u());
      if (timer !== null) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const indices = useMemo(() => {
    const result: WebSocketIndexData[] = [];
    for (const [symbol, name] of Object.entries(INDEX_NAMES)) {
      const key = indexTickKey(symbol);
      const tick = key ? tickMap.get(key) : undefined;
      if (!tick?.ltp) continue;
      result.push({
        symbol,
        name,
        ltp: tick.ltp,
        change: tick.change || 0,
        changePercent: tick.changePercent || 0,
        open: tick.open || tick.ltp,
        high: tick.high || tick.ltp,
        low: tick.low || tick.ltp,
        prevClose: tick.prevClose || tick.close || tick.ltp,
      });
    }
    return result;
  }, [tickMap]);

  return { indices, isConnected };
}

export interface WebSocketVixData {
  value: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
}

export function useWebSocketVix(): { vix: WebSocketVixData | null; isConnected: boolean } {
  const isConnected = useWebSocketStatus();
  const tick = useWebSocketTick("INDIAVIX");
  const vix = useMemo(() => {
    if (!tick?.ltp) return null;
    return {
      value: tick.ltp,
      change: tick.change || 0,
      changePercent: tick.changePercent || 0,
      high: tick.high || tick.ltp,
      low: tick.low || tick.ltp,
    };
  }, [tick]);
  return { vix, isConnected };
}
