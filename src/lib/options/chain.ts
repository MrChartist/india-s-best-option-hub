/**
 * Option-chain helpers operating on OptionData / OptionLegData (src/lib/mockData).
 * NSE sends zero IV / Greeks for illiquid strikes; these helpers ignore zeros and
 * can back-fill them with Black-76 on the chain forward.
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import { impliedForward } from "./blackScholes";
import { greeks76Spot } from "./greeks";
import { impliedVol76 } from "./iv";
import { getMarketParams } from "./marketParams";
import { timeToExpiryYears } from "./time";

const pos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

/** Mid price when a sane two-sided quote exists, otherwise LTP. 0 when neither. */
export function legMid(leg: OptionLegData | undefined): number {
  if (!leg) return 0;
  if (pos(leg.bidPrice) && pos(leg.askPrice) && leg.askPrice >= leg.bidPrice) return (leg.bidPrice + leg.askPrice) / 2;
  return pos(leg.ltp) ? leg.ltp : 0;
}

function sortedRows(chain: OptionData[]): OptionData[] {
  return (Array.isArray(chain) ? chain : []).filter((r) => r && pos(r.strikePrice)).slice().sort((a, b) => a.strikePrice - b.strikePrice);
}

/** Most common gap between adjacent strikes (near spot when given). Defaults to 50. */
export function modalStrikeStep(chain: OptionData[], spot?: number): number {
  let strikes = Array.from(new Set(sortedRows(chain).map((r) => r.strikePrice))).sort((a, b) => a - b);
  if (pos(spot)) {
    const near = strikes.filter((k) => Math.abs(k - spot) / spot <= 0.1);
    if (near.length >= 3) strikes = near;
  }
  if (strikes.length < 2) return 50;
  const counts = new Map<number, number>();
  for (let i = 1; i < strikes.length; i++) {
    const g = Math.round((strikes[i] - strikes[i - 1]) * 100) / 100;
    if (g > 0) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let best = 50;
  let bestN = -1;
  for (const [g, n] of counts) {
    if (n > bestN || (n === bestN && g < best)) {
      best = g;
      bestN = n;
    }
  }
  return best;
}

/** ATM strike: nearest to spot, or the strike where |CE − PE| is smallest. NaN for an empty chain. */
export function findATMStrike(chain: OptionData[], spot: number, method: "nearest" | "minStraddleDiff" = "nearest"): number {
  const rows = sortedRows(chain);
  if (rows.length === 0) return NaN;
  const nearest = () => {
    if (!pos(spot)) return rows[Math.floor(rows.length / 2)].strikePrice;
    let best = rows[0].strikePrice;
    for (const r of rows) if (Math.abs(r.strikePrice - spot) < Math.abs(best - spot)) best = r.strikePrice;
    return best;
  };
  if (method === "minStraddleDiff") {
    let best = NaN;
    let bestDiff = Infinity;
    for (const r of rows) {
      const c = legMid(r.ce);
      const p = legMid(r.pe);
      if (!(c > 0 && p > 0)) continue;
      if (pos(spot) && Math.abs(r.strikePrice - spot) / spot > 0.1) continue;
      const diff = Math.abs(c - p);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = r.strikePrice;
      }
    }
    return Number.isFinite(best) ? best : nearest();
  }
  return nearest();
}

