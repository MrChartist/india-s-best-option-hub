/**
 * OI analysis utilities.
 *
 * Pure functions over an option chain (OptionData[]) and over recorded chain snapshots. Pricing,
 * ATM, max pain and buildup maths come from the shared core in "@/lib/options"; this module adds the
 * OI-specific aggregates (PCR family, ATM zone, OI walls, writer delta exposure, buildup quadrant,
 * intraday series) on top of it. Nothing here touches the DOM, the network or IndexedDB.
 *
 * Conventions
 * - OI and OI change are in whatever unit the source sends (contracts for NSE, quantity for Dhan);
 *   ratios are unit-free. Writer delta exposure converts to lots when told the unit.
 * - CE OI = call writers = resistance (bearish colour). PE OI = put writers = support (bullish colour).
 * - Ratios that cannot be computed (division by zero) are 0 in the legacy fields and null in the new
 *   optional fields, so the UI can show "—" instead of a fabricated number.
 */
import {
  BUILDUP_LABEL,
  atmIV,
  atmStraddle,
  chainForward,
  classifyBuildup,
  expectedMoveFromIV,
  expectedMoveFromStraddle,
  findATMStrike,
  formatStrike,
  istDateString,
  legIV,
  maxPain,
  maxPainCurve,
  modalStrikeStep,
  timeToExpiryYears,
  type Buildup,
  type OptionType,
} from "@/lib/options";
import type { OptionData, OptionLegData } from "./mockData";
import type { ChainSnapshot } from "./snapshotStore";

export type { OptionData, OptionLegData } from "./mockData";
export type { Buildup } from "@/lib/options";
export { BUILDUP_LABEL };

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const pos = (x: unknown): x is number => finite(x) && x > 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (x: unknown): number => (finite(x) ? x : 0);

function sortedChain(chain: OptionData[]): OptionData[] {
  return (Array.isArray(chain) ? chain : [])
    .filter((r) => r && pos(r.strikePrice))
    .slice()
    .sort((a, b) => a.strikePrice - b.strikePrice);
}

// ── Relative thresholds ──

/** Largest single-leg OI in the chain (0 for an empty chain). */
export function maxLegOI(chain: OptionData[]): number {
  let m = 0;
  for (const r of chain ?? []) m = Math.max(m, num(r?.ce?.oi), num(r?.pe?.oi));
  return m;
}

/** Default share of the largest leg OI a strike needs to be charted (5%). */
export const SIGNIFICANT_OI_FRACTION = 0.05;

/**
 * Strikes where either leg holds at least `fraction` of the largest leg OI. Relative, so it works
 * the same for NIFTY (crores of units) and a thin stock chain (a few thousand contracts).
 */
export function significantStrikes(chain: OptionData[], fraction: number = SIGNIFICANT_OI_FRACTION): OptionData[] {
  const rows = sortedChain(chain);
  const maxOI = maxLegOI(rows);
  if (maxOI <= 0) return [];
  const cut = Math.max(0, fraction) * maxOI;
  return rows.filter((r) => Math.max(num(r.ce.oi), num(r.pe.oi)) >= cut && Math.max(num(r.ce.oi), num(r.pe.oi)) > 0);
}

// ── Max pain ──

/** Max pain strike (delegates to the shared core). 0 for an empty chain. */
export function getMaxPain(chain: OptionData[]): number {
  const mp = maxPain(Array.isArray(chain) ? chain : []);
  return finite(mp) ? mp : 0;
}

export { maxPainCurve };

// ── Buildup ──

/** Day price change of a leg: `change`, else from `pChange`/`prevClose`. NaN when unknown. */
export function legPriceChange(leg: OptionLegData | undefined): number {
  if (!leg) return NaN;
  if (finite(leg.change)) return leg.change;
  if (pos(leg.prevClose) && finite(leg.ltp)) return leg.ltp - leg.prevClose;
  if (finite(leg.pChange) && pos(leg.ltp) && leg.pChange > -100) return leg.ltp - leg.ltp / (1 + leg.pChange / 100);
  return NaN;
}

/** Day price change of a leg in percent. NaN when unknown. */
export function legPriceChangePct(leg: OptionLegData | undefined): number {
  if (!leg) return NaN;
  if (finite(leg.pChange)) return leg.pChange;
  const chg = legPriceChange(leg);
  const prev = pos(leg.prevClose) ? leg.prevClose : finite(chg) && pos(leg.ltp) ? leg.ltp - chg : NaN;
  return finite(chg) && pos(prev) ? (chg / prev) * 100 : NaN;
}

/** OI change in percent of the previous OI (oi − oiChange). NaN when the previous OI is not positive. */
export function legOIChangePct(leg: OptionLegData | undefined): number {
  if (!leg || !finite(leg.oi) || !finite(leg.oiChange)) return NaN;
  const prev = leg.oi - leg.oiChange;
  return prev > 0 ? (leg.oiChange / prev) * 100 : NaN;
}

/**
 * Buildup of one leg from its price change and OI change. The same rule applies to CE and PE:
 * price ↑ OI ↑ long build-up, price ↓ OI ↑ short build-up, price ↑ OI ↓ short covering,
 * price ↓ OI ↓ long unwinding. NEUTRAL when the price change is unknown or either change is zero.
 */
export function getBuildup(leg: OptionLegData | undefined): Buildup {
  if (!leg) return "NEUTRAL";
  return classifyBuildup(legPriceChange(leg), num(leg.oiChange));
}

/** Badge variant for a buildup (theme spec: LB bullish, SB bearish, SC info, LU warning). */
export function buildupTone(b: Buildup): "bullish" | "bearish" | "info" | "warning" | "neutral" {
  switch (b) {
    case "LONG_BUILDUP":
      return "bullish";
    case "SHORT_BUILDUP":
      return "bearish";
    case "SHORT_COVERING":
      return "info";
    case "LONG_UNWINDING":
      return "warning";
    default:
      return "neutral";
  }
}

