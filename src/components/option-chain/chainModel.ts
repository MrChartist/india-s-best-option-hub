/**
 * Pure option-chain view model: enriched IV/Greeks, real rho, probabilities, liquidity,
 * buildup, chain-level summary stats, strike-range slicing and delta targets.
 * No React and no DOM here, so it is unit tested in isolation (chainModel.test.ts).
 */
import type { OptionData } from "@/lib/mockData";
import type { OptionLegDataExt } from "@/lib/types/market";
import {
  atmIV,
  chainForward,
  classifyBuildup,
  enrichChain,
  expectedMoveFromIV,
  expectedMoveFromStraddle,
  findATMStrike,
  getDividendYield,
  getMarketParams,
  greeks,
  legMid,
  maxPain as computeMaxPain,
  modalStrikeStep,
  probITM,
  probTouch,
  syntheticFuture,
  timeToExpiryYears,
  type Buildup,
  type OptionType,
} from "@/lib/options";

const pos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export interface LegView {
  /** Enriched leg (IV and Greeks filled where the feed sent zeros). */
  leg: OptionLegDataExt;
  type: OptionType;
  mid: number;
  /** True when IV was solved locally (the feed sent 0). */
  ivDerived: boolean;
  /** True when delta/gamma/theta/vega were computed locally. */
  greeksDerived: boolean;
  /** Spot-based Black-Scholes rho, rupees per 1% rate change. NaN without IV. */
  rho: number;
  spread: number;
  /** Bid-ask spread as % of mid. NaN without a two-sided quote. */
  spreadPct: number;
  probITM: number;
  probTouch: number;
  /** OI change as % of the previous OI. NaN when previous OI is 0. */
  oiChgPct: number;
  /** LTP change in rupees vs previous close (null when the feed does not send it). */
  ltpChg: number | null;
  ltpChgPct: number | null;
  /** Null when the feed has no price change (buildup cannot be classified honestly). */
  buildup: Buildup | null;
  /** 1 (illiquid) to 5 (very liquid); 0 when there is no trading at all. */
  liquidity: number;
  /** Premium traded today in rupees = volume × lot size × LTP (volume in contracts). */
  premiumTraded: number;
  itm: boolean;
}

export interface RowView {
  strike: number;
  ce: LegView;
  pe: LegView;
}

export interface ChainTotals {
  ceOi: number;
  peOi: number;
  ceOiChg: number;
  peOiChg: number;
  ceVol: number;
  peVol: number;
  cePremium: number;
  pePremium: number;
}

export interface ChainModel {
  rows: RowView[];
  spot: number;
  forward: number;
  /** Years to the 15:30 IST expiry. */
  T: number;
  r: number;
  atmStrike: number;
  step: number;
  /** ATM IV in percent (NaN when unknown). */
  atmIv: number;
  straddle: { strike: number; ce: number; pe: number; straddle: number; straddlePct: number };
  synthFuture: number;
  expectedMove: { move: number; upper: number; lower: number; pct: number };
  pcrOi: number;
  pcrChgOi: number;
  pcrVol: number;
  totals: ChainTotals;
  maxPain: number;
  maxOiStrike: { ce: number; pe: number };
  maxVolStrike: { ce: number; pe: number };
  /** Largest single-leg OI / volume / |OI change| (bar scaling). */
  maxOi: number;
  maxVol: number;
  maxAbsOiChg: number;
  /** True when any IV or Greek was derived locally. */
  anyDerived: boolean;
}

export interface BuildModelOptions {
  spot: number;
  expiry: string;
  lotSize: number;
  symbol?: string;
  now?: Date;
  /** Precomputed max pain from the hook (falls back to computing it). */
  maxPain?: number;
}

/** Spread score: tight quotes score high. */
function spreadScore(spreadPct: number): number {
  if (!fin(spreadPct)) return 1;
  if (spreadPct <= 1) return 5;
  if (spreadPct <= 2.5) return 4;
  if (spreadPct <= 5) return 3;
  if (spreadPct <= 10) return 2;
  return 1;
}

