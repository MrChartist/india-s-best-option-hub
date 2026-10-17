/**
 * Futures term structure, basis, cost of carry, rollover and roll cost. Pure and unit tested.
 *
 * Input is one end-of-day snapshot per symbol and trade date (from the NSE F&O bhavcopy, or the
 * labelled sample generator). Rollover and carry reuse the screener's definitions
 * (rolloverPct, annualisedCarry) and fair value / implied dividend reuse the Futures basis
 * calculator's futuresBasis, so every page agrees on the numbers.
 *
 * Units: prices in rupees (index points for indices), percentages as plain percent.
 */
import { futuresBasis } from "@/components/calculators/calcLogic";
import {
  calendarDaysBetween,
  classifyBuildup,
  getDividendYield,
  getExpiries,
  getLotSize,
  getMarketParams,
  toISTDate,
  tradingDaysBetween,
  addTradingDays,
  isTradingDay,
  previousTradingDay,
  type Buildup,
} from "@/lib/options";
import { annualisedCarry, rolloverPct, BUILDUP_EPS_PCT, type BhavRow } from "@/lib/screener/metrics";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const round = (x: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

export const SERIES_LABELS = ["Near", "Next", "Far"] as const;
export type SeriesLabel = (typeof SERIES_LABELS)[number];

/** One futures contract on one day. */
export interface FutContract {
  expiry: string;
  /** Close price, or settlement price when there was no trade. */
  price: number | null;
  oi: number;
  chgOi: number;
  volume: number;
}

/** One symbol's futures on one trade date (up to three monthly series, nearest first). */
export interface FuturesDay {
  symbol: string;
  /** Trade date, yyyy-mm-dd. */
  date: string;
  underlying: number | null;
  contracts: FutContract[];
}

/**
 * Build a FuturesDay from bhavcopy rows for one symbol and date. Options rows are ignored.
 *
 * NSE's UDiFF bhavcopy reports OpnIntrst, ChngInOpnIntrst and TtlTradgVol in quantity (units),
 * while every futures view (and the sample generator) works in contracts. Rows are therefore
 * divided by the contract's lot size for that expiry. Pass `unit: "contracts"` for input that is
 * already in contracts. When the lot size is unknown the numbers are left as they are.
 */
export function futuresDayFromBhav(
  symbol: string,
  date: string,
  rows: readonly BhavRow[],
  opts: { unit?: "quantity" | "contracts" } = {},
): FuturesDay {
  const fut = rows
    .filter((r) => r && r.type === "FUT" && r.expiry && (!r.symbol || r.symbol === symbol))
    .sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0))
    .slice(0, 3);
  const underlying = rows.map((r) => r.underlyingClose).find((u) => fin(u) && u > 0) ?? null;
  const toContracts = (x: number, expiry: string) => {
    if ((opts.unit ?? "quantity") === "contracts") return x;
    const lot = getLotSize(symbol, expiry);
    return lot && lot > 0 ? Math.round(x / lot) : x;
  };
  return {
    symbol,
    date,
    underlying,
    contracts: fut.map((r) => ({
      expiry: r.expiry,
      price: fin(r.close) && r.close > 0 ? r.close : fin(r.settle) && r.settle > 0 ? r.settle : null,
      oi: fin(r.oi) && r.oi > 0 ? toContracts(r.oi, r.expiry) : 0,
      chgOi: fin(r.chgOi) ? toContracts(r.chgOi, r.expiry) : 0,
      volume: fin(r.volume) && r.volume > 0 ? toContracts(r.volume, r.expiry) : 0,
    })),
  };
}

export interface SeriesView extends FutContract {
  label: SeriesLabel;
  /** Previous session's price for the same contract (null when unknown). */
  prevPrice: number | null;
  priceChg: number | null;
  priceChgPct: number | null;
  /** OI change as % of the previous OI (null when previous OI is 0). */
  oiChgPct: number | null;
  /** Null when the price change is unknown (buildup cannot be classified honestly). */
  buildup: Buildup | null;
  /** Calendar days from the trade date to expiry. */
  dte: number;
  basis: number | null;
  basisPct: number | null;
  /** Simple annualised cost of carry, % a year: (F/S − 1) × 365 / days (same as the screener). */
  carryPct: number | null;
}

export interface RollCost {
  /** Next-month price minus near-month price. */
  points: number;
  /** As % of the near price. */
  pct: number;
  /** Annualised over the days between the two expiries. */
  annualisedPct: number;
}

