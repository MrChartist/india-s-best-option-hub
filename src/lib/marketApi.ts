/**
 * Market data fetchers and parsers.
 *
 * All network calls go through src/lib/api/proxyClient.ts. Parsers are pure and accept the
 * loosely-typed upstream DTOs from src/lib/types/market.ts.
 */
import type { ExpiryDate, IndexData } from "./mockData";
import { calendarDaysBetween, formatDateIST, istDateString, normalizeExpiry } from "@/lib/options";
import {
  PROXY_BASE,
  dhanHeaders,
  markProxyOffline,
  markProxyOnline,
  proxyFetchJSON,
  proxyGet,
  shouldTryProxy,
  type ProxyEnvelope,
} from "@/lib/api/proxyClient";
import type {
  ChainMultiDTO,
  ColumnarCandlesDTO,
  DhanExpiryListDTO,
  DhanOptionChainDTO,
  DhanOptionLegDTO,
  InstrumentMasterDTO,
  LiveOptionChainResult,
  NSEAllIndicesDTO,
  NSEEquityDerivativesDTO,
  NSEFiiDiiRowDTO,
  NSEIndexRowDTO,
  NSEMarketStatusDTO,
  NSEOptionChainDTO,
  NSEOptionLegDTO,
  OptionDataExt,
  OptionLegDataExt,
  ParsedOptionChain,
  ProxyHealthDTO,
  TVScanDTO,
  TVStockDTO,
} from "@/lib/types/market";

export { PROXY_BASE };

// ── Small numeric helpers ──

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function optNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = num(v);
  return Number.isFinite(n) ? n : undefined;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ── Expiry helpers ──

/** Build an ExpiryDate with an ISO value, an IST label and calendar days to expiry. */
export function toExpiryDate(raw: string, now: Date = new Date()): ExpiryDate | null {
  const iso = normalizeExpiry(raw, now);
  if (!iso) return null;
  const days = Math.max(0, calendarDaysBetween(istDateString(now), iso));
  return { label: formatDateIST(iso), value: iso, daysToExpiry: Number.isFinite(days) ? days : 0 };
}

export function toExpiryDates(list: string[] | undefined, now: Date = new Date()): ExpiryDate[] {
  const seen = new Set<string>();
  const out: ExpiryDate[] = [];
  for (const raw of list ?? []) {
    const e = toExpiryDate(String(raw), now);
    if (e && !seen.has(e.value)) {
      seen.add(e.value);
      out.push(e);
    }
  }
  return out.sort((a, b) => (a.value < b.value ? -1 : 1));
}

// ── Raw proxy fetchers (legacy, non-envelope routes) ──

function fetchDhanProxy<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  return proxyFetchJSON<T>("/api/dhan-proxy", { endpoint, ...params });
}

function fetchNSEProxy<T>(endpoint: string, params?: Record<string, string | undefined>): Promise<T> {
  return proxyFetchJSON<T>("/api/nse-proxy", { endpoint, ...params }, { withDhan: false });
}

// ── Parse Dhan Option Chain ──

const EMPTY_LEG: OptionLegDataExt = { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };

function parseDhanLeg(leg: DhanOptionLegDTO | undefined): OptionLegDataExt {
  if (!leg) return { ...EMPTY_LEG };
  const g = leg.greeks ?? {};
  const ltp = num(leg.last_price ?? leg.ltp);
  const oi = num(leg.oi);
  const prevClose = optNum(leg.previous_close_price ?? leg.close);
  const out: OptionLegDataExt = {
    ltp,
    oi,
    oiChange: leg.oi_chg !== undefined ? num(leg.oi_chg) : leg.previous_oi !== undefined ? oi - num(leg.previous_oi) : 0,
    volume: num(leg.volume),
    iv: num(leg.implied_volatility ?? leg.iv),
    delta: num(g.delta ?? leg.delta),
    gamma: num(g.gamma ?? leg.gamma),
    theta: num(g.theta ?? leg.theta),
    vega: num(g.vega ?? leg.vega),
    bidPrice: num(leg.top_bid_price ?? leg.best_bid_price ?? leg.bid_price),
    askPrice: num(leg.top_ask_price ?? leg.best_ask_price ?? leg.ask_price),
  };
  if (prevClose !== undefined && prevClose > 0) {
    out.prevClose = prevClose;
    if (ltp > 0) {
      out.change = round2(ltp - prevClose);
      out.pChange = round2(((ltp - prevClose) / prevClose) * 100);
    }
  }
  const bq = optNum(leg.top_bid_quantity);
  const aq = optNum(leg.top_ask_quantity);
  if (bq !== undefined) out.bidQty = bq;
  if (aq !== undefined) out.askQty = aq;
  if (leg.security_id !== undefined && leg.security_id !== null && String(leg.security_id) !== "") out.securityId = String(leg.security_id);
  return out;
}

