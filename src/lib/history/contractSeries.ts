/**
 * One option contract over time: route helpers, series extraction from chain snapshots, and
 * per-point Greeks computed with the shared options core (spot-based BSM with the symbol's
 * dividend yield, at the snapshot's spot, time to expiry at the snapshot time, and the snapshot IV;
 * when a snapshot has no IV it is solved from the LTP).
 *
 * Route shape (shared with other streams): /contract/:symbol/:expiry/:strike/:type
 *   symbol  upper-case underlying, e.g. NIFTY
 *   expiry  ISO yyyy-mm-dd
 *   strike  number, e.g. 25000 or 112.5
 *   type    CE | PE
 */
import {
  formatDateIST,
  formatStrike,
  getMarketParams,
  getDividendYield,
  greeks,
  impliedVol,
  intrinsic,
  isTradingDay,
  isValidIsoDate,
  istDateString,
  nowIST,
  previousTradingDay,
  toISTDate,
  normalizeExpiry,
  timeToExpiryYears,
  formatTimeIST,
  type OptionType,
  type Side,
} from "@/lib/options";
import type { BasketLeg } from "@/components/option-chain/basket";
import type { OptionLegData } from "@/lib/mockData";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import type { ContractDailyRow } from "./sampleSession";

export const CONTRACT_ROUTE = "/contract/:symbol/:expiry/:strike/:type";

export interface ContractKey {
  symbol: string;
  expiry: string;
  strike: number;
  type: OptionType;
}

/** URL for a contract page, e.g. /contract/NIFTY/2026-10-20/25000/CE. */
export function contractPath(symbol: string, expiry: string, strike: number, type: OptionType): string {
  const iso = normalizeExpiry(expiry) || expiry;
  return `/contract/${encodeURIComponent(String(symbol).trim().toUpperCase())}/${iso}/${strike}/${type}`;
}

/** Validate route params. Returns the key or a human-readable error. */
export function parseContractParams(p: Partial<Record<"symbol" | "expiry" | "strike" | "type", string | undefined>>): { key: ContractKey } | { error: string } {
  const symbol = String(p.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) return { error: "The symbol in the link is not valid." };
  const rawExpiry = String(p.expiry ?? "").trim();
  const expiry = isValidIsoDate(rawExpiry) ? rawExpiry : normalizeExpiry(rawExpiry);
  if (!expiry) return { error: "The expiry in the link must be a date (yyyy-mm-dd)." };
  const strike = Number(p.strike);
  if (!(Number.isFinite(strike) && strike > 0 && strike < 1e7)) return { error: "The strike in the link is not a valid number." };
  const type = String(p.type ?? "").trim().toUpperCase();
  if (type !== "CE" && type !== "PE") return { error: "The option type in the link must be CE or PE." };
  return { key: { symbol, expiry, strike, type } };
}

/** "NIFTY 20 Oct 2026 25,000 CE". */
export function contractLabel(k: ContractKey): string {
  return `${k.symbol} ${formatDateIST(k.expiry)} ${formatStrike(k.strike)} ${k.type}`;
}

export interface ContractPoint {
  ts: number;
  spot: number;
  ltp: number;
  oi: number;
  /** Cumulative day volume at the snapshot. */
  vol: number;
  /** Percent, as the feed reports it (0 = not reported). */
  iv: number;
  bid: number;
  ask: number;
  bidQty?: number;
  askQty?: number;
}

/** Pull one strike/side out of chain snapshots (ascending by time; snapshots without the leg are skipped). */
export function extractContractSeries(snaps: ChainSnapshot[], strike: number, type: OptionType): ContractPoint[] {
  const out: ContractPoint[] = [];
  for (const s of [...(snaps ?? [])].sort((a, b) => a.ts - b.ts)) {
    const r = s.rows.find((x) => x.strike === strike && x.side === type);
    if (!r) continue;
    const p: ContractPoint = { ts: s.ts, spot: s.spot, ltp: r.ltp, oi: r.oi, vol: r.vol, iv: r.iv, bid: r.bid, ask: r.ask };
    if (r.bidQty !== undefined) p.bidQty = r.bidQty;
    if (r.askQty !== undefined) p.askQty = r.askQty;
    out.push(p);
  }
  return out;
}

