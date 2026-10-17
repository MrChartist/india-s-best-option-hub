/**
 * Strategy payoff engine: expiry payoff, exact breakevens, max profit/loss with
 * unlimited detection, T+x valuation (Black-76 per leg), P&L matrix.
 * All money values are rupees for the whole position (lots × lotSize applied).
 */
import { black76Price, forwardFromSpot, intrinsic } from "./blackScholes";
import { impliedVol76 } from "./iv";
import { getMarketParams } from "./marketParams";
import { istDateString, nowIST, timeToExpiryYears } from "./time";
import type { Leg } from "./types";
import { isLegEnabled, sideSign } from "./types";

/** Default vol used when a leg has no IV and none can be back-solved. */
export const FALLBACK_IV = 0.15;

function qty(leg: Leg): number {
  const q = (Number(leg.lots) || 0) * (Number(leg.lotSize) || 0);
  return Number.isFinite(q) ? q : 0;
}

function activeLegs(legs: Leg[]): Leg[] {
  return (Array.isArray(legs) ? legs : []).filter((l) => l && isLegEnabled(l) && qty(l) !== 0);
}

/** Expiry P&L of one leg in rupees (includes premium; lots × lotSize). */
export function legPayoffAtExpiry(leg: Leg, ST: number): number {
  if (!leg || !Number.isFinite(ST)) return NaN;
  const value = leg.type === "FUT" ? ST : intrinsic(ST, leg.strike, leg.type);
  return sideSign(leg.side) * (value - (Number(leg.premium) || 0)) * qty(leg);
}

export function strategyPayoffAtExpiry(legs: Leg[], ST: number): number {
  if (!Number.isFinite(ST)) return NaN;
  let total = 0;
  for (const l of activeLegs(legs)) total += legPayoffAtExpiry(l, ST);
  return total;
}

/** Net slope of the expiry payoff as S → ∞ (rupees per point). */
function upperSlope(legs: Leg[]): number {
  let s = 0;
  for (const l of activeLegs(legs)) if (l.type === "CE" || l.type === "FUT") s += sideSign(l.side) * qty(l);
  return s;
}

function kinks(legs: Leg[]): number[] {
  const ks = activeLegs(legs)
    .filter((l) => l.type !== "FUT" && Number.isFinite(l.strike) && l.strike > 0)
    .map((l) => l.strike);
  return Array.from(new Set(ks)).sort((a, b) => a - b);
}

function scaleOf(legs: Leg[]): number {
  let s = 1;
  for (const l of activeLegs(legs)) s = Math.max(s, Math.abs((Number(l.premium) || 0) * qty(l)), Math.abs(l.strike * qty(l)) * 1e-6);
  return s;
}

function pushUnique(out: number[], x: number): void {
  const r = Math.round(x * 1e6) / 1e6;
  if (!out.some((y) => Math.abs(y - r) < 1e-6)) out.push(r);
}

/** Exact roots of the piecewise-linear expiry payoff, including both tails. Sorted ascending. */
export function breakevens(legs: Leg[]): number[] {
  const act = activeLegs(legs);
  if (act.length === 0) return [];
  const ks = kinks(act);
  const eps = 1e-9 * scaleOf(act);
  const pts = [0, ...ks.filter((k) => k > 0)];
  const out: number[] = [];
  const isZero = (v: number) => Math.abs(v) <= eps;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const va = strategyPayoffAtExpiry(act, a);
    if (isZero(va) && a > 0) pushUnique(out, a);
    if (i + 1 < pts.length) {
      const b = pts[i + 1];
      const vb = strategyPayoffAtExpiry(act, b);
      if (!isZero(va) && !isZero(vb) && Math.sign(va) !== Math.sign(vb)) {
        pushUnique(out, a + ((0 - va) * (b - a)) / (vb - va));
      }
    }
  }
  // upper tail beyond the last kink
  const last = pts[pts.length - 1];
  const vLast = strategyPayoffAtExpiry(act, last);
  const slope = upperSlope(act);
  if (slope !== 0 && !isZero(vLast)) {
    const root = last - vLast / slope;
    if (root > last) pushUnique(out, root);
  }
  return out.filter((x) => x > 0).sort((a, b) => a - b);
}