export function parseDhanOptionChain(raw: DhanOptionChainDTO | null | undefined): ParsedOptionChain {
  const oc = raw?.data?.oc ?? {};
  const spotPrice = num(raw?.data?.last_price);
  let totalCEOI = 0;
  let totalPEOI = 0;
  const chain: OptionDataExt[] = [];
  for (const strikeStr of Object.keys(oc)) {
    const strike = parseFloat(strikeStr);
    if (!Number.isFinite(strike) || strike <= 0) continue;
    const legs = oc[strikeStr] ?? {};
    const ce = parseDhanLeg(legs.ce);
    const pe = parseDhanLeg(legs.pe);
    totalCEOI += ce.oi;
    totalPEOI += pe.oi;
    chain.push({ strikePrice: strike, ce, pe });
  }
  chain.sort((a, b) => a.strikePrice - b.strikePrice);
  return { chain, spotPrice, totalCEOI, totalPEOI };
}

// ── Parse NSE Indices ──

const INDEX_SYMBOL_MAP: Record<string, string> = {
  "NIFTY 50": "NIFTY",
  "NIFTY BANK": "BANKNIFTY",
  "NIFTY FINANCIAL SERVICES": "FINNIFTY",
  "NIFTY FIN SERVICE": "FINNIFTY",
  "NIFTY MIDCAP SELECT": "MIDCPNIFTY",
  "NIFTY MID SELECT": "MIDCPNIFTY",
};

export function parseNSEIndices(raw: NSEAllIndicesDTO | null | undefined): IndexData[] {
  if (!raw?.data || !Array.isArray(raw.data)) return [];
  const out: IndexData[] = [];
  const seen = new Set<string>();
  for (const d of raw.data) {
    const name = d.index ?? "";
    const symbol = INDEX_SYMBOL_MAP[name];
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const last = num(d.last);
    out.push({
      name,
      symbol,
      ltp: last,
      change: num(d.variation),
      changePercent: num(d.percentChange),
      high: num(d.high) || last,
      low: num(d.low) || last,
      open: num(d.open) || last,
      prevClose: num(d.previousClose) || last,
    });
  }
  return out;
}

// ── Parse NSE Option Chain (legacy and v3 shapes) ──

function parseNSELeg(leg: NSEOptionLegDTO | undefined): OptionLegDataExt {
  if (!leg) return { ...EMPTY_LEG };
  const ltp = num(leg.lastPrice);
  const change = optNum(leg.change);
  const pChange = optNum(leg.pChange ?? leg.pchange);
  const out: OptionLegDataExt = {
    ltp,
    oi: num(leg.openInterest),
    oiChange: num(leg.changeinOpenInterest),
    volume: num(leg.totalTradedVolume),
    iv: num(leg.impliedVolatility),
    delta: 0,
    gamma: 0,
    theta: 0,
    vega: 0,
    bidPrice: num(leg.bidprice),
    askPrice: num(leg.askPrice),
  };
  if (change !== undefined) {
    out.change = round2(change);
    if (ltp > 0) out.prevClose = round2(ltp - change);
  }
  if (pChange !== undefined) out.pChange = round2(pChange);
  const bq = optNum(leg.bidQty);
  const aq = optNum(leg.askQty);
  if (bq !== undefined) out.bidQty = bq;
  if (aq !== undefined) out.askQty = aq;
  if (leg.identifier) out.securityId = leg.identifier;
  return out;
}

