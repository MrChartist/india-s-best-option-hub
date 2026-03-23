import { supabase } from "@/integrations/supabase/client";
import type { OptionData, ExpiryDate, IndexData } from "./mockData";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

// Direct fetch to edge function (reliable for query params)
async function fetchDhanProxy(endpoint: string, params?: Record<string, string>): Promise<any> {
  const qp = new URLSearchParams({ endpoint, ...params });
  const url = `https://${PROJECT_ID}.supabase.co/functions/v1/dhan-proxy?${qp.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dhan proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

// Keep NSE proxy as fallback for indices & market status (Dhan doesn't provide broad index data the same way)
async function fetchNSEProxy(endpoint: string, symbol?: string): Promise<any> {
  const params = new URLSearchParams({ endpoint });
  if (symbol) params.set("symbol", symbol);
  const url = `https://${PROJECT_ID}.supabase.co/functions/v1/nse-proxy?${params.toString()}`;
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