export const BUILDUP_SHORT: Record<Buildup, string> = {
  LONG_BUILDUP: "LB",
  SHORT_BUILDUP: "SB",
  SHORT_COVERING: "SC",
  LONG_UNWINDING: "LU",
  NEUTRAL: "—",
};

/** Two-letter build-up code for BuildupBadge; null for NEUTRAL (nothing to badge). */
export function buildupCode(b: Buildup): "LB" | "SB" | "SC" | "LU" | null {
  switch (b) {
    case "LONG_BUILDUP":
      return "LB";
    case "SHORT_BUILDUP":
      return "SB";
    case "SHORT_COVERING":
      return "SC";
    case "LONG_UNWINDING":
      return "LU";
    default:
      return null;
  }
}

export interface BuildupPoint {
  strike: number;
  side: "CE" | "PE";
  /** % premium change (x axis). */
  pricePct: number;
  /** % OI change vs previous OI (y axis). */
  oiPct: number;
  oi: number;
  oiChange: number;
  buildup: Buildup;
}

/**
 * Points for the buildup quadrant scatter (x = % premium change, y = % OI change), one per leg with
 * a known price change and a positive previous OI. Legs below `minOIFraction` of the largest OI are
 * dropped so illiquid far strikes do not dominate the axes.
 */
export function buildupQuadrantPoints(chain: OptionData[], minOIFraction = 0.02): BuildupPoint[] {
  const rows = sortedChain(chain);
  const cut = maxLegOI(rows) * Math.max(0, minOIFraction);
  const out: BuildupPoint[] = [];
  for (const r of rows) {
    for (const side of ["CE", "PE"] as const) {
      const leg = side === "CE" ? r.ce : r.pe;
      if (!leg || num(leg.oi) <= 0 || num(leg.oi) < cut) continue;
      const pricePct = legPriceChangePct(leg);
      const oiPct = legOIChangePct(leg);
      if (!finite(pricePct) || !finite(oiPct)) continue;
      out.push({ strike: r.strikePrice, side, pricePct: r2(pricePct), oiPct: r2(oiPct), oi: leg.oi, oiChange: num(leg.oiChange), buildup: classifyBuildup(pricePct, oiPct) });
    }
  }
  return out;
}

/** Count of points per buildup quadrant. */
export function buildupCounts(points: BuildupPoint[]): Record<Buildup, number> {
  const c: Record<Buildup, number> = { LONG_BUILDUP: 0, SHORT_BUILDUP: 0, SHORT_COVERING: 0, LONG_UNWINDING: 0, NEUTRAL: 0 };
  for (const p of points) c[p.buildup]++;
  return c;
}

// ── Writer delta exposure (formerly "Delta OI") ──

export interface DeltaOIData {
  strike: number;
  /** Call writers' delta, in lots (negative: short calls are short delta). */
  ceDeltaOI: number;
  /** Put writers' delta, in lots (positive: short puts are long delta). */
  peDeltaOI: number;
  /** Net writer delta in lots. Positive = writers net long (they defend downside), negative = short. */
  netDeltaOI: number;
}

/**
 * Writer delta exposure per strike, in lots: −OI × delta for each leg (option writers hold the
 * opposite side of the buyers). OI in quantity is divided by `lotSize`; OI in contracts is already
 * lots. Strikes below 5% of the largest leg OI are skipped. Legs with no delta contribute 0.
 */
export function getDeltaOI(
  chain: OptionData[],
  _spotPrice?: number,
  _stepSize?: number,
  opts: { oiUnit?: "contracts" | "qty"; lotSize?: number; fraction?: number } = {},
): DeltaOIData[] {
  const div = opts.oiUnit === "qty" && pos(opts.lotSize) ? opts.lotSize : 1;
  return significantStrikes(chain, opts.fraction ?? SIGNIFICANT_OI_FRACTION).map((o) => {
    const ce = -(num(o.ce.oi) * num(o.ce.delta)) / div;
    const pe = -(num(o.pe.oi) * num(o.pe.delta)) / div;
    return { strike: o.strikePrice, ceDeltaOI: Math.round(ce), peDeltaOI: Math.round(pe), netDeltaOI: Math.round(ce + pe) };
  });
}

/** Alias with the descriptive name. */
export const getWriterDeltaExposure = getDeltaOI;

// ── Strike-wise PCR ──

export interface StrikePCRData {
  strike: number;
  pcr: number;
  ceOI: number;
  peOI: number;
  /** Distance from spot in percent. */
  distance: number;
}

/** PCR per strike for strikes where both legs hold at least `fraction` of the largest leg OI. */
export function getStrikePCR(chain: OptionData[], spotPrice: number, fraction: number = SIGNIFICANT_OI_FRACTION): StrikePCRData[] {
  const rows = sortedChain(chain);
  const cut = maxLegOI(rows) * Math.max(0, fraction);
  return rows
    .filter((o) => num(o.ce.oi) > 0 && num(o.pe.oi) > 0 && o.ce.oi >= cut && o.pe.oi >= cut)
    .map((o) => ({
      strike: o.strikePrice,
      pcr: r2(o.pe.oi / o.ce.oi),
      ceOI: o.ce.oi,
      peOI: o.pe.oi,
      distance: pos(spotPrice) ? r2(((o.strikePrice - spotPrice) / spotPrice) * 100) : 0,
    }));
}

// ── PCR signal ──

export type PCRTone = "bullish" | "bearish" | "neutral" | "warning";
export type PCRBand = "call-heavy" | "balanced" | "put-heavy" | "extreme-put";

