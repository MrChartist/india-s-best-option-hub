/**
 * Deterministic SAMPLE end-of-day dataset for the backtester (always labelled "Sample").
 *
 * About one year of daily option closes for NIFTY, BANKNIFTY, FINNIFTY and MIDCPNIFTY, generated
 * from a seeded process rather than shipped as a file, so the bundle stays small and every run
 * returns identical numbers:
 *  - India VIX follows a mean-reverting log process with occasional spikes, shared by every symbol;
 *  - each index follows a log-normal walk whose daily volatility tracks VIX (realised below implied,
 *    as is typical), with returns negatively correlated to VIX moves;
 *  - expiries follow the current NSE calendar (NIFTY weekly Tuesday, the rest monthly last Tuesday),
 *    holidays shift an expiry to the previous trading day;
 *  - option closes are Black-76 prices on the forward with the shared sample smile, rounded to ₹0.05.
 * It is a teaching dataset. Never present it as market history.
 */
import {
  black76Price,
  calendarDaysBetween,
  getDividendYield,
  getExpiries,
  getStrikeStep,
  gaussianSource,
  isTradingDay,
  addCalendarDays,
  mulberry32,
  normalizeSymbol,
  sampleSeed,
  sampleSmile,
  timeToExpiryYears,
  toISTDate,
} from "@/lib/options";
import type { EodChain, EodDataset, EodDay } from "./types";

/** Fixed window of the sample (one year of sessions ending before the app's sample "today"). */
export const SAMPLE_RANGE = { from: "2025-10-01", to: "2026-09-30" } as const;

interface SymbolProfile {
  spot: number;
  /** ATM IV ÷ VIX. */
  ivMult: number;
  /** Return beta to the shared market shock. */
  beta: number;
  drift: number;
}

const PROFILES: Record<string, SymbolProfile> = {
  NIFTY: { spot: 24_800, ivMult: 0.95, beta: 1, drift: 0.1 },
  BANKNIFTY: { spot: 55_400, ivMult: 1.12, beta: 1.15, drift: 0.11 },
  FINNIFTY: { spot: 26_100, ivMult: 1.05, beta: 1.1, drift: 0.1 },
  MIDCPNIFTY: { spot: 12_900, ivMult: 1.3, beta: 1.25, drift: 0.13 },
};

const TICK = 0.05;
const R = 0.065;
const roundTick = (x: number) => Math.max(TICK, Math.round(x / TICK) * TICK);

export function isSampleSymbol(symbol: string): boolean {
  return normalizeSymbol(symbol) in PROFILES;
}

/** Trading days (NSE calendar) from `from` to `to`, inclusive. */
export function tradingDaysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const span = calendarDaysBetween(from, to);
  if (!Number.isFinite(span) || span < 0) return out;
  for (let i = 0; i <= span; i++) {
    const d = addCalendarDays(from, i);
    if (isTradingDay(d)) out.push(d);
  }
  return out;
}

/** The shared market path: daily India VIX close and the standardised market shock for each session. */
function marketPath(dates: string[]): Array<{ vix: number; shock: number }> {
  const rand = mulberry32(sampleSeed("INDIAVIX", "backtest-sample-v1"));
  const gauss = gaussianSource(rand);
  const theta = Math.log(13.8);
  let lnV = Math.log(12.6);
  const out: Array<{ vix: number; shock: number }> = [];
  for (let i = 0; i < dates.length; i++) {
    const shock = gauss();
    const idio = gauss();
    // VIX rises when the market falls (ρ ≈ −0.7), mean-reverts over ~5 weeks, and spikes now and then.
    const jump = rand() < 0.018 ? 0.18 + 0.25 * rand() : 0;
    lnV += 0.035 * (theta - lnV) + 0.055 * (-0.7 * shock + 0.714 * idio) + jump;
    lnV = Math.min(Math.max(lnV, Math.log(9.5)), Math.log(38));
    out.push({ vix: Math.round(Math.exp(lnV) * 100) / 100, shock: jump > 0 ? -Math.abs(shock) - 1.2 : shock });
  }
  return out;
}

