import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  fetchChainMulti,
  fetchLiveOptionChain,
  fetchLiveIndices,
  fetchMarketStatus,
  fetchExpiryList,
  fetchAllIndices,
  fetchLiveFnOStocks,
  fetchProxyHealth,
  type AllIndicesSnapshot,
  type ChainMultiResult,
  type FnOStockData,
} from "@/lib/marketApi";
import {
  formatDateIST,
  generateSampleChain,
  getExpiries,
  getLotSize as getContractLotSize,
  getMarketSession,
  maxPain,
  modalStrikeStep,
  normalizeExpiry,
  type MarketSession,
} from "@/lib/options";
import { getLotSize as getFallbackLotSize, getSpotPrice } from "@/lib/positionStore";
import type { OptionData, IndexData, ExpiryDate } from "@/lib/mockData";
import type { DataSource, OptionDataExt, ProxyHealthDTO, SourceMeta } from "@/lib/types/market";
import { useWebSocketIndices, useWebSocketVix, useWebSocketStatus } from "@/hooks/useWebSocket";
import { getAllPriceSnapshots, getCandleHistory, type PriceSnapshot } from "@/lib/localDatabase";
import { resetProxyGate, shouldTryProxy } from "@/lib/api/proxyClient";
import {
  allIndicesRefetchInterval,
  buildCachedIndices,
  chainMultiRefetchInterval,
  chainRefetchInterval,
  fallbackReason,
  fnoRefetchInterval,
  indicesRefetchInterval,
  isLiveSession,
  marketStatusRefetchInterval,
  meta,
} from "@/lib/marketData/policy";

// Reachability is tracked by the shared gate in src/lib/api/proxyClient.ts: every proxyFetchJSON /
// proxyGet call is gated and reports its own outcome, so these hooks only check shouldTryProxy() to
// skip work cheaply while the proxy is known to be down.

export { isLiveSession };

// ── Local database cache singleton ──
let cachedPrices: PriceSnapshot[] | null = null;
let cachedPricesPromise: Promise<PriceSnapshot[]> | null = null;

async function getCachedPricesOnce(): Promise<PriceSnapshot[]> {
  if (cachedPrices !== null) return cachedPrices;
  if (cachedPricesPromise) return cachedPricesPromise;
  cachedPricesPromise = getAllPriceSnapshots()
    .then((p) => (cachedPrices = p))
    .catch(() => (cachedPrices = []));
  return cachedPricesPromise;
}

// ── Hook: Live Indices (WebSocket primary, polling fallback, DB cache tertiary) ──
export function useLiveIndices() {
  const { indices: wsIndices, isConnected: wsConnected } = useWebSocketIndices();

  const pollingQuery = useQuery({
    queryKey: ["nse-indices"],
    queryFn: async (): Promise<{ data: IndexData[]; isLive: boolean } & SourceMeta> => {
      let reason = "Proxy offline";
      if (shouldTryProxy()) {
        try {
          const data = await fetchLiveIndices();
          if (data.length > 0) return { data, isLive: true, ...meta("nse") };
          reason = "Live sources returned no index prices";
        } catch (e) {
          reason = fallbackReason(e);
        }
      }
      const db = buildCachedIndices(await getCachedPricesOnce());
      if (db.data.length > 0) return { data: db.data, isLive: false, ...meta("database", db.asOf || Date.now(), true, `${reason}. Showing prices saved in the local database.`) };
      return { data: [], isLive: false, ...meta("none", Date.now(), true, reason) };
    },
    refetchInterval: (query) => indicesRefetchInterval({ wsConnected, isLive: query.state.data?.isLive }),
    staleTime: 10000,
    retry: 1,
  });

  const mergedData = useMemo(() => {
    if (wsIndices.length > 0) {
      const polledData = pollingQuery.data?.data ?? [];
      const merged: IndexData[] = wsIndices.map((ws) => {
        const polled = polledData.find((p) => p.symbol === ws.symbol);
        return {
          name: ws.name,
          symbol: ws.symbol,
          ltp: ws.ltp,
          change: ws.change,
          changePercent: ws.changePercent,
          open: ws.open || polled?.open || ws.ltp,
          high: ws.high || polled?.high || ws.ltp,
          low: ws.low || polled?.low || ws.ltp,
          prevClose: ws.prevClose || polled?.prevClose || ws.ltp,
        };
      });
      for (const p of polledData) if (!merged.find((m) => m.symbol === p.symbol)) merged.push(p);
      return { data: merged, isLive: true, ...meta("dhan") };
    }
    return pollingQuery.data ?? { data: [] as IndexData[], isLive: false, ...meta("none", Date.now(), true, "Loading index prices") };
  }, [wsIndices, pollingQuery.data]);

  return {
    data: mergedData,
    isLoading: pollingQuery.isLoading && wsIndices.length === 0,
    source: mergedData.source,
    asOf: mergedData.asOf,
    stale: mergedData.stale,
  };
}

