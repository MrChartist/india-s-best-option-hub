import type { OptionData, ExpiryDate, IndexData } from "./mockData";
import { getActiveBroker } from "./brokerConfig";

// Local proxy base URL — override via VITE_PROXY_URL if deploying proxy elsewhere
const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

// ── Broker-agnostic proxy fetch ──
//
// The proxy router picks an adapter via the `broker` query param + the
// `x-broker-id` / `x-broker-credentials` headers. Each adapter normalizes its
// native response into the unified shapes consumed below.
//
// Credentials are sent as base64(JSON) so the field set is broker-defined
// (Dhan: clientId/accessToken, Kite: apiKey/accessToken, etc).

function buildBrokerHeaders(): { headers: Record<string, string>; brokerId: string } {
  const headers: Record<string, string> = {};
  const activeBroker = getActiveBroker();
  const brokerId = activeBroker?.brokerId || "dhan";
  headers["x-broker-id"] = brokerId;
  if (activeBroker?.values && Object.keys(activeBroker.values).length > 0) {
    try {
      headers["x-broker-credentials"] = btoa(JSON.stringify(activeBroker.values));
    } catch {
      // btoa fails on non-Latin1 chars; should never happen for API keys/tokens
    }
  }
  return { headers, brokerId };
}

async function fetchBrokerProxy(endpoint: string, params?: Record<string, string>): Promise<any> {
  const { headers, brokerId } = buildBrokerHeaders();
  const qp = new URLSearchParams({ broker: brokerId, endpoint, ...params });
  const url = `${PROXY_BASE}/api/broker-proxy?${qp.toString()}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Broker proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

// NSE proxy for indices & market status (broker-agnostic, fallback)
async function fetchNSEProxy(endpoint: string, symbol?: string): Promise<any> {
  const params = new URLSearchParams({ endpoint });
  if (symbol) params.set("symbol", symbol);
  const url = `${PROXY_BASE}/api/nse-proxy?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`NSE proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

// ── Unified Option Chain Response (matches brokers/types.mjs) ──

export interface UnifiedChainResponse {
  source: string;
  symbol: string;
  expiry: string | null;
  spotPrice: number;
  chain: OptionData[];
  totalCEOI: number;
  totalPEOI: number;
  afterHours: boolean;
  cachedAt: number | null;
}

// ── Legacy Dhan parser (kept for backward compatibility with existing unit tests) ──

interface DhanOptionChainData {
  data: {
    oc: Record<string, { ce?: DhanOptionLeg; pe?: DhanOptionLeg }>;
    iv_oc?: Record<string, { ce_iv?: number; pe_iv?: number }>;
    gk_oc?: Record<string, {
      ce_delta?: number; ce_gamma?: number; ce_theta?: number; ce_vega?: number;
      pe_delta?: number; pe_gamma?: number; pe_theta?: number; pe_vega?: number;
    }>;
    last_price?: number;
    oi_data?: Record<string, { ce_oi?: number; pe_oi?: number; ce_oi_chg?: number; pe_oi_chg?: number }>;
  };
  status: string;
}

interface DhanOptionLeg {
  ltp?: number; last_price?: number; close?: number;
  volume?: number; oi?: number; oi_chg?: number; previous_oi?: number;
  iv?: number; implied_volatility?: number;
  delta?: number; gamma?: number; theta?: number; vega?: number;
  bid_price?: number; ask_price?: number;
  best_bid_price?: number; best_ask_price?: number;
  top_bid_price?: number; top_ask_price?: number;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
}

/**
 * @deprecated The proxy now returns the unified shape directly. This function
 * is preserved for unit tests and any caller still consuming raw Dhan responses.
 */
export function parseDhanOptionChain(raw: DhanOptionChainData): {
  chain: OptionData[];
  spotPrice: number;
  totalCEOI: number;
  totalPEOI: number;
} {
  const oc = raw?.data?.oc || {};
  const spotPrice = raw?.data?.last_price || 0;

  let totalCEOI = 0;
  let totalPEOI = 0;

  const chain: OptionData[] = Object.keys(oc)
    .map((strikeStr) => {
      const strike = parseFloat(strikeStr);
      const legData = oc[strikeStr];

      const ceOI = legData.ce?.oi || 0;
      const peOI = legData.pe?.oi || 0;
      totalCEOI += ceOI;
      totalPEOI += peOI;

      const ceGreeks = legData.ce?.greeks || {};
      const peGreeks = legData.pe?.greeks || {};

      return {
        strikePrice: strike,
        ce: {
          ltp: legData.ce?.last_price || legData.ce?.ltp || 0,
          oi: ceOI,
          oiChange: legData.ce?.oi_chg || (ceOI - (legData.ce?.previous_oi || ceOI)),
          volume: legData.ce?.volume || 0,
          iv: legData.ce?.implied_volatility || legData.ce?.iv || 0,
          delta: ceGreeks.delta || legData.ce?.delta || 0,
          gamma: ceGreeks.gamma || legData.ce?.gamma || 0,
          theta: ceGreeks.theta || legData.ce?.theta || 0,
          vega: ceGreeks.vega || legData.ce?.vega || 0,
          bidPrice: legData.ce?.top_bid_price || legData.ce?.best_bid_price || legData.ce?.bid_price || 0,
          askPrice: legData.ce?.top_ask_price || legData.ce?.best_ask_price || legData.ce?.ask_price || 0,
        },
        pe: {
          ltp: legData.pe?.last_price || legData.pe?.ltp || 0,
          oi: peOI,
          oiChange: legData.pe?.oi_chg || (peOI - (legData.pe?.previous_oi || peOI)),
          volume: legData.pe?.volume || 0,
          iv: legData.pe?.implied_volatility || legData.pe?.iv || 0,
          delta: peGreeks.delta || legData.pe?.delta || 0,
          gamma: peGreeks.gamma || legData.pe?.gamma || 0,
          theta: peGreeks.theta || legData.pe?.theta || 0,
          vega: peGreeks.vega || legData.pe?.vega || 0,
          bidPrice: legData.pe?.top_bid_price || legData.pe?.best_bid_price || legData.pe?.bid_price || 0,
          askPrice: legData.pe?.top_ask_price || legData.pe?.best_ask_price || legData.pe?.ask_price || 0,
        },
      };
    })
    .sort((a, b) => a.strikePrice - b.strikePrice);

  return { chain, spotPrice, totalCEOI, totalPEOI };
}

// ── NSE Indices Response Parser ──

export function parseNSEIndices(raw: any): IndexData[] {
  const indices = ["NIFTY 50", "NIFTY BANK", "NIFTY FINANCIAL SERVICES", "NIFTY MIDCAP 50"];
  const symbolMap: Record<string, string> = {
    "NIFTY 50": "NIFTY",
    "NIFTY BANK": "BANKNIFTY",
    "NIFTY FINANCIAL SERVICES": "FINNIFTY",
    "NIFTY MIDCAP 50": "MIDCPNIFTY",
  };

  if (!raw?.data) return [];

  return raw.data
    .filter((d: any) => indices.includes(d.index))
    .map((d: any) => ({
      name: d.index,
      symbol: symbolMap[d.index] || d.index,
      ltp: d.last,
      change: d.variation || 0,
      changePercent: d.percentChange || 0,
      high: d.high || d.last,
      low: d.low || d.last,
      open: d.open || d.last,
      prevClose: d.previousClose || d.last,
    }));
}

// NSE option-chain parser (used as a fallback when broker is unavailable)
interface NSEOptionChainResponse {
  records: {
    expiryDates: string[];
    strikePrices: number[];
    data: Array<{ strikePrice: number; expiryDate: string; CE?: any; PE?: any }>;
  };
  filtered: { CE: { totOI: number; totVol: number }; PE: { totOI: number; totVol: number } };
}

export function parseNSEOptionChain(raw: NSEOptionChainResponse, selectedExpiry?: string) {
  if (!raw?.records?.expiryDates || !raw?.records?.data) {
    return { chain: [], spotPrice: 0, expiries: [], totalCEOI: 0, totalPEOI: 0 };
  }

  const expiries: ExpiryDate[] = raw.records.expiryDates.map((exp) => {
    const d = new Date(exp);
    const now = new Date();
    const days = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    return { label: exp, value: exp, daysToExpiry: days };
  });

  const expiryFilter = selectedExpiry || raw.records.expiryDates[0];
  const filteredData = raw.records.data.filter((d) => d.expiryDate === expiryFilter);

  let spotPrice = 0;
  const chain: OptionData[] = filteredData.map((item) => {
    if (item.CE?.underlyingValue) spotPrice = item.CE.underlyingValue;
    if (item.PE?.underlyingValue) spotPrice = item.PE.underlyingValue;
    const defaultLeg = { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
    return {
      strikePrice: item.strikePrice,
      ce: item.CE ? {
        ltp: item.CE.lastPrice, oi: item.CE.openInterest, oiChange: item.CE.changeinOpenInterest,
        volume: item.CE.totalTradedVolume, iv: item.CE.impliedVolatility,
        delta: 0, gamma: 0, theta: 0, vega: 0,
        bidPrice: item.CE.bidprice, askPrice: item.CE.askPrice,
      } : defaultLeg,
      pe: item.PE ? {
        ltp: item.PE.lastPrice, oi: item.PE.openInterest, oiChange: item.PE.changeinOpenInterest,
        volume: item.PE.totalTradedVolume, iv: item.PE.impliedVolatility,
        delta: 0, gamma: 0, theta: 0, vega: 0,
        bidPrice: item.PE.bidprice, askPrice: item.PE.askPrice,
      } : defaultLeg,
    };
  });

  return { chain, spotPrice, expiries, totalCEOI: raw.filtered?.CE?.totOI || 0, totalPEOI: raw.filtered?.PE?.totOI || 0 };
}

// ── Exported fetch functions ──

// Live option chain — broker-agnostic, with NSE fallback
export async function fetchLiveOptionChain(symbol: string, expiry?: string) {
  // Try active broker first (proxy returns already-normalized unified shape)
  try {
    const params: Record<string, string> = { symbol: symbol.toUpperCase() };
    if (expiry) params.expiry = expiry;
    const unified = (await fetchBrokerProxy("option-chain", params)) as UnifiedChainResponse;

    if (unified && Array.isArray(unified.chain) && unified.chain.length > 0) {
      // Also fetch expiry list (broker-side)
      let expiries: ExpiryDate[] = [];
      try {
        expiries = (await fetchBrokerProxy("expiry-list", { symbol: symbol.toUpperCase() })) as ExpiryDate[];
        if (!Array.isArray(expiries)) expiries = [];
      } catch {
        // ignore — expiry list is best-effort
      }
      return {
        chain: unified.chain,
        spotPrice: unified.spotPrice,
        totalCEOI: unified.totalCEOI,
        totalPEOI: unified.totalPEOI,
        expiries,
        source: unified.source as "dhan" | "kite" | string,
        afterHours: unified.afterHours,
        cachedAt: unified.cachedAt,
      };
    }
  } catch (e) {
    console.warn("Broker option chain fetch failed, trying NSE:", e);
  }

  // Fallback to NSE
  try {
    const raw = await fetchNSEProxy("option-chain", symbol);
    const parsed = parseNSEOptionChain(raw, expiry);
    return { ...parsed, source: "nse" as const, afterHours: false, cachedAt: null };
  } catch (e) {
    console.warn("NSE option chain also failed:", e);
    throw e;
  }
}

// Expiry list — broker-agnostic
export async function fetchExpiryList(symbol: string): Promise<ExpiryDate[]> {
  try {
    const result = await fetchBrokerProxy("expiry-list", { symbol: symbol.toUpperCase() });
    if (Array.isArray(result)) return result;
    return [];
  } catch (e) {
    console.warn("Broker expiry list fetch failed:", e);
    return [];
  }
}

// NSE Indices (no broker provides this view directly)
export async function fetchLiveIndices() {
  const raw = await fetchNSEProxy("indices");
  return parseNSEIndices(raw);
}

export async function fetchMarketStatus() {
  return fetchNSEProxy("market-status");
}

export async function fetchFnOStocks() {
  return fetchNSEProxy("equity-derivatives");
}

// ── All Indices (for VIX, sector performance) ──

const SECTOR_INDEX_MAP: Record<string, string> = {
  "NIFTY IT": "IT",
  "NIFTY BANK": "Banking",
  "NIFTY AUTO": "Auto",
  "NIFTY PHARMA": "Pharma",
  "NIFTY METAL": "Metal",
  "NIFTY ENERGY": "Energy",
  "NIFTY FMCG": "FMCG",
  "NIFTY REALTY": "Realty",
  "NIFTY MEDIA": "Media",
  "NIFTY PSU BANK": "PSU Bank",
  "NIFTY FIN SERVICE": "Fin Svc",
  "NIFTY INFRA": "Infra",
  "NIFTY HEALTHCARE INDEX": "Health",
  "NIFTY CONSUMER DURABLES": "Consumer",
};

export async function fetchAllIndices() {
  const raw = await fetchNSEProxy("indices");
  if (!raw?.data) return null;

  const vixEntry = raw.data.find((d: any) => d.index === "INDIA VIX");
  const vix = vixEntry ? {
    value: vixEntry.last,
    change: vixEntry.variation || 0,
    changePercent: vixEntry.percentChange || 0,
    high: vixEntry.high || vixEntry.last,
    low: vixEntry.low || vixEntry.last,
  } : null;

  const sectors = raw.data
    .filter((d: any) => SECTOR_INDEX_MAP[d.index])
    .map((d: any) => ({
      name: SECTOR_INDEX_MAP[d.index],
      fullName: d.index,
      change: d.percentChange || 0,
      ltp: d.last || 0,
      open: d.open || d.last,
      high: d.high || d.last,
      low: d.low || d.last,
    }));

  const nifty50 = raw.data.find((d: any) => d.index === "NIFTY 50");
  const advances = nifty50?.advances || 0;
  const declines = nifty50?.declines || 0;
  const unchanged = nifty50?.unchanged || 0;

  return { vix, sectors, advances, declines, unchanged };
}

// ── F&O Stocks List (Top Movers + Most Active) ──

export interface FnOStockData {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  totalTradedVolume?: number;
  openInterest?: number;
  oiChange?: number;
  sector?: string;
}

export async function fetchLiveFnOStocks(): Promise<FnOStockData[]> {
  try {
    const raw = await fetchNSEProxy("equity-derivatives");
    if (raw?.data?.length > 0) {
      return raw.data
        .filter((d: any) => d.symbol && d.symbol !== "NIFTY 50" && d.lastPrice)
        .map((d: any) => ({
          symbol: d.symbol,
          ltp: d.lastPrice || 0,
          change: d.change || 0,
          changePercent: d.pChange || 0,
          open: d.open || d.lastPrice,
          high: d.dayHigh || d.lastPrice,
          low: d.dayLow || d.lastPrice,
          previousClose: d.previousClose || d.lastPrice,
          volume: d.totalTradedVolume || 0,
          totalTradedVolume: d.totalTradedVolume || 0,
          openInterest: d.openInterest || 0,
          oiChange: d.changeinOpenInterest || 0,
          sector: d.meta?.industry || "",
        }));
    }
  } catch (e) {
    console.warn("NSE F&O stocks fetch failed, trying TradingView:", e);
  }

  try {
    const tvData = await fetchTradingViewStocks();
    if (tvData.length > 0) return tvData;
  } catch (e) {
    console.warn("TradingView stocks fetch also failed:", e);
  }

  return [];
}

// ── TradingView Scanner API ──

export async function fetchTradingViewStocks(): Promise<FnOStockData[]> {
  const url = `${PROXY_BASE}/api/tv-scan?type=stocks`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TV scan error: ${res.status}`);
  const data = await res.json();

  return (data.stocks || []).map((s: any) => ({
    symbol: s.symbol || "",
    ltp: s.ltp || 0,
    change: s.changeAbs || 0,
    changePercent: s.changePercent || 0,
    open: s.open || 0,
    high: s.high || 0,
    low: s.low || 0,
    previousClose: (s.ltp || 0) - (s.changeAbs || 0),
    volume: s.volume || 0,
    totalTradedVolume: s.volume || 0,
    openInterest: 0,
    oiChange: 0,
    sector: s.sector || "",
  }));
}

