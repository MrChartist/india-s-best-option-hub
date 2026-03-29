import type { OptionData, ExpiryDate, IndexData } from "./mockData";
import { getActiveBroker } from "./brokerConfig";

// Local proxy base URL — override via VITE_PROXY_URL if deploying proxy elsewhere
const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

// Direct fetch to local proxy with optional user credentials
async function fetchDhanProxy(endpoint: string, params?: Record<string, string>): Promise<any> {
  const qp = new URLSearchParams({ endpoint, ...params });
  const url = `${PROXY_BASE}/api/dhan-proxy?${qp.toString()}`;

  // Inject user's Dhan credentials if available
  const headers: Record<string, string> = {};
  const activeBroker = getActiveBroker();
  if (activeBroker?.brokerId === "dhan" && activeBroker.values.clientId && activeBroker.values.accessToken) {
    headers["x-dhan-client-id"] = activeBroker.values.clientId;
    headers["x-dhan-access-token"] = activeBroker.values.accessToken;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dhan proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

// NSE proxy for indices & market status
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

// ── Parse Dhan Option Chain Response ──

interface DhanOptionChainData {
  data: {
    oc: Record<string, {
      ce?: DhanOptionLeg;
      pe?: DhanOptionLeg;
    }>;
    iv_oc?: Record<string, {
      ce_iv?: number;
      pe_iv?: number;
    }>;
    gk_oc?: Record<string, {
      ce_delta?: number; ce_gamma?: number; ce_theta?: number; ce_vega?: number;
      pe_delta?: number; pe_gamma?: number; pe_theta?: number; pe_vega?: number;
    }>;
    last_price?: number;
    oi_data?: Record<string, {
      ce_oi?: number; pe_oi?: number;
      ce_oi_chg?: number; pe_oi_chg?: number;
    }>;
  };
  status: string;
}

interface DhanOptionLeg {
  ltp?: number;
  close?: number;
  volume?: number;
  oi?: number;
  oi_chg?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  bid_price?: number;
  ask_price?: number;
  best_bid_price?: number;
  best_ask_price?: number;
}

export function parseDhanOptionChain(raw: DhanOptionChainData): {
  chain: OptionData[];
  spotPrice: number;
  totalCEOI: number;
  totalPEOI: number;
} {
  const oc = raw?.data?.oc || {};
  const ivOc = raw?.data?.iv_oc || {};
  const gkOc = raw?.data?.gk_oc || {};
  const spotPrice = raw?.data?.last_price || 0;

  let totalCEOI = 0;
  let totalPEOI = 0;

  const chain: OptionData[] = Object.keys(oc)
    .map(strikeStr => {
      const strike = parseFloat(strikeStr);
      const legData = oc[strikeStr];
      const ivData = ivOc[strikeStr] || {};
      const greekData = gkOc[strikeStr] || {};

      const ceOI = legData.ce?.oi || 0;
      const peOI = legData.pe?.oi || 0;
      totalCEOI += ceOI;
      totalPEOI += peOI;

      return {
        strikePrice: strike,
        ce: {
          ltp: legData.ce?.ltp || legData.ce?.close || 0,
          oi: ceOI,
          oiChange: legData.ce?.oi_chg || 0,
          volume: legData.ce?.volume || 0,
          iv: legData.ce?.iv || ivData.ce_iv || 0,
          delta: greekData.ce_delta || legData.ce?.delta || 0,
          gamma: greekData.ce_gamma || legData.ce?.gamma || 0,
          theta: greekData.ce_theta || legData.ce?.theta || 0,
          vega: greekData.ce_vega || legData.ce?.vega || 0,
          bidPrice: legData.ce?.best_bid_price || legData.ce?.bid_price || 0,
          askPrice: legData.ce?.best_ask_price || legData.ce?.ask_price || 0,
        },
        pe: {
          ltp: legData.pe?.ltp || legData.pe?.close || 0,
          oi: peOI,
          oiChange: legData.pe?.oi_chg || 0,
          volume: legData.pe?.volume || 0,
          iv: legData.pe?.iv || ivData.pe_iv || 0,
          delta: greekData.pe_delta || legData.pe?.delta || 0,
          gamma: greekData.pe_gamma || legData.pe?.gamma || 0,
          theta: greekData.pe_theta || legData.pe?.theta || 0,
          vega: greekData.pe_vega || legData.pe?.vega || 0,
          bidPrice: legData.pe?.best_bid_price || legData.pe?.bid_price || 0,
          askPrice: legData.pe?.best_ask_price || legData.pe?.ask_price || 0,
        },
      };
    })
    .sort((a, b) => a.strikePrice - b.strikePrice);

  return { chain, spotPrice, totalCEOI, totalPEOI };
}

// ── Parse NSE Indices Response (kept for Dashboard) ──

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

// NSE parse for backward compat
interface NSEOptionChainResponse {
  records: {
    expiryDates: string[];
    strikePrices: number[];
    data: Array<{
      strikePrice: number;
      expiryDate: string;
      CE?: any;
      PE?: any;
    }>;
  };
  filtered: {
    CE: { totOI: number; totVol: number };
    PE: { totOI: number; totVol: number };
  };
}

export function parseNSEOptionChain(raw: NSEOptionChainResponse, selectedExpiry?: string) {
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

// Dhan Option Chain (primary) with NSE fallback
export async function fetchLiveOptionChain(symbol: string, expiry?: string) {
  // Try Dhan first
  try {
    const params: Record<string, string> = { symbol: symbol.toUpperCase() };
    if (expiry) params.expiry = expiry;
    const raw = await fetchDhanProxy("option-chain", params);
    if (raw?.status === "success" && raw?.data?.oc) {
      const parsed = parseDhanOptionChain(raw);
      // Also fetch expiry list
      let expiries: ExpiryDate[] = [];
      try {
        const expiryRaw = await fetchDhanProxy("expiry-list", { symbol: symbol.toUpperCase() });
        if (expiryRaw?.data) {
          expiries = expiryRaw.data.map((dateStr: string) => {
            const d = new Date(dateStr);
            const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
            return {
              label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
              value: dateStr,
              daysToExpiry: days,
            };
          });
        }
      } catch {
        // Expiry fetch failed, continue with chain data
      }
      return { ...parsed, expiries, source: "dhan" as const };
    }
  } catch (e) {
    console.warn("Dhan option chain fetch failed, trying NSE:", e);
  }

  // Fallback to NSE
  try {
    const raw = await fetchNSEProxy("option-chain", symbol);
    const parsed = parseNSEOptionChain(raw, expiry);
    return { ...parsed, source: "nse" as const };
  } catch (e) {
    console.warn("NSE option chain also failed:", e);
    throw e;
  }
}

// Dhan expiry list
export async function fetchExpiryList(symbol: string): Promise<ExpiryDate[]> {
  try {
    const raw = await fetchDhanProxy("expiry-list", { symbol: symbol.toUpperCase() });
    if (raw?.data) {
      return raw.data.map((dateStr: string) => {
        const d = new Date(dateStr);
        const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
        return {
          label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
          value: dateStr,
          daysToExpiry: days,
        };
      });
    }
  } catch (e) {
    console.warn("Dhan expiry list fetch failed:", e);
  }
  return [];
}

// NSE Indices (Dhan doesn't provide broad index overview the same way)
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

  // Extract VIX
  const vixEntry = raw.data.find((d: any) => d.index === "INDIA VIX");
  const vix = vixEntry ? {
    value: vixEntry.last,
    change: vixEntry.variation || 0,
    changePercent: vixEntry.percentChange || 0,
    high: vixEntry.high || vixEntry.last,
    low: vixEntry.low || vixEntry.last,
  } : null;

  // Extract sector indices
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

  // Advance/Decline from NIFTY 50
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
  // OI fields from NSE equity-derivatives endpoint
  totalTradedVolume?: number;
  openInterest?: number;
  oiChange?: number;
  sector?: string;
}

export async function fetchLiveFnOStocks(): Promise<FnOStockData[]> {
  // Try NSE first (has OI data)
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

  // Fallback to TradingView Scanner (no OI but great LTP/volume data)
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
  category: string; // "FII/FPI" or "DII"
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

// ── Test Connection ──

export async function testDhanConnection(): Promise<{ status: string; message: string }> {
  const headers: Record<string, string> = {};
  const activeBroker = getActiveBroker();
  if (activeBroker?.brokerId === "dhan" && activeBroker.values.clientId && activeBroker.values.accessToken) {
    headers["x-dhan-client-id"] = activeBroker.values.clientId;
    headers["x-dhan-access-token"] = activeBroker.values.accessToken;
  }
  const res = await fetch(`${PROXY_BASE}/api/test-connection`, { headers });
  return res.json();
}

export async function fetchProxyHealth(): Promise<any> {
  const res = await fetch(`${PROXY_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

// ── Instrument Master Download ──

export async function fetchInstrumentMaster(): Promise<{
  instruments: any[];
  count: number;
}> {
  const result = await fetchDhanProxy("instruments");
  return result;
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
  const params: Record<string, string> = {
    securityId,
    exchangeSegment,
    instrument,
    interval,
  };
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;

  return fetchDhanProxy("historical", params);
}