/** Strike IV in PERCENT, ignoring zeros; prefers the OTM side relative to the forward. NaN if none. */
export function legIV(row: OptionData, forward: number): number {
  if (!row) return NaN;
  const ce = pos(row.ce?.iv) ? row.ce.iv : NaN;
  const pe = pos(row.pe?.iv) ? row.pe.iv : NaN;
  const callSide = pos(forward) ? row.strikePrice >= forward : true;
  if (callSide) return Number.isFinite(ce) ? ce : pe;
  return Number.isFinite(pe) ? pe : ce;
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Parity-implied forward (median of up to 3 strikes nearest spot). NaN when no two-sided strikes. */
function parityForward(chain: OptionData[], spot: number, T: number, r: number): number {
  if (!pos(spot) || !Number.isFinite(T) || !Number.isFinite(r)) return NaN;
  const rows = sortedRows(chain)
    .filter((row) => legMid(row.ce) > 0 && legMid(row.pe) > 0)
    .sort((a, b) => Math.abs(a.strikePrice - spot) - Math.abs(b.strikePrice - spot))
    .slice(0, 3);
  const fs = rows
    .map((row) => impliedForward(row.strikePrice, legMid(row.ce), legMid(row.pe), T, r))
    .filter((f) => pos(f) && Math.abs(f - spot) / spot < 0.1);
  return median(fs);
}

/**
 * Chain forward from put-call parity around ATM (median of up to 3 strikes); fallback
 * spot·e^{(r−q)T}. Pass the dividend yield (getDividendYield(symbol)) so the fallback agrees
 * with enrichChain's.
 */
export function chainForward(chain: OptionData[], spot: number, T: number, r: number, q = 0): number {
  const parity = parityForward(chain, spot, T, r);
  if (pos(parity)) return parity;
  const qq = Number.isFinite(q) ? q : 0;
  return pos(spot) && Number.isFinite(T) && Number.isFinite(r) ? spot * Math.exp((r - qq) * Math.max(T, 0)) : NaN;
}

/** ATM IV in PERCENT, linearly interpolated in strike between the strikes around F. */
export function atmIV(chain: OptionData[], forward: number): number {
  const pts = sortedRows(chain)
    .map((r) => ({ k: r.strikePrice, iv: legIV(r, forward) }))
    .filter((p) => Number.isFinite(p.iv));
  if (pts.length === 0) return NaN;
  if (!pos(forward)) return pts[Math.floor(pts.length / 2)].iv;
  if (forward <= pts[0].k) return pts[0].iv;
  if (forward >= pts[pts.length - 1].k) return pts[pts.length - 1].iv;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (forward >= a.k && forward <= b.k) {
      if (b.k === a.k) return a.iv;
      const w = (forward - a.k) / (b.k - a.k);
      return a.iv + w * (b.iv - a.iv);
    }
  }
  return NaN;
}

/** ATM straddle (mid prices when bid/ask exist). */
export function atmStraddle(
  chain: OptionData[],
  spot: number,
): { strike: number; ce: number; pe: number; straddle: number; straddlePct: number; lower: number; upper: number } {
  const strike = findATMStrike(chain, spot);
  const row = sortedRows(chain).find((r) => r.strikePrice === strike);
  if (!row) return { strike: NaN, ce: NaN, pe: NaN, straddle: NaN, straddlePct: NaN, lower: NaN, upper: NaN };
  const ce = legMid(row.ce);
  const pe = legMid(row.pe);
  const straddle = ce + pe;
  return {
    strike,
    ce,
    pe,
    straddle,
    straddlePct: pos(spot) ? (straddle / spot) * 100 : NaN,
    lower: strike - straddle,
    upper: strike + straddle,
  };
}

/** Synthetic future at ATM: K + C − P (undiscounted). NaN when prices are missing. */
export function syntheticFuture(chain: OptionData[], spot: number): number {
  const strike = findATMStrike(chain, spot, "nearest");
  const row = sortedRows(chain).find((r) => r.strikePrice === strike);
  if (!row) return NaN;
  const c = legMid(row.ce);
  const p = legMid(row.pe);
  if (!(c > 0 && p > 0)) return NaN;
  return strike + c - p;
}

export interface EnrichOptions {
  spot: number;
  expiry: string;
  now?: Date;
  r?: number;
  q?: number;
  forward?: number;
  overwrite?: boolean;
}

function enrichLeg(
  leg: OptionLegData,
  K: number,
  type: "CE" | "PE",
  F: number,
  T: number,
  r: number,
  overwrite: boolean,
  spot: number,
): OptionLegData {
  const out: OptionLegData = { ...leg };
  if (!pos(F) || !pos(T)) return out;
  if (overwrite || !pos(out.iv)) {
    const price = legMid(leg);
    if (price > 0) {
      const iv = impliedVol76(price, { F, K, T, r, type });
      if (Number.isFinite(iv)) out.iv = Math.round(iv * 1e6) / 1e4; // percent, 4 dp
    }
  }
  const needGreeks = overwrite || out.delta === 0 || out.gamma === 0 || out.theta === 0 || out.vega === 0 || [out.delta, out.gamma, out.theta, out.vega].some((v) => !Number.isFinite(v));
  if (needGreeks && pos(out.iv)) {
    // Spot-fixed Greeks (theta per calendar day with spot held, not the forward): NSE index
    // options settle on spot, so this is the theta a trader sees.
    const g = greeks76Spot({ F, K, T, r, sigma: out.iv / 100, type }, spot);
    const fill = (cur: number, v: number) => (overwrite || cur === 0 || !Number.isFinite(cur)) && Number.isFinite(v) ? v : cur;
    out.delta = fill(out.delta, g.delta);
    out.gamma = fill(out.gamma, g.gamma);
    out.theta = fill(out.theta, g.theta);
    out.vega = fill(out.vega, g.vega);
  }
  return out;
}

