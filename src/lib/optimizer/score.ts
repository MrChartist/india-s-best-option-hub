/**
 * Strategy Optimizer: scoring and ranking.
 *
 * Every number comes from "@/lib/options": P&L at the target via strategyValueAt (Black-76 per leg),
 * probabilityOfProfit (lognormal, with the chain's smile), maxProfitLoss, estimateMargin (SPAN-style
 * estimate) and chargesForLegs (round trip). ROI = net-of-charges profit at target ÷ funds required
 * (span + exposure + expiry-day ELM + net debit, so a debit spread is not charged its gross long premium).
 * utility = w · ROI_norm + (1 − w) · POP, plus NEUTRAL_VIEW_BOOST for delta-neutral fits to a Neutral view.
 */
import type { OptionData } from "@/lib/mockData";
import {
  atmIV,
  breakevens,
  chainForward,
  chargesForLegs,
  estimateMargin,
  expectedMoveFromIV,
  forwardFromSpot,
  getDividendYield,
  greeks76Spot,
  profitableIntervals,
  legIV,
  maxProfitLoss,
  netPremium,
  probabilityOfProfit,
  probBetween,
  strategyPayoffAtExpiry,
  strategyValueAt,
  timeToExpiryYears,
  toISTDate,
  type Interval,
  type Leg,
  expectedMoveSigma,
} from "@/lib/options";
import { isDefinedRisk } from "./candidates";
import { inZones, matchesView, NEUTRAL_VIEW_BOOST, profitZonesFromGrid } from "./insights";
import type { Sentiment } from "./preview";
import {
  CATEGORY_ORDER,
  KIND_META,
  type Candidate,
  type OptimizerContext,
  type OptimizerInput,
  type RankedCandidate,
  type ScoredCandidate,
  type StrategyCategory,
} from "./types";

const FALLBACK_SIGMA = 0.15;
const GRID_POINTS = 97;

export interface ScoreContext {
  symbol: string;
  spot: number;
  lotSize: number;
  now: Date;
  atDate: Date;
  /** Valuation instant is the front expiry close. */
  atExpiry: boolean;
  frontExpiry: string;
  targetPrice: number;
  budget: number;
  maxLots: number;
  r: number;
  /**
   * Carry (dividend) yield implied by the front chain's parity forward: F = S·e^{(r−q)T}. Leg IVs are
   * solved on that forward, so every valuation must use the same q or the model value at the current
   * spot drifts away from the entry premium (phantom T+0 P&L that favours bullish structures).
   */
  q: number;
  /** ATM IV (decimal) of the front expiry. */
  sigma: number;
  /** IV (decimal) as a function of strike, from the front chain. */
  smile: (K: number) => number;
  /** Forward to the front expiry. */
  forward: number;
  tExpiry: number;
  /** Years from now to the valuation instant. */
  tTarget: number;
  /** Forward to the valuation instant. */
  forwardTarget: number;
}

/** Linear-in-strike smile from the chain (OTM side preferred), flat beyond the listed range. */
export function buildSmile(chain: OptionData[], forward: number, fallback: number): (K: number) => number {
  const pts = (Array.isArray(chain) ? chain : [])
    .filter((r) => r && r.strikePrice > 0)
    .map((r) => ({ k: r.strikePrice, iv: legIV(r, forward) / 100 }))
    .filter((p) => Number.isFinite(p.iv) && p.iv > 0)
    .sort((x, y) => x.k - y.k);
  const fb = fallback > 0 ? fallback : FALLBACK_SIGMA;
  if (pts.length === 0) return () => fb;
  return (K: number) => {
    if (!(K > 0)) return pts[0].iv;
    if (K <= pts[0].k) return pts[0].iv;
    const last = pts[pts.length - 1];
    if (K >= last.k) return last.iv;
    let loIdx = 0;
    let hiIdx = pts.length - 1;
    while (hiIdx - loIdx > 1) {
      const mid = (loIdx + hiIdx) >> 1;
      if (pts[mid].k <= K) loIdx = mid;
      else hiIdx = mid;
    }
    const a = pts[loIdx];
    const b = pts[hiIdx];
    return b.k === a.k ? a.iv : a.iv + ((b.iv - a.iv) * (K - a.k)) / (b.k - a.k);
  };
}

