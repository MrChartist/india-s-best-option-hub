/**
 * Results-event move statistics: the move the ATM straddle priced before a results announcement
 * (from NSE F&O bhavcopy closes) against the move the stock actually made, and how often the
 * straddle overpriced it.
 *
 * Definitions
 *  - Window: pre = the last trading day strictly before the results date; post = the first trading
 *    day strictly after it. The two-session window catches the reaction whether the board declared
 *    results before, during or after market hours.
 *  - Straddle move = ATM straddle close / underlying close on `pre`, for the nearest expiry that
 *    is still alive on `post` (the straddle's breakeven move to expiry). For stock options the
 *    expiry is often 1-4 weeks away, so this also carries ordinary time value, not just the event.
 *  - Implied (event-window) move = the part of that straddle priced for the pre → post window:
 *    total implied variance σ_pre²·T_pre minus the ex-event variance still left after `post`,
 *    σ_ex²·T_post, expressed as an expected absolute move √(2/π)·√V (the same convention as a
 *    straddle's breakeven, so with no event and no time left it equals straddle ÷ spot).
 *    σ_ex comes from the term structure (the next expiry's ATM IV with the shared event variance
 *    removed) when the pre-event bhavcopy has it, else the post-event IV of the same straddle.
 *    When neither is available the full straddle move is used and flagged (`impliedMethod`).
 *  - Realised move = |underlying close on post − close on pre| / close on pre.
 *  - Overpriced: realised < implied. Straddle P&L = (straddle on post − straddle on pre) / straddle
 *    on pre, same strike and expiry: what a long straddle bought before the event made by the next close.
 */
import {
  bsPrice,
  defaultSampleIv,
  gaussianSource,
  getExpiries,
  getStrikeStep,
  isValidIsoDate,
  mulberry32,
  nextTradingDay,
  previousTradingDay,
  sampleSeed,
  timeToExpiryYears,
  toISTDate,
} from "@/lib/options";
import { DEFAULT_MARKET_PARAMS } from "@/lib/options/marketParams";
import type { BhavcopyFoRow } from "@/lib/history/contractSeries";
import { sampleResultsEvents } from "./calendar";
import type { MarketEvent } from "./types";

export type { BhavcopyFoRow };

export type MoveSource = "bhavcopy" | "sample";
/** term = next-expiry term structure; post = post-event IV; straddle = full straddle (not isolated). */
export type ImpliedMoveMethod = "term" | "post" | "straddle";

export interface StraddleQuote {
  expiry: string;
  strike: number;
  ce: number;
  pe: number;
  straddle: number;
  spot: number;
}

export interface EventMoveObservation {
  symbol: string;
  eventDate: string;
  preDate: string;
  postDate: string;
  expiry: string;
  strike: number;
  spotPre: number;
  spotPost: number;
  straddlePre: number;
  /** NaN when the post-event straddle is missing from the bhavcopy. */
  straddlePost: number;
  /** Calendar days from the pre-event session to the straddle's expiry. */
  dte: number;
  /** Full straddle ÷ spot in percent: the breakeven to expiry, including ordinary time value. */
  straddleMovePct: number;
  /**
   * Expected absolute move priced for the pre → post window, in percent of spot (event jump plus
   * the normal diffusion over those sessions, with time value beyond `post` removed).
   */
  impliedMovePct: number;
  /** How impliedMovePct was isolated. "straddle" = no ex-event IV, so it is the full straddle move. */
  impliedMethod: ImpliedMoveMethod;
  /** Absolute percent move, always ≥ 0. */
  realisedMovePct: number;
  /** Signed percent move (positive = stock rose). */
  signedMovePct: number;
  /** realised / implied. Below 1 means the straddle overpriced the move. */
  moveRatio: number;
  overpriced: boolean;
  /** Long-straddle P&L in percent of the entry premium; NaN when straddlePost is missing. */
  straddlePnlPct: number;
  source: MoveSource;
}