/** Max profit / loss at expiry (maxLoss ≤ 0). Unlimited when the net call/futures slope is non-zero as S → ∞. */
export function maxProfitLoss(legs: Leg[]): { maxProfit: number; maxLoss: number; unlimitedProfit: boolean; unlimitedLoss: boolean } {
  const act = activeLegs(legs);
  if (act.length === 0) return { maxProfit: 0, maxLoss: 0, unlimitedProfit: false, unlimitedLoss: false };
  const pts = [0, ...kinks(act)];
  let hi = -Infinity;
  let lo = Infinity;
  for (const p of pts) {
    const v = strategyPayoffAtExpiry(act, p);
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  const slope = upperSlope(act);
  const unlimitedProfit = slope > 0;
  const unlimitedLoss = slope < 0;
  return {
    maxProfit: unlimitedProfit ? Infinity : Math.max(hi, 0),
    maxLoss: unlimitedLoss ? -Infinity : Math.min(lo, 0),
    unlimitedProfit,
    unlimitedLoss,
  };
}

/** Net option premium from the trader's cash view: + received (CREDIT), − paid (DEBIT). Futures are ignored. */
export function netPremium(legs: Leg[]): { net: number; type: "CREDIT" | "DEBIT" } {
  let net = 0;
  for (const l of activeLegs(legs)) {
    if (l.type === "FUT") continue;
    net += -sideSign(l.side) * (Number(l.premium) || 0) * qty(l);
  }
  return { net, type: net > 0 ? "CREDIT" : "DEBIT" };
}

/** Spot grid around spot that always contains every strike and breakeven. */
export function spotGrid(legs: Leg[], spot: number, o?: { pctRange?: number; points?: number }): number[] {
  if (!(spot > 0)) return [];
  const pct = o?.pctRange && o.pctRange > 0 ? o.pctRange : 0.1;
  const n = Math.max(2, Math.min(2000, Math.round(o?.points ?? 121)));
  const keys = [...kinks(legs), ...breakevens(legs)].filter((x) => x > 0);
  let lo = spot * (1 - pct);
  let hi = spot * (1 + pct);
  for (const k of keys) {
    if (k < lo) lo = k * 0.99;
    if (k > hi) hi = k * 1.01;
  }
  lo = Math.max(lo, 0.01);
  const set = new Set<number>();
  for (let i = 0; i < n; i++) set.add(Math.round((lo + ((hi - lo) * i) / (n - 1)) * 100) / 100);
  for (const k of keys) set.add(Math.round(k * 100) / 100);
  set.add(Math.round(spot * 100) / 100);
  return Array.from(set).sort((a, b) => a - b);
}

export interface ValueOptions {
  now?: Date;
  /** Evaluation date (defaults to now). */
  atDate?: Date;
  /** Parallel IV shift in decimal vol points (+0.02 = +2 points). */
  ivShift?: number;
  r?: number;
  q?: number;
  /** Current spot, used to back-solve IV from premium for legs without iv. */
  spot?: number;
}

/**
 * Fill each leg's iv (decimal): keeps leg.iv; otherwise back-solves from premium on the forward of
 * `spot` at `now`; otherwise uses the median of the known IVs, or FALLBACK_IV.
 */
export function resolveLegIVs(legs: Leg[], o?: { spot?: number; now?: Date; r?: number; q?: number }): Leg[] {
  const list = Array.isArray(legs) ? legs : [];
  const r = Number.isFinite(o?.r) ? (o?.r as number) : getMarketParams().r;
  const q = Number.isFinite(o?.q) ? (o?.q as number) : 0;
  const now = o?.now ?? new Date();
  const solved = list.map((l) => {
    if (!l || l.type === "FUT") return l;
    if (typeof l.iv === "number" && l.iv > 0) return l;
    const spot = o?.spot;
    if (spot && spot > 0 && l.premium > 0) {
      const T = timeToExpiryYears(l.expiry, now);
      if (T > 0) {
        const iv = impliedVol76(l.premium, { F: forwardFromSpot(spot, T, r, q), K: l.strike, T, r, type: l.type });
        if (Number.isFinite(iv)) return { ...l, iv };
      }
    }
    return { ...l, iv: undefined };
  });
  const known = solved.filter((l) => l && l.type !== "FUT" && typeof l.iv === "number" && l.iv > 0).map((l) => l.iv as number).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : FALLBACK_IV;
  return solved.map((l) => (l && l.type !== "FUT" && !(typeof l.iv === "number" && l.iv > 0) ? { ...l, iv: fallback } : l));
}

/** T+x position P&L at spot S via Black-76 per leg (own expiry and IV); legs past expiry use intrinsic. */
export function strategyValueAt(legs: Leg[], S: number, opts: ValueOptions = {}): number {
  if (!Number.isFinite(S) || S <= 0) return NaN;
  const o: ValueOptions = opts ?? {};
  const now = o.now ?? new Date();
  const at = o.atDate ?? now;
  const r = Number.isFinite(o.r) ? (o.r as number) : getMarketParams().r;
  const q = Number.isFinite(o.q) ? (o.q as number) : 0;
  const shift = Number.isFinite(o.ivShift) ? (o.ivShift as number) : 0;
  const resolved = resolveLegIVs(activeLegs(legs), { spot: o.spot, now, r, q });
  let total = 0;
  for (const l of resolved) {
    const T = timeToExpiryYears(l.expiry, at);
    const F = Number.isFinite(T) && T > 0 ? forwardFromSpot(S, T, r, q) : S;
    let value: number;
    if (l.type === "FUT") value = F;
    else if (!(T > 0)) value = intrinsic(S, l.strike, l.type);
    else value = black76Price({ F, K: l.strike, T, r, sigma: Math.max((l.iv ?? FALLBACK_IV) + shift, 0.001), type: l.type });
    total += sideSign(l.side) * (value - (Number(l.premium) || 0)) * qty(l);
  }
  return total;
}

/** Key used for date columns in payoffSeries: "yyyy-mm-dd HH:mm" in IST. */
export function payoffDateKey(d: Date): string {
  const p = nowIST(d);
  return `${istDateString(d)} ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
}

export function payoffSeries(
  legs: Leg[],
  grid: number[],
  o?: { dates?: Date[]; ivShift?: number; now?: Date; spot?: number; r?: number; q?: number },
): Array<{ spot: number; expiry: number; [dateKey: string]: number }> {
  const dates = (Array.isArray(o?.dates) ? o.dates : []).filter((d) => d instanceof Date);
  const now = o?.now ?? new Date();
  const resolved = resolveLegIVs(legs, { spot: o?.spot, now, r: o?.r, q: o?.q });
  const keys = dates.map(payoffDateKey);
  return (Array.isArray(grid) ? grid : []).map((S) => {
    const row: { spot: number; expiry: number; [dateKey: string]: number } = { spot: S, expiry: strategyPayoffAtExpiry(resolved, S) };
    dates.forEach((d, i) => {
      row[keys[i]] = strategyValueAt(resolved, S, { now, atDate: d, ivShift: o?.ivShift, r: o?.r, q: o?.q });
    });
    return row;
  });
}

/** P&L matrix [spotIdx][dateIdx]. */
export function pnlMatrix(legs: Leg[], spots: number[], dates: Date[], o?: { ivShift?: number; now?: Date; spot?: number; r?: number; q?: number }): number[][] {
  const now = o?.now ?? new Date();
  const resolved = resolveLegIVs(legs, { spot: o?.spot, now, r: o?.r, q: o?.q });
  const ds = Array.isArray(dates) ? dates : [];
  return (Array.isArray(spots) ? spots : []).map((S) => ds.map((d) => strategyValueAt(resolved, S, { now, atDate: d, ivShift: o?.ivShift, r: o?.r, q: o?.q })));
}