// ── Hook: Market Status + GIFT Nifty ──
const SESSION_LABEL: Record<MarketSession, string> = {
  "pre-open": "Pre-open",
  open: "Open",
  closing: "Closing session",
  closed: "Closed",
  holiday: "Holiday",
  weekend: "Closed (weekend)",
};

export function useMarketStatus() {
  return useQuery({
    queryKey: ["nse-market-status"],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const data = await fetchMarketStatus();
          if (data?.marketState) {
            const nseStatus = data.marketState.find((m) => m.market === "Capital Market" || m.market === "CM");
            const n = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, "")) || 0);
            const giftNifty = data.giftnifty
              ? {
                  lastPrice: n(data.giftnifty.LASTPRICE),
                  change: n(data.giftnifty.DAYCHANGE),
                  changePercent: n(data.giftnifty.PERCHANGE),
                  expiry: data.giftnifty.EXPIRYDATE || "",
                  timestamp: data.giftnifty.TIMESTMP || "",
                  contractsTraded: n(data.giftnifty.CONTRACTSTRADED),
                }
              : null;
            const indicativeNifty = data.indicativenifty50
              ? {
                  value: data.indicativenifty50.finalClosingValue || data.indicativenifty50.closingValue || 0,
                  change: data.indicativenifty50.change || 0,
                  changePercent: data.indicativenifty50.perChange || 0,
                  status: data.indicativenifty50.status || "",
                }
              : null;
            const status = nseStatus?.marketStatus || "Closed";
            return { isOpen: status === "Open", status, session: getMarketSession(), isLive: true, giftNifty, indicativeNifty, ...meta("nse") };
          }
        } catch {
          /* fall through to the IST clock */
        }
      }
      // Offline: derive the session from the IST clock and the NSE holiday calendar.
      const session = getMarketSession();
      return {
        isOpen: session === "open",
        status: SESSION_LABEL[session],
        session,
        isLive: false,
        giftNifty: null,
        indicativeNifty: null,
        ...meta("none", Date.now(), true, "Derived from the IST clock and NSE holiday calendar"),
      };
    },
    refetchInterval: (query) => marketStatusRefetchInterval(query.state.data?.isLive),
    staleTime: 10000,
    retry: 0,
  });
}

// ── Option chain helpers ──

export interface OptionChainHookData {
  chain: OptionData[];
  spotPrice: number;
  expiries: ExpiryDate[];
  /** ISO expiry the chain belongs to. */
  expiry: string;
  lotSize: number;
  stepSize: number;
  maxPain: number;
  totalCEOI: number;
  totalPEOI: number;
  isLive: boolean;
  afterHours: boolean;
  source: DataSource;
  cachedAt: number | null;
  asOf: number;
  stale: boolean;
  reason?: string;
}

function resolveLotSize(symbol: string, expiry?: string): number {
  return getContractLotSize(symbol, expiry || undefined) ?? getFallbackLotSize(symbol) ?? 1;
}

function derivedExpiries(symbol: string, now: Date = new Date()): ExpiryDate[] {
  return getExpiries(symbol, now, 6).map((e) => ({ label: formatDateIST(e.date), value: e.date, daysToExpiry: e.dte }));
}

