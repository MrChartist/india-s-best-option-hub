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
 * One-sigma move in log space, σ·√T, with the floors each caller needs made explicit:
 * - `minT` (default one day, 1/365) so an expiring contract still has a visible band;
 * - `minSigma` floors the IV before scaling (guards a missing or zero IV);
 * - `minSd` floors the result (keeps a grid or chart from collapsing to a point).
 */
export function expectedMoveSigma(sigma: number, T: number, opts: { minT?: number; minSigma?: number; minSd?: number } = {}): number {
  const { minT = 1 / 365, minSigma = 0, minSd = 0 } = opts;
  const s = Math.max(Number.isFinite(sigma) ? sigma : 0, minSigma);
  const t = Math.max(Number.isFinite(T) ? T : 0, minT);
  return Math.max(s * Math.sqrt(t), minSd);
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

export interface ExpectedMoveBand {
  move: number;
  upper: number;
  lower: number;
  pct: number;
}

export type ExpectedMoveMethod = "iv" | "straddle";

/** Short tags to show next to a move so readers know which definition they are looking at. */
export const EM_METHOD_LABEL: Record<ExpectedMoveMethod, string> = { iv: "IV 1σ", straddle: "Straddle ×0.85" };

/**
 * Both expected-move definitions side by side.
 *  - `iv`: 1σ band from ATM IV around the forward (spot when no forward is given); see expectedMoveFromIV.
 *  - `straddle`: 0.85 × ATM straddle around spot (≈ a 50% band); null when no usable straddle is given.
 * Invalid inputs give NaN fields for `iv` rather than throwing.
 */
export function expectedMoves(o: { spot: number; forward?: number; atmIv: number; tYears: number; straddle?: number }): {
  iv: ExpectedMoveBand;
  straddle: ExpectedMoveBand | null;
} {
  const spot = Number(o?.spot);
  const centre = typeof o?.forward === "number" && Number.isFinite(o.forward) && o.forward > 0 ? o.forward : spot;
  const iv = expectedMoveFromIV(centre, Number(o?.atmIv), Number(o?.tYears));
  const st = o?.straddle;
  const straddle = typeof st === "number" && Number.isFinite(st) && st > 0 && spot > 0 ? expectedMoveFromStraddle(st, spot) : null;
  return { iv, straddle };
}