export async function fetchTradingViewIndices(): Promise<any[]> {
  const url = `${PROXY_BASE}/api/tv-scan?type=indices`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TV indices error: ${res.status}`);
  const data = await res.json();
  return data.stocks || [];
}

// ── FII/DII Activity Data ──

export interface FIIDIIData {
  category: string;
  date: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
}

export async function fetchFIIDII(): Promise<FIIDIIData[]> {
  const raw = await fetchNSEProxy("fii-dii");
  if (!raw?.data) return [];

  return raw.data.map((d: any) => ({
    category: d.category || "",
    date: d.date || "",
    buyValue: parseFloat(d.buyValue?.replace(/,/g, "")) || 0,
    sellValue: parseFloat(d.sellValue?.replace(/,/g, "")) || 0,
    netValue: parseFloat(d.netValue?.replace(/,/g, "")) || 0,
  }));
}

// ── Test Connection (broker-agnostic) ──

export async function testBrokerConnection(): Promise<{ status: string; message: string }> {
  const { headers } = buildBrokerHeaders();
  const res = await fetch(`${PROXY_BASE}/api/test-connection`, { headers });
  return res.json();
}

/** @deprecated Use testBrokerConnection — kept for backward compatibility. */
export const testDhanConnection = testBrokerConnection;

export async function fetchProxyHealth(): Promise<any> {
  const res = await fetch(`${PROXY_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

// ── Instrument Master Download ──

export async function fetchInstrumentMaster(): Promise<{ instruments: any[]; count: number }> {
  return fetchBrokerProxy("instruments");
}

// ── Historical Candle Data ──

export interface HistoricalCandleResponse {
  status: string;
  data: {
    timestamp: number[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
    oi?: number[];
  };
  remarks?: string;
}

export async function fetchHistoricalCandles(
  securityId: string,
  exchangeSegment: string = "IDX_I",
  instrument: string = "INDEX",
  interval: string = "5",
  fromDate?: string,
  toDate?: string,
): Promise<HistoricalCandleResponse> {
  const params: Record<string, string> = { securityId, exchangeSegment, instrument, interval };
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;
  return fetchBrokerProxy("historical", params);
}

// ── Yahoo Finance Chart Data (free, no auth) ──

export async function fetchYahooChart(
  symbol: string,
  interval: string = "D",
  fromDate?: string,
  toDate?: string,
): Promise<HistoricalCandleResponse> {
  const params = new URLSearchParams({ symbol, interval });
  if (fromDate) params.set("fromDate", fromDate);
  if (toDate) params.set("toDate", toDate);

  const url = `${PROXY_BASE}/api/yahoo-chart?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Yahoo chart error ${res.status}: ${errText}`);
  }
  return res.json();
}