/** Today's IST date string and the clamp of a target date into [today, expiry]. */
export function clampTargetDate(targetDate: string, today: string, expiry: string): string {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : expiry;
  if (t < today) return today;
  if (t > expiry) return expiry;
  return t;
}

/** Bound on the implied carry yield, so a noisy parity forward close to expiry cannot blow it up. */
const MAX_ABS_Q = 0.1;

/**
 * q implied by a forward: F = S·e^{(r−q)T} ⇒ q = r − ln(F/S)/T. Falls back to the static dividend
 * table when the forward or T is unusable, and clamps the result to ±MAX_ABS_Q.
 */
export function impliedCarryYield(spot: number, forward: number, T: number, r: number, symbol: string): number {
  const fallback = getDividendYield(symbol);
  if (!(spot > 0) || !(forward > 0) || !(T > 1 / 365) || !Number.isFinite(r)) return fallback;
  const q = r - Math.log(forward / spot) / T;
  if (!Number.isFinite(q)) return fallback;
  return Math.max(-MAX_ABS_Q, Math.min(MAX_ABS_Q, q));
}

/** Market context for the front expiry: forward, ATM IV, time to expiry and to the target, 1σ range. */
export function buildScoreContext(input: OptimizerInput, today: string): ScoreContext {
  const now = new Date(input.nowMs);
  const frontExpiry = input.front.expiry;
  const tExpiry = timeToExpiryYears(frontExpiry, now);
  const forward0 = chainForward(input.front.chain, input.spot, Math.max(tExpiry, 0), input.r);
  const forward = forward0 > 0 ? forward0 : input.spot;
  const q = forward0 > 0 ? impliedCarryYield(input.spot, forward0, tExpiry, input.r, input.symbol) : getDividendYield(input.symbol);
  const atmPct = atmIV(input.front.chain, forward);
  const sigma = Number.isFinite(atmPct) && atmPct > 0 ? atmPct / 100 : FALLBACK_SIGMA;
  const target = clampTargetDate(input.targetDate, today, frontExpiry);
  const close = toISTDate(target, "15:30");
  const atDate = close.getTime() > now.getTime() ? close : now;
  const atExpiry = target === frontExpiry;
  const tTarget = Math.max(0, (atDate.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000));
  return {
    symbol: input.symbol,
    spot: input.spot,
    lotSize: input.lotSize,
    now,
    atDate,
    atExpiry,
    frontExpiry,
    targetPrice: input.targetPrice,
    budget: input.budget,
    maxLots: Math.max(1, Math.floor(input.maxLots)),
    r: input.r,
    q,
    sigma,
    smile: buildSmile(input.front.chain, forward, sigma),
    forward,
    tExpiry: Math.max(0, tExpiry),
    tTarget,
    forwardTarget: forwardFromSpot(input.spot, tTarget, input.r, q),
  };
}

export function contextSummary(ctx: ScoreContext): OptimizerContext {
  const em = expectedMoveFromIV(ctx.forwardTarget, ctx.sigma, Math.max(ctx.tTarget, 1 / (365 * 24 * 60)));
  return {
    forward: ctx.forward,
    atmIv: ctx.sigma,
    tExpiry: ctx.tExpiry,
    tTarget: ctx.tTarget,
    atDateMs: ctx.atDate.getTime(),
    atExpiry: ctx.atExpiry,
    lower: em.lower,
    upper: em.upper,
  };
}

/** Convert a candidate to "@/lib/options" legs for a given number of strategy units. */
export function toLegs(c: Pick<Candidate, "legs">, units: number, symbol: string, lotSize: number): Leg[] {
  return c.legs.map((l) => ({
    symbol,
    type: l.type,
    side: l.side,
    strike: l.strike,
    expiry: l.expiry,
    lots: l.ratio * units,
    lotSize,
    premium: l.premium,
    iv: l.iv ?? undefined,
  }));
}

export function isMultiExpiry(c: Pick<Candidate, "legs">): boolean {
  return new Set(c.legs.map((l) => l.expiry)).size > 1;
}

