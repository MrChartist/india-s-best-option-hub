/**
 * Spot-referenced SL/Target maths — 1Cliq's headline differentiator, and the
 * single most money-losing place to get a sign wrong (see 1CLIQ-TRADE-SPEC.md
 * §4 and §13 #3: "Sign inversion on SELL/PE legs — the 'stop' sits on the
 * profitable side; zero protection on the losing side").
 *
 * The whole file hangs off one idea: whatever the leg (BUY/SELL x CE/PE),
 * `bias` folds it down to a single +1/-1 so every other function can work in
 * "adv" (advantage) space, where positive always means "the trade is doing
 * well" regardless of which raw direction the spot is moving. Getting `bias`
 * right once and reusing it everywhere is what prevents four separate
 * hand-derived sign conventions from drifting apart.
 *
 * `nextStopAdv`'s Math.max(currentStopAdv, candidate) is the ratchet
 * invariant: a trailing stop that can go backwards is not a stop, it is a
 * suggestion. Every trailing mode below computes a *candidate* and the ratchet
 * is applied uniformly on the way out, so no mode can special-case its way
 * around it.
 */

/** +1 if the position profits from spot rising, -1 if it profits from spot falling. */
export function bias(side, optionType) {
  return (side === "BUY" ? 1 : -1) * (optionType === "CE" ? 1 : -1);
}

/** Points in the trade's favour, sign-normalised so SL/Target logic is direction-agnostic. */
export function computeAdv(spot, s0, side, optionType) {
  return bias(side, optionType) * (spot - s0);
}

/** Absolute spot level at which the SL fires, for display and for broker-resident protection. */
export function slLevel(s0, side, optionType, slPts) {
  return s0 - bias(side, optionType) * slPts;
}

/** Absolute spot level at which the Target fires, for display. */
export function tgtLevel(s0, side, optionType, tgtPts) {
  return s0 + bias(side, optionType) * tgtPts;
}

/** `<=`, not `<` — a gap-through past the level must still fire, not wait for an exact print. */
export function shouldTriggerSL(adv, slPts) {
  return adv <= -slPts;
}

/** `>=`, not `>` — same gap-through reasoning as shouldTriggerSL. */
export function shouldTriggerTarget(adv, tgtPts) {
  return adv >= tgtPts;
}

/**
 * Arm-time sanity check: the target must sit beyond the SL in the favourable
 * direction, not on top of or behind it. Because slLevel/tgtLevel both derive
 * from the same `bias`, this collapses algebraically to `slPts + tgtPts > 0`
 * — which is exactly the point. It is a direction-agnostic invariant that
 * holds regardless of leg, so it catches a zero/negative-points config the
 * same way for all four combinations without a single per-leg special case.
 */
export function validateArmConfig(s0, side, optionType, slPts, tgtPts) {
  const b = bias(side, optionType);
  const sl = slLevel(s0, side, optionType, slPts);
  const tgt = tgtLevel(s0, side, optionType, tgtPts);
  if (b * (tgt - sl) <= 0) {
    return {
      ok: false,
      reason:
        `Invalid SL/Target: target level ${tgt} is not beyond SL level ${sl} ` +
        `in the favourable direction for this leg (bias ${b}).`,
    };
  }
  return { ok: true };
}

/** Trailing-mode identifiers accepted by nextStopAdv. */
export const TRAIL_MODES = Object.freeze({
  FIXED_POINT: "fixed-point",
  PERCENTAGE_GIVEBACK: "percentage-giveback",
  STEP_RATCHET: "step-ratchet",
});

/**
 * Computes the next trailing-stop level in `adv` space and applies the
 * ratchet invariant. `mfe` (max favourable excursion) is a running max
 * maintained by the caller — this function does not compute it — so calling
 * this once per tick with a monotonically non-decreasing `mfe` is what makes
 * the non-decreasing `stopAdv` property hold.
 *
 * Each mode computes a `candidate` and nothing else; the final
 * `Math.max(currentStopAdv, candidate)` is the one place the ratchet is
 * enforced, so no mode can accidentally lower the stop.
 *
 * @param {string} mode one of TRAIL_MODES
 * @param {object} params mode-specific params (see below)
 * @param {number} mfe running max of adv observed so far
 * @param {number} currentStopAdv the stop before this tick (initial value is `-slPts`)
 * @param {number} slPts the leg's original SL distance, used as the step-ratchet baseline
 *
 * Param shapes:
 *  - fixed-point:          { activation, trailPts }
 *  - percentage-giveback:  { p }               // give back fraction p of mfe, 0 < p < 1
 *  - step-ratchet:         { A, stepX, stepY }  // every stepX pts of mfe past A, stop moves up stepY
 */
export function nextStopAdv(mode, params, mfe, currentStopAdv, slPts) {
  let candidate = -Infinity; // "skip" — leaves currentStopAdv untouched via Math.max below

  if (mode === TRAIL_MODES.FIXED_POINT) {
    const { activation, trailPts } = params;
    if (mfe >= activation) candidate = mfe - trailPts;
  } else if (mode === TRAIL_MODES.PERCENTAGE_GIVEBACK) {
    const { p } = params;
    if (mfe > 0) candidate = mfe * (1 - p);
  } else if (mode === TRAIL_MODES.STEP_RATCHET) {
    const { A, stepX, stepY } = params;
    const steps = mfe >= A ? Math.floor((mfe - A) / stepX) : 0;
    candidate = -slPts + steps * stepY;
  } else {
    // A config bug here is a stop that silently never trails. Fail loudly
    // instead, matching buildOrderBody's "throw on invalid enum" precedent.
    throw new Error(`Unknown trailing mode: ${mode}`);
  }

  return Math.max(currentStopAdv, candidate);
}
