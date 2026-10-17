/**
 * Pure builders for the option-chain price-chart overlays: key option levels (max pain, OI and
 * gamma walls, gamma flip) and the 1σ / 2σ expected-move cone from now to expiry.
 * No DOM and no chart library here, so it is unit tested in isolation.
 */
import { expectedMoveFromIV, formatStrike, isTradingDay, istDateString, nextTradingDay, timeToExpiryYears, toISTDate } from "@/lib/options";
import type { GammaLevels } from "./gammaLevels";

export type OverlayLevelKind = "callWall" | "putWall" | "flip" | "maxPain" | "absGamma" | "breakeven";

export interface OverlayLevel {
  price: number;
  label: string;
  kind: OverlayLevelKind;
}

const pos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

export interface ChainLevelInput {
  maxPain?: number;
  /** Highest CE / PE OI strikes, used as walls when gamma levels are unavailable. */
  maxOiStrike?: { ce: number; pe: number };
  gamma?: GammaLevels | null;
}

/**
 * Levels to draw as horizontal price lines. Gamma walls win over OI walls when both exist;
 * duplicates at the same price are merged into one line with a combined label.
 */
export function chainChartLevels({ maxPain, maxOiStrike, gamma }: ChainLevelInput): OverlayLevel[] {
  const out: OverlayLevel[] = [];
  const push = (price: number | null | undefined, label: string, kind: OverlayLevelKind) => {
    if (!pos(price)) return;
    const dup = out.find((l) => Math.abs(l.price - price) < 1e-6);
    if (dup) {
      dup.label = `${dup.label} · ${label}`;
      return;
    }
    out.push({ price, label, kind });
  };
  push(maxPain, `Max pain ${pos(maxPain) ? formatStrike(maxPain) : ""}`.trim(), "maxPain");
  const callWall = pos(gamma?.callWall) ? gamma?.callWall : maxOiStrike?.ce;
  const putWall = pos(gamma?.putWall) ? gamma?.putWall : maxOiStrike?.pe;
  const wallSrc = pos(gamma?.callWall) ? "GEX" : "OI";
  push(callWall, `Call wall (${wallSrc})`, "callWall");
  push(putWall, `Put wall (${pos(gamma?.putWall) ? "GEX" : "OI"})`, "putWall");
  if (gamma && gamma.flip !== null) push(gamma.flip, "Gamma flip", "flip");
  return out;
}

/** Breakevens as overlay levels (non-positive and non-finite values are dropped). */
export function breakevenLevels(breakevens: readonly number[] | undefined): OverlayLevel[] {
  return (breakevens ?? []).filter(pos).map((b, i, arr) => ({ price: b, label: arr.length > 1 ? `BE ${i + 1}` : "Breakeven", kind: "breakeven" as const }));
}

export interface ConePoint {
  /** Unix seconds. */
  time: number;
  value: number;
}

export interface ConeBand {
  /** Standard deviations (1 or 2). */
  k: number;
  upper: ConePoint[];
  lower: ConePoint[];
}

export interface ConeInput {
  /** Unix seconds of the last candle: the cone starts here at zero width. */
  anchorTime: number;
  /** Price the cone is centred on (forward or spot). */
  anchor: number;
  /** Annualised IV as a decimal (0.14 = 14%). */
  iv: number;
  /** ISO expiry date; the cone ends at 15:30 IST on that day. */
  expiry: string;
  now?: Date;
  sigmas?: readonly number[];
  /** Safety cap on the number of projected points per band. */
  maxPoints?: number;
}

/**
 * Expected-move cone: one point per NSE trading day from the anchor to expiry, widening with √t
 * (log-normal bounds from expectedMoveFromIV). Returns [] when inputs are unusable or the expiry
 * has passed.
 */
export function expectedMoveCone({ anchorTime, anchor, iv, expiry, now = new Date(), sigmas = [1, 2], maxPoints = 260 }: ConeInput): ConeBand[] {
  if (!pos(anchor) || !pos(iv) || !Number.isFinite(anchorTime) || !expiry) return [];
  const Ttotal = timeToExpiryYears(expiry, now);
  if (!pos(Ttotal)) return [];
  const nowSec = Math.floor(now.getTime() / 1000);
  // Trading-day closes strictly after the anchor (and after now), up to and including expiry.
  const closes: number[] = [];
  let day = istDateString(now);
  if (!isTradingDay(day)) day = nextTradingDay(day);
  let guard = 0;
  while (day <= expiry && closes.length < maxPoints && guard++ < 1000) {
    const t = Math.floor(toISTDate(day, "15:30").getTime() / 1000);
    if (t > anchorTime && t > nowSec) closes.push(t);
    day = nextTradingDay(day);
  }
  // Always end exactly at expiry, even if the feed's expiry falls on a non-trading day.
  const expiryAt = Math.floor(toISTDate(expiry, "15:30").getTime() / 1000);
  if (Number.isFinite(expiryAt) && expiryAt > anchorTime && expiryAt > nowSec && (closes.length === 0 || closes[closes.length - 1] < expiryAt)) closes.push(expiryAt);
  if (closes.length === 0) return [];
  return sigmas.filter(pos).map((k) => {
    const upper: ConePoint[] = [{ time: anchorTime, value: anchor }];
    const lower: ConePoint[] = [{ time: anchorTime, value: anchor }];
    for (const t of closes) {
      const remaining = timeToExpiryYears(expiry, new Date(t * 1000));
      const elapsed = Math.max(0, Ttotal - (Number.isFinite(remaining) ? remaining : 0));
      const em = expectedMoveFromIV(anchor, iv, elapsed, k);
      if (!pos(em.upper) || !pos(em.lower)) continue;
      upper.push({ time: t, value: em.upper });
      lower.push({ time: t, value: em.lower });
    }
    return { k, upper, lower };
  });
}