export function strategyLabel(c: Candidate): string {
  const meta = KIND_META[c.kind];
  const strikes = Array.from(new Set(c.legs.map((l) => l.strike))).sort((a, b) => a - b);
  const strikeText = strikes.map((k) => (Number.isInteger(k) ? String(k) : k.toFixed(1))).join("/");
  const types = Array.from(new Set(c.legs.map((l) => l.type)));
  const suffix = c.category === "single" || c.kind === "short_straddle" ? ` ${types.join("+")}` : "";
  return `${meta.label} ${strikeText}${suffix}`;
}

/** Log-spaced price grid around a forward: F·e^{±k·σ√T}. */
export function priceGrid(F: number, sigma: number, T: number, points = GRID_POINTS, k = 5, strikes: number[] = []): number[] {
  const sd = expectedMoveSigma(sigma, T, { minSd: 0.02 });
  const lo = Math.log(F) - k * sd;
  const hi = Math.log(F) + k * sd;
  const out: number[] = [];
  for (let i = 0; i < points; i++) out.push(Math.exp(lo + ((hi - lo) * i) / (points - 1)));
  for (const s of strikes) if (s > out[0] && s < out[out.length - 1]) out.push(s);
  return out.sort((x, y) => x - y);
}

/** POP from P&L values on a price grid: lognormal mass of the intervals where P&L > 0. */
export function popFromGrid(grid: number[], values: number[], F: number, T: number, smile: (K: number) => number): number {
  if (grid.length < 2 || grid.length !== values.length || !(F > 0)) return NaN;
  if (!(T > 0)) return strategyAtSpotPositive(grid, values, F) ? 1 : 0;
  return popFromZones(profitZonesFromGrid(grid, values), F, T, smile);
}

/** Lognormal mass of the given profit zones (each zone uses the smile at a representative strike). */
export function popFromZones(zones: Interval[], F: number, T: number, smile: (K: number) => number): number {
  if (!(F > 0) || !(T > 0)) return NaN;
  let p = 0;
  for (const iv of zones) {
    const ref = iv.to === Infinity ? Math.max(iv.from, F) : iv.from === 0 ? Math.min(iv.to, F) : (iv.from + iv.to) / 2;
    const v = probBetween(F, iv.from, iv.to, T, smile(ref));
    if (Number.isFinite(v)) p += v;
  }
  return Math.max(0, Math.min(1, p));
}

function strategyAtSpotPositive(grid: number[], values: number[], F: number): boolean {
  let best = 0;
  for (let i = 1; i < grid.length; i++) if (Math.abs(grid[i] - F) < Math.abs(grid[best] - F)) best = i;
  return values[best] > 0;
}

export type ScoreReject = "over_budget" | "unprofitable" | "invalid";
export type ScoreOutcome = { ok: true; result: ScoredCandidate } | { ok: false; reason: ScoreReject };

/** P&L at the target price and valuation instant for the given legs. */
export function profitAtTarget(legs: Leg[], ctx: ScoreContext, multi: boolean): number {
  if (ctx.atExpiry && !multi) return strategyPayoffAtExpiry(legs, ctx.targetPrice);
  return strategyValueAt(legs, ctx.targetPrice, { now: ctx.now, atDate: ctx.atDate, r: ctx.r, q: ctx.q });
}