export interface PCRSignal {
  band: PCRBand;
  label: string;
  tone: PCRTone;
  /** Tailwind text colour class for the tone. */
  className: string;
  description: string;
}

/** Band edges used by pcrSignal (exported for charts). */
export const PCR_BANDS = { low: 0.7, high: 1.2, extreme: 1.6 } as const;

const TONE_CLASS: Record<PCRTone, string> = {
  bullish: "text-bullish",
  bearish: "text-bearish",
  neutral: "text-muted-foreground",
  warning: "text-warning",
};

/**
 * The single OI-PCR reading used across the app.
 *
 * - below 0.7: call-heavy. Call writers dominate, resistance overhead, bearish tilt.
 * - 0.7 to 1.2: balanced. No strong tilt from OI alone.
 * - above 1.2 up to 1.6: put-heavy. Put writers defending lower strikes, supportive.
 * - above 1.6: extreme put-heavy. Crowded and often contrarian; supports can give way sharply.
 *
 * Non-finite or non-positive input returns the balanced band with a "No data" label.
 */
export function pcrSignal(pcr: number): PCRSignal {
  const mk = (band: PCRBand, label: string, tone: PCRTone, description: string): PCRSignal => ({ band, label, tone, className: TONE_CLASS[tone], description });
  if (!pos(pcr)) return mk("balanced", "No data", "neutral", "PCR needs open interest on both calls and puts.");
  if (pcr < PCR_BANDS.low) return mk("call-heavy", "Call heavy · bearish tilt", "bearish", "Call writers dominate. Resistance is building overhead.");
  if (pcr <= PCR_BANDS.high) return mk("balanced", "Balanced", "neutral", "No strong directional tilt from open interest alone.");
  if (pcr <= PCR_BANDS.extreme) return mk("put-heavy", "Put heavy · supportive", "bullish", "Put writers are defending lower strikes. Supportive for now.");
  return mk("extreme-put", "Extreme · contrarian watch", "warning", "Put writing looks crowded. Extremes often precede reversals; treat as a contrarian warning.");
}

// ── Chain-wide PCR family ──

export interface PCRResult {
  pcrOI: number;
  pcrVolume: number;
  /** ΣPE ΔOI ÷ ΣCE ΔOI, only when both sides added OI; null otherwise. */
  pcrChgOI: number | null;
  /** Traded premium PCR: Σ(PE LTP × volume) ÷ Σ(CE LTP × volume); null when no traded premium. */
  pcrPremium: number | null;
  totalCEOI: number;
  totalPEOI: number;
  totalCEVol: number;
  totalPEVol: number;
  totalCEOIChg: number;
  totalPEOIChg: number;
  /** Legacy label and colour (from pcrSignal). */
  signal: string;
  signalColor: string;
  signalTone: PCRTone;
}

export function calculatePCR(chain: OptionData[]): PCRResult {
  let ceOI = 0, peOI = 0, ceVol = 0, peVol = 0, ceChg = 0, peChg = 0, cePrem = 0, pePrem = 0;
  for (const o of Array.isArray(chain) ? chain : []) {
    ceOI += num(o?.ce?.oi);
    peOI += num(o?.pe?.oi);
    ceVol += num(o?.ce?.volume);
    peVol += num(o?.pe?.volume);
    ceChg += num(o?.ce?.oiChange);
    peChg += num(o?.pe?.oiChange);
    cePrem += num(o?.ce?.ltp) * num(o?.ce?.volume);
    pePrem += num(o?.pe?.ltp) * num(o?.pe?.volume);
  }
  const pcrOI = ceOI > 0 ? r2(peOI / ceOI) : 0;
  const sig = pcrSignal(pcrOI);
  return {
    pcrOI,
    pcrVolume: ceVol > 0 ? r2(peVol / ceVol) : 0,
    pcrChgOI: ceChg > 0 && peChg > 0 ? r2(peChg / ceChg) : null,
    pcrPremium: cePrem > 0 && pePrem > 0 ? r2(pePrem / cePrem) : null,
    totalCEOI: ceOI,
    totalPEOI: peOI,
    totalCEVol: ceVol,
    totalPEVol: peVol,
    totalCEOIChg: ceChg,
    totalPEOIChg: peChg,
    signal: sig.label,
    signalColor: sig.className,
    signalTone: sig.tone,
  };
}

// ── ATM zone ──

export interface ATMZoneStrike {
  strike: number;
  ceOI: number;
  peOI: number;
  pcr: number;
  ceOIChg: number;
  peOIChg: number;
  ceOIChgPct: number;
  peOIChgPct: number;
  isATM: boolean;
}

export interface ATMZoneData {
  /** Number of strikes actually in the zone (ATM ± N, fewer at the chain edges). */
  strikes: number;
  /** Strikes requested on each side of ATM. */
  perSide: number;
  atmStrike: number;
  totalCEOI: number;
  totalPEOI: number;
  pcr: number;
  /** Zone PCR at the previous close (OI − OI change); 0 when not computable. */
  prevPcr: number;
  totalCEOIChg: number;
  totalPEOIChg: number;
  ceOIChgPercent: number;
  peOIChgPercent: number;
  /** PCR now − PCR at the previous close. */
  pcrChange: number;
  strikeData: ATMZoneStrike[];
}

/**
 * ATM zone: the ATM strike plus `perSide` listed strikes on each side (by position in the chain,
 * so irregular strike steps are handled). PCR change compares the zone PCR now with the zone PCR
 * implied by the previous-day OI (OI − OI change).
 *
 * `stepSize` is accepted for backwards compatibility and ignored.
 */