export interface EnrichedPoint extends ContractPoint {
  /** OI change since the previous point (0 for the first). */
  dOi: number;
  /** Contracts traded since the previous point (cumulative volume difference; resets each day). */
  dVol: number;
  /** IV used for the Greeks, decimal; NaN when it could not be found. */
  sigma: number;
  ivSource: "feed" | "solved" | "none";
  delta: number;
  gamma: number;
  /** Rupees per calendar day per unit. */
  theta: number;
  /** Rupees per vol point per unit. */
  vega: number;
  /** Mid when both sides are quoted, else LTP. */
  mid: number;
}

/** Add interval OI/volume and Greeks to a contract series. */
export function enrichContractSeries(points: ContractPoint[], k: ContractKey, o?: { r?: number; q?: number }): EnrichedPoint[] {
  const r = o?.r ?? getMarketParams().r;
  const q = o?.q ?? getDividendYield(k.symbol);
  return points.map((p, i) => {
    const prev = i > 0 ? points[i - 1] : undefined;
    const sameDay = prev ? Math.floor((prev.ts + 19_800_000) / 86_400_000) === Math.floor((p.ts + 19_800_000) / 86_400_000) : false;
    const dOi = prev ? p.oi - prev.oi : 0;
    const dVol = prev && sameDay ? Math.max(0, p.vol - prev.vol) : prev ? p.vol : 0;
    const T = timeToExpiryYears(k.expiry, new Date(p.ts));
    let sigma = p.iv > 0 ? p.iv / 100 : NaN;
    let ivSource: EnrichedPoint["ivSource"] = p.iv > 0 ? "feed" : "none";
    if (!(sigma > 0) && p.ltp > 0 && p.spot > 0 && T > 0) {
      const solved = impliedVol(p.ltp, { S: p.spot, K: k.strike, T, r, q, type: k.type });
      if (Number.isFinite(solved) && solved > 0) {
        sigma = solved;
        ivSource = "solved";
      }
    }
    const g = sigma > 0 && p.spot > 0 && Number.isFinite(T) ? greeks({ S: p.spot, K: k.strike, T, r, q, sigma, type: k.type }) : null;
    const mid = p.bid > 0 && p.ask > 0 && p.ask >= p.bid ? (p.bid + p.ask) / 2 : p.ltp;
    return {
      ...p,
      dOi,
      dVol,
      sigma: sigma > 0 ? sigma : NaN,
      ivSource,
      delta: g ? g.delta : NaN,
      gamma: g ? g.gamma : NaN,
      theta: g ? g.theta : NaN,
      vega: g ? g.vega : NaN,
      mid,
    };
  });
}

export interface SeriesSummary {
  first?: EnrichedPoint;
  last?: EnrichedPoint;
  high: number;
  low: number;
  ltpChange: number;
  ltpChangePct: number;
  oiChange: number;
  oiChangePct: number;
  volume: number;
  ivChange: number;
}

/** Session summary across the series (NaN where undefined). */
export function summariseSeries(points: EnrichedPoint[]): SeriesSummary {
  if (points.length === 0) return { high: NaN, low: NaN, ltpChange: NaN, ltpChangePct: NaN, oiChange: NaN, oiChangePct: NaN, volume: NaN, ivChange: NaN };
  const first = points[0];
  const last = points[points.length - 1];
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const p of points) {
    if (p.ltp > 0) {
      high = Math.max(high, p.ltp);
      low = Math.min(low, p.ltp);
    }
    volume += p.dVol;
  }
  return {
    first,
    last,
    high: Number.isFinite(high) ? high : NaN,
    low: Number.isFinite(low) ? low : NaN,
    ltpChange: last.ltp - first.ltp,
    ltpChangePct: first.ltp > 0 ? ((last.ltp - first.ltp) / first.ltp) * 100 : NaN,
    oiChange: last.oi - first.oi,
    oiChangePct: first.oi > 0 ? ((last.oi - first.oi) / first.oi) * 100 : NaN,
    volume: points.length > 1 ? volume : last.vol,
    ivChange: last.iv > 0 && first.iv > 0 ? last.iv - first.iv : NaN,
  };
}