export interface FairValue {
  fair: number;
  mispricing: number;
  impliedDivYieldPct: number;
  continuousCarryPct: number;
}

export interface FuturesView {
  symbol: string;
  date: string;
  underlying: number | null;
  series: SeriesView[];
  totalOi: number;
  totalChgOi: number;
  totalOiChgPct: number | null;
  /** Share of futures OI in the next and far months, percent. */
  rolloverPct: number | null;
  rollCost: RollCost | null;
  /** Trading days from the trade date to the near expiry (0 on expiry day). */
  tradingDte: number | null;
  /** Near-month fair value and implied dividend yield (futures basis calculator maths). */
  fair: FairValue | null;
}

/** Cost of rolling one unit from the near to the next contract. */
export function rollCost(
  nearPrice: number | null,
  nextPrice: number | null,
  nearExpiry: string,
  nextExpiry: string,
): RollCost | null {
  if (!fin(nearPrice) || !fin(nextPrice) || nearPrice <= 0 || nextPrice <= 0) return null;
  const gap = calendarDaysBetween(nearExpiry, nextExpiry);
  if (!fin(gap) || gap <= 0) return null;
  const points = nextPrice - nearPrice;
  const pct = (points / nearPrice) * 100;
  return { points: round(points, 2), pct: round(pct, 3), annualisedPct: round((pct * 365) / gap, 2) };
}

/** Fair value of the near future from spot (r from market params, q from the dividend table). */
export function nearFairValue(
  symbol: string,
  spot: number | null,
  fut: number | null,
  date: string,
  expiry: string,
): FairValue | null {
  if (!fin(spot) || !fin(fut)) return null;
  const days = Math.max(1, calendarDaysBetween(date, expiry));
  const res = futuresBasis(spot, fut, days / 365, getMarketParams().r, getDividendYield(symbol));
  if (!res.valid) return null;
  return {
    fair: round(res.fair, 2),
    mispricing: round(res.mispricing, 2),
    impliedDivYieldPct: round(res.impliedDivYieldPct, 2),
    continuousCarryPct: round(res.continuousPct, 2),
  };
}

/** Derived view of one day, with price change against the previous day's snapshot when given. */
export function buildFuturesView(day: FuturesDay, prev?: FuturesDay | null): FuturesView {
  const u = fin(day.underlying) && day.underlying > 0 ? day.underlying : null;
  const series: SeriesView[] = day.contracts.slice(0, 3).map((c, i) => {
    const p = prev?.contracts.find((x) => x.expiry === c.expiry);
    const prevPrice = p && fin(p.price) && p.price > 0 ? p.price : null;
    const priceChg = prevPrice !== null && fin(c.price) ? round(c.price - prevPrice, 2) : null;
    const priceChgPct = prevPrice !== null && fin(c.price) ? round(((c.price - prevPrice) / prevPrice) * 100, 2) : null;
    const prevOi = c.oi - c.chgOi;
    const oiChgPct = prevOi > 0 ? round((c.chgOi / prevOi) * 100, 2) : null;
    const dte = Math.max(0, calendarDaysBetween(day.date, c.expiry));
    const basis = u !== null && fin(c.price) ? round(c.price - u, 2) : null;
    return {
      ...c,
      label: SERIES_LABELS[i],
      prevPrice,
      priceChg,
      priceChgPct,
      oiChgPct,
      buildup:
        priceChgPct !== null && oiChgPct !== null ? classifyBuildup(priceChgPct, oiChgPct, BUILDUP_EPS_PCT) : null,
      dte,
      basis,
      basisPct: basis !== null && u ? round((basis / u) * 100, 3) : null,
      carryPct: u !== null && fin(c.price) ? annualisedCarry(c.price, u, dte) : null,
    };
  });
  const totalOi = series.reduce((s, x) => s + x.oi, 0);
  const totalChgOi = series.reduce((s, x) => s + x.chgOi, 0);
  const prevTotal = totalOi - totalChgOi;
  const near = series[0];
  const next = series[1];
  return {
    symbol: day.symbol,
    date: day.date,
    underlying: u,
    series,
    totalOi,
    totalChgOi,
    totalOiChgPct: prevTotal > 0 ? round((totalChgOi / prevTotal) * 100, 2) : null,
    rolloverPct: rolloverPct(series.map((s) => s.oi)),
    rollCost: near && next ? rollCost(near.price, next.price, near.expiry, next.expiry) : null,
    tradingDte: near ? Math.max(0, tradingDaysBetween(day.date, near.expiry)) : null,
    fair: near ? nearFairValue(day.symbol, u, near.price, day.date, near.expiry) : null,
  };
}