/** Score one candidate: size it to the budget, then P&L at target, POP, max P/L, margin and charges. */
export function scoreCandidate(c: Candidate, ctx: ScoreContext): ScoreOutcome {
  const multi = isMultiExpiry(c);
  const legs1 = toLegs(c, 1, ctx.symbol, ctx.lotSize);
  if (legs1.length === 0 || !(ctx.lotSize > 0)) return { ok: false, reason: "invalid" };

  // Cheap rejection first: gross profit per unit must be positive (charges only reduce it).
  const gross1 = profitAtTarget(legs1, ctx, multi);
  if (!Number.isFinite(gross1)) return { ok: false, reason: "invalid" };
  if (gross1 <= 0) return { ok: false, reason: "unprofitable" };

  const marginOpts = { spot: ctx.spot, now: ctx.now, sigma: ctx.sigma };
  const m1 = estimateMargin(legs1, marginOpts);
  if (!(m1.fundsRequired > 0)) return { ok: false, reason: "invalid" };
  let units = Math.min(ctx.maxLots, Math.floor(ctx.budget / m1.fundsRequired));
  if (units < 1) return { ok: false, reason: "over_budget" };

  let legs = toLegs(c, units, ctx.symbol, ctx.lotSize);
  let margin = estimateMargin(legs, marginOpts);
  while (margin.fundsRequired > ctx.budget && units > 1) {
    units--;
    legs = toLegs(c, units, ctx.symbol, ctx.lotSize);
    margin = estimateMargin(legs, marginOpts);
  }
  if (margin.fundsRequired > ctx.budget) return { ok: false, reason: "over_budget" };

  const gross = profitAtTarget(legs, ctx, multi);
  const charges = chargesForLegs(legs, { roundTrip: true }).total;
  const net = gross - charges;
  if (!(net > 0)) return { ok: false, reason: "unprofitable" };

  const strikes = c.legs.map((l) => l.strike);
  let maxProfit: number;
  let maxLoss: number;
  let unlimitedProfit = false;
  let unlimitedLoss = false;
  let maxIsEstimate = false;
  let bes: number[] = [];
  if (!multi) {
    const pl = maxProfitLoss(legs);
    maxProfit = pl.maxProfit;
    maxLoss = pl.maxLoss;
    unlimitedProfit = pl.unlimitedProfit;
    unlimitedLoss = pl.unlimitedLoss;
    bes = breakevens(legs);
  } else {
    // Mixed expiries: read max profit/loss off a wide grid at the front-expiry close.
    const front = toISTDate(ctx.frontExpiry, "15:30");
    const grid = priceGrid(ctx.forward, ctx.sigma, ctx.tExpiry, GRID_POINTS, 6, strikes);
    const vals = grid.map((S) => strategyValueAt(legs, S, { now: ctx.now, atDate: front, r: ctx.r, q: ctx.q }));
    const finite = vals.filter(Number.isFinite);
    maxProfit = finite.length ? Math.max(0, ...finite) : NaN;
    maxLoss = finite.length ? Math.min(0, ...finite) : NaN;
    maxIsEstimate = true;
  }

  let pop: number;
  let profitZones: Interval[];
  if (ctx.atExpiry && !multi) {
    pop = probabilityOfProfit(legs, { F: ctx.forward, T: ctx.tExpiry, sigma: ctx.smile });
    profitZones = profitableIntervals(legs);
  } else {
    const grid = priceGrid(ctx.forwardTarget, ctx.sigma, ctx.tTarget, GRID_POINTS, 5, strikes);
    const vals = grid.map((S) => strategyValueAt(legs, S, { now: ctx.now, atDate: ctx.atDate, r: ctx.r, q: ctx.q }));
    pop = popFromGrid(grid, vals, ctx.forwardTarget, ctx.tTarget, ctx.smile);
    profitZones = profitZonesFromGrid(grid, vals);
  }
  if (!Number.isFinite(pop)) pop = 0;
  const fundsRequired = margin.fundsRequired;

  const result: ScoredCandidate = {
    ...c,
    label: strategyLabel(c),
    lots: units,
    lotSize: ctx.lotSize,
    profitAtTarget: gross,
    charges,
    netProfit: net,
    capital: fundsRequired,
    fundsRequired,
    marginTotal: margin.total,
    elm: margin.elmExpiryDay,
    roi: net / fundsRequired,
    deltaPerSet: deltaPerSet(c, ctx),
    profitZones,
    spotInProfitZone: inZones(profitZones, ctx.spot),
    pop,
    maxProfit,
    maxLoss,
    unlimitedProfit,
    unlimitedLoss,
    maxIsEstimate,
    netPremium: netPremium(legs).net,
    breakevens: bes,
    definedRisk: isDefinedRisk(c.legs) && !unlimitedLoss,
    hedgeBenefit: margin.hedgeBenefit,
    quoteWarning: c.legs.some((l) => l.noQuote),
  };
  return { ok: true, result };
}

