/**
 * Pure per-row screener metrics. No React, no fetches: everything here is unit tested.
 *
 * Units: percentages are plain percent (12.5 = 12.5 %), IV and HV are percent, prices in rupees.
 */
import {
  atmIV,
  calendarDaysBetween,
  chainForward,
  classifyBuildup,
  hvCloseToClose,
  ivPercentile,
  timeToExpiryYears,
  DEFAULT_MARKET_PARAMS,
  type Buildup,
} from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import type { InstrumentKind } from "./universe";

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const round = (x: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/** Thresholds NSE uses for the market-wide position limit (MWPL). */
export const MWPL_BAN_PCT = 95;
export const MWPL_EXIT_PCT = 80;
export const MWPL_DANGER_PCT = 85;
export const MWPL_NEAR_PCT = 80;

/** Price and OI moves smaller than this (percent) are treated as flat for the buildup tag. */
export const BUILDUP_EPS_PCT = 0.05;

export type MwplStatus = "BAN" | "DANGER" | "NEAR" | "OK";

export type OiSource = "futures-eod" | "oi-spurts" | "sample";
export type PcrSource = "live" | "eod" | "sample";

export interface ScreenerRow {
  symbol: string;
  kind: InstrumentKind;
  sector: string;
  ltp: number;
  changePct: number;
  /** Underlying traded volume today (shares). */
  volume: number;
  /** Futures (or F&O) OI change, percent. */
  oiChangePct: number | null;
  oiSource: OiSource | null;
  buildup: Buildup;
  /** Near-expiry ATM IV, percent. */
  atmIv: number | null;
  /** ATM IV percentile against recorded end-of-day ATM IV (needs 20+ days). */
  ivp: number | null;
  /** 20-day close-to-close historical volatility, percent. */
  hv20: number | null;
  /** atmIv / hv20. Above 1: options are pricing more movement than the stock has shown. */
  ivHvRatio: number | null;
  pcrOi: number | null;
  pcrSource: PcrSource | null;
  /** True when the option-chain metrics are older than the refresh window. */
  chainStale: boolean;
  /** Today's volume ÷ the previous 5-session average. */
  volRatio: number | null;
  mwplPct: number | null;
  banned: boolean;
  mwplStatus: MwplStatus | null;
  /** Near-month future minus underlying close (EOD), rupees. */
  basis: number | null;
  basisPct: number | null;
  /** Annualised cost of carry from the near-month future, percent. */
  carryPct: number | null;
  /** Share of futures OI in next and far months, percent. */
  rolloverPct: number | null;
  /** Calendar days to the near-month futures expiry. */
  futDte: number | null;
  isSample: boolean;
  scannedAt: number | null;
}

// ── Basic moves ──

export function pctChange(now: number, prev: number): number | null {
  if (!finite(now) || !finite(prev) || prev === 0) return null;
  return ((now - prev) / Math.abs(prev)) * 100;
}

export function buildupTag(changePct: number | null, oiChangePct: number | null): Buildup {
  if (changePct === null || oiChangePct === null) return "NEUTRAL";
  return classifyBuildup(changePct, oiChangePct, BUILDUP_EPS_PCT);
}

// ── Option chain metrics ──

export interface ChainMetrics {
  pcrOi: number | null;
  pcrVol: number | null;
  atmIv: number | null;
  ceOi: number;
  peOi: number;
}

/** Put-call ratio (OI and volume) and ATM IV from one expiry's chain. */
export function chainMetrics(chain: readonly OptionData[], spot: number, expiryIso: string, now: Date = new Date(), r: number = DEFAULT_MARKET_PARAMS.r): ChainMetrics {
  let ceOi = 0;
  let peOi = 0;
  let ceVol = 0;
  let peVol = 0;
  for (const row of chain ?? []) {
    ceOi += finite(row?.ce?.oi) ? row.ce.oi : 0;
    peOi += finite(row?.pe?.oi) ? row.pe.oi : 0;
    ceVol += finite(row?.ce?.volume) ? row.ce.volume : 0;
    peVol += finite(row?.pe?.volume) ? row.pe.volume : 0;
  }
  let atm: number | null = null;
  if (chain && chain.length > 0 && finite(spot) && spot > 0) {
    const T = timeToExpiryYears(expiryIso, now);
    if (finite(T) && T > 0) {
      const F = chainForward(chain as OptionData[], spot, T, r);
      const iv = atmIV(chain as OptionData[], F);
      atm = finite(iv) && iv > 0 ? round(iv, 2) : null;
    }
  }
  return {
    pcrOi: ceOi > 0 ? round(peOi / ceOi, 3) : null,
    pcrVol: ceVol > 0 ? round(peVol / ceVol, 3) : null,
    atmIv: atm,
    ceOi,
    peOi,
  };
}

/** IV percentile of the current ATM IV against a history of daily ATM IVs (percent). */
export function ivpFromHistory(currentIv: number | null, history: readonly number[]): number | null {
  if (currentIv === null || !finite(currentIv)) return null;
  const v = ivPercentile(currentIv, history.filter((x) => finite(x) && x > 0));
  return v === null ? null : round(v, 0);
}

// ── Daily history (volume and HV) ──

export interface DailyBar {
  date: string;
  close: number;
  volume: number;
}

/** 20-day close-to-close HV in percent from daily bars (oldest first). */
export function hv20FromBars(bars: readonly DailyBar[]): number | null {
  const closes = bars.map((b) => b.close).filter((c) => finite(c) && c > 0);
  const hv = hvCloseToClose(closes, 20);
  return finite(hv) && hv > 0 ? round(hv * 100, 2) : null;
}

/**
 * Today's volume against the average of the previous `n` completed sessions.
 * Bars dated today are excluded from the average.
 */
export function volumeRatio(todayVolume: number, bars: readonly DailyBar[], todayIso: string, n = 5): number | null {
  if (!finite(todayVolume) || todayVolume <= 0) return null;
  const prior = bars.filter((b) => b.date < todayIso && finite(b.volume) && b.volume > 0).slice(-n);
  if (prior.length < Math.min(3, n)) return null;
  const avg = prior.reduce((s, b) => s + b.volume, 0) / prior.length;
  return avg > 0 ? round(todayVolume / avg, 2) : null;
}

export function ivHvRatio(atmIv: number | null, hv: number | null): number | null {
  if (atmIv === null || hv === null || !finite(atmIv) || !finite(hv) || hv <= 0) return null;
  return round(atmIv / hv, 2);
}

// ── Futures from the F&O bhavcopy ──

export interface BhavRow {
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

export interface FuturesSummary {
  nearExpiry: string | null;
  nearPrice: number | null;
  underlying: number | null;
  futOi: number;
  futOiChgPct: number | null;
  basis: number | null;
  basisPct: number | null;
  carryPct: number | null;
  rolloverPct: number | null;
  futDte: number | null;
  /** End-of-day PCR (all expiries) from the bhavcopy option rows. */
  eodPcr: number | null;
  /** Trade date of the file (ISO), when known. */
  asOfDate: string | null;
}

/**
 * Annualised cost of carry: (F / S − 1) × 365 / days, in percent.
 * Days are floored at 1 so the expiry-day number does not explode.
 */
export function annualisedCarry(fut: number, spot: number, days: number): number | null {
  if (!finite(fut) || !finite(spot) || spot <= 0 || fut <= 0 || !finite(days)) return null;
  return round((fut / spot - 1) * (365 / Math.max(1, days)) * 100, 2);
}

/** Rollover % = OI in next and far months ÷ total futures OI × 100. */
export function rolloverPct(oiByExpiry: readonly number[]): number | null {
  const total = oiByExpiry.reduce((s, x) => s + (finite(x) && x > 0 ? x : 0), 0);
  if (total <= 0 || oiByExpiry.length === 0) return null;
  const near = finite(oiByExpiry[0]) && oiByExpiry[0] > 0 ? oiByExpiry[0] : 0;
  return round(((total - near) / total) * 100, 1);
}

/** Summarise one symbol's bhavcopy rows (futures basis, carry, rollover, OI change, EOD PCR). */
export function summariseFutures(rows: readonly BhavRow[], asOfIso: string | null): FuturesSummary {
  const fut = rows.filter((r) => r && r.type === "FUT" && r.expiry).sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  let ceOi = 0;
  let peOi = 0;
  for (const r of rows) {
    if (r?.type === "CE" && finite(r.oi)) ceOi += r.oi;
    else if (r?.type === "PE" && finite(r.oi)) peOi += r.oi;
  }
  const eodPcr = ceOi > 0 ? round(peOi / ceOi, 3) : null;
  const empty: FuturesSummary = {
    nearExpiry: null, nearPrice: null, underlying: null, futOi: 0, futOiChgPct: null, basis: null, basisPct: null,
    carryPct: null, rolloverPct: null, futDte: null, eodPcr, asOfDate: asOfIso,
  };
  if (fut.length === 0) return empty;
  const near = fut[0];
  const nearPrice = finite(near.close) && near.close > 0 ? near.close : finite(near.settle) && near.settle > 0 ? near.settle : null;
  const underlying = rows.map((r) => r.underlyingClose).find((u) => finite(u) && u > 0) ?? null;
  const futOi = fut.reduce((s, r) => s + (finite(r.oi) ? r.oi : 0), 0);
  const chg = fut.reduce((s, r) => s + (finite(r.chgOi) ? r.chgOi : 0), 0);
  const prevOi = futOi - chg;
  const futDte = asOfIso ? Math.max(0, calendarDaysBetween(asOfIso, near.expiry)) : null;
  const basis = nearPrice !== null && underlying !== null ? round(nearPrice - underlying, 2) : null;
  return {
    nearExpiry: near.expiry,
    nearPrice,
    underlying,
    futOi,
    futOiChgPct: prevOi > 0 ? round((chg / prevOi) * 100, 2) : null,
    basis,
    basisPct: basis !== null && underlying ? round((basis / underlying) * 100, 3) : null,
    carryPct: nearPrice !== null && underlying !== null && futDte !== null ? annualisedCarry(nearPrice, underlying, futDte) : null,
    rolloverPct: rolloverPct(fut.map((r) => r.oi)),
    futDte: futDte !== null && Number.isFinite(futDte) ? futDte : null,
    eodPcr,
    asOfDate: asOfIso,
  };
}

// ── MWPL ──

export function mwplStatus(mwplPct: number | null, banned: boolean): MwplStatus | null {
  if (banned) return "BAN";
  if (mwplPct === null || !finite(mwplPct)) return null;
  if (mwplPct >= MWPL_DANGER_PCT) return "DANGER";
  if (mwplPct >= MWPL_NEAR_PCT) return "NEAR";
  return "OK";
}

// ── Row assembly ──

export interface RowInputs {
  symbol: string;
  kind: InstrumentKind;
  sector: string;
  ltp: number;
  changePct: number;
  volume: number;
  /** OI change from the live OI-spurts feed (percent), used when futures are not scanned yet. */
  spurtOiChgPct?: number | null;
  chain?: { pcrOi: number | null; atmIv: number | null; ivp: number | null; stale: boolean; asOf: number } | null;
  futures?: FuturesSummary | null;
  bars?: readonly DailyBar[] | null;
  todayIso: string;
  mwplPct?: number | null;
  banned?: boolean;
}

export function buildRow(i: RowInputs): ScreenerRow {
  const futOi = i.futures?.futOiChgPct ?? null;
  const spurt = finite(i.spurtOiChgPct) ? (i.spurtOiChgPct as number) : null;
  const oiChangePct = futOi !== null ? futOi : spurt;
  const oiSource: OiSource | null = futOi !== null ? "futures-eod" : spurt !== null ? "oi-spurts" : null;
  const livePcr = i.chain?.pcrOi ?? null;
  const eodPcr = i.futures?.eodPcr ?? null;
  const pcrOi = livePcr !== null ? livePcr : eodPcr;
  const hv20 = i.bars && i.bars.length > 0 ? hv20FromBars(i.bars) : null;
  const atmIv = i.chain?.atmIv ?? null;
  const banned = !!i.banned;
  const mwplPct = finite(i.mwplPct) ? round(i.mwplPct as number, 2) : null;
  return {
    symbol: i.symbol,
    kind: i.kind,
    sector: i.sector,
    ltp: i.ltp,
    changePct: round(i.changePct, 2),
    volume: i.volume,
    oiChangePct,
    oiSource,
    buildup: buildupTag(i.changePct, oiChangePct),
    atmIv,
    ivp: i.chain?.ivp ?? null,
    hv20,
    ivHvRatio: ivHvRatio(atmIv, hv20),
    pcrOi,
    pcrSource: livePcr !== null ? "live" : eodPcr !== null ? "eod" : null,
    chainStale: !!i.chain?.stale,
    volRatio: i.bars ? volumeRatio(i.volume, i.bars, i.todayIso) : null,
    mwplPct,
    banned,
    mwplStatus: i.kind === "INDEX" ? null : mwplStatus(mwplPct, banned),
    basis: i.futures?.basis ?? null,
    basisPct: i.futures?.basisPct ?? null,
    carryPct: i.futures?.carryPct ?? null,
    rolloverPct: i.futures?.rolloverPct ?? null,
    futDte: i.futures?.futDte ?? null,
    isSample: false,
    scannedAt: i.chain?.asOf ?? null,
  };
}