export function getATMZoneAnalysis(chain: OptionData[], spotPrice: number, _stepSize?: number, perSide: number = 2): ATMZoneData {
  const rows = sortedChain(chain);
  const n = Math.max(0, Math.floor(perSide));
  const atmStrike = rows.length > 0 ? findATMStrike(rows, spotPrice) : NaN;
  const idx = rows.findIndex((r) => r.strikePrice === atmStrike);
  const zone = idx < 0 ? [] : rows.slice(Math.max(0, idx - n), idx + n + 1);

  let ceOI = 0, peOI = 0, ceChg = 0, peChg = 0;
  for (const o of zone) {
    ceOI += num(o.ce.oi);
    peOI += num(o.pe.oi);
    ceChg += num(o.ce.oiChange);
    peChg += num(o.pe.oiChange);
  }
  const pcr = ceOI > 0 ? peOI / ceOI : 0;
  const prevCE = ceOI - ceChg;
  const prevPE = peOI - peChg;
  const prevPcr = prevCE > 0 && prevPE >= 0 ? prevPE / prevCE : 0;
  return {
    strikes: zone.length,
    perSide: n,
    atmStrike: finite(atmStrike) ? atmStrike : 0,
    totalCEOI: ceOI,
    totalPEOI: peOI,
    pcr: r2(pcr),
    prevPcr: r2(prevPcr),
    totalCEOIChg: ceChg,
    totalPEOIChg: peChg,
    ceOIChgPercent: prevCE > 0 ? r2((ceChg / prevCE) * 100) : 0,
    peOIChgPercent: prevPE > 0 ? r2((peChg / prevPE) * 100) : 0,
    pcrChange: ceOI > 0 && prevPcr > 0 ? r2(pcr - prevPcr) : 0,
    strikeData: zone.map((o) => {
      const cePrev = num(o.ce.oi) - num(o.ce.oiChange);
      const pePrev = num(o.pe.oi) - num(o.pe.oiChange);
      return {
        strike: o.strikePrice,
        ceOI: num(o.ce.oi),
        peOI: num(o.pe.oi),
        pcr: num(o.ce.oi) > 0 ? r2(num(o.pe.oi) / o.ce.oi) : 0,
        ceOIChg: num(o.ce.oiChange),
        peOIChg: num(o.pe.oiChange),
        ceOIChgPct: cePrev > 0 ? r2((num(o.ce.oiChange) / cePrev) * 100) : 0,
        peOIChgPct: pePrev > 0 ? r2((num(o.pe.oiChange) / pePrev) * 100) : 0,
        isATM: o.strikePrice === atmStrike,
      };
    }),
  };
}

// ── IV ──

/**
 * ATM IV (percent) from the strike nearest spot using the OTM-preferred leg IV (legIV). A zero IV
 * on one leg falls back to the other leg instead of being averaged in.
 */
export function getATMIV(chain: OptionData[], spotPrice: number): { atmIV: number; atmStrike: number } {
  const rows = sortedChain(chain);
  if (rows.length === 0) return { atmIV: 0, atmStrike: 0 };
  const atmStrike = findATMStrike(rows, spotPrice);
  const row = rows.find((r) => r.strikePrice === atmStrike);
  const iv = row ? legIV(row, spotPrice) : NaN;
  return { atmIV: finite(iv) ? iv : 0, atmStrike: finite(atmStrike) ? atmStrike : 0 };
}

/**
 * Where ATM IV sits in the cross-strike IV distribution of the current chain. This is a snapshot of
 * the smile, not a historical IV percentile.
 */
export function getIVPercentileFromChain(chain: OptionData[], spotPrice: number): {
  percentile: number;
  rank: number;
  min: number;
  max: number;
  mean: number;
  atmIV: number;
} {
  if (!Array.isArray(chain) || chain.length === 0) return { percentile: 0, rank: 0, min: 0, max: 0, mean: 0, atmIV: 0 };
  const { atmIV } = getATMIV(chain, spotPrice);
  const allIVs = chain.flatMap((o) => [num(o.ce.iv), num(o.pe.iv)]).filter((iv) => iv > 0);
  if (allIVs.length === 0) return { percentile: 0, rank: 0, min: 0, max: 0, mean: 0, atmIV };
  const below = allIVs.filter((v) => v < atmIV).length;
  const min = Math.min(...allIVs);
  const max = Math.max(...allIVs);
  const mean = allIVs.reduce((s, v) => s + v, 0) / allIVs.length;
  return {
    percentile: Math.round((below / allIVs.length) * 100),
    rank: max > min ? Math.round(((atmIV - min) / (max - min)) * 100) : 50,
    min: r2(min),
    max: r2(max),
    mean: r2(mean),
    atmIV: r2(atmIV),
  };
}

/** IV smile points; the average ignores a zero IV on either leg. */
export function getIVSkew(chain: OptionData[]): { strike: number; callIV: number; putIV: number; avgIV: number }[] {
  return sortedChain(chain)
    .filter((o) => num(o.ce.iv) > 0 || num(o.pe.iv) > 0)
    .map((o) => {
      const c = num(o.ce.iv);
      const p = num(o.pe.iv);
      const avg = c > 0 && p > 0 ? (c + p) / 2 : c > 0 ? c : p;
      return { strike: o.strikePrice, callIV: c, putIV: p, avgIV: avg };
    });
}

// ── OI walls: support and resistance ──

export interface OILevel {
  strike: number;
  type: "support" | "resistance";
  /** 0–100, relative to the strongest level on the same side. */
  strength: number;
  oi: number;
  oiChange: number;
  /** OI plus the weighted fresh (positive) OI change. */
  score: number;
  distance: number;
  distancePercent: number;
}

/**
 * Resistance from CE OI at strikes ≥ spot and support from PE OI at strikes ≤ spot (the ATM strike
 * can be both). Each strike is scored as OI + freshWeight × max(OI change, 0), so today's fresh
 * writing counts extra. Returns the `top` strongest per side, resistance ascending and support
 * descending by strike (nearest first).
 */