export function parseNSEOptionChain(
  raw: NSEOptionChainDTO | null | undefined,
  selectedExpiry?: string,
): ParsedOptionChain & { expiries: ExpiryDate[]; expiry: string } {
  const records = raw?.records;
  if (!records?.data || !Array.isArray(records.data)) {
    return { chain: [], spotPrice: 0, expiries: [], expiry: "", totalCEOI: 0, totalPEOI: 0 };
  }
  const rowExpiry = (r: { expiryDate?: string; expiryDates?: string }) => normalizeExpiry(r.expiryDate ?? r.expiryDates ?? "");
  const expiryRaw = records.expiryDates && records.expiryDates.length > 0 ? records.expiryDates : records.data.map((r) => r.expiryDate ?? r.expiryDates ?? "");
  const expiries = toExpiryDates(expiryRaw);
  const wanted = selectedExpiry ? normalizeExpiry(selectedExpiry) : "";
  const expiry = wanted && expiries.some((e) => e.value === wanted) ? wanted : expiries[0]?.value ?? "";

  let spotPrice = num(records.underlyingValue);
  let totalCEOI = 0;
  let totalPEOI = 0;
  const byStrike = new Map<number, OptionDataExt>();
  for (const item of records.data) {
    if (expiry && rowExpiry(item) !== expiry) continue;
    const strike = num(item.strikePrice);
    if (!(strike > 0)) continue;
    if (!spotPrice) spotPrice = num(item.CE?.underlyingValue) || num(item.PE?.underlyingValue);
    const ce = parseNSELeg(item.CE);
    const pe = parseNSELeg(item.PE);
    totalCEOI += ce.oi;
    totalPEOI += pe.oi;
    byStrike.set(strike, { strikePrice: strike, ce, pe });
  }
  const chain = [...byStrike.values()].sort((a, b) => a.strikePrice - b.strikePrice);
  // Prefer NSE's own filtered totals only when they describe the same expiry we parsed.
  const ftCE = num(raw?.filtered?.CE?.totOI);
  const ftPE = num(raw?.filtered?.PE?.totOI);
  const useFiltered = (!selectedExpiry || expiry === expiries[0]?.value) && ftCE > 0 && ftPE > 0;
  return {
    chain,
    spotPrice,
    expiries,
    expiry,
    totalCEOI: useFiltered ? ftCE : totalCEOI,
    totalPEOI: useFiltered ? ftPE : totalPEOI,
  };
}

// ── Option chain: Dhan (primary) → NSE (fallback) ──

async function fetchDhanChain(symbol: string, expiry?: string): Promise<LiveOptionChainResult | null> {
  const params: Record<string, string> = { symbol };
  if (expiry) params.expiry = expiry;
  const raw = await fetchDhanProxy<DhanOptionChainDTO>("option-chain", params);
  if (raw?.status !== "success") return null;
  const parsed = parseDhanOptionChain(raw);
  if (parsed.chain.length === 0) return null; // empty "success" is not a result
  let expiries: ExpiryDate[] = [];
  try {
    expiries = await fetchExpiryList(symbol);
  } catch {
    /* chain is still useful without the list */
  }
  const stale = !!(raw.stale || raw.afterHours);
  const chainExpiry = normalizeExpiry(raw.expiry ?? expiry ?? "") || expiries[0]?.value || "";
  return {
    ...parsed,
    expiries,
    expiry: chainExpiry,
    source: "dhan",
    afterHours: !!raw.afterHours,
    stale,
    cachedAt: raw.cachedAt ?? null,
    asOf: stale && raw.cachedAt ? raw.cachedAt : Date.now(),
  };
}

async function fetchNSEChain(symbol: string, expiry?: string): Promise<LiveOptionChainResult | null> {
  const raw = await fetchNSEProxy<NSEOptionChainDTO>("option-chain", { symbol, expiry: expiry ? normalizeExpiry(expiry) || expiry : undefined });
  const parsed = parseNSEOptionChain(raw, expiry);
  if (parsed.chain.length === 0) return null;
  const stale = !!raw?.stale;
  return {
    ...parsed,
    source: "nse",
    afterHours: stale,
    stale,
    cachedAt: raw?.cachedAt ?? null,
    asOf: stale && raw?.cachedAt ? raw.cachedAt : Date.now(),
  };
}

