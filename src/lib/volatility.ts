// Volatility helpers. Everything here is computed from real inputs (live VIX, option chain, VIX history).

export interface ExpectedMove {
  spotPrice: number;
  iv: number;
  daysToExpiry: number;
  expectedMove: number;
  expectedMovePercent: number;
  upperBound1SD: number;
  lowerBound1SD: number;
  upperBound2SD: number;
  lowerBound2SD: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ±1σ move = Spot × IV × √(DTE/365). `iv` is annualised, in percent (e.g. 13.5). */
export function calculateExpectedMove(spotPrice: number, iv: number, daysToExpiry: number): ExpectedMove {
  const ivDecimal = iv / 100;
  const sqrtTime = Math.sqrt(Math.max(daysToExpiry, 0) / 365);
  const move = spotPrice * ivDecimal * sqrtTime;

  return {
    spotPrice,
    iv,
    daysToExpiry,
    expectedMove: round2(move),
    expectedMovePercent: round2(ivDecimal * sqrtTime * 100),
    upperBound1SD: round2(spotPrice + move),
    lowerBound1SD: round2(spotPrice - move),
    upperBound2SD: round2(spotPrice + move * 2),
    lowerBound2SD: round2(spotPrice - move * 2),
  };
}

export interface VolRank {
  current: number;
  /** Where `current` sits between the period low and high, 0–100 */
  rank: number;
  /** Share of observations that were below `current`, 0–100 */
  percentile: number;
  high: number;
  low: number;
  mean: number;
  samples: number;
}

/** IV Rank / Percentile of `current` against a history of closes. Returns null with too little data. */
export function computeVolRank(current: number, history: number[], minSamples = 30): VolRank | null {
  const closes = history.filter((v) => Number.isFinite(v) && v > 0);
  if (closes.length < minSamples || !(current > 0)) return null;

  // Include today's reading so rank stays within 0–100 even when it sets a new high/low.
  const all = [...closes, current];
  const high = Math.max(...all);
  const low = Math.min(...all);
  const rank = high === low ? 50 : ((current - low) / (high - low)) * 100;
  const percentile = (closes.filter((v) => v < current).length / closes.length) * 100;
  const mean = closes.reduce((s, v) => s + v, 0) / closes.length;

  return {
    current,
    rank: Math.round(rank),
    percentile: Math.round(percentile),
    high,
    low,
    mean,
    samples: closes.length,
  };
}

export function volRankLabel(rank: number): { label: string; tone: "bullish" | "warning" | "bearish" } {
  if (rank >= 70) return { label: "High — options expensive vs last year", tone: "bearish" };
  if (rank <= 30) return { label: "Low — options cheap vs last year", tone: "bullish" };
  return { label: "Mid-range", tone: "warning" };
}