export function getOILevels(
  chain: OptionData[],
  spotPrice: number,
  opts: { top?: number; freshWeight?: number; minFraction?: number } = {},
): { resistance: OILevel[]; support: OILevel[] } {
  const rows = sortedChain(chain);
  if (rows.length === 0 || !pos(spotPrice)) return { resistance: [], support: [] };
  const top = opts.top ?? 5;
  const w = opts.freshWeight ?? 0.5;
  const minFraction = opts.minFraction ?? 0.3;
  const build = (type: "support" | "resistance"): OILevel[] => {
    const side = rows
      .filter((o) => (type === "resistance" ? o.strikePrice >= spotPrice : o.strikePrice <= spotPrice))
      .map((o) => {
        const leg = type === "resistance" ? o.ce : o.pe;
        const oi = num(leg.oi);
        const chg = num(leg.oiChange);
        return { o, oi, chg, score: oi + w * Math.max(chg, 0) };
      })
      .filter((x) => x.oi > 0);
    const best = Math.max(0, ...side.map((x) => x.score));
    if (best <= 0) return [];
    return side
      .filter((x) => x.score >= best * minFraction)
      .sort((a, b) => b.score - a.score)
      .slice(0, top)
      .map((x) => ({
        strike: x.o.strikePrice,
        type,
        strength: Math.round((x.score / best) * 100),
        oi: x.oi,
        oiChange: x.chg,
        score: x.score,
        distance: Math.abs(x.o.strikePrice - spotPrice),
        distancePercent: (Math.abs(x.o.strikePrice - spotPrice) / spotPrice) * 100,
      }));
  };
  return {
    resistance: build("resistance").sort((a, b) => a.strike - b.strike),
    support: build("support").sort((a, b) => b.strike - a.strike),
  };
}

/** Strike with the highest CE (side "CE") or PE OI. NaN for an empty chain. */
export function maxOIStrike(chain: OptionData[], side: "CE" | "PE"): number {
  let best = NaN;
  let bestOI = -1;
  for (const r of sortedChain(chain)) {
    const oi = num(side === "CE" ? r.ce.oi : r.pe.oi);
    if (oi > bestOI) {
      bestOI = oi;
      best = r.strikePrice;
    }
  }
  return bestOI > 0 ? best : NaN;
}

/** Direction a wall moved between two readings: "up", "down", "same" or "unknown". */
export function wallShift(prev: number, now: number): "up" | "down" | "same" | "unknown" {
  if (!finite(prev) || !finite(now)) return "unknown";
  return now > prev ? "up" : now < prev ? "down" : "same";
}

// ── Snapshot series (intraday replay, PCR vs spot, max-pain drift) ──

export interface SnapshotPoint {
  ts: number;
  spot: number;
  pcrOI: number | null;
  pcrVol: number | null;
  maxPain: number | null;
  maxCEStrike: number | null;
  maxPEStrike: number | null;
  totalCEOI: number;
  totalPEOI: number;
}

/** Per-snapshot aggregates for intraday charts. Snapshots are sorted by time; empty ones skipped. */
export function snapshotSeries(snaps: ChainSnapshot[]): SnapshotPoint[] {
  const out: SnapshotPoint[] = [];
  for (const s of [...(snaps ?? [])].sort((a, b) => a.ts - b.ts)) {
    if (!s?.rows?.length) continue;
    let ce = 0, pe = 0, cv = 0, pv = 0;
    const ceByStrike = new Map<number, number>();
    const peByStrike = new Map<number, number>();
    for (const r of s.rows) {
      if (r.side === "CE") {
        ce += num(r.oi);
        cv += num(r.vol);
        ceByStrike.set(r.strike, num(r.oi));
      } else {
        pe += num(r.oi);
        pv += num(r.vol);
        peByStrike.set(r.strike, num(r.oi));
      }
    }
    const argmax = (m: Map<number, number>) => {
      let k: number | null = null;
      let v = 0;
      for (const [strike, oi] of m) if (oi > v) { v = oi; k = strike; }
      return k;
    };
    const chain = snapshotRowsToChain(s);
    const mp = maxPain(chain);
    out.push({
      ts: s.ts,
      spot: num(s.spot),
      pcrOI: ce > 0 ? r2(pe / ce) : null,
      pcrVol: cv > 0 ? r2(pv / cv) : null,
      maxPain: finite(mp) ? mp : null,
      maxCEStrike: argmax(ceByStrike),
      maxPEStrike: argmax(peByStrike),
      totalCEOI: ce,
      totalPEOI: pe,
    });
  }
  return out;
}

/** Minimal OI-only chain from a snapshot (enough for max pain and OI aggregates). */
export function snapshotRowsToChain(s: Pick<ChainSnapshot, "rows">): OptionData[] {
  const blank = (): OptionLegData => ({ ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 });
  const m = new Map<number, OptionData>();
  for (const r of s?.rows ?? []) {
    let row = m.get(r.strike);
    if (!row) {
      row = { strikePrice: r.strike, ce: blank(), pe: blank() };
      m.set(r.strike, row);
    }
    const leg: OptionLegData = { ...blank(), ltp: num(r.ltp), oi: num(r.oi), volume: num(r.vol), iv: num(r.iv), bidPrice: num(r.bid), askPrice: num(r.ask) };
    if (r.side === "CE") row.ce = leg;
    else row.pe = leg;
  }
  return [...m.values()].sort((a, b) => a.strikePrice - b.strikePrice);
}

export interface StrikeOIDiff {
  strike: number;
  ceOI: number;
  peOI: number;
  /** CE OI at `at` minus CE OI at `base` (0 when the strike is missing from base). */
  ceChg: number;
  peChg: number;
}