/**
 * Live option chain. Dhan is accepted only when it returns a non-empty chain; a stale (last-good)
 * Dhan copy is used only when NSE has nothing fresher. Throws when both sources fail.
 */
export async function fetchLiveOptionChain(symbol: string, expiry?: string): Promise<LiveOptionChainResult> {
  const sym = symbol.toUpperCase();
  let dhan: LiveOptionChainResult | null = null;
  try {
    dhan = await fetchDhanChain(sym, expiry);
    if (dhan && !dhan.stale) return dhan;
  } catch {
    /* fall through to NSE */
  }
  let nseError: unknown = null;
  try {
    const nse = await fetchNSEChain(sym, expiry);
    if (nse && (!nse.stale || !dhan)) return nse;
    if (nse && dhan) return (nse.cachedAt ?? 0) > (dhan.cachedAt ?? 0) ? nse : dhan;
  } catch (e) {
    nseError = e;
  }
  if (dhan) return dhan;
  throw nseError instanceof Error ? nseError : new Error(`No option chain available for ${sym}`);
}

/** Dhan expiry list, normalised to ISO. Falls back to the NSE chain's expiry list. */
export async function fetchExpiryList(symbol: string): Promise<ExpiryDate[]> {
  const sym = symbol.toUpperCase();
  try {
    const raw = await fetchDhanProxy<DhanExpiryListDTO>("expiry-list", { symbol: sym });
    const list = toExpiryDates(raw?.data);
    if (list.length > 0) return list;
  } catch {
    /* try NSE */
  }
  try {
    const raw = await fetchNSEProxy<NSEOptionChainDTO>("option-chain", { symbol: sym });
    return toExpiryDates(raw?.records?.expiryDates);
  } catch {
    return [];
  }
}

// ── Multi-expiry chain ──

export interface ChainMultiResult {
  symbol: string;
  spot: number;
  expiries: Array<{ expiry: string; chain: OptionDataExt[] }>;
}

/** Validate the /api/x/chain-multi payload (rows already normalised by the proxy). */
export function parseChainMulti(data: ChainMultiDTO | null | undefined): ChainMultiResult | null {
  if (!data || !Array.isArray(data.expiries)) return null;
  const expiries = data.expiries
    .map((e) => ({
      expiry: normalizeExpiry(String(e?.expiry ?? "")),
      chain: (Array.isArray(e?.chain) ? e.chain : [])
        .filter((r) => r && num(r.strikePrice) > 0)
        .map((r) => ({ strikePrice: num(r.strikePrice), ce: { ...EMPTY_LEG, ...(r.ce ?? {}) }, pe: { ...EMPTY_LEG, ...(r.pe ?? {}) } }))
        .sort((a, b) => a.strikePrice - b.strikePrice),
    }))
    .filter((e) => e.expiry && e.chain.length > 0)
    .sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  if (expiries.length === 0) return null;
  return { symbol: String(data.symbol || "").toUpperCase(), spot: num(data.spot), expiries };
}

export async function fetchChainMulti(
  symbol: string,
  expiries: string[] | "next3" | "all",
  signal?: AbortSignal,
): Promise<ProxyEnvelope<ChainMultiResult>> {
  const exp = Array.isArray(expiries) ? expiries.map((e) => normalizeExpiry(e)).filter(Boolean).join(",") : expiries;
  const env = await proxyGet<ChainMultiDTO>("/api/x/chain-multi", { symbol: symbol.toUpperCase(), expiries: exp || "next3" }, { timeoutMs: 30000, signal });
  return { data: parseChainMulti(env.data), meta: env.meta };
}

// ── Indices, status, F&O lists ──

export async function fetchLiveIndices(): Promise<IndexData[]> {
  const raw = await fetchNSEProxy<NSEAllIndicesDTO>("indices");
  return parseNSEIndices(raw);
}

