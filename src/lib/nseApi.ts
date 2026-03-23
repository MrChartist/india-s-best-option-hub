import { supabase } from "@/integrations/supabase/client";
import type { IndexData, OptionData, ExpiryDate } from "./mockData";

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

async function callNSEProxy(endpoint: string, symbol?: string): Promise<any> {
  const params = new URLSearchParams({ endpoint });
  if (symbol) params.set("symbol", symbol);

  // Use supabase.functions.invoke for proper auth headers
  const { data, error } = await supabase.functions.invoke("nse-proxy", {
    body: null,
    headers: { "Content-Type": "application/json" },
  });

  // Fallback: direct fetch if invoke doesn't support query params well
  if (error) {
    const url = `https://${PROJECT_ID}.supabase.co/functions/v1/nse-proxy?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`NSE proxy error: ${res.status}`);
    return res.json();
  }

  return data;
}

// Direct fetch approach (more reliable for query params)
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

// ── Parse NSE Option Chain Response ──

interface NSEOptionChainResponse {
  records: {
    expiryDates: string[];
    strikePrices: number[];
    data: Array<{
      strikePrice: number;
      expiryDate: string;
      CE?: NSEOptionLeg;
      PE?: NSEOptionLeg;
    }>;
    timestamp: string;
  };
  filtered: {
    data: Array<{
      strikePrice: number;
      expiryDate: string;
      CE?: NSEOptionLeg;
      PE?: NSEOptionLeg;
    }>;
    CE: { totOI: number; totVol: number };
    PE: { totOI: number; totVol: number };
  };
}

interface NSEOptionLeg {
  strikePrice: number;
  expiryDate: string;
  underlying: string;
  identifier: string;
  openInterest: number;
  changeinOpenInterest: number;
  pchangeinOpenInterest: number;
  totalTradedVolume: number;
  impliedVolatility: number;
  lastPrice: number;
  change: number;
  pChange: number;
  totalBuyQuantity: number;
  totalSellQuantity: number;
  bidQty: number;
  bidprice: number;
  askQty: number;
  askPrice: number;
  underlyingValue: number;
}

export function parseNSEOptionChain(raw: NSEOptionChainResponse, selectedExpiry?: string): {
  chain: OptionData[];
  spotPrice: number;
  expiries: ExpiryDate[];
  totalCEOI: number;
  totalPEOI: number;
} {
  const expiries: ExpiryDate[] = raw.records.expiryDates.map((exp) => {
    const d = new Date(exp);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    return {
      label: exp,
      value: exp,
      daysToExpiry: days,
    };
  });

  const expiryFilter = selectedExpiry || raw.records.expiryDates[0];

  const filteredData = raw.records.data.filter((d) => d.expiryDate === expiryFilter);

  let spotPrice = 0;
  const chain: OptionData[] = filteredData.map((item) => {
    if (item.CE?.underlyingValue) spotPrice = item.CE.underlyingValue;
    if (item.PE?.underlyingValue) spotPrice = item.PE.underlyingValue;

    const defaultLeg = {
      ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0,
      delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0,
    };

    return {
      strikePrice: item.strikePrice,
      ce: item.CE
        ? {
            ltp: item.CE.lastPrice,
            oi: item.CE.openInterest,
            oiChange: item.CE.changeinOpenInterest,
            volume: item.CE.totalTradedVolume,
            iv: item.CE.impliedVolatility,
            delta: 0, gamma: 0, theta: 0, vega: 0,
            bidPrice: item.CE.bidprice,
            askPrice: item.CE.askPrice,
          }
        : defaultLeg,
      pe: item.PE
        ? {
            ltp: item.PE.lastPrice,
            oi: item.PE.openInterest,
            oiChange: item.PE.changeinOpenInterest,
            volume: item.PE.totalTradedVolume,
            iv: item.PE.impliedVolatility,
            delta: 0, gamma: 0, theta: 0, vega: 0,
            bidPrice: item.PE.bidprice,
            askPrice: item.PE.askPrice,
          }
        : defaultLeg,
    };
  });

  return {
    chain,
    spotPrice,
    expiries,
    totalCEOI: raw.filtered?.CE?.totOI || 0,
    totalPEOI: raw.filtered?.PE?.totOI || 0,
  };
}

// ── Parse NSE Indices Response ──

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
      change: d.change || 0,
      changePercent: d.percentChange || 0,
      high: d.high || d.last,
      low: d.low || d.last,
      open: d.open || d.last,
      prevClose: d.previousClose || d.last,
    }));
}

// ── Exported fetch functions ──

export async function fetchLiveOptionChain(symbol: string, expiry?: string) {
  const raw = await fetchNSEProxy("option-chain", symbol);
  return parseNSEOptionChain(raw, expiry);
}

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
