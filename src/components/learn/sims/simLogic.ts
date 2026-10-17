/**
 * Pure helpers for the Learn simulators. All pricing goes through @/lib/options; this file only
 * builds the grids and small derived series the charts need.
 */
import {
  BROKER_PRESETS,
  bsPrice,
  calcCharges,
  exerciseSTT,
  greeks,
  MINUTES_PER_YEAR,
  strategyValueAt,
  type BrokerPreset,
  type ChargesBreakdown,
  type Leg,
  type OptionType,
  type Side,
} from "@/lib/options";

export const MARKET_OPEN_MIN = 9 * 60 + 15;
export const MARKET_CLOSE_MIN = 15 * 60 + 30;
export const DEFAULT_RATE = 0.065;

/** Minutes from a time of day (minutes after midnight IST) to the 15:30 close; never negative. */
export function minutesToClose(minuteOfDay: number): number {
  if (!Number.isFinite(minuteOfDay)) return 0;
  return Math.max(0, MARKET_CLOSE_MIN - Math.round(minuteOfDay));
}

/** "13:05" for a minute-of-day value. */
export function clockLabel(minuteOfDay: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minuteOfDay)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Year fraction for a number of calendar minutes (the core's calendar convention). */
export function minutesToYears(minutes: number): number {
  return Math.max(0, minutes) / MINUTES_PER_YEAR;
}

export interface ExpiryDayPoint {
  minute: number;
  label: string;
  value: number;
  timeValue: number;
}

/**
 * Option value through the expiry-day session (09:15 → 15:30 IST) with spot and IV held fixed.
 * Shows how time value collapses into the close.
 */
export function expiryDayCurve(o: { spot: number; strike: number; sigma: number; type: OptionType; r?: number; stepMin?: number }): ExpiryDayPoint[] {
  const step = Math.max(1, Math.round(o.stepMin ?? 5));
  const r = o.r ?? DEFAULT_RATE;
  const intrinsicVal = o.type === "CE" ? Math.max(o.spot - o.strike, 0) : Math.max(o.strike - o.spot, 0);
  const out: ExpiryDayPoint[] = [];
  for (let m = MARKET_OPEN_MIN; m <= MARKET_CLOSE_MIN; m += step) {
    out.push(pointAt(m));
  }
  if (out[out.length - 1]?.minute !== MARKET_CLOSE_MIN) out.push(pointAt(MARKET_CLOSE_MIN));
  return out;

  function pointAt(m: number): ExpiryDayPoint {
    const T = minutesToYears(minutesToClose(m));
    const value = T > 0 ? bsPrice({ S: o.spot, K: o.strike, T, r, sigma: o.sigma, type: o.type }) : intrinsicVal;
    return { minute: m, label: clockLabel(m), value, timeValue: Math.max(0, value - intrinsicVal) };
  }
}

/** Option value against days to expiry (30 → 0), measured at the same time of day. */
export function decayByDays(o: { spot: number; strike: number; sigma: number; type: OptionType; r?: number; maxDays?: number }): Array<{ days: number; value: number }> {
  const r = o.r ?? DEFAULT_RATE;
  const maxDays = Math.max(1, Math.round(o.maxDays ?? 30));
  const out: Array<{ days: number; value: number }> = [];
  for (let d = maxDays; d >= 0; d--) {
    const T = d / 365;
    out.push({ days: d, value: bsPrice({ S: o.spot, K: o.strike, T, r, sigma: o.sigma, type: o.type }) });
  }
  return out;
}

/** ATM straddle and its parts across an IV range (decimal sigmas). */
export function straddleCurve(o: { spot: number; days: number; ivs: number[]; strike?: number; r?: number }): Array<{ iv: number; ce: number; pe: number; straddle: number }> {
  const K = o.strike ?? o.spot;
  const T = Math.max(0, o.days) / 365;
  const r = o.r ?? DEFAULT_RATE;
  return o.ivs.map((sigma) => {
    const ce = bsPrice({ S: o.spot, K, T, r, sigma, type: "CE" });
    const pe = bsPrice({ S: o.spot, K, T, r, sigma, type: "PE" });
    return { iv: sigma, ce, pe, straddle: ce + pe };
  });
}

/** Evenly spaced decimal IVs from lo to hi inclusive. */
export function ivRange(lo: number, hi: number, n: number): number[] {
  const count = Math.max(2, Math.round(n));
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
}

/** Delta, gamma and price across a spot range for one option. */
export function greeksCurve(o: { strike: number; days: number; sigma: number; type: OptionType; spots: number[]; r?: number }): Array<{ spot: number; price: number; delta: number; gamma: number }> {
  const T = Math.max(o.days, 0) / 365;
  const r = o.r ?? DEFAULT_RATE;
  return o.spots.map((S) => {
    const g = greeks({ S, K: o.strike, T, r, sigma: o.sigma, type: o.type });
    return { spot: S, price: bsPrice({ S, K: o.strike, T, r, sigma: o.sigma, type: o.type }), delta: g.delta, gamma: g.gamma };
  });
}

/** Strikes centred on the ATM strike: count each side, rounded to the step. */
export function strikeLadder(spot: number, step: number, each: number): number[] {
  if (!(spot > 0) || !(step > 0)) return [];
  const atm = Math.round(spot / step) * step;
  const n = Math.max(0, Math.round(each));
  return Array.from({ length: 2 * n + 1 }, (_, i) => atm + (i - n) * step);
}

/** Evenly spaced grid around a centre (± pct). */
export function linearGrid(centre: number, pct: number, points: number): number[] {
  const n = Math.max(2, Math.round(points));
  const lo = centre * (1 - pct);
  const hi = centre * (1 + pct);
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

/** Lognormal density of S_T given forward F, vol sigma and time T (years); from @/lib/options. */
export { lognormalDensity } from "@/lib/options";

let legSeq = 0;
/**
 * A leg priced at model fair value. The premium comes from the same Black-76 valuation the payoff
 * engine uses (strategyValueAt), so the T+0 line passes through zero at the entry spot.
 */
export function makeLeg(o: {
  symbol: string;
  type: OptionType;
  side: Side;
  strike: number;
  expiry: string;
  lotSize: number;
  spot: number;
  sigma: number;
  now: Date;
  lots?: number;
}): Leg {
  const probe: Leg = { symbol: o.symbol, type: o.type, side: "BUY", strike: o.strike, expiry: o.expiry, lots: 1, lotSize: 1, premium: 0, iv: o.sigma, enabled: true };
  const fair = strategyValueAt([probe], o.spot, { now: o.now });
  legSeq += 1;
  return {
    id: `sim${legSeq}`,
    symbol: o.symbol,
    type: o.type,
    side: o.side,
    strike: o.strike,
    expiry: o.expiry,
    lots: o.lots ?? 1,
    lotSize: o.lotSize,
    premium: Number.isFinite(fair) ? Math.max(0.05, Math.round(fair * 20) / 20) : 0.05,
    iv: o.sigma,
    enabled: true,
  };
}

export type PresetId = "longCall" | "longPut" | "bullCall" | "shortStraddle" | "ironCondor" | "longStraddle";

export const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: "longCall", label: "Long call" },
  { id: "longPut", label: "Long put" },
  { id: "bullCall", label: "Bull call spread" },
  { id: "longStraddle", label: "Long straddle" },
  { id: "shortStraddle", label: "Short straddle" },
  { id: "ironCondor", label: "Iron condor" },
];