export async function fetchMarketStatus(): Promise<NSEMarketStatusDTO> {
  return fetchNSEProxy<NSEMarketStatusDTO>("market-status");
}

export async function fetchFnOStocks(): Promise<NSEEquityDerivativesDTO> {
  return fetchNSEProxy<NSEEquityDerivativesDTO>("equity-derivatives");
}

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
  "NIFTY FINANCIAL SERVICES": "Fin Svc",
  "NIFTY INFRA": "Infra",
  "NIFTY HEALTHCARE INDEX": "Health",
  "NIFTY CONSUMER DURABLES": "Consumer",
};

export interface VixSnapshot {
  value: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
}

export interface SectorSnapshot {
  name: string;
  fullName: string;
  change: number;
  ltp: number;
  open: number;
  high: number;
  low: number;
}

export interface AllIndicesSnapshot {
  vix: VixSnapshot | null;
  sectors: SectorSnapshot[];
  advances: number;
  declines: number;
  unchanged: number;
}

export function parseAllIndices(raw: NSEAllIndicesDTO | null | undefined): AllIndicesSnapshot | null {
  if (!raw?.data || !Array.isArray(raw.data) || raw.data.length === 0) return null;
  const rows: NSEIndexRowDTO[] = raw.data;
  const vixEntry = rows.find((d) => d.index === "INDIA VIX");
  const vix = vixEntry
    ? {
        value: num(vixEntry.last),
        change: num(vixEntry.variation),
        changePercent: num(vixEntry.percentChange),
        high: num(vixEntry.high) || num(vixEntry.last),
        low: num(vixEntry.low) || num(vixEntry.last),
      }
    : null;
  const seen = new Set<string>();
  const sectors: SectorSnapshot[] = [];
  for (const d of rows) {
    const name = SECTOR_INDEX_MAP[d.index ?? ""];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const last = num(d.last);
    sectors.push({ name, fullName: d.index ?? name, change: num(d.percentChange), ltp: last, open: num(d.open) || last, high: num(d.high) || last, low: num(d.low) || last });
  }
  const nifty50 = rows.find((d) => d.index === "NIFTY 50");
  return { vix, sectors, advances: num(nifty50?.advances), declines: num(nifty50?.declines), unchanged: num(nifty50?.unchanged) };
}

export async function fetchAllIndices(): Promise<AllIndicesSnapshot | null> {
  const raw = await fetchNSEProxy<NSEAllIndicesDTO>("indices");
  return parseAllIndices(raw);
}

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

export function parseNSEFnOStocks(raw: NSEEquityDerivativesDTO | null | undefined): FnOStockData[] {
  if (!raw?.data || !Array.isArray(raw.data)) return [];
  return raw.data
    .filter((d) => d.symbol && d.symbol !== "NIFTY 50" && num(d.lastPrice) > 0)
    .map((d) => {
      const ltp = num(d.lastPrice);
      return {
        symbol: d.symbol as string,
        ltp,
        change: num(d.change),
        changePercent: num(d.pChange),
        open: num(d.open) || ltp,
        high: num(d.dayHigh) || ltp,
        low: num(d.dayLow) || ltp,
        previousClose: num(d.previousClose) || ltp,
        volume: num(d.totalTradedVolume),
        totalTradedVolume: num(d.totalTradedVolume),
        openInterest: num(d.openInterest),
        oiChange: num(d.changeinOpenInterest),
        sector: d.meta?.industry || "",
      };
    });
}

export async function fetchLiveFnOStocks(): Promise<FnOStockData[]> {
  try {
    const list = parseNSEFnOStocks(await fetchNSEProxy<NSEEquityDerivativesDTO>("equity-derivatives"));
    if (list.length > 0) return list;
  } catch {
    /* fall back to TradingView */
  }
  try {
    const tv = await fetchTradingViewStocks();
    if (tv.length > 0) return tv;
  } catch {
    /* both failed */
  }
  return [];
}

// ── TradingView scanner ──