/**
 * Fill missing IV (percent, via impliedVol76 from mid/LTP) and zero Greeks (Black-76 on the chain
 * forward, re-expressed with spot held fixed via greeks76Spot). Returns new objects; the input
 * chain is not mutated.
 */
export function enrichChain(chain: OptionData[], o: EnrichOptions): OptionData[] {
  if (!Array.isArray(chain)) return [];
  const params = getMarketParams();
  const r = Number.isFinite(o?.r) ? (o.r as number) : params.r;
  const q = Number.isFinite(o?.q) ? (o.q as number) : 0;
  const T = timeToExpiryYears(o?.expiry ?? "", o?.now ?? new Date());
  const spot = o?.spot;
  let F = pos(o?.forward) ? (o.forward as number) : NaN;
  if (!pos(F) && pos(spot) && pos(T)) {
    const parity = parityForward(chain, spot, T, r);
    F = pos(parity) ? parity : spot * Math.exp((r - q) * T);
  }
  const overwrite = !!o?.overwrite;
  const S = pos(spot) ? spot : NaN;
  return chain.map((row) => {
    if (!row) return row;
    return {
      ...row,
      ce: row.ce ? enrichLeg(row.ce, row.strikePrice, "CE", F, T, r, overwrite, S) : row.ce,
      pe: row.pe ? enrichLeg(row.pe, row.strikePrice, "PE", F, T, r, overwrite, S) : row.pe,
    };
  });
}

/** Writer payout at each candidate settlement strike, in OI units (multiply by lot size outside). */
export function maxPainCurve(chain: OptionData[]): Array<{ strike: number; cePayout: number; pePayout: number; total: number }> {
  const rows = sortedRows(chain);
  return rows.map(({ strikePrice: S }) => {
    let cePayout = 0;
    let pePayout = 0;
    for (const r of rows) {
      const ceOi = pos(r.ce?.oi) ? r.ce.oi : 0;
      const peOi = pos(r.pe?.oi) ? r.pe.oi : 0;
      if (S > r.strikePrice) cePayout += ceOi * (S - r.strikePrice);
      if (S < r.strikePrice) pePayout += peOi * (r.strikePrice - S);
    }
    return { strike: S, cePayout, pePayout, total: cePayout + pePayout };
  });
}

/** Strike with the least total writer payout. NaN for an empty chain. */
export function maxPain(chain: OptionData[]): number {
  const curve = maxPainCurve(chain);
  if (curve.length === 0) return NaN;
  let best = curve[0];
  for (const p of curve) if (p.total < best.total) best = p;
  return best.strike;
}

export type Buildup = "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING" | "NEUTRAL";

/** Price ↑ OI ↑ long build-up; price ↓ OI ↑ short build-up; price ↑ OI ↓ short covering; price ↓ OI ↓ long unwinding. */
export function classifyBuildup(priceChange: number, oiChange: number, eps = 0): Buildup {
  if (!Number.isFinite(priceChange) || !Number.isFinite(oiChange)) return "NEUTRAL";
  const e = Math.abs(eps);
  if (Math.abs(priceChange) <= e || Math.abs(oiChange) <= e) return "NEUTRAL";
  if (priceChange > 0 && oiChange > 0) return "LONG_BUILDUP";
  if (priceChange < 0 && oiChange > 0) return "SHORT_BUILDUP";
  if (priceChange > 0 && oiChange < 0) return "SHORT_COVERING";
  return "LONG_UNWINDING";
}

export const BUILDUP_LABEL: Record<Buildup, string> = {
  LONG_BUILDUP: "Long build-up",
  SHORT_BUILDUP: "Short build-up",
  SHORT_COVERING: "Short covering",
  LONG_UNWINDING: "Long unwinding",
  NEUTRAL: "Neutral",
};