async function sampleSpot(symbol: string): Promise<number> {
  const prices = await getCachedPricesOnce();
  const p = prices.find((x) => x.symbol === symbol.toUpperCase());
  return p && p.ltp > 0 ? p.ltp : getSpotPrice(symbol.toUpperCase());
}

/** Labelled sample chain used when neither the proxy nor any live source answers. */
export async function buildSampleChainData(symbol: string, expiry?: string, reason = "Live data unavailable"): Promise<OptionChainHookData> {
  const sym = symbol.toUpperCase();
  const expiries = derivedExpiries(sym);
  const exp = (expiry && normalizeExpiry(expiry)) || expiries[0]?.value || "";
  const spot = await sampleSpot(sym);
  const sample = generateSampleChain({ symbol: sym, spot, expiry: exp });
  let ce = 0;
  let pe = 0;
  for (const r of sample.chain) { ce += r.ce.oi; pe += r.pe.oi; }
  return {
    chain: sample.chain,
    spotPrice: sample.spotPrice || spot,
    expiries,
    expiry: exp,
    lotSize: resolveLotSize(sym, exp),
    stepSize: modalStrikeStep(sample.chain, spot),
    maxPain: sample.chain.length > 0 ? maxPain(sample.chain) : 0,
    totalCEOI: ce,
    totalPEOI: pe,
    isLive: false,
    afterHours: false,
    source: "sample",
    cachedAt: null,
    asOf: Date.now(),
    stale: true,
    reason,
  };
}

// ── Hook: Live Option Chain ──
// Live during market hours, last-good copy after hours, and a clearly labelled sample when offline.
export function useLiveOptionChain(symbol: string, expiry?: string) {
  return useQuery({
    queryKey: ["live-option-chain", symbol, expiry],
    queryFn: async (): Promise<OptionChainHookData> => {
      let reason = "Proxy offline";
      if (shouldTryProxy()) {
        try {
          const result = await fetchLiveOptionChain(symbol, expiry);
          const exp = result.expiry || (expiry ? normalizeExpiry(expiry) : "") || result.expiries[0]?.value || "";
          return {
            chain: result.chain,
            spotPrice: result.spotPrice,
            expiries: result.expiries,
            expiry: exp,
            lotSize: resolveLotSize(symbol, exp),
            stepSize: modalStrikeStep(result.chain, result.spotPrice),
            maxPain: result.chain.length > 0 ? maxPain(result.chain) : 0,
            totalCEOI: result.totalCEOI,
            totalPEOI: result.totalPEOI,
            isLive: !result.stale && isLiveSession(),
            // Outside the session the chain is the closing picture, even when freshly fetched.
            afterHours: result.afterHours || result.stale || !isLiveSession(),
            source: result.stale ? "cache" : result.source,
            cachedAt: result.cachedAt,
            asOf: result.asOf,
            stale: result.stale,
            reason: result.stale ? `Last saved ${result.source.toUpperCase()} chain` : undefined,
          };
        } catch (e) {
          const why = fallbackReason(e, "");
          reason = why === "Proxy offline" || why === "Proxy timed out" ? why : "Live sources returned no chain";
        }
      }
      return buildSampleChainData(symbol, expiry, reason);
    },
    refetchInterval: (query) => chainRefetchInterval(query.state.data),
    staleTime: 2000,
    retry: 1,
  });
}

// ── Hook: Multi-expiry chain ──

export interface ChainMultiHookData extends ChainMultiResult {
  isLive: boolean;
  source: DataSource;
  asOf: number;
  stale: boolean;
  reason?: string;
}