/**
 * Net spot delta of one strategy unit: Σ side × ratio × Δ (Black-76 on each leg's forward, converted
 * to spot delta), with each leg's own IV or the front smile. NaN when a leg cannot be priced.
 */
export function deltaPerSet(c: Pick<Candidate, "legs">, ctx: Pick<ScoreContext, "spot" | "now" | "r" | "q" | "smile">): number {
  let d = 0;
  for (const l of c.legs) {
    const T = timeToExpiryYears(l.expiry, ctx.now);
    const sign = l.side === "BUY" ? 1 : -1;
    if (!(T > 0)) {
      const itm = l.type === "CE" ? ctx.spot > l.strike : ctx.spot < l.strike;
      d += sign * l.ratio * (itm ? (l.type === "CE" ? 1 : -1) : 0);
      continue;
    }
    const F = forwardFromSpot(ctx.spot, T, ctx.r, ctx.q);
    const sigma = l.iv !== null && l.iv > 0 ? l.iv : ctx.smile(l.strike);
    const g = greeks76Spot({ F, K: l.strike, T, r: ctx.r, sigma, type: l.type }, ctx.spot);
    if (!Number.isFinite(g.delta)) return NaN;
    d += sign * l.ratio * g.delta;
  }
  return Math.round(d * 1e4) / 1e4;
}

// ───────────────────────────── ranking ─────────────────────────────

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return base + 1 < sorted.length ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

/**
 * ROI normaliser over the feasible set: min-max between the 5th and 95th percentiles (clipped to
 * 0..1), so one far-OTM lottery ticket does not flatten every other ROI.
 */
export function roiNormaliser(results: Array<Pick<ScoredCandidate, "roi">>): (roi: number) => number {
  const rois = results.map((r) => r.roi).filter(Number.isFinite).sort((a, b) => a - b);
  if (rois.length === 0) return () => 0;
  const lo = rois.length >= 20 ? quantile(rois, 0.05) : rois[0];
  const hi = rois.length >= 20 ? quantile(rois, 0.95) : rois[rois.length - 1];
  if (!(hi > lo)) return () => 1;
  return (roi: number) => Math.max(0, Math.min(1, (roi - lo) / (hi - lo)));
}

/** w = 1 → maximum return, w = 0 → maximum chance. */
export function utility(roiNorm: number, pop: number, w: number): number {
  const ww = Math.max(0, Math.min(1, Number.isFinite(w) ? w : 0.5));
  return ww * roiNorm + (1 - ww) * pop;
}

export interface RankedResults {
  overall: RankedCandidate[];
  byCategory: Record<StrategyCategory, RankedCandidate[]>;
  counts: Record<StrategyCategory, number>;
}

export interface RankOptions {
  /** Reader's market view. Neutral boosts delta-neutral structures; every view sets matchesView. */
  view?: Sentiment | null;
}

/**
 * Rank by utility (ties: higher ROI, then higher POP, then id) and keep the top N overall and per
 * category. With a Neutral view, structures that match it get NEUTRAL_VIEW_BOOST added to utility.
 */
export function rankResults(results: ScoredCandidate[], w: number, perCategory = 10, opts: RankOptions = {}): RankedResults {
  const norm = roiNormaliser(results);
  const view = opts.view ?? null;
  const ranked: RankedCandidate[] = results
    .map((r) => {
      const roiNorm = norm(r.roi);
      const fits = matchesView(r, view);
      const boost = view === "neutral" && fits ? NEUTRAL_VIEW_BOOST : 0;
      return { ...r, roiNorm, utility: utility(roiNorm, r.pop, w) + boost, rank: 0, matchesView: fits };
    })
    .sort((a, b) => b.utility - a.utility || b.roi - a.roi || b.pop - a.pop || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ranked.forEach((r, i) => (r.rank = i + 1));
  const byCategory = {} as Record<StrategyCategory, RankedCandidate[]>;
  const counts = {} as Record<StrategyCategory, number>;
  for (const cat of CATEGORY_ORDER) {
    const list = ranked.filter((r) => r.category === cat);
    counts[cat] = list.length;
    byCategory[cat] = list.slice(0, perCategory);
  }
  return { overall: ranked.slice(0, perCategory), byCategory, counts };
}
