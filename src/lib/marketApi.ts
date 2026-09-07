import type { OptionData, ExpiryDate, IndexData } from "./mockData";
import { getActiveBroker } from "./brokerConfig";
import type { FuturesQuoteRow, RolloverRow } from "./futuresUtils";

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

// UTF-8 safe base64 encode for credential headers (plain btoa breaks on non-Latin1 chars)
function encodeCredsHeader(values: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(values));
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

// Generic multi-broker proxy — dispatches to whichever broker module the user has connected.
// Sends that broker's saved credentials only when it's the currently active broker.
async function fetchBrokerProxy(brokerId: string, endpoint: string, params?: Record<string, string>): Promise<any> {
  const qp = new URLSearchParams({ broker: brokerId, endpoint, ...params });
  const url = `${PROXY_BASE}/api/broker-proxy?${qp.toString()}`;

  const headers: Record<string, string> = {};
  const activeBroker = getActiveBroker();
  if (activeBroker?.brokerId === brokerId) {
    headers["x-broker-credentials"] = encodeCredsHeader(activeBroker.values);
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Broker proxy error ${res.status}: ${errText}`);
  }
  return res.json();
}

/** Test a broker connection with arbitrary (possibly unsaved) credential values — used by Broker Settings. */
export async function testBrokerConnection(brokerId: string, values: Record<string, string>): Promise<{ status: string; message: string }> {
  const qp = new URLSearchParams({ broker: brokerId });
  const headers: Record<string, string> = { "x-broker-credentials": encodeCredsHeader(values) };
  const res = await fetch(`${PROXY_BASE}/api/broker-test-connection?${qp.toString()}`, { headers });
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
  security_id?: number | string;
  ltp?: number;
  last_price?: number;
  close?: number;
  volume?: number;
  oi?: number;
  oi_chg?: number;
  previous_oi?: number;
  iv?: number;
  implied_volatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  bid_price?: number;
  ask_price?: number;
  best_bid_price?: number;
  best_ask_price?: number;
  top_bid_price?: number;
  top_ask_price?: number;
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
  };
}

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
    .map(strikeStr => {
      const strike = parseFloat(strikeStr);
      const legData = oc[strikeStr];

      const ceOI = legData.ce?.oi || 0;
      const peOI = legData.pe?.oi || 0;
      totalCEOI += ceOI;
      totalPEOI += peOI;

      // Support both Dhan API v1 (flat fields) and v2 (nested greeks object)
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
          securityId: legData.ce?.security_id !== undefined ? String(legData.ce.security_id) : undefined,
          exchangeSegment: legData.ce?.security_id !== undefined ? "NSE_FNO" : undefined,
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
          securityId: legData.pe?.security_id !== undefined ? String(legData.pe.security_id) : undefined,
          exchangeSegment: legData.pe?.security_id !== undefined ? "NSE_FNO" : undefined,
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
  // Guard against malformed/empty response
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

// Dhan Option Chain (primary) with NSE fallback
function toExpiryDates(dateStrs: string[]): ExpiryDate[] {
  return dateStrs.map((dateStr) => {
    const d = new Date(dateStr);
    const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    return {
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      value: dateStr,
      daysToExpiry: days,
    };
  });
}

export async function fetchLiveOptionChain(symbol: string, expiry?: string) {
  // If the user has an active non-Dhan broker connected, route through it instead —
  // that's the whole point of connecting your own broker.
  const activeBroker = getActiveBroker();
  const brokerId = activeBroker && activeBroker.brokerId !== "dhan" ? activeBroker.brokerId : "dhan";

  try {
    const params: Record<string, string> = { symbol: symbol.toUpperCase() };
    if (expiry) params.expiry = expiry;
    const raw = brokerId === "dhan"
      ? await fetchDhanProxy("option-chain", params)
      : await fetchBrokerProxy(brokerId, "option-chain", params);

    if (raw?.status === "success" && raw?.data?.oc) {
      const parsed = parseDhanOptionChain(raw); // every broker module normalizes to this same shape
      let expiries: ExpiryDate[] = [];
      try {
        const expiryRaw = brokerId === "dhan"
          ? await fetchDhanProxy("expiry-list", { symbol: symbol.toUpperCase() })
          : await fetchBrokerProxy(brokerId, "expiry-list", { symbol: symbol.toUpperCase() });
        if (expiryRaw?.data) expiries = toExpiryDates(expiryRaw.data);
      } catch {
        // Expiry fetch failed, continue with chain data
      }
      return {
        ...parsed, expiries, source: brokerId,
        afterHours: raw.afterHours || false,
        cachedAt: raw.cachedAt || null,
      };
    }
  } catch (e) {
    console.warn(`${brokerId} option chain fetch failed, trying NSE:`, e);
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

// Expiry list from whichever broker is active (Dhan by default)
export async function fetchExpiryList(symbol: string): Promise<ExpiryDate[]> {
  const activeBroker = getActiveBroker();
  const brokerId = activeBroker && activeBroker.brokerId !== "dhan" ? activeBroker.brokerId : "dhan";
  try {
    const raw = brokerId === "dhan"
      ? await fetchDhanProxy("expiry-list", { symbol: symbol.toUpperCase() })
      : await fetchBrokerProxy(brokerId, "expiry-list", { symbol: symbol.toUpperCase() });
    if (raw?.data) return toExpiryDates(raw.data);
  } catch (e) {
    console.warn(`${brokerId} expiry list fetch failed:`, e);
  }
  return [];
}

// MCX commodity expiry (CRUDEOIL, GOLD, SILVER, NATURALGAS, ...) — always via
// Dhan regardless of the user's active broker. No other connected broker module
// resolves commodity contracts, and Dhan's side of this reads a public
// instrument file rather than an authenticated endpoint (same "always Dhan"
// precedent as fetchFuturesQuotes for dashboard-wide data).
export async function fetchCommodityExpiryList(symbol: string): Promise<ExpiryDate[]> {
  try {
    const raw = await fetchDhanProxy("expiry-list", { symbol: symbol.toUpperCase() });
    if (raw?.data) return toExpiryDates(raw.data);
  } catch (e) {
    console.warn(`Commodity expiry list fetch failed for ${symbol}:`, e);
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
    console.warn("NSE F&O stocks fetch failed:", e);
  }

  return [];
}

// ── Stock/Index Futures (Scanner) ──
// Always Dhan+NSE regardless of the active broker — see proxy-server.mjs's
// futures-quotes case for why this is a deliberate exception to the
// active-broker routing used elsewhere in this file.

export async function fetchFuturesQuotes(symbols: string[]): Promise<FuturesQuoteRow[]> {
  if (symbols.length === 0) return [];
  // proxy-server.mjs's /api/dhan-proxy route sends its internal { data } field's
  // value directly as the HTTP body — for this endpoint that value is already the
  // array itself, not a { data: [...] } envelope. `raw?.data` here was always
  // undefined (arrays have no .data), so this silently returned [] every time.
  const raw = await fetchDhanProxy("futures-quotes", { symbols: symbols.join(",") });
  return Array.isArray(raw) ? raw : [];
}

export async function fetchRolloverData(symbols: string[]): Promise<RolloverRow[]> {
  if (symbols.length === 0) return [];
  const raw = await fetchDhanProxy("rollover", { symbols: symbols.join(",") });
  return Array.isArray(raw) ? raw : [];
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

// ── Global Market Cues ──

export interface GlobalCue {
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  marketTime: number | null;
}

export type GlobalCuesData = Partial<Record<"DOW" | "NASDAQ" | "SPX500" | "NIKKEI" | "HANGSENG" | "CRUDE_WTI" | "DXY", GlobalCue>>;

export async function fetchGlobalCues(): Promise<GlobalCuesData> {
  const res = await fetch(`${PROXY_BASE}/api/global-cues`);
  if (!res.ok) throw new Error(`Global cues fetch failed: ${res.status}`);
  return res.json();
}

// ── Order Placement (Dhan only — real money) — split out to dhanOrderApi.ts,
// which crossed 300 lines once this section landed alongside the
// futures/FII-DII/global-cues additions above. Re-exported so every existing
// `import { placeOrder, fetchOrders, cancelOrder } from "@/lib/marketApi"`
// (and the PlaceOrderParams/DhanOrderResult types) keeps working unchanged. ──
export { placeOrder, fetchOrders, cancelOrder } from "./dhanOrderApi";
export type { PlaceOrderParams, DhanOrderResult } from "./dhanOrderApi";

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
