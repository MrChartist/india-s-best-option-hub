/**
 * Market data transfer types shared by the data layer (proxy client, parsers, hooks).
 *
 * Upstream DTOs describe what Dhan / NSE / Yahoo actually send (every field optional,
 * because upstreams drop fields without notice). App-facing types describe what the parsers return.
 */
import type { ExpiryDate, OptionData, OptionLegData } from "@/lib/mockData";

// ── Provenance ──

/** Where a value came from. "cache" = proxy last-good copy, "sample" = generated, never live. */
export type DataSource = "dhan" | "nse" | "bse" | "yahoo" | "cache" | "sample";

/** Provenance attached to every hook result. */
export interface SourceMeta {
  source: DataSource | "database" | "none";
  /** Epoch ms of the underlying data (not of the fetch). */
  asOf: number;
  /** True when the data is a cached or last-good copy rather than a fresh read. */
  stale: boolean;
  reason?: string;
}

// ── App-facing option chain types ──

/** OptionLegData plus optional fields the live parsers can fill. */
export interface OptionLegDataExt extends OptionLegData {
  /** LTP change vs previous close, in rupees. */
  change?: number;
  /** LTP change vs previous close, in percent. */
  pChange?: number;
  prevClose?: number;
  bidQty?: number;
  askQty?: number;
  /** Broker security id (Dhan) or NSE identifier string. */
  securityId?: string;
}

export interface OptionDataExt extends OptionData {
  ce: OptionLegDataExt;
  pe: OptionLegDataExt;
}

export interface ParsedOptionChain {
  chain: OptionDataExt[];
  spotPrice: number;
  totalCEOI: number;
  totalPEOI: number;
}

export interface LiveOptionChainResult extends ParsedOptionChain {
  expiries: ExpiryDate[];
  /** ISO yyyy-mm-dd of the expiry this chain belongs to ("" when unknown). */
  expiry: string;
  source: "dhan" | "nse";
  /** True when the proxy served a last-good copy (market closed or upstream failure). */
  afterHours: boolean;
  stale: boolean;
  cachedAt: number | null;
  asOf: number;
}

// ── Dhan DTOs ──