export interface EventMoveStats {
  symbol: string;
  n: number;
  overpricedCount: number;
  /** Share of events (0–100) where the straddle priced a bigger move than the stock made. */
  overpricedPct: number;
  avgImpliedPct: number;
  avgRealisedPct: number;
  medianRatio: number;
  /** Mean long-straddle P&L in percent (events with a post-event straddle only). */
  avgStraddlePnlPct: number;
  /** Share (0–100) of events where the straddle lost value by the next close (sellers won). */
  sellerWinPct: number;
  maxRealisedPct: number;
  /** Mean of (implied − realised): positive = the market overpays on average, in percent of spot. */
  avgEdgePct: number;
  /** Median days to expiry of the straddles used. */
  medianDte: number;
  /** Events whose implied move could not be isolated from time value (full straddle used). */
  unisolatedCount: number;
  source: MoveSource;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const priceOf = (r: BhavcopyFoRow | undefined) => (r ? (r.close > 0 ? r.close : r.settle > 0 ? r.settle : NaN) : NaN);

const RATE = DEFAULT_MARKET_PARAMS.r;
const SQRT_2_OVER_PI = Math.sqrt(2 / Math.PI);
const DAY_MS = 86_400_000;

function straddlePrice(S: number, K: number, T: number, sigma: number): number {
  return bsPrice({ S, K, T, r: RATE, sigma, type: "CE" }) + bsPrice({ S, K, T, r: RATE, sigma, type: "PE" });
}

/** Black-Scholes IV of a CE+PE straddle (bisection; the straddle is monotone in σ). NaN when out of bounds. */
export function straddleImpliedVol(straddle: number, S: number, K: number, T: number): number {
  if (![straddle, S, K, T].every(finite) || straddle <= 0 || S <= 0 || K <= 0 || T <= 0) return NaN;
  let lo = 0.001;
  let hi = 5;
  if (straddlePrice(S, K, T, lo) >= straddle || straddlePrice(S, K, T, hi) <= straddle) return NaN;
  for (let i = 0; i < 80 && hi - lo > 1e-7; i++) {
    const mid = 0.5 * (lo + hi);
    if (straddlePrice(S, K, T, mid) > straddle) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Expected absolute move (percent of spot) priced for the window between the pre-event close and
 * a later time `tPost` years before expiry, given the pre-event straddle IV over `tPre` and an
 * ex-event IV for the remaining `tPost`. NaN when the inputs are unusable.
 */
export function eventWindowMovePct(ivPre: number, tPre: number, ivEx: number, tPost: number): number {
  if (![ivPre, tPre, ivEx, tPost].every(finite) || tPre <= 0 || tPost < 0 || tPost > tPre) return NaN;
  const v = Math.max(0, ivPre * ivPre * tPre - ivEx * ivEx * tPost);
  return SQRT_2_OVER_PI * Math.sqrt(v) * 100;
}

/**
 * Ex-event IV from two expiries that both contain the event: σ1²T1 = σex²T1 + J and
 * σ2²T2 = σex²T2 + J, so σex² = (σ2²T2 − σ1²T1) / (T2 − T1). NaN when not positive.
 */
export function termStructureExEventIv(iv1: number, t1: number, iv2: number, t2: number): number {
  if (![iv1, t1, iv2, t2].every(finite) || !(t2 > t1) || t1 <= 0) return NaN;
  const v = (iv2 * iv2 * t2 - iv1 * iv1 * t1) / (t2 - t1);
  return v > 0 ? Math.sqrt(v) : NaN;
}

function isolateImpliedMove(o: {
  straddleMovePct: number;
  ivPre: number;
  tPre: number;
  tPost: number;
  ivTerm: number;
  ivPost: number;
}): { pct: number; method: ImpliedMoveMethod } {
  for (const [iv, method] of [
    [o.ivTerm, "term"],
    [o.ivPost, "post"],
  ] as const) {
    const pct = eventWindowMovePct(o.ivPre, o.tPre, iv, o.tPost);
    if (finite(pct) && pct > 0) return { pct, method };
  }
  return { pct: o.straddleMovePct, method: "straddle" };
}

/** The pre/post sessions around a results date. */
export function eventWindow(eventDate: string): { pre: string; post: string } | null {
  if (!isValidIsoDate(eventDate)) return null;
  return { pre: previousTradingDay(eventDate), post: nextTradingDay(eventDate) };
}

function spotOf(rows: BhavcopyFoRow[]): number {
  for (const r of rows) if (finite(r.underlyingClose) && r.underlyingClose > 0) return r.underlyingClose;
  return NaN;
}

/** Straddle (CE + PE close) at a given strike and expiry, or null when either leg is missing. */
export function straddleAt(rows: BhavcopyFoRow[] | null | undefined, symbol: string, expiry: string, strike: number): StraddleQuote | null {
  const list = (rows ?? []).filter((r) => r && r.symbol === symbol && r.expiry === expiry);
  const ce = priceOf(list.find((r) => r.type === "CE" && Math.abs(r.strike - strike) < 1e-6));
  const pe = priceOf(list.find((r) => r.type === "PE" && Math.abs(r.strike - strike) < 1e-6));
  const spot = spotOf(list.length ? list : (rows ?? []).filter((r) => r && r.symbol === symbol));
  if (!finite(ce) || !finite(pe) || !finite(spot)) return null;
  return { expiry, strike, ce, pe, straddle: ce + pe, spot };
}

/**
 * The ATM straddle in a day's bhavcopy for the nearest expiry strictly after `aliveAfter`: the
 * strike nearest the underlying close with both legs priced.
 */
export function atmStraddleFromRows(rows: BhavcopyFoRow[] | null | undefined, symbol: string, aliveAfter: string): StraddleQuote | null {
  const list = (rows ?? []).filter((r) => r && r.symbol === symbol && (r.type === "CE" || r.type === "PE") && typeof r.expiry === "string");
  const expiries = [...new Set(list.map((r) => r.expiry))].filter((e) => e > aliveAfter).sort();
  for (const expiry of expiries) {
    const legs = list.filter((r) => r.expiry === expiry);
    const spot = spotOf(legs);
    if (!finite(spot)) continue;
    const strikes = [...new Set(legs.map((r) => r.strike))].filter((k) => finite(k) && k > 0).sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot) || a - b);
    for (const k of strikes.slice(0, 3)) {
      const q = straddleAt(legs, symbol, expiry, k);
      if (q && q.straddle > 0) return q;
    }
  }
  return null;
}

/** One results event measured from the pre- and post-event bhavcopy rows. Null when the pre-event straddle or either close is missing. */
export function measureEventMove(o: {
  symbol: string;
  eventDate: string;
  preRows: BhavcopyFoRow[] | null | undefined;
  postRows: BhavcopyFoRow[] | null | undefined;
  source?: MoveSource;
}): EventMoveObservation | null {
  const w = eventWindow(o.eventDate);
  if (!w) return null;
  const symbol = String(o.symbol || "").toUpperCase();
  const pre = atmStraddleFromRows(o.preRows, symbol, w.post);
  if (!pre) return null;
  const postRows = (o.postRows ?? []).filter((r) => r && r.symbol === symbol);
  const spotPost = spotOf(postRows);
  if (!finite(spotPost)) return null;
  const post = straddleAt(postRows, symbol, pre.expiry, pre.strike);
  const preAt = toISTDate(w.pre, "15:30");
  const postAt = toISTDate(w.post, "15:30");
  const tPre = timeToExpiryYears(pre.expiry, preAt);
  const tPost = timeToExpiryYears(pre.expiry, postAt);
  const ivPre = straddleImpliedVol(pre.straddle, pre.spot, pre.strike, tPre);
  // Next expiry in the pre-event rows: shares the event, so the term structure isolates it.
  const next = atmStraddleFromRows(o.preRows, symbol, pre.expiry);
  const tNext = next ? timeToExpiryYears(next.expiry, preAt) : NaN;
  const ivNext = next ? straddleImpliedVol(next.straddle, next.spot, next.strike, tNext) : NaN;
  const ivTerm = termStructureExEventIv(ivPre, tPre, ivNext, tNext);
  const ivPost = post && tPost > 0 ? straddleImpliedVol(post.straddle, spotPost, pre.strike, tPost) : NaN;
  const straddleMovePct = (pre.straddle / pre.spot) * 100;
  const { pct: impliedMovePct, method: impliedMethod } = isolateImpliedMove({ straddleMovePct, ivPre, tPre, tPost, ivTerm, ivPost });
  const signedMovePct = ((spotPost - pre.spot) / pre.spot) * 100;
  const realisedMovePct = Math.abs(signedMovePct);
  const straddlePost = post ? post.straddle : NaN;
  return {
    symbol,
    eventDate: o.eventDate,
    preDate: w.pre,
    postDate: w.post,
    expiry: pre.expiry,
    strike: pre.strike,
    spotPre: pre.spot,
    spotPost,
    straddlePre: pre.straddle,
    straddlePost,
    dte: Math.round((toISTDate(pre.expiry, "15:30").getTime() - preAt.getTime()) / DAY_MS),
    straddleMovePct,
    impliedMovePct,
    impliedMethod,
    realisedMovePct,
    signedMovePct,
    moveRatio: impliedMovePct > 0 ? realisedMovePct / impliedMovePct : NaN,
    overpriced: realisedMovePct < impliedMovePct,
    straddlePnlPct: finite(straddlePost) ? ((straddlePost - pre.straddle) / pre.straddle) * 100 : NaN,
    source: o.source ?? "bhavcopy",
  };
}

function mean(xs: number[]): number {
  const v = xs.filter(finite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
}

export function median(xs: number[]): number {
  const v = xs.filter(finite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Aggregate observations for one symbol. Null when there are none. */
export function summariseEventMoves(obs: EventMoveObservation[]): EventMoveStats | null {
  const list = (Array.isArray(obs) ? obs : []).filter((o) => o && finite(o.impliedMovePct) && finite(o.realisedMovePct));
  if (list.length === 0) return null;
  const overpricedCount = list.filter((o) => o.realisedMovePct < o.impliedMovePct).length;
  const withPost = list.filter((o) => finite(o.straddlePnlPct));
  return {
    symbol: list[0].symbol,
    n: list.length,
    overpricedCount,
    overpricedPct: (overpricedCount / list.length) * 100,
    avgImpliedPct: mean(list.map((o) => o.impliedMovePct)),
    avgRealisedPct: mean(list.map((o) => o.realisedMovePct)),
    medianRatio: median(list.map((o) => o.moveRatio)),
    avgStraddlePnlPct: mean(withPost.map((o) => o.straddlePnlPct)),
    sellerWinPct: withPost.length ? (withPost.filter((o) => o.straddlePnlPct < 0).length / withPost.length) * 100 : NaN,
    maxRealisedPct: Math.max(...list.map((o) => o.realisedMovePct)),
    avgEdgePct: mean(list.map((o) => o.impliedMovePct - o.realisedMovePct)),
    medianDte: median(list.map((o) => o.dte)),
    unisolatedCount: list.filter((o) => o.impliedMethod === "straddle").length,
    source: list.some((o) => o.source === "sample") ? "sample" : "bhavcopy",
  };
}

/** Plain-English verdict for the headline statistic. */
export function overpricedVerdict(s: Pick<EventMoveStats, "n" | "overpricedPct"> & Partial<Pick<EventMoveStats, "unisolatedCount">>): string {
  if (!s || !(s.n > 0)) return "Not enough history";
  if (s.n < 4) return "Too few events to call";
  // When most implied moves still include time value to expiry they lean "overpriced" by construction.
  if ((s.unisolatedCount ?? 0) * 2 > s.n) return "Not comparable: time value to expiry not removed";
  if (s.overpricedPct >= 70) return "Straddles usually overpriced";
  if (s.overpricedPct >= 55) return "Straddles slightly rich";
  if (s.overpricedPct > 45) return "Fairly priced";
  if (s.overpricedPct > 30) return "Straddles slightly cheap";
  return "Straddles usually underpriced";
}

/**
 * Past results dates for a symbol (newest first), from calendar events and any stored history,
 * strictly before `before` and no older than `maxAgeDays`. Only real (NSE) dates count.
 */
export function pastResultsDates(symbol: string, before: string, sources: { events?: MarketEvent[]; stored?: string[] }, maxAgeDays = 760, limit = 12): string[] {
  const sym = String(symbol || "").toUpperCase();
  const oldest = toISTDate(before, "00:00").getTime() - maxAgeDays * 86_400_000;
  const set = new Set<string>();
  for (const e of sources.events ?? []) if (e.kind === "results" && e.source === "nse" && e.symbol === sym) set.add(e.date);
  for (const d of sources.stored ?? []) set.add(d);
  return [...set]
    .filter((d) => isValidIsoDate(d) && d < before && nextTradingDay(d) < before && toISTDate(d, "00:00").getTime() >= oldest)
    .sort()
    .reverse()
    .slice(0, limit);
}

/** Merge newly seen NSE results dates into a stored per-symbol history (bounded, newest kept). */
export function mergeResultsHistory(stored: Record<string, string[]>, events: MarketEvent[], cap = 16): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(stored ?? {})) if (Array.isArray(v)) out[k] = v.filter((d) => typeof d === "string" && isValidIsoDate(d));
  for (const e of events) {
    if (e.kind !== "results" || e.source !== "nse" || !e.symbol) continue;
    const list = out[e.symbol] ?? [];
    if (!list.includes(e.date)) list.push(e.date);
    out[e.symbol] = list.sort().slice(-cap);
  }
  return out;
}

/**
 * SAMPLE observations for a symbol (always `source: "sample"`): the last `count` sample results
 * dates before `before`, a straddle priced with an event-variance bump over the stock's sample IV,
 * a realised move drawn from a symbol-specific distribution, and IV crush after the event.
 * Deterministic for the same inputs.
 */
export function sampleEventMoves(symbol: string, before: string, count = 8): EventMoveObservation[] {
  const sym = String(symbol || "").toUpperCase();
  if (!sym || !isValidIsoDate(before)) return [];
  const from = toISTDate(before, "12:00");
  const startIso = new Date(from.getTime() - 800 * 86_400_000).toISOString().slice(0, 10);
  const dates = sampleResultsEvents({ from: startIso, to: before })
    .filter((e) => e.symbol === sym && nextTradingDay(e.date) < before)
    .map((e) => e.date)
    .sort()
    .slice(-count);
  const baseIv = defaultSampleIv(sym);
  const rand = mulberry32(sampleSeed(sym, "results-moves", 9_173));
  const gauss = gaussianSource(rand);
  const eventMove = 0.025 + 0.035 * rand(); // typical one-day results move (σ of the jump)
  const pricing = 0.6 + 0.45 * rand(); // how richly the market prices the jump for this name (time value to expiry adds on top)
  const step = getStrikeStep(sym);
  let spot = Math.round((300 + 2_700 * rand()) / step) * step;
  const out: EventMoveObservation[] = [];
  for (const eventDate of dates) {
    const w = eventWindow(eventDate);
    if (!w) continue;
    const expiry = getExpiries(sym, toISTDate(w.post, "09:15"), 3).find((e) => e.date > w.post)?.date;
    if (!expiry) continue;
    spot = Math.max(step * 4, Math.round(spot * Math.exp(0.08 * gauss()) * 100) / 100);
    const strike = Math.round(spot / step) * step;
    const tPre = timeToExpiryYears(expiry, toISTDate(w.pre, "15:30"));
    const tPost = timeToExpiryYears(expiry, toISTDate(w.post, "15:30"));
    if (!(tPre > 0)) continue;
    const pricedJump = eventMove * pricing * (1 + 0.15 * gauss());
    const sigmaPre = Math.sqrt((baseIv * baseIv * tPre + pricedJump * pricedJump) / tPre);
    const legs = (S: number, T: number, sigma: number) => straddlePrice(S, strike, T, sigma);
    const straddlePre = Math.round(legs(spot, tPre, sigmaPre) * 20) / 20;
    const jump = eventMove * gauss() + baseIv * Math.sqrt(2 / 252) * gauss();
    const spotPost = Math.round(spot * Math.exp(jump) * 100) / 100;
    const straddlePost = Math.round(legs(spotPost, Math.max(tPost, 0), baseIv * (0.9 + 0.1 * rand())) * 20) / 20;
    const straddleMovePct = (straddlePre / spot) * 100;
    const ivPre = straddleImpliedVol(straddlePre, spot, strike, tPre);
    const ivPost = tPost > 0 ? straddleImpliedVol(straddlePost, spotPost, strike, tPost) : NaN;
    const { pct: impliedMovePct, method: impliedMethod } = isolateImpliedMove({ straddleMovePct, ivPre, tPre, tPost, ivTerm: NaN, ivPost });
    const signedMovePct = ((spotPost - spot) / spot) * 100;
    const realisedMovePct = Math.abs(signedMovePct);
    out.push({
      symbol: sym,
      eventDate,
      preDate: w.pre,
      postDate: w.post,
      expiry,
      strike,
      spotPre: spot,
      spotPost,
      straddlePre,
      straddlePost,
      dte: Math.round((toISTDate(expiry, "15:30").getTime() - toISTDate(w.pre, "15:30").getTime()) / DAY_MS),
      straddleMovePct,
      impliedMovePct,
      impliedMethod,
      realisedMovePct,
      signedMovePct,
      moveRatio: realisedMovePct / impliedMovePct,
      overpriced: realisedMovePct < impliedMovePct,
      straddlePnlPct: ((straddlePost - straddlePre) / straddlePre) * 100,
      source: "sample",
    });
    spot = spotPost;
  }
  return out.reverse();
}