/** Leg templates as (type, side, strike offset in steps) relative to ATM. */
export function presetTemplate(id: PresetId): Array<{ type: OptionType; side: Side; offset: number }> {
  switch (id) {
    case "longCall":
      return [{ type: "CE", side: "BUY", offset: 0 }];
    case "longPut":
      return [{ type: "PE", side: "BUY", offset: 0 }];
    case "bullCall":
      return [
        { type: "CE", side: "BUY", offset: 0 },
        { type: "CE", side: "SELL", offset: 4 },
      ];
    case "longStraddle":
      return [
        { type: "CE", side: "BUY", offset: 0 },
        { type: "PE", side: "BUY", offset: 0 },
      ];
    case "shortStraddle":
      return [
        { type: "CE", side: "SELL", offset: 0 },
        { type: "PE", side: "SELL", offset: 0 },
      ];
    case "ironCondor":
      return [
        { type: "PE", side: "BUY", offset: -8 },
        { type: "PE", side: "SELL", offset: -4 },
        { type: "CE", side: "SELL", offset: 4 },
        { type: "CE", side: "BUY", offset: 8 },
      ];
  }
}

export interface ExerciseComparison {
  /** Charges if the long option is sold before 15:30 at `exitPrice`. */
  squareOff: ChargesBreakdown;
  /** STT if it is left to be exercised (on intrinsic value). */
  exerciseStt: number;
  /** Positive when exercising costs more than squaring off. */
  difference: number;
}

/** Compare selling a long ITM option on expiry day with letting it be exercised. */
export function compareSquareOffVsExercise(o: { exitPrice: number; intrinsic: number; qty: number; onDate: string; broker?: BrokerPreset }): ExerciseComparison {
  const squareOff = calcCharges([{ type: "CE", side: "SELL", price: o.exitPrice, qty: o.qty }], { broker: o.broker ?? BROKER_PRESETS[0], onDate: o.onDate });
  const ex = exerciseSTT(o.intrinsic, o.qty, o.onDate);
  return { squareOff, exerciseStt: ex, difference: ex - squareOff.total };
}

/** Round-trip charges (buy then sell) for one option trade, plus gross and net P&L. */
export function roundTripSummary(o: { entry: number; exit: number; qty: number; onDate: string; broker?: BrokerPreset }): { charges: ChargesBreakdown; gross: number; net: number; chargesPctOfGross: number } {
  const charges = calcCharges(
    [
      { type: "CE", side: "BUY", price: o.entry, qty: o.qty },
      { type: "CE", side: "SELL", price: o.exit, qty: o.qty },
    ],
    { broker: o.broker ?? BROKER_PRESETS[0], onDate: o.onDate },
  );
  const gross = (o.exit - o.entry) * o.qty;
  const net = gross - charges.total;
  const chargesPctOfGross = gross > 0 ? (charges.total / gross) * 100 : NaN;
  return { charges, gross, net, chargesPctOfGross };
}

/** Tone for a signed rupee value (colour is never the only signal: values also carry +/−). */
export function pnlTone(v: number): "bullish" | "bearish" | undefined {
  if (!Number.isFinite(v) || v === 0) return undefined;
  return v > 0 ? "bullish" : "bearish";
}