/** OI by strike at snapshot `at`, with the change since snapshot `base` (null base = no change). */
export function diffSnapshots(at: ChainSnapshot | undefined, base: ChainSnapshot | undefined | null): StrikeOIDiff[] {
  if (!at) return [];
  const baseMap = new Map<string, number>();
  for (const r of base?.rows ?? []) baseMap.set(`${r.side}|${r.strike}`, num(r.oi));
  const m = new Map<number, StrikeOIDiff>();
  for (const r of at.rows ?? []) {
    let d = m.get(r.strike);
    if (!d) {
      d = { strike: r.strike, ceOI: 0, peOI: 0, ceChg: 0, peChg: 0 };
      m.set(r.strike, d);
    }
    const prev = base ? baseMap.get(`${r.side}|${r.strike}`) ?? num(r.oi) : num(r.oi);
    if (r.side === "CE") {
      d.ceOI = num(r.oi);
      d.ceChg = num(r.oi) - prev;
    } else {
      d.peOI = num(r.oi);
      d.peChg = num(r.oi) - prev;
    }
  }
  return [...m.values()].sort((a, b) => a.strike - b.strike);
}

/** Keep strikes within `n` listed strikes of `center` (by position). */
export function windowAround<T extends { strike: number }>(rows: T[], center: number, n: number): T[] {
  if (rows.length === 0 || !finite(center)) return rows;
  let idx = 0;
  for (let i = 0; i < rows.length; i++) if (Math.abs(rows[i].strike - center) < Math.abs(rows[idx].strike - center)) idx = i;
  return rows.slice(Math.max(0, idx - n), idx + n + 1);
}

// ── Per-expiry summary (max pain table, PCR suite) ──

export interface ExpirySummary {
  expiry: string;
  maxPain: number | null;
  /** Max pain − spot, in points. */
  distance: number | null;
  distancePct: number | null;
  /** 1σ expected move to expiry in points (IV-based, straddle fallback). */
  expectedMove: number | null;
  emSource: "iv" | "straddle" | null;
  /** |distance| ÷ expected move. */
  emMultiple: number | null;
  atmIv: number | null;
  pcr: PCRResult;
}

/**
 * Max pain, distance from spot, expected move and the PCR family for one expiry. The expected move
 * is the 1σ log-space move from ATM IV at the chain forward; when IV is missing it falls back to
 * 0.85 × ATM straddle.
 */
export function expirySummary(chain: OptionData[], spot: number, expiry: string, opts: { now?: Date; r?: number } = {}): ExpirySummary {
  const rows = sortedChain(chain);
  const mp = rows.length > 0 ? maxPain(rows) : NaN;
  const hasMp = finite(mp);
  const distance = hasMp && pos(spot) ? mp - spot : NaN;
  const T = timeToExpiryYears(expiry, opts.now ?? new Date());
  const r = finite(opts.r) ? opts.r : 0.065;
  let em = NaN;
  let emSource: ExpirySummary["emSource"] = null;
  let ivPct = NaN;
  if (rows.length > 0 && pos(spot) && pos(T)) {
    const F = chainForward(rows, spot, T, r);
    ivPct = atmIV(rows, F);
    if (pos(ivPct) && pos(F)) {
      em = expectedMoveFromIV(F, ivPct / 100, T).move;
      emSource = "iv";
    }
  }
  if (!pos(em) && rows.length > 0 && pos(spot)) {
    const st = atmStraddle(rows, spot);
    const m = expectedMoveFromStraddle(st.straddle, spot).move;
    if (pos(m)) {
      em = m;
      emSource = "straddle";
    }
  }
  return {
    expiry,
    maxPain: hasMp ? mp : null,
    distance: finite(distance) ? distance : null,
    distancePct: finite(distance) && pos(spot) ? r2((distance / spot) * 100) : null,
    expectedMove: pos(em) ? em : null,
    emSource: pos(em) ? emSource : null,
    emMultiple: pos(em) && finite(distance) ? r2(Math.abs(distance) / em) : null,
    atmIv: pos(ivPct) ? r2(ivPct) : null,
    pcr: calculatePCR(rows),
  };
}

// ── Distribution helpers (PCR history) ──

/** Linear-interpolated quantile (q in 0..1) of the finite values; NaN when empty. */
export function quantile(values: number[], q: number): number {
  const xs = (values ?? []).filter(finite).sort((a, b) => a - b);
  if (xs.length === 0) return NaN;
  const p = Math.min(1, Math.max(0, q)) * (xs.length - 1);
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  return xs[lo] + (xs[hi] - xs[lo]) * (p - lo);
}

/** Percent of history values strictly below `value` (0–100); null when history is empty. */
export function percentileRank(value: number, history: number[]): number | null {
  const xs = (history ?? []).filter(finite);
  if (xs.length === 0 || !finite(value)) return null;
  const below = xs.filter((x) => x < value).length;
  const equal = xs.filter((x) => x === value).length;
  return Math.round(((below + equal / 2) / xs.length) * 100);
}

// ── Intraday OI time series (strike lines, cumulative CE vs PE change, ATM range change) ──

/** Snapshots of the most recent IST trading date in the list, oldest first (empty snapshots dropped). */
export function latestSessionSnapshots(snaps: ChainSnapshot[]): ChainSnapshot[] {
  const sorted = [...(snaps ?? [])].filter((s) => s && finite(s.ts) && s.rows?.length).sort((a, b) => a.ts - b.ts);
  if (sorted.length === 0) return [];
  const day = istDateString(new Date(sorted[sorted.length - 1].ts));
  return sorted.filter((s) => istDateString(new Date(s.ts)) === day);
}

