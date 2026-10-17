import { useQuery } from "@tanstack/react-query";
import { proxyFetchJSON, shouldTryProxy } from "@/lib/api/proxyClient";
import { istDateString } from "@/lib/options";
import type { ColumnarCandlesDTO, InstrumentMasterDTO } from "@/lib/types/market";

export interface OHLCVCandle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SecurityRef {
  secId: string;
  exchSeg: "IDX_I" | "NSE_EQ";
  instrument: "INDEX" | "EQUITY";
}

/**
 * Dhan security ids for indices and the larger F&O stocks (NSE cash segment), keyed by the NSE
 * trading symbol. Taken from the Dhan scrip master; re-verify after corporate actions or renames.
 * Anything missing is resolved at runtime from the instrument master.
 */
export const SECURITY_MAP: Record<string, SecurityRef> = {
  // ─── Indices (IDX_I) ───
  NIFTY:       { secId: "13",    exchSeg: "IDX_I",  instrument: "INDEX" },
  BANKNIFTY:   { secId: "25",    exchSeg: "IDX_I",  instrument: "INDEX" },
  FINNIFTY:    { secId: "27",    exchSeg: "IDX_I",  instrument: "INDEX" },
  MIDCPNIFTY:  { secId: "442",   exchSeg: "IDX_I",  instrument: "INDEX" },
  INDIAVIX:    { secId: "21",    exchSeg: "IDX_I",  instrument: "INDEX" },
  SENSEX:      { secId: "51",    exchSeg: "IDX_I",  instrument: "INDEX" },
  BANKEX:      { secId: "69",    exchSeg: "IDX_I",  instrument: "INDEX" },
  // ─── Stocks (NSE_EQ) ───
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
  BAJAJFINSV:  { secId: "16675", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  "BAJAJ-AUTO": { secId: "16669", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  WIPRO:       { secId: "3787",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  HCLTECH:     { secId: "7229",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TATAMOTORS:  { secId: "3456",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TATASTEEL:   { secId: "3499",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  NTPC:        { secId: "11630", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  POWERGRID:   { secId: "14977", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  ONGC:        { secId: "2475",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  JSWSTEEL:    { secId: "11723", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  "M&M":       { secId: "2031",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
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
  HDFCLIFE:    { secId: "467",   exchSeg: "NSE_EQ", instrument: "EQUITY" },
  VEDL:        { secId: "3063",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  HINDALCO:    { secId: "1363",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  BANKBARODA:  { secId: "4668",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
  PNB:         { secId: "10666", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  DLF:         { secId: "14732", exchSeg: "NSE_EQ", instrument: "EQUITY" },
  TRENT:       { secId: "1964",  exchSeg: "NSE_EQ", instrument: "EQUITY" },
};

/** Older keys that referred to the same instruments. */
const SYMBOL_ALIASES: Record<string, string> = { M_M: "M&M", BAJFINSV: "BAJAJFINSV", BAJAJ_AUTO: "BAJAJ-AUTO", "BAJAJ AUTO": "BAJAJ-AUTO" };

/** Look up a symbol in SECURITY_MAP (case-insensitive, with aliases). */
export function lookupSecurity(symbol: string): SecurityRef | undefined {
  const s = String(symbol || "").trim().toUpperCase();
  return SECURITY_MAP[s] ?? SECURITY_MAP[SYMBOL_ALIASES[s] ?? ""];
}

/** Symbols whose security id appears more than once within the same segment (should be empty). */
export function findDuplicateSecurityIds(map: Record<string, SecurityRef> = SECURITY_MAP): string[] {
  const seen = new Map<string, string>();
  const dups: string[] = [];
  for (const [sym, ref] of Object.entries(map)) {
    const k = `${ref.exchSeg}:${ref.secId}`;
    const prev = seen.get(k);
    if (prev) dups.push(`${prev}/${sym}`);
    else seen.set(k, sym);
  }
  return dups;
}

// ── In-memory cache for dynamically resolved security IDs ──
const resolvedSecurityIds: Record<string, { securityId: string; exchangeSegment: string; instrument: string }> = {};

/**
 * Resolve a stock symbol to its Dhan securityId.
 * Priority: hardcoded map → in-memory cache → instrument master download (fallback)
 */
async function resolveSecurityId(symbol: string): Promise<{ securityId: string; exchangeSegment: string; instrument: string } | null> {
  // Check hardcoded map first (instant — no network call)
  const mapped = lookupSecurity(symbol);
  if (mapped) return { securityId: mapped.secId, exchangeSegment: mapped.exchSeg, instrument: mapped.instrument };

  // Check runtime cache
  if (resolvedSecurityIds[symbol]) return resolvedSecurityIds[symbol];

  // Fallback: download instrument master (only for stocks not in hardcoded map)
  try {
    const data = await proxyFetchJSON<InstrumentMasterDTO>("/api/dhan-proxy", { endpoint: "instruments" }, { timeoutMs: 60000, withDhan: false });
    const instruments = Array.isArray(data?.instruments) ? data.instruments : [];
    const match = instruments.find(
      (i) => i.symbol === symbol && i.exchangeSegment === "NSE_EQ" && i.instrumentType === "EQUITY",
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

type ColumnarCandleData = ColumnarCandlesDTO;

/** IST calendar date (yyyy-mm-dd) `daysBack` days before `now`. */
export function istDaysAgo(daysBack: number, now: Date = new Date()): string {
  return istDateString(new Date(now.getTime() - daysBack * 86_400_000));
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
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue; // Yahoo emits null gaps on non-trading slots
    const ts = timestamps[i];
    const time = typeof ts === "string"
      ? Math.floor(new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : `${ts.replace(" ", "T")}+05:30`).getTime() / 1000)
      : typeof ts === "number"
        ? (ts > 1e12 ? Math.floor(ts / 1000) : ts) // handle ms vs s timestamps
        : Math.floor(Date.now() / 1000);
    if (!Number.isFinite(time)) continue;
    candles.push({
      time,
      open: opens[i] ?? close,
      high: highs[i] ?? close,
      low: lows[i] ?? close,
      close,
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
  const json = await proxyFetchJSON<{ data?: ColumnarCandlesDTO } & ColumnarCandlesDTO>("/api/dhan-proxy", {
    endpoint: "historical",
    securityId: resolved.securityId,
    exchangeSegment: resolved.exchangeSegment,
    instrument: resolved.instrument,
    interval,
    fromDate: `${istDaysAgo(daysBack)} 09:15`,
    toDate: `${istDaysAgo(0)} 15:30`,
  });
  return parseColumnarCandles(json?.data || json);
}

/**
 * Universal fallback: Yahoo Finance candles via the proxy. Free, no auth,
 * covers all indices + any NSE equity (.NS). This is what keeps charts alive
 * for users who haven't configured Dhan broker keys.
 */
async function fetchYahooHistorical(symbol: string, range: string): Promise<OHLCVCandle[]> {
  const { interval, daysBack } = rangeToParams(range);
  const json = await proxyFetchJSON<{ data?: ColumnarCandlesDTO } & ColumnarCandlesDTO>(
    "/api/yahoo-chart",
    { symbol: symbol.toUpperCase(), interval, fromDate: istDaysAgo(daysBack), toDate: istDaysAgo(0) },
    { withDhan: false },
  );
  return parseColumnarCandles(json?.data || json);
}

/**
 * Fetches OHLCV candle data with graceful degradation:
 *   Dhan (when symbol is known + broker keys configured) → Yahoo Finance fallback.
 * Always returns candles when the proxy is reachable, even without broker keys.
 */
export async function fetchHistorical(symbol: string, range: string): Promise<OHLCVCandle[]> {
  // Proxy known to be down (inside the reachability backoff): skip all three sources at once.
  if (!shouldTryProxy()) return [];
  // Try Dhan first for symbols we can resolve instantly (no 30MB CSV download).
  const mapped = lookupSecurity(symbol);
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
 * React Query hook for chart data: Dhan candles when available, Yahoo Finance otherwise.
 */
export function useChartData(symbol: string, range: string = "3M", enabled: boolean = true) {
  return useQuery({
    queryKey: ["chart-data", symbol, range],
    queryFn: () => fetchHistorical(symbol, range),
    enabled: !!symbol && enabled,
    staleTime: 5 * 60 * 1000, // 5 min cache
    refetchOnWindowFocus: false,
    retry: (failures: number) => failures < 1 && shouldTryProxy(),
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
    retry: (failures: number) => failures < 1 && shouldTryProxy(),
  });
}