export function useChainMulti(symbol: string, expiries: string[] | "next3" | "all") {
  const expKey = Array.isArray(expiries) ? expiries.join(",") : expiries;
  return useQuery({
    queryKey: ["chain-multi", symbol, expKey],
    queryFn: async ({ signal }): Promise<ChainMultiHookData> => {
      const env = await fetchChainMulti(symbol, expiries, signal);
      if (env.data && env.data.expiries.length > 0) {
        return { ...env.data, isLive: !env.meta.stale && isLiveSession(), source: env.meta.source, asOf: env.meta.asOf, stale: env.meta.stale, reason: env.meta.reason };
      }
      // Sample fallback, one chain per expiry.
      const sym = symbol.toUpperCase();
      const wanted = Array.isArray(expiries) && expiries.length > 0
        ? expiries.map((e) => normalizeExpiry(e)).filter(Boolean)
        : derivedExpiries(sym).slice(0, expiries === "all" ? 6 : 3).map((e) => e.value);
      const spot = await sampleSpot(sym);
      return {
        symbol: sym,
        spot,
        expiries: wanted.map((exp) => ({ expiry: exp, chain: generateSampleChain({ symbol: sym, spot, expiry: exp }).chain as OptionDataExt[] })),
        isLive: false,
        source: "sample",
        asOf: Date.now(),
        stale: true,
        reason: env.meta.reason ? fallbackReason(env.meta.reason) : "Live multi-expiry chain unavailable",
      };
    },
    enabled: !!symbol,
    refetchInterval: (query) => chainMultiRefetchInterval(query.state.data?.isLive),
    staleTime: 10000,
    retry: 0,
  });
}

// ── Hook: Expiry List ──
export function useExpiryList(symbol: string) {
  return useQuery({
    queryKey: ["expiry-list", symbol],
    queryFn: async (): Promise<{ expiries: ExpiryDate[]; isLive: boolean } & SourceMeta> => {
      if (shouldTryProxy()) {
        try {
          const expiries = await fetchExpiryList(symbol);
          if (expiries.length > 0) return { expiries, isLive: true, ...meta("dhan") };
        } catch {
          /* derive from the calendar below */
        }
      }
      // Derived from SEBI expiry rules and the NSE holiday calendar.
      return { expiries: derivedExpiries(symbol), isLive: false, ...meta("sample", Date.now(), true, "Derived from SEBI expiry rules") };
    },
    staleTime: 60000,
    refetchInterval: 300000,
    retry: 1,
  });
}

// ── Hook: All Indices (VIX + Sectors + Advance/Decline) ──
type AllIndicesData = AllIndicesSnapshot & { isLive: boolean } & SourceMeta;

const EMPTY_ALL_INDICES = (): AllIndicesData => ({ vix: null, sectors: [], advances: 0, declines: 0, unchanged: 0, isLive: false, ...meta("none", Date.now(), true, "Proxy offline") });

export function useAllIndices() {
  const { vix: wsVix } = useWebSocketVix();
  const wsConnected = useWebSocketStatus();

  const pollingQuery = useQuery({
    queryKey: ["nse-all-indices"],
    queryFn: async (): Promise<AllIndicesData> => {
      if (shouldTryProxy()) {
        try {
          const data = await fetchAllIndices();
          if (data) return { ...data, isLive: true, ...meta("nse") };
        } catch {
          /* empty snapshot below */
        }
      }
      return EMPTY_ALL_INDICES();
    },
    refetchInterval: (query) => allIndicesRefetchInterval({ wsConnected, isLive: query.state.data?.isLive }),
    staleTime: 15000,
    retry: 1,
  });

  const mergedData = useMemo((): AllIndicesData => {
    const base = pollingQuery.data ?? EMPTY_ALL_INDICES();
    if (wsVix) return { ...base, vix: wsVix, isLive: true, ...meta(base.isLive ? base.source : "dhan", Date.now(), false) };
    return base;
  }, [pollingQuery.data, wsVix]);

  return { data: mergedData, isLoading: pollingQuery.isLoading, source: mergedData.source, asOf: mergedData.asOf, stale: mergedData.stale };
}

// ── Hook: F&O Stocks (Top Movers + Most Active) ──

function getOIInterpretation(changePercent: number, oiChange: number): string {
  if (changePercent > 0 && oiChange > 0) return "Long Buildup";
  if (changePercent < 0 && oiChange > 0) return "Short Buildup";
  if (changePercent > 0 && oiChange < 0) return "Short Covering";
  if (changePercent < 0 && oiChange < 0) return "Long Unwinding";
  return "Neutral";
}