/** Every strike seen across the snapshots, ascending. */
export function snapshotStrikes(snaps: ChainSnapshot[]): number[] {
  const set = new Set<number>();
  for (const s of snaps ?? []) for (const r of s?.rows ?? []) if (pos(r.strike)) set.add(r.strike);
  return [...set].sort((a, b) => a - b);
}

export type OISeriesMetric = "oi" | "chg";
export type OISide = "CE" | "PE";

/** Data key of one strike line, e.g. "CE_24500". */
export function strikeSeriesKey(strike: number, side: OISide): string {
  return `${side}_${strike}`;
}

/** One row of the strike time series: ts, spot and one value (or null when missing) per strike key. */
export type StrikeSeriesRow = { ts: number; spot: number } & Record<string, number | null>;

/**
 * OI (metric "oi") or OI change since the first snapshot that carried the leg (metric "chg") for
 * the chosen strikes and sides, one row per snapshot. A leg missing from a snapshot is null so the
 * chart shows a gap instead of a fake zero.
 */
export function strikeOISeries(snaps: ChainSnapshot[], strikes: number[], sides: OISide[], metric: OISeriesMetric): StrikeSeriesRow[] {
  const sorted = [...(snaps ?? [])].filter((s) => s && finite(s.ts)).sort((a, b) => a.ts - b.ts);
  const keys = strikes.flatMap((k) => sides.map((side) => ({ k, side, key: strikeSeriesKey(k, side) })));
  const base = new Map<string, number>();
  return sorted.map((s) => {
    const byKey = new Map<string, number>();
    for (const r of s.rows ?? []) byKey.set(strikeSeriesKey(r.strike, r.side), num(r.oi));
    const row = { ts: s.ts, spot: num(s.spot) } as StrikeSeriesRow;
    for (const { key } of keys) {
      const v = byKey.get(key);
      if (v === undefined) {
        row[key] = null;
        continue;
      }
      if (!base.has(key)) base.set(key, v);
      row[key] = metric === "oi" ? v : v - (base.get(key) as number);
    }
    return row;
  });
}

export interface OIFlowPoint {
  ts: number;
  spot: number;
  /** Total call OI over the strikes in scope. */
  ceOI: number;
  peOI: number;
  /** Call OI added since each leg's first snapshot (cumulative). */
  ceChg: number;
  peChg: number;
  /** Put change minus call change: positive = put writers adding faster (supportive). */
  netChg: number;
}

/**
 * Cumulative call and put OI change since the first snapshot, optionally limited to a strike set.
 * Each leg's baseline is its first appearance, so a strike that is listed mid-session does not
 * show up as a jump.
 */
export function cumulativeOIChangeSeries(snaps: ChainSnapshot[], strikes?: number[]): OIFlowPoint[] {
  const scope = strikes ? new Set(strikes) : null;
  const sorted = [...(snaps ?? [])].filter((s) => s && finite(s.ts) && s.rows?.length).sort((a, b) => a.ts - b.ts);
  const base = new Map<string, number>();
  return sorted.map((s) => {
    let ceOI = 0, peOI = 0, ceChg = 0, peChg = 0;
    for (const r of s.rows) {
      if (scope && !scope.has(r.strike)) continue;
      const key = strikeSeriesKey(r.strike, r.side);
      const oi = num(r.oi);
      if (!base.has(key)) base.set(key, oi);
      const chg = oi - (base.get(key) as number);
      if (r.side === "CE") {
        ceOI += oi;
        ceChg += chg;
      } else {
        peOI += oi;
        peChg += chg;
      }
    }
    return { ts: s.ts, spot: num(s.spot), ceOI, peOI, ceChg, peChg, netChg: peChg - ceChg };
  });
}

/**
 * OI change over time inside ATM ± `perSide` listed strikes. The range is fixed for the whole
 * session, centred on the ATM strike at the latest snapshot's spot (or `center` when given), so
 * the lines compare like with like.
 */
export function rangeOIChangeSeries(
  snaps: ChainSnapshot[],
  perSide: number,
  center?: number,
): { atm: number; strikes: number[]; points: OIFlowPoint[] } {
  const sorted = [...(snaps ?? [])].filter((s) => s && finite(s.ts) && s.rows?.length).sort((a, b) => a.ts - b.ts);
  const all = snapshotStrikes(sorted);
  if (all.length === 0) return { atm: NaN, strikes: [], points: [] };
  const ref = pos(center) ? center : num(sorted[sorted.length - 1]?.spot);
  if (!pos(ref)) return { atm: NaN, strikes: [], points: [] };
  const window = windowAround(all.map((strike) => ({ strike })), ref, Math.max(0, Math.floor(perSide))).map((r) => r.strike);
  const atm = all.reduce((best, k) => (Math.abs(k - ref) < Math.abs(best - ref) ? k : best), all[0]);
  return { atm, strikes: window, points: cumulativeOIChangeSeries(sorted, window) };
}

/**
 * A sensible first selection for the strike time series from the latest snapshot: the ATM strike
 * and the strongest call wall above and put wall below spot. Deduplicated, ascending.
 */
export function defaultSeriesStrikes(snaps: ChainSnapshot[]): number[] {
  const sorted = [...(snaps ?? [])].filter((s) => s && s.rows?.length).sort((a, b) => a.ts - b.ts);
  const last = sorted[sorted.length - 1];
  if (!last) return [];
  const chain = snapshotRowsToChain(last);
  const spot = num(last.spot);
  const out = new Set<number>();
  const atm = chain.length && pos(spot) ? findATMStrike(chain, spot) : NaN;
  if (finite(atm)) out.add(atm);
  let ceBest = NaN, ceOI = 0, peBest = NaN, peOI = 0;
  for (const r of chain) {
    if ((!pos(spot) || r.strikePrice > spot) && r.ce.oi > ceOI) {
      ceOI = r.ce.oi;
      ceBest = r.strikePrice;
    }
    if ((!pos(spot) || r.strikePrice < spot) && r.pe.oi > peOI) {
      peOI = r.pe.oi;
      peBest = r.strikePrice;
    }
  }
  if (finite(ceBest)) out.add(ceBest);
  if (finite(peBest)) out.add(peBest);
  return [...out].sort((a, b) => a - b);
}

