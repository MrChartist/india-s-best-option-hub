/**
 * React Hooks for Dhan WebSocket real-time market data
 * 
 * These hooks consume the MarketWebSocket singleton and provide
 * real-time ticking data to dashboard components.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { marketWS, SYMBOL_TO_SECURITY_ID, type TickData } from "@/lib/websocketClient";

// ── Hook: WebSocket Connection Status ──

export function useWebSocketStatus() {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    return marketWS.onStatus(setIsConnected);
  }, []);

  return isConnected;
}

// ── Hook: Single Instrument Tick ──

export function useWebSocketTick(symbol: string): TickData | null {
  const securityId = SYMBOL_TO_SECURITY_ID[symbol];
  const [tick, setTick] = useState<TickData | null>(() => {
    return securityId ? marketWS.getLatest(securityId) || null : null;
  });

  useEffect(() => {
    if (!securityId) return;
    return marketWS.subscribe(securityId, setTick);
  }, [securityId]);

  return tick;
}

// ── Hook: All Index Ticks (NIFTY, BANKNIFTY, etc.) ──

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
  MIDCPNIFTY: "NIFTY MIDCAP 50",
};

export function useWebSocketIndices(): { indices: WebSocketIndexData[]; isConnected: boolean } {
  const isConnected = useWebSocketStatus();
  const [tickMap, setTickMap] = useState<Map<number, TickData>>(new Map());

  useEffect(() => {
    // Subscribe to all index ticks
    const indexSymbols = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
    const unsubscribers: (() => void)[] = [];

    for (const symbol of indexSymbols) {
      const secId = SYMBOL_TO_SECURITY_ID[symbol];
      if (!secId) continue;

      const unsub = marketWS.subscribe(secId, (data) => {
        setTickMap((prev) => {
          const next = new Map(prev);
          next.set(secId, data);
          return next;
        });
      });
      unsubscribers.push(unsub);
    }

    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);

  const indices = useMemo(() => {
    const result: WebSocketIndexData[] = [];
    for (const [symbol, name] of Object.entries(INDEX_NAMES)) {
      const secId = SYMBOL_TO_SECURITY_ID[symbol];
      const tick = tickMap.get(secId);
      if (tick?.ltp) {
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
    }
    return result;
  }, [tickMap]);

  return { indices, isConnected };
}

// ── Hook: VIX Real-time ──

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

// ── Hook: Force reconnect ──

export function useWebSocketReconnect() {
  return useCallback(() => {
    marketWS.disconnect();
    setTimeout(() => marketWS.connect(), 200);
  }, []);
}