/** Moneyness of the contract at a spot: ITM/ATM/OTM with intrinsic and time value per unit. */
export function moneyness(k: ContractKey, spot: number, ltp: number, atmBand: number): { state: "ITM" | "ATM" | "OTM"; intrinsic: number; timeValue: number } {
  const intr = spot > 0 ? intrinsic(spot, k.strike, k.type) : NaN;
  const state = Math.abs(spot - k.strike) <= atmBand / 2 ? "ATM" : intr > 0 ? "ITM" : "OTM";
  return { state, intrinsic: intr, timeValue: ltp > 0 && Number.isFinite(intr) ? Math.max(0, ltp - intr) : NaN };
}

/** Raw bhavcopy row from /api/x/bhavcopy-fo. */
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

/** The contract's row in one day's bhavcopy, as a daily row; null when it is not listed. */
export function pickBhavcopyRow(rows: BhavcopyFoRow[] | null | undefined, k: ContractKey, date: string): ContractDailyRow | null {
  const r = (rows ?? []).find((x) => x && x.symbol === k.symbol && x.expiry === k.expiry && x.type === k.type && Math.abs(x.strike - k.strike) < 1e-6);
  if (!r) return null;
  return { date, close: r.close, settle: r.settle, oi: r.oi, chgOi: r.chgOi, volume: r.volume, underlyingClose: r.underlyingClose };
}

/**
 * Trading dates whose bhavcopy to fetch, oldest first: the last `days` trading days up to today
 * (today only after 19:00 IST, when NSE has published it), never after the contract's expiry.
 */
export function dailyHistoryDates(now: Date, days: number, expiry?: string): string[] {
  const t = nowIST(now);
  const today = istDateString(now);
  let d = isTradingDay(today) && t.hh >= 19 ? today : previousTradingDay(today);
  const out: string[] = [];
  const want = Math.max(0, Math.min(60, Math.floor(days)));
  for (let guard = 0; d && out.length < want && guard < 200; guard++) {
    if (!expiry || d <= expiry) out.push(d);
    d = previousTradingDay(d);
  }
  return out.reverse();
}

/**
 * The intraday window the Contract page shows: today's session once it has opened (09:00 IST to
 * now, capped at 15:35), otherwise the previous trading day's full session.
 */
export function contractSessionWindow(now: Date = new Date()): { date: string; from: number; to: number; isToday: boolean } {
  const t = nowIST(now);
  const today = istDateString(now);
  const open = isTradingDay(today) && t.hh * 60 + t.mm >= 9 * 60 + 15;
  const date = open ? today : previousTradingDay(today) || today;
  const from = toISTDate(date, "09:00").getTime();
  const close = toISTDate(date, "15:35").getTime();
  return { date, from, to: open ? Math.min(now.getTime(), close) : close, isToday: open };
}

/** Basket leg for this contract at the current quote (premium = mid when two-sided, else LTP; IV decimal). */
export function contractBasketLeg(k: ContractKey, side: Side, leg: Pick<OptionLegData, "ltp" | "iv" | "bidPrice" | "askPrice"> | undefined): BasketLeg {
  const mid = leg && leg.bidPrice > 0 && leg.askPrice >= leg.bidPrice ? (leg.bidPrice + leg.askPrice) / 2 : 0;
  const premium = mid > 0 ? mid : leg?.ltp ?? 0;
  return {
    symbol: k.symbol,
    expiry: k.expiry,
    strike: k.strike,
    type: k.type,
    side,
    lots: 1,
    premium: Math.round(premium * 100) / 100,
    iv: leg && leg.iv > 0 ? Math.round(leg.iv * 100) / 10000 : null,
  };
}

/** "14:05" in IST (24-hour), for chart axes. */
export function hhmmIST(ts: number): string {
  return formatTimeIST(ts).replace(" IST", "");
}
