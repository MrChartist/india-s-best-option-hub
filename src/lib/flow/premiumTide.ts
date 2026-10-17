/**
 * Premium Tide: cumulative signed premium through the session.
 *
 *   call tide = Σ(ask-side CE premium) − Σ(bid-side CE premium)
 *   put tide  = Σ(ask-side PE premium) − Σ(bid-side PE premium)
 *   net       = call tide − put tide   (rising = bullish premium dominates)
 *
 * Mid-market prints are left out of the tide (direction unknown) but count in totals.
 */
import { signedPremium } from "./derivePrints";
import type { FlowPrint, TidePoint } from "./types";

export interface TideOptions {
  /** Bucket width in ms. Default 60 000 (one minute). Use 0 to keep one point per snapshot time. */
  bucketMs?: number;
}

export function premiumTide(prints: FlowPrint[], opts: TideOptions = {}): TidePoint[] {
  const bucketMs = opts.bucketMs ?? 60_000;
  const buckets = new Map<number, { ce: number; pe: number; spot?: number; spotTs: number; symbols: Set<string> }>();
  for (const p of prints ?? []) {
    if (!p || !Number.isFinite(p.ts)) continue;
    const t = bucketMs > 0 ? Math.floor(p.ts / bucketMs) * bucketMs : p.ts;
    let b = buckets.get(t);
    if (!b) {
      b = { ce: 0, pe: 0, spotTs: -1, symbols: new Set() };
      buckets.set(t, b);
    }
    const s = signedPremium(p);
    if (p.type === "CE") b.ce += s;
    else b.pe += s;
    b.symbols.add(p.symbol);
    if (p.ts >= b.spotTs && p.spot > 0) {
      b.spot = p.spot;
      b.spotTs = p.ts;
    }
  }
  const multiSymbol = new Set((prints ?? []).map((p) => p?.symbol)).size > 1;
  let ce = 0;
  let pe = 0;
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, b]) => {
      ce += b.ce;
      pe += b.pe;
      const pt: TidePoint = { ts, ce, pe, net: ce - pe };
      if (!multiSymbol && b.spot !== undefined) pt.spot = b.spot;
      return pt;
    });
}

export interface PremiumSummary {
  ceBought: number;
  ceSold: number;
  peBought: number;
  peSold: number;
  mid: number;
  /** Ask-side minus bid-side call premium. */
  netCe: number;
  netPe: number;
  /** netCe − netPe */
  net: number;
  total: number;
  prints: number;
  /** Share of premium printed at the ask, 0..1 (NaN when nothing printed). */
  askShare: number;
}

export function premiumSummary(prints: FlowPrint[]): PremiumSummary {
  const s = { ceBought: 0, ceSold: 0, peBought: 0, peSold: 0, mid: 0, total: 0, prints: 0 };
  for (const p of prints ?? []) {
    if (!p || !Number.isFinite(p.premium)) continue;
    s.total += p.premium;
    s.prints += 1;
    if (p.aggressor === "MID") s.mid += p.premium;
    else if (p.type === "CE") {
      if (p.aggressor === "ASK") s.ceBought += p.premium;
      else s.ceSold += p.premium;
    } else if (p.aggressor === "ASK") s.peBought += p.premium;
    else s.peSold += p.premium;
  }
  const netCe = s.ceBought - s.ceSold;
  const netPe = s.peBought - s.peSold;
  return { ...s, netCe, netPe, net: netCe - netPe, askShare: s.total > 0 ? (s.ceBought + s.peBought) / s.total : NaN };
}

export interface ChainHeat {
  symbol: string;
  premium: number;
  cePremium: number;
  pePremium: number;
  net: number;
  prints: number;
  /** Share of this underlying's premium in calls, 0..1. */
  callShare: number;
}

/** Premium per underlying, hottest first. */
export function hottestChains(prints: FlowPrint[]): ChainHeat[] {
  const by = new Map<string, FlowPrint[]>();
  for (const p of prints ?? []) {
    if (!p) continue;
    const arr = by.get(p.symbol);
    if (arr) arr.push(p);
    else by.set(p.symbol, [p]);
  }
  return [...by.entries()]
    .map(([symbol, list]) => {
      const sm = premiumSummary(list);
      const ce = list.filter((p) => p.type === "CE").reduce((a, p) => a + p.premium, 0);
      const pe = sm.total - ce;
      return { symbol, premium: sm.total, cePremium: ce, pePremium: pe, net: sm.net, prints: sm.prints, callShare: sm.total > 0 ? ce / sm.total : NaN };
    })
    .sort((a, b) => b.premium - a.premium);
}

export interface ContractHeat {
  key: string;
  symbol: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE";
  premium: number;
  dVol: number;
  dOI: number;
  /** Signed premium (ask − bid). */
  net: number;
  lastLtp: number;
  prints: number;
  moneyness: FlowPrint["moneyness"];
  dte: number;
}

export function contractKey(p: Pick<FlowPrint, "symbol" | "expiry" | "strike" | "type">): string {
  return `${p.symbol}|${p.expiry}|${p.strike}|${p.type}`;
}

/** Contracts ranked by total premium across all intervals. */
export function topPremiumContracts(prints: FlowPrint[], limit = 10): ContractHeat[] {
  const by = new Map<string, ContractHeat & { lastTs: number }>();
  for (const p of prints ?? []) {
    if (!p) continue;
    const key = contractKey(p);
    const c = by.get(key) ?? { key, symbol: p.symbol, expiry: p.expiry, strike: p.strike, type: p.type, premium: 0, dVol: 0, dOI: 0, net: 0, lastLtp: p.ltp, prints: 0, moneyness: p.moneyness, dte: p.dte, lastTs: -1 };
    c.premium += p.premium;
    c.dVol += p.dVol;
    c.dOI += p.dOI;
    c.net += signedPremium(p);
    c.prints += 1;
    if (p.ts >= c.lastTs) {
      c.lastTs = p.ts;
      c.lastLtp = p.ltp;
      c.moneyness = p.moneyness;
      c.dte = p.dte;
    }
    by.set(key, c);
  }
  return [...by.values()]
    .sort((a, b) => b.premium - a.premium)
    .slice(0, Math.max(0, limit))
    .map(({ lastTs: _lastTs, ...rest }) => rest);
}

/**
 * One-line reading of the Premium Tide's net line (calls − puts, ₹). "Balanced" when |net| is
 * under 5% of the gross |call| + |put| tide.
 */
export function tideReading(last: Pick<TidePoint, "ce" | "pe" | "net"> | undefined, fmt: (v: number) => string): string {
  if (!last || ![last.ce, last.pe, last.net].every(Number.isFinite)) return "Not enough flow to read the tide yet.";
  const gross = Math.abs(last.ce) + Math.abs(last.pe);
  if (!(gross > 0) || Math.abs(last.net) < gross * 0.05) {
    return `Net ${fmt(last.net)}: call and put premium are roughly balanced, so no clear lean.`;
  }
  return last.net > 0
    ? `Net ${fmt(last.net)} and positive: more premium is buying calls (or selling puts) than the reverse, a bullish lean.`
    : `Net ${fmt(last.net)} and negative: more premium is buying puts (or selling calls) than the reverse, a bearish lean.`;
}