function summariseStocks(stocks: FnOStockData[]) {
  const gainers = stocks.filter((s) => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
  const losers = stocks.filter((s) => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
  const mostActive = [...stocks].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 10).map((s) => ({
    ...s,
    oi: s.openInterest || 0,
    oiChange: s.oiChange || 0,
    oiInterpretation: getOIInterpretation(s.changePercent, s.oiChange || 0),
  }));
  return { gainers, losers, mostActive };
}

export function useFnOStocks() {
  return useQuery({
    queryKey: ["nse-fno-stocks"],
    queryFn: async () => {
      if (shouldTryProxy()) {
        try {
          const stocks = await fetchLiveFnOStocks();
          if (stocks.length > 0) {
            const hasOI = stocks.some((s) => (s.openInterest || 0) > 0);
            const source = hasOI ? ("nse" as const) : ("tradingview" as const);
            // `source` keeps its historical values ("nse" | "tradingview" | "database" | "none").
            return { ...summariseStocks(stocks), allStocks: stocks, isLive: true, source, asOf: Date.now(), stale: false, reason: undefined as string | undefined };
          }
        } catch {
          /* local database below */
        }
      }
      const dbPrices = await getCachedPricesOnce();
      const dbStocks: FnOStockData[] = dbPrices
        .filter((p) => p.ltp > 0 && p.symbol)
        .map((p) => ({ symbol: p.symbol, ltp: p.ltp, change: p.change, changePercent: p.changePercent, open: p.open, high: p.high, low: p.low, previousClose: p.close, volume: p.volume, totalTradedVolume: p.volume, openInterest: p.oi, oiChange: 0 }));
      if (dbStocks.length > 0) {
        const asOf = dbPrices.reduce((m, p) => Math.max(m, p.timestamp || 0), 0) || Date.now();
        return { ...summariseStocks(dbStocks), allStocks: dbStocks, isLive: false, source: "database" as const, asOf, stale: true, reason: "Prices saved in the local database" as string | undefined };
      }
      return { gainers: [], losers: [], mostActive: [], allStocks: [] as FnOStockData[], isLive: false, source: "none" as const, asOf: Date.now(), stale: true, reason: "Proxy offline" as string | undefined };
    },
    refetchInterval: (query) => fnoRefetchInterval(query.state.data?.isLive),
    staleTime: 15000,
    retry: 1,
  });
}

// ── Hook: Candle history for charts (from the local database) ──
const KNOWN_INDEX_MAP: Record<string, string> = { NIFTY: "13", BANKNIFTY: "25", FINNIFTY: "27", MIDCPNIFTY: "442", INDIAVIX: "21", SENSEX: "51", BANKEX: "69" };

export function useStoredCandles(symbol: string, interval: string = "5") {
  return useQuery({
    queryKey: ["stored-candles", symbol, interval],
    queryFn: async () => {
      const secId = KNOWN_INDEX_MAP[symbol.toUpperCase()] || symbol;
      const history = await getCandleHistory(secId, interval);
      if (!history?.candles?.length) return null;
      return {
        symbol: history.symbol,
        interval: history.interval,
        lastUpdated: history.lastUpdated,
        source: "database" as const,
        asOf: history.lastUpdated,
        stale: true,
        candles: history.candles.map((c) => ({
          time: c.timestamp,
          date: new Date(c.timestamp).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          oi: c.oi,
        })),
      };
    },
    staleTime: 60000,
    retry: 0,
  });
}

/** Forget the proxy's reachability (next request probes again). Kept for existing callers. */
export function resetProxyStatus() {
  resetProxyGate();
}

/** Invalidate the local price cache so the next fetch re-reads IndexedDB (call after a DB update). */
export function invalidateLocalPriceCache() {
  cachedPrices = null;
  cachedPricesPromise = null;
}

// ── Hook: Proxy Health ──
export function useProxyHealth() {
  return useQuery({
    queryKey: ["proxy-health"],
    queryFn: async (): Promise<ProxyHealthDTO & { reachable: boolean } & SourceMeta> => {
      try {
        // fetchProxyHealth respects the gate's backoff and reports its outcome to it.
        const health = await fetchProxyHealth();
        return { ...health, reachable: true, ...meta("cache") };
      } catch (e) {
        return { reachable: false, status: "offline", ...meta("none", Date.now(), true, fallbackReason(e)) };
      }
    },
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 0,
  });
}
