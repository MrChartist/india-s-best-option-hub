import { useQuery } from "@tanstack/react-query";

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

export interface OHLCVCandle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ── Security ID lookup: indices + top F&O stocks ──
// Hardcoded to avoid downloading the 30MB instrument master CSV for every sparkline.
// Dhan security IDs for NSE equity stocks (from api-scrip-master.csv).
const SECURITY_MAP: Record<string, { secId: string; exchSeg: string; instrument: string }> = {
  // ─── Indices ───
  NIFTY:       { secId: "13",    exchSeg: "IDX_I",  instrument: "INDEX" },
  BANKNIFTY:   { secId: "25",    exchSeg: "IDX_I",  instrument: "INDEX" },
  FINNIFTY:    { secId: "27",    exchSeg: "IDX_I",  instrument: "INDEX" },
  MIDCPNIFTY:  { secId: "442",   exchSeg: "IDX_I",  instrument: "INDEX" },
  INDIAVIX:    { secId: "26",    exchSeg: "IDX_I",  instrument: "INDEX" },
  SENSEX:      { secId: "1",     exchSeg: "IDX_I",  instrument: "INDEX" },
  // ─── NIFTY 50 Stocks ───
  RELIANCE:    { secId: "2885",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TCS:         { secId: "11536", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  HDFCBANK:    { secId: "1333",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  INFY:        { secId: "1594",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  ICICIBANK:   { secId: "4963",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  HINDUNILVR:  { secId: "1394",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  ITC:         { secId: "1660",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  SBIN:        { secId: "3045",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  BHARTIARTL:  { secId: "10604", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  KOTAKBANK:   { secId: "1922",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  LT:          { secId: "11483", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  AXISBANK:    { secId: "5900",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  ASIANPAINT:  { secId: "236",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  MARUTI:      { secId: "10999", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TITAN:       { secId: "3506",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  SUNPHARMA:   { secId: "3351",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  BAJFINANCE:  { secId: "317",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  BAJFINSV:    { secId: "16669", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  WIPRO:       { secId: "3787",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  HCLTECH:     { secId: "7229",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TATAMOTORS:  { secId: "3456",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TATASTEEL:   { secId: "3499",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  NTPC:        { secId: "11630", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  POWERGRID:   { secId: "14977", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  ONGC:        { secId: "2475",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  JSWSTEEL:    { secId: "11723", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  M_M:         { secId: "2031",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  ADANIENT:    { secId: "25",    exchSeg: "NSE_EQ", instrument: "EQUITY" },
  ADANIPORTS:  { secId: "15083", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  ULTRACEMCO:  { secId: "11532", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TECHM:       { secId: "13538", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  INDUSINDBK:  { secId: "5258",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  DRREDDY:     { secId: "881",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  CIPLA:       { secId: "694",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  EICHERMOT:   { secId: "910",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  DIVISLAB:    { secId: "10940", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  BPCL:        { secId: "526",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  COALINDIA:   { secId: "20374", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  GRASIM:      { secId: "1232",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  APOLLOHOSP:  { secId: "157",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  HEROMOTOCO:  { secId: "1348",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TATACONSUM:  { secId: "3432",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  SBILIFE:     { secId: "21808", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  BRITANNIA:   { secId: "547",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  NESTLEIND:   { secId: "17963", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  BAJAJ_AUTO:  { secId: "16669", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  HDFCLIFE:    { secId: "467",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  VEDL:        { secId: "3063",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  HINDALCO:    { secId: "1363",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  BANKBARODA:  { secId: "4668",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  PNB:         { secId: "10666", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  DLF:         { secId: "14732", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TRENT:       { secId: "1964",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
};

// Alias: M&M uses underscore in our map
if (!SECURITY_MAP["M&M"]) SECURITY_MAP["M&M"] = SECURITY_MAP["M_M"];

// ── In-memory cache for dynamically resolved security IDs ──
const resolvedSecurityIds: Record<string, { securityId: string; exchangeSegment: string; instrument: string }> = {};

/**
 * Resolve a stock symbol to its Dhan securityId.
 * Priority: hardcoded map → in-memory cache → instrument master download (fallback)
 */
async function resolveSecurityId(symbol: string): Promise<{ securityId: string; exchangeSegment: string; instrument: string } | null> {
  // Check hardcoded map first (instant — no network call)
  const mapped = SECURITY_MAP[symbol];
  if (mapped) return { securityId: mapped.secId, exchangeSegment: mapped.exchSeg, instrument: mapped.instrument };

  // Check runtime cache
  if (resolvedSecurityIds[symbol]) return resolvedSecurityIds[symbol];

  // Fallback: download instrument master (only for stocks not in hardcoded map)
  try {
    const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?endpoint=instruments`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const instruments = data?.instruments || [];

    const match = instruments.find(
      (i: any) => i.symbol === symbol && i.exchangeSegment === "NSE_EQ" && i.instrumentType === "EQUITY"
    );
    if (match) {
      const resolved = { securityId: match.securityId, exchangeSegment: "NSE_EQ", instrument: "EQUITY" };
      resolvedSecurityIds[symbol] = resolved;
      return resolved;
    }
  } catch {
    // Instrument master download failed — symbol not chartable
  }
  return null;
}

// ── Map a UI time range to candle interval + lookback days ──
function rangeToParams(range: string): { interval: string; daysBack: number } {
  switch (range) {
    case "1W": return { interval: "15", daysBack: 10 };
    case "1M": return { interval: "60", daysBack: 31 };
    case "3M": return { interval: "D", daysBack: 92 };
    case "6M": return { interval: "D", daysBack: 183 };
    case "1Y": return { interval: "D", daysBack: 365 };
    default:   return { interval: "D", daysBack: 92 };
  }
}

interface ColumnarCandleData {
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  volume?: number[];
  timestamp?: (number | string)[];
  start_Time?: (number | string)[];
}

/**
 * Parses the proxy's column-array candle response (shared by Dhan + Yahoo,
 * which both return { open[], high[], low[], close[], volume[], timestamp[] }).
 * Exported for unit testing.
 */
export function parseColumnarCandles(rawData: ColumnarCandleData | null | undefined): OHLCVCandle[] {
  if (!rawData || !Array.isArray(rawData.close)) return [];

  const opens = rawData.open || [];
  const highs = rawData.high || [];
  const lows = rawData.low || [];
  const closes = rawData.close || [];
  const volumes = rawData.volume || [];
  const timestamps = rawData.start_Time || rawData.timestamp || [];

  const candles: OHLCVCandle[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] == null) continue; // Yahoo emits null gaps on non-trading slots
    const ts = timestamps[i];
    const time = typeof ts === "string"
      ? Math.floor(new Date(ts).getTime() / 1000)
      : typeof ts === "number"
        ? (ts > 1e12 ? Math.floor(ts / 1000) : ts) // handle ms vs s timestamps
        : Math.floor(Date.now() / 1000);
    candles.push({
      time,
      open: opens[i] ?? closes[i],
      high: highs[i] ?? closes[i],
      low: lows[i] ?? closes[i],
      close: closes[i],
      volume: volumes[i] || 0,
    });
  }
  return candles.sort((a, b) => a.time - b.time);
}

/** Primary source: Dhan historical candles (includes OI, needs broker keys). */
async function fetchDhanHistorical(
  resolved: { securityId: string; exchangeSegment: string; instrument: string },
  range: string,
): Promise<OHLCVCandle[]> {
  const { interval, daysBack } = rangeToParams(range);
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - daysBack);

  const params = new URLSearchParams({
    endpoint: "historical",
    securityId: resolved.securityId,
    exchangeSegment: resolved.exchangeSegment,
    instrument: resolved.instrument,
    interval,
    fromDate: `${from.toISOString().split("T")[0]} 09:15`,
    toDate: `${now.toISOString().split("T")[0]} 15:30`,
  });

  const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return parseColumnarCandles(json?.data || json);
}

/**
 * Universal fallback: Yahoo Finance candles via the proxy. Free, no auth,
 * covers all indices + any NSE equity (.NS). This is what keeps charts alive
 * for users who haven't configured Dhan broker keys.
 */
async function fetchYahooHistorical(symbol: string, range: string): Promise<OHLCVCandle[]> {
  const { interval, daysBack } = rangeToParams(range);
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - daysBack);

  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
    fromDate: from.toISOString().split("T")[0],
    toDate: now.toISOString().split("T")[0],
  });

  const res = await fetch(`${PROXY_BASE}/api/yahoo-chart?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return parseColumnarCandles(json?.data || json);
}

/**
 * Fetches OHLCV candle data with graceful degradation:
 *   Dhan (when symbol is known + broker keys configured) → Yahoo Finance fallback.
 * Always returns candles when the proxy is reachable, even without broker keys.
 */
async function fetchHistorical(symbol: string, range: string): Promise<OHLCVCandle[]> {
  // Try Dhan first for symbols we can resolve instantly (no 30MB CSV download).
  const mapped = SECURITY_MAP[symbol];
  if (mapped) {
    try {
      const candles = await fetchDhanHistorical(
        { securityId: mapped.secId, exchangeSegment: mapped.exchSeg, instrument: mapped.instrument },
        range,
      );
      if (candles.length > 0) return candles;
    } catch {
      // Dhan unavailable (no keys / rate limit) — fall through to Yahoo.
    }
  }

  // Universal fallback — works for everyone, no broker keys required.
  try {
    const yahoo = await fetchYahooHistorical(symbol, range);
    if (yahoo.length > 0) return yahoo;
  } catch {
    // Yahoo unreachable too.
  }

  // Last resort for non-mapped stocks: resolve via instrument master, then Dhan.
  if (!mapped) {
    try {
      const resolved = await resolveSecurityId(symbol);
      if (resolved) return await fetchDhanHistorical(resolved, range);
    } catch {
      // give up — return empty
    }
  }

  return [];
}

/**
 * React Query hook for chart data. Fetches OHLCV candles from Dhan API.
 */
export function useChartData(symbol: string, range: string = "3M", enabled: boolean = true) {
  return useQuery({
    queryKey: ["chart-data", symbol, range],
    queryFn: () => fetchHistorical(symbol, range),
    enabled: !!symbol && enabled,
    staleTime: 5 * 60 * 1000, // 5 min cache
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Fetches a quick sparkline (close prices only) for mini charts.
 */
export function useSparklineData(symbol: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ["sparkline", symbol],
    queryFn: async (): Promise<number[]> => {
      const candles = await fetchHistorical(symbol, "3M");
      if (candles.length > 0) {
        return candles.map(c => c.close);
      }
      return [];
    },
    enabled: !!symbol && enabled,
    staleTime: 10 * 60 * 1000, // 10 min cache
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
