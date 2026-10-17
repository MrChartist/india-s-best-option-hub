/** Hand-built EOD datasets for engine tests (flat-vol Black-76 closes, NSE calendar). */
import { black76Price, forwardFromSpot, timeToExpiryYears, toISTDate } from "@/lib/options";
import type { BacktestConfig, EodChain, EodDataset, EodDay } from "../types";

export const R = 0.065;

export function fixtureChain(date: string, spot: number, expiry: string, iv = 0.15, step = 50, width = 30): EodChain {
  const T = timeToExpiryYears(expiry, toISTDate(date, "15:30"));
  const F = forwardFromSpot(spot, T, R, 0);
  const atm = Math.round(spot / step) * step;
  const strikes: number[] = [];
  const ce: Array<number | null> = [];
  const pe: Array<number | null> = [];
  for (let i = -width; i <= width; i++) {
    const K = atm + i * step;
    strikes.push(K);
    if (T <= 0) {
      ce.push(Math.max(spot - K, 0));
      pe.push(Math.max(K - spot, 0));
      continue;
    }
    const r20 = (x: number) => Math.max(0.05, Math.round(x * 20) / 20);
    ce.push(r20(black76Price({ F, K, T, r: R, sigma: iv, type: "CE" })));
    pe.push(r20(black76Price({ F, K, T, r: R, sigma: iv, type: "PE" })));
  }
  return { expiry, strikes, ce, pe, fut: Math.round(F * 20) / 20 };
}

/** Dataset where every day lists every not-yet-expired expiry from `expiries`. */
export function fixtureDataset(path: Array<[string, number]>, expiries: string[], o: { iv?: number; vix?: number | null; symbol?: string } = {}): EodDataset {
  const days: EodDay[] = path.map(([date, spot]) => ({
    date,
    spot,
    vix: o.vix === undefined ? 14 : o.vix,
    chains: expiries.filter((e) => e >= date).map((e) => fixtureChain(date, spot, e, o.iv ?? 0.15)),
  }));
  return { symbol: o.symbol ?? "NIFTY", source: "sample", days };
}

/** February 2026 sessions (no NSE holidays that month). */
export const FEB_2026 = [
  "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06",
  "2026-02-09", "2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13",
  "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
  "2026-02-23", "2026-02-24",
];
export const FEB_EXPIRIES = ["2026-02-03", "2026-02-10", "2026-02-17", "2026-02-24", "2026-03-31"];

export function flat(spot = 25_000, dates = FEB_2026): Array<[string, number]> {
  return dates.map((d) => [d, spot]);
}

export function baseConfig(patch: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    symbol: "NIFTY",
    templateId: "short-straddle",
    lots: 1,
    series: "nearest",
    timing: "dte",
    dte: 7,
    weekdays: [],
    strikeMode: "template",
    atmOffset: 0,
    delta: 0.2,
    premium: 50,
    profitPct: null,
    stopPct: null,
    maxDaysHeld: null,
    exitDte: null,
    brokerId: "zerodha",
    slippagePct: 0,
    capital: 500_000,
    from: "2026-02-01",
    to: "2026-02-28",
    ...patch,
  };
}