// ── Labels and trade hand-offs ──

/**
 * Chart labels for spot and max pain. When they sit within half a strike step of each other one
 * combined label ("Spot ≈ Max pain 24,250") replaces two overlapping ones.
 */
export function spotMaxPainLabel(spot: number, maxPainStrike: number, step: number): { combined: boolean; text: string | null } {
  if (!pos(maxPainStrike)) return { combined: false, text: null };
  if (pos(spot) && pos(step) && Math.abs(spot - maxPainStrike) <= step / 2) {
    return { combined: true, text: `Spot ≈ Max pain ${formatStrike(maxPainStrike)}` };
  }
  return { combined: false, text: `Max pain ${formatStrike(maxPainStrike)}` };
}

/** Smallest gap between consecutive strikes (NaN with fewer than two strikes). */
export function strikeGap(strikes: number[]): number {
  const xs = [...new Set((strikes ?? []).filter(pos))].sort((a, b) => a - b);
  let g = Infinity;
  for (let i = 1; i < xs.length; i++) g = Math.min(g, xs[i] - xs[i - 1]);
  return Number.isFinite(g) ? g : NaN;
}

export interface SpreadLeg {
  strike: number;
  /** Rupees per unit: mid when both sides are quoted, else LTP. */
  premium: number;
  /** Decimal IV (0.142 = 14.2%), null when the feed sent none. */
  iv: number | null;
}

export interface WallSpread {
  type: OptionType;
  sell: SpreadLeg;
  buy: SpreadLeg;
  /** Points between the strikes. */
  width: number;
  /** Sell premium − buy premium, per unit. */
  netCredit: number;
}

function legQuote(leg: OptionLegData | undefined): { premium: number; iv: number | null } {
  if (!leg) return { premium: 0, iv: null };
  const mid = pos(leg.bidPrice) && pos(leg.askPrice) && leg.askPrice >= leg.bidPrice ? (leg.bidPrice + leg.askPrice) / 2 : NaN;
  const premium = pos(mid) ? mid : num(leg.ltp);
  return { premium: r2(premium), iv: pos(leg.iv) ? Math.round(leg.iv * 10) / 1000 : null };
}

/**
 * Credit spread written at an OI wall: sell the wall strike and buy protection further out
 * (calls: above a resistance; puts: below a support). The hedge sits max(2 strikes, ~0.8% of spot)
 * away, snapped outwards to a listed strike. Null when the wall or a hedge strike is not listed.
 */
export function wallCreditSpread(chain: OptionData[], wallStrike: number, type: OptionType, spot: number): WallSpread | null {
  const rows = sortedChain(chain);
  const wall = rows.find((r) => r.strikePrice === wallStrike);
  if (!wall || !pos(spot)) return null;
  const step = modalStrikeStep(rows, spot);
  if (!pos(step)) return null;
  const dist = Math.max(2 * step, Math.ceil((0.008 * spot) / step) * step);
  const target = type === "CE" ? wallStrike + dist : wallStrike - dist;
  const candidates = rows.filter((r) => (type === "CE" ? r.strikePrice >= target : r.strikePrice <= target));
  const hedge = type === "CE" ? candidates[0] : candidates[candidates.length - 1];
  if (!hedge) return null;
  const s = legQuote(type === "CE" ? wall.ce : wall.pe);
  const b = legQuote(type === "CE" ? hedge.ce : hedge.pe);
  return {
    type,
    sell: { strike: wallStrike, ...s },
    buy: { strike: hedge.strikePrice, ...b },
    width: Math.abs(hedge.strikePrice - wallStrike),
    netCredit: r2(s.premium - b.premium),
  };
}

/** Optimizer link with a price target, e.g. /optimizer?symbol=NIFTY&target=24250. */
export function optimizerTargetUrl(symbol: string, target: number): string {
  const q = new URLSearchParams({ symbol: String(symbol || "").trim().toUpperCase() });
  if (pos(target)) q.set("target", String(Math.round(target * 100) / 100));
  return `/optimizer?${q.toString()}`;
}

/**
 * The build-up carrying the most absolute OI change on one side of the chain (strikes above
 * `SIGNIFICANT_OI_FRACTION` of the largest OI). `share` is that build-up's part of the side's total
 * |OI change| (0–1). NEUTRAL with share 0 when no leg has a known premium change.
 */
export function dominantBuildup(chain: OptionData[], side: OISide): { buildup: Buildup; share: number } {
  const weight: Record<Buildup, number> = { LONG_BUILDUP: 0, SHORT_BUILDUP: 0, SHORT_COVERING: 0, LONG_UNWINDING: 0, NEUTRAL: 0 };
  let total = 0;
  for (const r of significantStrikes(chain)) {
    const leg = side === "CE" ? r.ce : r.pe;
    const b = getBuildup(leg);
    if (b === "NEUTRAL") continue;
    const w = Math.abs(num(leg.oiChange));
    weight[b] += w;
    total += w;
  }
  if (total <= 0) return { buildup: "NEUTRAL", share: 0 };
  let best: Buildup = "NEUTRAL";
  for (const b of ["LONG_BUILDUP", "SHORT_BUILDUP", "SHORT_COVERING", "LONG_UNWINDING"] as const) if (weight[b] > (best === "NEUTRAL" ? 0 : weight[best])) best = b;
  return { buildup: best, share: r2(weight[best] / total) };
}