/** Views for a run of days (any order in, ascending by date out), each priced against the previous day. */
export function buildViews(days: readonly FuturesDay[]): FuturesView[] {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((d, i) => buildFuturesView(d, i > 0 ? sorted[i - 1] : null));
}

// ── Expiry cycles ──

/** Monthly expiries of a symbol that fall within [fromIso, toIso], ascending. */
export function monthlyExpiriesBetween(symbol: string, fromIso: string, toIso: string): string[] {
  if (!(fromIso <= toIso)) return [];
  const out = new Set<string>();
  let y = +fromIso.slice(0, 4);
  let m = +fromIso.slice(5, 7);
  for (let i = 0; i < 60; i++) {
    const first = `${y}-${String(m).padStart(2, "0")}-01`;
    if (first > toIso) break;
    for (const e of getExpiries(symbol, toISTDate(first, "09:00"), 8)) {
      if (e.type === "monthly" && e.date >= fromIso && e.date <= toIso) out.add(e.date);
    }
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return [...out].sort();
}

/** The `count` monthly expiries strictly before `beforeIso`, most recent first. */
export function previousMonthlyExpiries(symbol: string, beforeIso: string, count = 3): string[] {
  const from = `${+beforeIso.slice(0, 4) - 1}${beforeIso.slice(4, 8)}01`;
  return monthlyExpiriesBetween(symbol, from, beforeIso)
    .filter((e) => e < beforeIso)
    .reverse()
    .slice(0, count);
}

/** The trade date `tdte` trading days before `expiry` (0 = expiry day). */
export function dateAtTradingDte(expiry: string, tdte: number): string {
  const base = isTradingDay(expiry) ? expiry : previousTradingDay(expiry);
  return tdte <= 0 ? base : addTradingDays(base, -Math.round(tdte));
}

export interface Comparable {
  expiry: string;
  date: string;
}

/**
 * For each of the previous `count` monthly cycles, the trade date that was the same number of
 * trading days before that cycle's expiry as `date` is before `currentExpiry`.
 */
export function comparableDates(symbol: string, date: string, currentExpiry: string, count = 3): Comparable[] {
  const tdte = Math.max(0, tradingDaysBetween(date, currentExpiry));
  return previousMonthlyExpiries(symbol, currentExpiry, count).map((expiry) => ({
    expiry,
    date: dateAtTradingDte(expiry, tdte),
  }));
}

export interface RolloverComparison {
  current: number | null;
  average: number | null;
  /** current − average, percentage points. */
  diff: number | null;
  rollCostAnn: number | null;
  rollCostAvgAnn: number | null;
  rollCostDiff: number | null;
  /** How many prior cycles had data. */
  cycles: number;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Rollover % and annualised roll cost now vs the average of comparable prior-cycle days. */
export function compareRollover(
  current: FuturesView | null,
  priors: readonly (FuturesView | null | undefined)[],
): RolloverComparison {
  const ok = priors.filter((p): p is FuturesView => !!p);
  const rolls = ok.map((p) => p.rolloverPct).filter(fin);
  const costs = ok.map((p) => p.rollCost?.annualisedPct).filter(fin);
  const avg = mean(rolls);
  const avgCost = mean(costs);
  const cur = current?.rolloverPct ?? null;
  const curCost = current?.rollCost?.annualisedPct ?? null;
  return {
    current: cur,
    average: avg === null ? null : round(avg, 1),
    diff: cur !== null && avg !== null ? round(cur - avg, 1) : null,
    rollCostAnn: curCost,
    rollCostAvgAnn: avgCost === null ? null : round(avgCost, 2),
    rollCostDiff: curCost !== null && avgCost !== null ? round(curCost - avgCost, 2) : null,
    cycles: Math.max(rolls.length, costs.length),
  };
}

// ── Expiry-week roll tracker ──

export const ROLL_WINDOW = 5;

export interface RollTrackerPoint {
  /** Trading days to expiry (ROLL_WINDOW … 0). */
  tdte: number;
  label: string;
  current: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
  /** Prior-cycle values, most recent cycle first. */
  priors: Array<number | null>;
}

/** "T-3", "Expiry". */
export function tdteLabel(tdte: number): string {
  return tdte <= 0 ? "Expiry" : `T-${tdte}`;
}

/**
 * Rollover % across the final ROLL_WINDOW trading days of the current cycle against the same days
 * of the previous cycles. `views` may hold any days; they are matched by date.
 */
export function rollTracker(
  symbol: string,
  currentExpiry: string,
  views: readonly FuturesView[],
  cycles = 3,
  window = ROLL_WINDOW,
): RollTrackerPoint[] {
  const byDate = new Map(views.map((v) => [v.date, v]));
  const priors = previousMonthlyExpiries(symbol, currentExpiry, cycles);
  const rollOn = (date: string, expiry: string): number | null => {
    const v = byDate.get(date);
    // The snapshot must belong to that cycle: its near contract is that expiry.
    if (!v || v.series[0]?.expiry !== expiry) return null;
    return v.rolloverPct;
  };
  const out: RollTrackerPoint[] = [];
  for (let t = window; t >= 0; t--) {
    const pv = priors.map((e) => rollOn(dateAtTradingDte(e, t), e));
    const vals = pv.filter(fin);
    const avg = mean(vals);
    out.push({
      tdte: t,
      label: tdteLabel(t),
      current: rollOn(dateAtTradingDte(currentExpiry, t), currentExpiry),
      average: avg === null ? null : round(avg, 1),
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
      priors: pv,
    });
  }
  return out;
}

/**
 * Trade dates worth fetching to fill the page for one symbol: the last `sessions` sessions to
 * `latest`, the comparable day of each prior cycle, and the roll window of each prior cycle.
 * Newest first, de-duplicated, never after `latest`.
 */
export function historyDatesFor(
  symbol: string,
  latest: string,
  currentExpiry: string,
  sessions = 15,
  cycles = 3,
  window = ROLL_WINDOW,
): string[] {
  const set = new Set<string>();
  let d = isTradingDay(latest) ? latest : previousTradingDay(latest);
  for (let i = 0; i < sessions; i++) {
    set.add(d);
    d = previousTradingDay(d);
  }
  for (const c of comparableDates(symbol, latest, currentExpiry, cycles)) set.add(c.date);
  for (const e of previousMonthlyExpiries(symbol, currentExpiry, cycles))
    for (let t = 0; t <= window; t++) set.add(dateAtTradingDte(e, t));
  for (let t = 0; t <= window; t++) set.add(dateAtTradingDte(currentExpiry, t));
  return [...set]
    .filter((x) => x <= latest)
    .sort()
    .reverse();
}

// ── Chart rows ──

export interface OiPricePoint {
  date: string;
  near: number;
  next: number;
  far: number;
  total: number;
  /** Near-month futures price. */
  price: number | null;
  underlying: number | null;
}

/** Futures OI by series and the near price per day (ascending), for the OI vs price chart. */
export function oiPriceSeries(views: readonly FuturesView[], last = 20): OiPricePoint[] {
  return [...views]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-last)
    .map((v) => ({
      date: v.date,
      near: v.series[0]?.oi ?? 0,
      next: v.series[1]?.oi ?? 0,
      far: v.series[2]?.oi ?? 0,
      total: v.totalOi,
      price: v.series[0]?.price ?? null,
      underlying: v.underlying,
    }));
}

/** Plain-English read of the near series' buildup and the rollover against its average. */
export function rolloverRead(cmp: RolloverComparison): string {
  if (cmp.current === null) return "Rollover is not available for this day.";
  if (cmp.average === null || cmp.diff === null)
    return `Rollover is ${cmp.current.toFixed(1)}%. Load history to compare it with the last three expiries.`;
  const dir = Math.abs(cmp.diff) < 2 ? "in line with" : cmp.diff > 0 ? "ahead of" : "behind";
  const cost =
    cmp.rollCostDiff === null
      ? ""
      : Math.abs(cmp.rollCostDiff) < 0.5
        ? " Rolling costs about the usual."
        : cmp.rollCostDiff > 0
          ? " Rolls are costing more than usual, which points to longs carrying positions forward."
          : " Rolls are cheaper than usual, which points to shorts carrying positions forward or weak demand.";
  return `Rollover of ${cmp.current.toFixed(1)}% is ${dir} the ${cmp.cycles}-expiry average of ${cmp.average.toFixed(1)}% for the same point in the cycle.${cost}`;
}
