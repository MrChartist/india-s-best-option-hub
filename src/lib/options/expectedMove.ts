/** Expected move from IV (log-space bounds) and from the ATM straddle. */

/**
 * k-sigma expected move from IV: bounds F·e^{±kσ√T}; move is the half-width of that band,
 * (upper − lower)/2 = F·sinh(kσ√T) (slightly above the downside distance, slightly below the
 * upside distance). pct is move/F × 100. This is the app's single definition of the IV-implied
 * move; chainModel.oneSigmaPoints delegates to it.
 */
export function expectedMoveFromIV(F: number, sigma: number, T: number, k = 1): { move: number; upper: number; lower: number; pct: number } {
  if (![F, sigma, T, k].every((x) => typeof x === "number" && Number.isFinite(x)) || F <= 0 || sigma < 0 || T < 0) {
    return { move: NaN, upper: NaN, lower: NaN, pct: NaN };
  }
  const sd = k * sigma * Math.sqrt(T);
  const upper = F * Math.exp(sd);
  const lower = F * Math.exp(-sd);
  const move = (upper - lower) / 2;
  return { move, upper, lower, pct: (move / F) * 100 };
}

/**
 * Straddle-implied "typical move": 0.85 × ATM straddle.
 *
 * An ATM straddle prices the expected absolute move, E|ΔS| ≈ √(2/π)·σ√T·S ≈ 0.8σ. So
 * 0.85 × straddle ≈ 0.68σ: roughly a 50% band (half of outcomes land inside), NOT a one standard
 * deviation move. A 1σ band would be ≈ 1.25 × straddle.
 */
export function expectedMoveFromStraddle(straddle: number, spot: number): { move: number; upper: number; lower: number; pct: number } {
  if (!Number.isFinite(straddle) || !Number.isFinite(spot) || straddle < 0 || spot <= 0) return { move: NaN, upper: NaN, lower: NaN, pct: NaN };
  const move = 0.85 * straddle;
  return { move, upper: spot + move, lower: spot - move, pct: (move / spot) * 100 };
}

/** Share (0-1) of past periods whose close stayed within the expected move. NaN for empty history. */
export function emHitRate(history: Array<{ spotAtStart: number; move: number; close: number }>): number {
  const valid = (Array.isArray(history) ? history : []).filter(
    (h) => h && Number.isFinite(h.spotAtStart) && Number.isFinite(h.move) && Number.isFinite(h.close) && h.move >= 0,
  );
  if (valid.length === 0) return NaN;
  const hits = valid.filter((h) => Math.abs(h.close - h.spotAtStart) <= h.move).length;
  return hits / valid.length;
}