function tvToFnO(s: TVStockDTO): FnOStockData {
  const ltp = num(s.ltp);
  const chg = num(s.changeAbs);
  return {
    symbol: s.symbol || "",
    ltp,
    change: chg,
    changePercent: num(s.changePercent),
    open: num(s.open),
    high: num(s.high),
    low: num(s.low),
    previousClose: ltp - chg,
    volume: num(s.volume),
    totalTradedVolume: num(s.volume),
    openInterest: 0,
    oiChange: 0,
    sector: s.sector || "",
  };
}

export async function fetchTradingViewStocks(): Promise<FnOStockData[]> {
  const data = await proxyFetchJSON<TVScanDTO>("/api/tv-scan", { type: "stocks" }, { withDhan: false });
  return (data.stocks ?? []).map(tvToFnO);
}

export async function fetchTradingViewIndices(): Promise<TVStockDTO[]> {
  const data = await proxyFetchJSON<TVScanDTO>("/api/tv-scan", { type: "indices" }, { withDhan: false });
  return data.stocks ?? [];
}

// ── FII/DII cash activity ──

export interface FIIDIIData {
  category: string;
  date: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
}

export function parseFIIDII(raw: { data?: NSEFiiDiiRowDTO[] } | NSEFiiDiiRowDTO[] | null | undefined): FIIDIIData[] {
  const rows = Array.isArray(raw) ? raw : raw?.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((d) => ({
    category: d.category || "",
    date: d.date || "",
    buyValue: num(d.buyValue),
    sellValue: num(d.sellValue),
    netValue: num(d.netValue),
  }));
}

export async function fetchFIIDII(): Promise<FIIDIIData[]> {
  const raw = await fetchNSEProxy<{ data?: NSEFiiDiiRowDTO[] } | NSEFiiDiiRowDTO[]>("fii-dii");
  return parseFIIDII(raw);
}

// ── Connection and health ──

export async function testDhanConnection(): Promise<{ status: string; message: string }> {
  // User-initiated, so it ignores the reachability backoff, but its outcome still updates the gate.
  let res: Response;
  try {
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
    res = await fetch(`${PROXY_BASE}/api/test-connection`, { headers: dhanHeaders(), signal });
  } catch {
    markProxyOffline("offline");
    return { status: "error", message: "Proxy not reachable. Start it with: npm run proxy" };
  }
  markProxyOnline();
  try {
    const body = (await res.json()) as { status?: string; message?: string; reason?: string };
    return { status: body.status || (res.ok ? "success" : "error"), message: body.message || body.reason || "" };
  } catch {
    return { status: "error", message: `The proxy answered with HTTP ${res.status} but no readable result.` };
  }
}

export async function fetchProxyHealth(): Promise<ProxyHealthDTO> {
  // A /health call is itself a probe: skip it inside the backoff window, otherwise send it straight
  // through (no second probe in front of it) and let its outcome reset or extend the backoff.
  if (!shouldTryProxy()) throw new Error("Proxy unreachable");
  return proxyFetchJSON<ProxyHealthDTO>("/health", undefined, { withDhan: false, timeoutMs: 5000, bypassGate: true });
}

// ── Instrument master ──

export async function fetchInstrumentMaster(): Promise<InstrumentMasterDTO> {
  const result = await proxyFetchJSON<InstrumentMasterDTO>("/api/dhan-proxy", { endpoint: "instruments" }, { timeoutMs: 120000, withDhan: false });
  return { instruments: Array.isArray(result?.instruments) ? result.instruments : [], count: num(result?.count) };
}

// ── Historical candles ──

export interface HistoricalCandleResponse {
  status: string;
  source?: string;
  data: ColumnarCandlesDTO;
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
  const raw = await fetchDhanProxy<HistoricalCandleResponse | ColumnarCandlesDTO>("historical", params);
  if (raw && typeof raw === "object" && "data" in raw && raw.data && typeof raw.data === "object") return raw as HistoricalCandleResponse;
  return { status: "success", source: "dhan", data: raw as ColumnarCandlesDTO };
}

export async function fetchYahooChart(symbol: string, interval: string = "D", fromDate?: string, toDate?: string): Promise<HistoricalCandleResponse> {
  return proxyFetchJSON<HistoricalCandleResponse>("/api/yahoo-chart", { symbol, interval, fromDate, toDate }, { withDhan: false });
}