/** Listed expiries to carry on a day: the next four, plus any monthly within 70 days (NIFTY), or the next three monthlies. */
function expiriesFor(symbol: string, date: string): string[] {
  const list = getExpiries(symbol, toISTDate(date, "09:15"), 10);
  const out: string[] = [];
  for (const [i, e] of list.entries()) {
    const dte = calendarDaysBetween(date, e.date);
    if (i < 4 || (e.type === "monthly" && dte <= 70)) out.push(e.date);
  }
  return out.slice(0, 6);
}

function buildChain(symbol: string, date: string, expiry: string, spot: number, atmIvBase: number, noise: () => number): EodChain {
  const step = getStrikeStep(symbol);
  const q = getDividendYield(symbol);
  const T = timeToExpiryYears(expiry, toISTDate(date, "15:30"));
  const F = spot * Math.exp((R - q) * Math.max(T, 0));
  const strikes: number[] = [];
  const ce: Array<number | null> = [];
  const pe: Array<number | null> = [];
  // Mild upward-sloping term structure.
  const atmIv = atmIvBase * (1 + 0.04 * Math.log(Math.max(T * 52, 0.5)));
  const sdT = atmIv * Math.sqrt(Math.max(T, 1 / 365));
  const width = Math.min(0.2, Math.max(0.08, 2.6 * sdT));
  const lo = Math.ceil((spot * (1 - width)) / step) * step;
  const hi = Math.floor((spot * (1 + width)) / step) * step;
  for (let K = lo; K <= hi; K += step) {
    strikes.push(K);
    if (T <= 0) {
      // Expiry day: the contract closes at intrinsic on the index close.
      ce.push(Math.round(Math.max(spot - K, 0) * 20) / 20);
      pe.push(Math.round(Math.max(K - spot, 0) * 20) / 20);
      continue;
    }
    const z = Math.log(K / F) / Math.max(sdT, 1e-6);
    const iv = sampleSmile(atmIv, z);
    const wobble = 1 + 0.006 * noise();
    ce.push(roundTick(black76Price({ F, K, T, r: R, sigma: iv, type: "CE" }) * wobble));
    pe.push(roundTick(black76Price({ F, K, T, r: R, sigma: iv, type: "PE" }) * wobble));
  }
  return { expiry, strikes, ce, pe, fut: Math.round(F * 20) / 20 };
}

/**
 * Generate the sample dataset for one symbol. Identical output for identical arguments.
 * Unknown symbols fall back to the NIFTY profile.
 */
export function generateSampleDataset(symbol: string, range: { from: string; to: string } = SAMPLE_RANGE): EodDataset {
  const sym = isSampleSymbol(symbol) ? normalizeSymbol(symbol) : "NIFTY";
  const p = PROFILES[sym];
  // The market path always starts at SAMPLE_RANGE.from so a sub-range is a slice of the same history.
  const allDates = tradingDaysInRange(SAMPLE_RANGE.from, SAMPLE_RANGE.to > range.to ? SAMPLE_RANGE.to : range.to);
  const market = marketPath(allDates);
  const rand = mulberry32(sampleSeed(sym, "backtest-sample-v1", 7));
  const gauss = gaussianSource(rand);
  const noise = gaussianSource(mulberry32(sampleSeed(sym, "backtest-noise-v1")));
  const dt = 1 / 252;
  let spot = p.spot;
  const days: EodDay[] = [];
  for (let i = 0; i < allDates.length; i++) {
    const date = allDates[i];
    const { vix, shock } = market[i];
    if (i > 0) {
      // Realised volatility runs at ~90% of implied, the usual variance risk premium.
      const sigma = (vix / 100) * 0.9 * p.ivMult;
      const z = p.beta * shock * 0.9 + 0.43 * gauss();
      const zn = z / Math.sqrt(p.beta * p.beta * 0.81 + 0.185);
      spot *= Math.exp((p.drift - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * zn);
    }
    if (date < range.from || date > range.to) continue;
    const close = Math.round(spot * 100) / 100;
    const atmIv = (vix / 100) * p.ivMult;
    const chains = expiriesFor(sym, date).map((e) => buildChain(sym, date, e, close, atmIv, noise));
    days.push({ date, spot: close, vix, chains });
  }
  return { symbol: sym, source: "sample", days };
}
