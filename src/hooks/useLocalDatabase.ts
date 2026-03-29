/**
 * useLocalDatabase — React hooks for reading locally-cached market data
 * 
 * Provides:
 *   1. useCachedPrices()     — All stored price snapshots from IndexedDB
 *   2. useCandleHistory()    — Stored OHLCV candle data for a specific instrument
 *   3. useDatabaseReady()    — Whether the local DB has been populated
 *   4. useInstrumentLookup() — Search instruments from the local DB
 * 
 * These hooks serve as the "offline-first" layer: components load from
 * IndexedDB immediately, then overlay live WebSocket / polling data on top.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getAllPriceSnapshots,
  getCandleHistory,
  getAllCandleHistories,
  getDatabaseStats,
  getFnOStockList,
  findInstrumentBySymbol,
  getInstrumentsBySegment,
  type PriceSnapshot,
  type CandleHistory,
  type CandleData,
  type DatabaseStats,
  type Instrument,
} from "@/lib/localDatabase";

// ── Hook: Database readiness check ──

export function useDatabaseReady() {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    getDatabaseStats().then((s) => {
      setStats(s);
      setIsReady(s.instruments > 0);
    }).catch(() => {
      setIsReady(false);
    });
  }, []);

  return { isReady, stats };
}

// ── Hook: Cached price snapshots ──

export function useCachedPrices() {
  const [prices, setPrices] = useState<PriceSnapshot[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    getAllPriceSnapshots().then((data) => {
      setPrices(data);
      setIsLoaded(true);
    }).catch(() => {
      setIsLoaded(true); // Still mark as loaded even if empty
    });
  }, []);

  // Build a lookup map for O(1) access
  const priceMap = useMemo(() => {
    const map = new Map<string, PriceSnapshot>();
    for (const p of prices) {
      map.set(p.symbol, p);
      map.set(p.securityId, p);
    }
    return map;
  }, [prices]);

  const getPrice = useCallback((symbolOrId: string) => {
    return priceMap.get(symbolOrId) || null;
  }, [priceMap]);

  return { prices, priceMap, getPrice, isLoaded };
}

// ── Hook: Candle history for a specific instrument ──

export function useCandleHistory(
  securityId: string | undefined,
  interval: string = "5",
) {
  const [history, setHistory] = useState<CandleHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!securityId) {
      setHistory(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    getCandleHistory(securityId, interval)
      .then((data) => {
        setHistory(data || null);
      })
      .catch(() => {
        setHistory(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [securityId, interval]);

  // Convert to chart-friendly format
  const chartData = useMemo(() => {
    if (!history?.candles?.length) return [];
    return history.candles.map((c) => ({
      time: c.timestamp,
      date: new Date(c.timestamp).toLocaleString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short",
      }),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      oi: c.oi,
    }));
  }, [history]);

  return { history, chartData, isLoading, hasData: !!history?.candles?.length };
}

// ── Hook: All available candle histories ──

export function useAllCandleHistories() {
  const [histories, setHistories] = useState<CandleHistory[]>([]);

  useEffect(() => {
    getAllCandleHistories().then(setHistories).catch(() => setHistories([]));
  }, []);

  return histories;
}

// ── Hook: F&O Stock instrument list from local DB ──

export function useLocalFnOStocks() {
  const [stocks, setStocks] = useState<Instrument[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    getFnOStockList().then((data) => {
      setStocks(data);
      setIsLoaded(true);
    }).catch(() => {
      setIsLoaded(true);
    });
  }, []);

  return { stocks, isLoaded };
}

// ── Hook: Instrument search/lookup ──

export function useInstrumentLookup() {
  const [allInstruments, setAllInstruments] = useState<Instrument[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Only load F&O instruments for perf (subset of full master)
    getInstrumentsBySegment("NSE_FNO").then((data) => {
      setAllInstruments(data);
      setIsLoaded(true);
    }).catch(() => {
      setIsLoaded(true);
    });
  }, []);

  const search = useCallback((query: string, limit = 20) => {
    if (!query || query.length < 1) return [];
    const q = query.toUpperCase();
    return allInstruments
      .filter((i) => 
        i.symbol.toUpperCase().includes(q) || 
        i.tradingSymbol.toUpperCase().includes(q)
      )
      .slice(0, limit);
  }, [allInstruments]);

  const findBySymbol = useCallback(async (symbol: string) => {
    return findInstrumentBySymbol(symbol);
  }, []);

  return { search, findBySymbol, isLoaded, count: allInstruments.length };
}

// ── Symbol → SecurityId mapping from local DB ──

const KNOWN_INDEX_MAP: Record<string, string> = {
  NIFTY: "13",
  BANKNIFTY: "25",
  FINNIFTY: "27",
  MIDCPNIFTY: "442",
  INDIAVIX: "26",
};

export function getSecurityIdForSymbol(symbol: string): string | undefined {
  return KNOWN_INDEX_MAP[symbol.toUpperCase()];
}