/**
 * Liquidity score 1-5 from the bid-ask spread % and the leg's volume rank within its side of the
 * chain (0..1). Returns 0 when the leg has no volume, no OI and no quote.
 */
export function liquidityScore(spreadPct: number, volumeRank: number, hasActivity: boolean): number {
  if (!hasActivity) return 0;
  const vr = fin(volumeRank) ? Math.min(Math.max(volumeRank, 0), 1) : 0;
  const volScore = 1 + Math.round(vr * 4);
  const score = Math.round(0.55 * spreadScore(spreadPct) + 0.45 * volScore);
  return Math.min(5, Math.max(1, score));
}

/** Rank (0..1) of each value within the list; zeros rank 0. */
function percentileRanks(values: number[]): number[] {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return values.map(() => 0);
  return values.map((v) => {
    if (!(v > 0)) return 0;
    // index of last element <= v
    let lo = 0;
    let hi = nonZero.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (nonZero[mid] <= v) lo = mid;
      else hi = mid - 1;
    }
    return nonZero.length === 1 ? 1 : lo / (nonZero.length - 1);
  });
}

function emptyLeg(): OptionLegDataExt {
  return { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
}

function buildLeg(
  raw: OptionLegDataExt,
  orig: OptionLegDataExt,
  type: OptionType,
  K: number,
  ctx: { spot: number; F: number; T: number; r: number; q: number; lotSize: number },
  volumeRank: number,
): LegView {
  const leg = raw ?? emptyLeg();
  const mid = legMid(leg);
  const sigma = pos(leg.iv) ? leg.iv / 100 : NaN;
  const ivDerived = !pos(orig?.iv) && pos(leg.iv);
  const greeksDerived = (orig?.delta ?? 0) === 0 && fin(leg.delta) && leg.delta !== 0;
  let rho = NaN;
  if (pos(sigma) && pos(ctx.spot) && pos(ctx.T)) {
    rho = greeks({ S: ctx.spot, K, T: ctx.T, r: ctx.r, q: ctx.q, sigma, type }).rho;
  }
  const twoSided = pos(leg.bidPrice) && pos(leg.askPrice) && leg.askPrice >= leg.bidPrice;
  const spread = twoSided ? leg.askPrice - leg.bidPrice : NaN;
  const spreadPct = twoSided && mid > 0 ? (spread / mid) * 100 : NaN;
  const pIn = pos(sigma) && pos(ctx.F) && pos(ctx.T) ? probITM({ F: ctx.F, K, T: ctx.T, sigma, type }) : NaN;
  const pTouch = pos(sigma) && pos(ctx.F) && pos(ctx.T) ? probTouch({ F: ctx.F, K, T: ctx.T, sigma, type }) : NaN;
  const prevOi = (leg.oi ?? 0) - (leg.oiChange ?? 0);
  const oiChgPct = prevOi > 0 ? ((leg.oiChange ?? 0) / prevOi) * 100 : NaN;
  const ltpChg = fin(leg.change) ? leg.change : null;
  let ltpChgPct: number | null = fin(leg.pChange) ? leg.pChange : null;
  if (ltpChgPct === null && ltpChg !== null && pos(leg.ltp) && leg.ltp - ltpChg > 0) {
    ltpChgPct = (ltpChg / (leg.ltp - ltpChg)) * 100;
  }
  const priceChange = ltpChg ?? ltpChgPct;
  const buildup = priceChange !== null && fin(leg.oiChange) ? classifyBuildup(priceChange, leg.oiChange) : null;
  const hasActivity = (leg.volume ?? 0) > 0 || (leg.oi ?? 0) > 0 || twoSided;
  const itm = pos(ctx.spot) ? (type === "CE" ? K < ctx.spot : K > ctx.spot) : false;
  return {
    leg,
    type,
    mid,
    ivDerived,
    greeksDerived,
    rho,
    spread,
    spreadPct,
    probITM: pIn,
    probTouch: pTouch,
    oiChgPct,
    ltpChg,
    ltpChgPct,
    buildup,
    liquidity: liquidityScore(spreadPct, volumeRank, hasActivity),
    premiumTraded: (leg.volume ?? 0) * (pos(ctx.lotSize) ? ctx.lotSize : 1) * (leg.ltp ?? 0),
    itm,
  };
}

function argMax<T>(xs: T[], f: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bestV = -Infinity;
  for (const x of xs) {
    const v = f(x);
    if (v > bestV) {
      bestV = v;
      best = x;
    }
  }
  return bestV > 0 ? best : undefined;
}

/** Build the full chain view model. Never throws; an empty chain yields an empty model. */
export function buildChainModel(chain: OptionData[], o: BuildModelOptions): ChainModel {
  const now = o.now ?? new Date();
  const spot = pos(o.spot) ? o.spot : NaN;
  const sorted = (Array.isArray(chain) ? chain : [])
    .filter((r) => r && pos(r.strikePrice))
    .slice()
    .sort((a, b) => a.strikePrice - b.strikePrice);
  const params = getMarketParams();
  const r = params.r;
  const q = o.symbol ? getDividendYield(o.symbol) : 0;
  const T = timeToExpiryYears(o.expiry ?? "", now);
  const F = sorted.length > 0 && pos(spot) && pos(T) ? chainForward(sorted, spot, T, r, q) : spot;
  const enriched = sorted.length > 0 && pos(spot) ? enrichChain(sorted, { spot, expiry: o.expiry, now, r, q, forward: pos(F) ? F : undefined }) : sorted;

  const ceRanks = percentileRanks(enriched.map((x) => x.ce?.volume ?? 0));
  const peRanks = percentileRanks(enriched.map((x) => x.pe?.volume ?? 0));
  const ctx = { spot, F, T, r, q, lotSize: o.lotSize };

  const rows: RowView[] = enriched.map((row, i) => ({
    strike: row.strikePrice,
    ce: buildLeg(row.ce as OptionLegDataExt, sorted[i].ce as OptionLegDataExt, "CE", row.strikePrice, ctx, ceRanks[i]),
    pe: buildLeg(row.pe as OptionLegDataExt, sorted[i].pe as OptionLegDataExt, "PE", row.strikePrice, ctx, peRanks[i]),
  }));

  const totals: ChainTotals = { ceOi: 0, peOi: 0, ceOiChg: 0, peOiChg: 0, ceVol: 0, peVol: 0, cePremium: 0, pePremium: 0 };
  let maxOi = 0;
  let maxVol = 0;
  let maxAbsOiChg = 0;
  let anyDerived = false;
  for (const rv of rows) {
    totals.ceOi += rv.ce.leg.oi || 0;
    totals.peOi += rv.pe.leg.oi || 0;
    totals.ceOiChg += rv.ce.leg.oiChange || 0;
    totals.peOiChg += rv.pe.leg.oiChange || 0;
    totals.ceVol += rv.ce.leg.volume || 0;
    totals.peVol += rv.pe.leg.volume || 0;
    totals.cePremium += rv.ce.premiumTraded;
    totals.pePremium += rv.pe.premiumTraded;
    maxOi = Math.max(maxOi, rv.ce.leg.oi || 0, rv.pe.leg.oi || 0);
    maxVol = Math.max(maxVol, rv.ce.leg.volume || 0, rv.pe.leg.volume || 0);
    maxAbsOiChg = Math.max(maxAbsOiChg, Math.abs(rv.ce.leg.oiChange || 0), Math.abs(rv.pe.leg.oiChange || 0));
    if (rv.ce.ivDerived || rv.pe.ivDerived || rv.ce.greeksDerived || rv.pe.greeksDerived) anyDerived = true;
  }

  const atmStrike = enriched.length > 0 ? findATMStrike(enriched, spot) : NaN;
  const step = enriched.length > 1 ? modalStrikeStep(enriched, spot) : 50;
  const atmRow = rows.find((x) => x.strike === atmStrike);
  const ceMid = atmRow ? atmRow.ce.mid : NaN;
  const peMid = atmRow ? atmRow.pe.mid : NaN;
  const straddleVal = ceMid > 0 && peMid > 0 ? ceMid + peMid : NaN;
  const straddle = {
    strike: atmStrike,
    ce: ceMid,
    pe: peMid,
    straddle: straddleVal,
    straddlePct: pos(straddleVal) && pos(spot) ? (straddleVal / spot) * 100 : NaN,
  };
  const em = pos(straddleVal) && pos(spot) ? expectedMoveFromStraddle(straddleVal, spot) : { move: NaN, upper: NaN, lower: NaN, pct: NaN };
  const mp = fin(o.maxPain) && (o.maxPain as number) > 0 ? (o.maxPain as number) : enriched.length > 0 ? computeMaxPain(enriched) : NaN;

  return {
    rows,
    spot,
    forward: F,
    T,
    r,
    atmStrike,
    step,
    atmIv: enriched.length > 0 ? atmIV(enriched, pos(F) ? F : spot) : NaN,
    straddle,
    synthFuture: enriched.length > 0 ? syntheticFuture(enriched, spot) : NaN,
    expectedMove: em,
    pcrOi: totals.ceOi > 0 ? totals.peOi / totals.ceOi : NaN,
    // Same rule as oiUtils.calculatePCR: a ΔOI ratio is only meaningful when both sides added OI.
    // With call OI unwinding the ratio turns negative, and near zero it explodes.
    pcrChgOi: totals.ceOiChg > 0 && totals.peOiChg > 0 ? totals.peOiChg / totals.ceOiChg : NaN,
    pcrVol: totals.ceVol > 0 ? totals.peVol / totals.ceVol : NaN,
    totals,
    maxPain: mp,
    maxOiStrike: { ce: argMax(rows, (x) => x.ce.leg.oi || 0)?.strike ?? NaN, pe: argMax(rows, (x) => x.pe.leg.oi || 0)?.strike ?? NaN },
    maxVolStrike: { ce: argMax(rows, (x) => x.ce.leg.volume || 0)?.strike ?? NaN, pe: argMax(rows, (x) => x.pe.leg.volume || 0)?.strike ?? NaN },
    maxOi,
    maxVol,
    maxAbsOiChg,
    anyDerived,
  };
}

export type StrikeRange = 10 | 15 | 20 | 30 | "all";
export const STRIKE_RANGES: StrikeRange[] = [10, 15, 20, 30, "all"];

/** Rows within ±n strikes of the ATM strike (by position), or all rows. */
export function sliceAroundATM<T extends { strike: number }>(rows: T[], atmStrike: number, range: StrikeRange): T[] {
  if (range === "all" || rows.length === 0) return rows;
  let idx = rows.findIndex((x) => x.strike === atmStrike);
  if (idx < 0) {
    // nearest strike
    let best = 0;
    for (let i = 1; i < rows.length; i++) if (Math.abs(rows[i].strike - atmStrike) < Math.abs(rows[best].strike - atmStrike)) best = i;
    idx = best;
  }
  return rows.slice(Math.max(0, idx - range), Math.min(rows.length, idx + range + 1));
}

/** Index after which the spot divider goes (spot lies between rows[i] and rows[i+1]); −1 = above the first row. */
export function spotDividerIndex(rows: Array<{ strike: number }>, spot: number): number {
  if (!pos(spot) || rows.length === 0) return -2;
  if (spot < rows[0].strike) return -1;
  for (let i = 0; i < rows.length - 1; i++) if (spot >= rows[i].strike && spot < rows[i + 1].strike) return i;
  return rows.length - 1;
}

export interface DeltaTargets {
  ce16: number;
  ce30: number;
  pe16: number;
  pe30: number;
}

/** Strikes whose |delta| is closest to 0.16 and 0.30 on each side (NaN when no deltas). */
export function deltaTargets(rows: RowView[]): DeltaTargets {
  const nearest = (side: "ce" | "pe", target: number) => {
    let best = NaN;
    let bestD = Infinity;
    for (const r of rows) {
      const d = Math.abs(r[side].leg.delta);
      if (!(d > 0) || !Number.isFinite(d)) continue;
      const diff = Math.abs(d - target);
      if (diff < bestD) {
        bestD = diff;
        best = r.strike;
      }
    }
    return bestD <= 0.08 ? best : NaN;
  };
  return { ce16: nearest("ce", 0.16), ce30: nearest("ce", 0.3), pe16: nearest("pe", 0.16), pe30: nearest("pe", 0.3) };
}

/**
 * 1σ move in points to expiry from ATM IV. Delegates to expectedMoveFromIV so the ±1σ strangle
 * here and the expected-move widgets share one definition: the half-width of the log-normal band,
 * (F·e^{σ√T} − F·e^{−σ√T}) / 2 = F·sinh(σ√T). NaN when unknown.
 */
export function oneSigmaPoints(model: Pick<ChainModel, "forward" | "spot" | "atmIv" | "T">): number {
  const F = pos(model.forward) ? model.forward : model.spot;
  if (!pos(F) || !pos(model.atmIv) || !pos(model.T)) return NaN;
  return expectedMoveFromIV(F, model.atmIv / 100, model.T).move;
}

/** Nearest available strike to a target price. */
export function nearestStrike(rows: Array<{ strike: number }>, target: number): number {
  if (rows.length === 0 || !fin(target)) return NaN;
  let best = rows[0].strike;
  for (const r of rows) if (Math.abs(r.strike - target) < Math.abs(best - target)) best = r.strike;
  return best;
}

/** CSV of the chain model (all rows, both sides). */
export function chainToCSV(rows: RowView[]): string {
  const head = [
    "Strike",
    ...["CE", "PE"].flatMap((s) => [
      `${s}_LTP`, `${s}_Chg`, `${s}_Bid`, `${s}_Ask`, `${s}_Spread%`, `${s}_IV%`, `${s}_IV_Derived`, `${s}_Delta`, `${s}_Gamma`, `${s}_Theta`, `${s}_Vega`, `${s}_Rho`,
      `${s}_OI`, `${s}_OI_Chg`, `${s}_Volume`, `${s}_ProbITM`, `${s}_ProbTouch`, `${s}_Buildup`, `${s}_Liquidity`, `${s}_PremiumTraded`,
    ]),
  ];
  const n = (v: number | null | undefined, dp = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "" : Number(v.toFixed(dp)).toString());
  const legCols = (l: LegView) => [
    n(l.leg.ltp), n(l.ltpChg), n(l.leg.bidPrice), n(l.leg.askPrice), n(l.spreadPct), n(l.leg.iv), l.ivDerived ? "Y" : "", n(l.leg.delta, 4), n(l.leg.gamma, 6), n(l.leg.theta), n(l.leg.vega), n(l.rho),
    n(l.leg.oi, 0), n(l.leg.oiChange, 0), n(l.leg.volume, 0), n(l.probITM, 4), n(l.probTouch, 4), l.buildup ?? "", String(l.liquidity), n(l.premiumTraded, 0),
  ];
  const lines = rows.map((r) => [n(r.strike), ...legCols(r.ce), ...legCols(r.pe)].join(","));
  return [head.join(","), ...lines].join("\n");
}

export const BUILDUP_SHORT: Record<Buildup, string> = {
  LONG_BUILDUP: "LB",
  SHORT_BUILDUP: "SB",
  SHORT_COVERING: "SC",
  LONG_UNWINDING: "LU",
  NEUTRAL: "—",
};