export interface DhanGreeksDTO {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

export interface DhanOptionLegDTO {
  ltp?: number;
  last_price?: number;
  close?: number;
  previous_close_price?: number;
  volume?: number;
  previous_volume?: number;
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
  top_bid_quantity?: number;
  top_ask_quantity?: number;
  security_id?: number | string;
  greeks?: DhanGreeksDTO;
}

export interface DhanOptionChainDTO {
  status?: string;
  reason?: string;
  data?: {
    last_price?: number;
    oc?: Record<string, { ce?: DhanOptionLegDTO; pe?: DhanOptionLegDTO }>;
  };
  /** Added by the proxy when it serves a last-good copy. */
  afterHours?: boolean;
  stale?: boolean;
  cachedAt?: number;
  /** Added by the proxy: the expiry the chain was requested for. */
  expiry?: string;
}

export interface DhanExpiryListDTO {
  status?: string;
  data?: string[];
}

// ── NSE DTOs ──

export interface NSEOptionLegDTO {
  strikePrice?: number;
  expiryDate?: string;
  underlying?: string;
  identifier?: string;
  openInterest?: number;
  changeinOpenInterest?: number;
  pchangeinOpenInterest?: number;
  totalTradedVolume?: number;
  impliedVolatility?: number;
  lastPrice?: number;
  change?: number;
  pChange?: number;
  /** option-chain-v3 spells it in lower case. */
  pchange?: number;
  totalBuyQuantity?: number;
  totalSellQuantity?: number;
  bidQty?: number;
  bidprice?: number;
  askQty?: number;
  askPrice?: number;
  underlyingValue?: number;
}

export interface NSEOptionRowDTO {
  strikePrice: number;
  /** Legacy endpoint. */
  expiryDate?: string;
  /** option-chain-v3. */
  expiryDates?: string;
  CE?: NSEOptionLegDTO;
  PE?: NSEOptionLegDTO;
}

export interface NSEOptionChainDTO {
  records?: {
    expiryDates?: string[];
    strikePrices?: number[];
    data?: NSEOptionRowDTO[];
    underlyingValue?: number;
    timestamp?: string;
  };
  filtered?: {
    CE?: { totOI?: number; totVol?: number };
    PE?: { totOI?: number; totVol?: number };
  };
  /** Added by the proxy. */
  stale?: boolean;
  cachedAt?: number;
}

export interface NSEIndexRowDTO {
  index?: string;
  indexSymbol?: string;
  last?: number;
  variation?: number;
  percentChange?: number;
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
  advances?: number | string;
  declines?: number | string;
  unchanged?: number | string;
}

export interface NSEAllIndicesDTO {
  data?: NSEIndexRowDTO[];
  timestamp?: string;
}

export interface NSEMarketStateDTO {
  market?: string;
  marketStatus?: string;
  tradeDate?: string;
  index?: string;
  last?: number | string;
  variation?: number | string;
  percentChange?: number | string;
  marketStatusMessage?: string;
}

export interface NSEMarketStatusDTO {
  marketState?: NSEMarketStateDTO[];
  giftnifty?: {
    LASTPRICE?: number | string;
    DAYCHANGE?: number | string;
    PERCHANGE?: number | string;
    EXPIRYDATE?: string;
    TIMESTMP?: string;
    CONTRACTSTRADED?: number | string;
  };
  indicativenifty50?: {
    closingValue?: number;
    finalClosingValue?: number;
    change?: number;
    perChange?: number;
    status?: string;
  };
}

export interface NSEEquityDerivativeRowDTO {
  symbol?: string;
  identifier?: string;
  lastPrice?: number;
  change?: number;
  pChange?: number;
  open?: number;
  dayHigh?: number;
  dayLow?: number;
  previousClose?: number;
  totalTradedVolume?: number;
  openInterest?: number;
  changeinOpenInterest?: number;
  meta?: { industry?: string };
}

export interface NSEEquityDerivativesDTO {
  data?: NSEEquityDerivativeRowDTO[];
}

export interface NSEFiiDiiRowDTO {
  category?: string;
  date?: string;
  buyValue?: string | number;
  sellValue?: string | number;
  netValue?: string | number;
}

// ── Yahoo / instruments ──

export interface InstrumentDTO {
  securityId: string;
  symbol: string;
  tradingSymbol: string;
  exchangeSegment: string;
  instrumentType: string;
  lotSize: number;
  expiryDate?: string;
  strikePrice?: number;
  optionType?: string;
}

export interface InstrumentMasterDTO {
  instruments: InstrumentDTO[];
  count: number;
}

export interface ColumnarCandlesDTO {
  timestamp?: Array<number | string>;
  start_Time?: Array<number | string>;
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
  oi?: Array<number | null>;
}

export interface HealthSourceDTO {
  lastSuccess: number | null;
  lastFailure: number | null;
  lastError: string | null;
  blockedUntil?: number | null;
}

export interface ProxyHealthDTO {
  status?: string;
  uptime?: number;
  version?: string;
  websocket?: {
    dhanConnected?: boolean;
    browserClients?: number;
    instrumentsSubscribed?: number;
    cachedTicks?: number;
    lastDisconnectCode?: number | null;
  };
  /** Back-compat flags: sources.dhan is true when the proxy has Dhan credentials in .env. */
  sources?: Record<string, boolean>;
  /** Per-upstream last success / failure. */
  upstreams?: Record<string, HealthSourceDTO>;
  security?: { host?: string; allowedOrigins?: string[] };
}

// ── /api/x/* row shapes (see docs/DATA_ENDPOINTS.md) ──

export type Participant = "Client" | "DII" | "FII" | "Pro";

export interface ParticipantOIRow {
  date: string;
  participant: Participant;
  futIdxLong: number;
  futIdxShort: number;
  optIdxCallLong: number;
  optIdxCallShort: number;
  optIdxPutLong: number;
  optIdxPutShort: number;
  futStkLong: number;
  futStkShort: number;
}

export interface FiiStatsRow {
  date: string;
  segment: "Index Futures" | "Index Calls" | "Index Puts" | "Stock Futures";
  longOi: number;
  shortOi: number;
  netOi: number;
  longPct: number;
  buyVol: number | null;
  sellVol: number | null;
  netVol: number | null;
}

export interface VixHistoryRow {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
}

export interface BhavcopyFoRow {
  symbol: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE" | "FUT";
  close: number;
  settle: number;
  oi: number;
  chgOi: number;
  volume: number;
  underlyingClose: number;
}

export interface ChainMultiExpiryDTO {
  expiry: string;
  chain: OptionDataExt[];
}

export interface ChainMultiDTO {
  symbol: string;
  spot: number;
  expiries: ChainMultiExpiryDTO[];
}
