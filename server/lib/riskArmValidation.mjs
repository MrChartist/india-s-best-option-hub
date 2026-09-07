/**
 * Arm-time validation ladder for riskEngine.armPosition.
 *
 * Factored out of riskEngine.mjs (which was pushing past the repo's 300-line
 * file cap) so "is this arm request well-formed" is one small pure function,
 * testable and readable on its own, separate from the Map/state-machine
 * wiring that actually stores an accepted position.
 *
 * Order matches spec §4: cheap shape/enum checks first, then the one call
 * into riskMath.validateArmConfig that catches the real sign/level invariant
 * (1CLIQ-TRADE-SPEC.md §13 failure mode #3 — "sign inversion on SELL/PE
 * legs"). Every rejection here means riskEngine.armPosition creates nothing.
 */

import { validateArmConfig, TRAIL_MODES } from "./riskMath.mjs";

const VALID_SIDES = new Set(["BUY", "SELL"]);
const VALID_OPTION_TYPES = new Set(["CE", "PE"]);
const VALID_TRAIL_MODES = new Set(Object.values(TRAIL_MODES));

/**
 * @param {object} config see riskEngine.armPosition's JSDoc for the full shape
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function validateArmRequest(config) {
  const { exchangeSegment, securityId, s0, side, optionType, slPts, tgtPts, trailing = null } = config || {};

  if (!exchangeSegment || securityId === undefined || securityId === null || securityId === "") {
    return { ok: false, reason: "Missing exchangeSegment/securityId for the underlying this leg's SL/Target reference." };
  }
  if (!VALID_SIDES.has(side)) {
    return { ok: false, reason: `Invalid side: ${side}. Must be BUY or SELL.` };
  }
  if (!VALID_OPTION_TYPES.has(optionType)) {
    return { ok: false, reason: `Invalid optionType: ${optionType}. Must be CE or PE.` };
  }
  if (!Number.isFinite(s0)) {
    return { ok: false, reason: "s0 (anchor spot price) must be a finite number." };
  }
  if (!Number.isFinite(slPts) || slPts <= 0) {
    return { ok: false, reason: "slPts must be a positive number." };
  }
  if (!Number.isFinite(tgtPts) || tgtPts <= 0) {
    return { ok: false, reason: "tgtPts must be a positive number." };
  }
  if (trailing !== null) {
    if (!trailing || !VALID_TRAIL_MODES.has(trailing.mode)) {
      return { ok: false, reason: `Invalid trailing mode: ${trailing?.mode}` };
    }
    if (!trailing.params || typeof trailing.params !== "object") {
      return { ok: false, reason: "Trailing config requires a params object." };
    }
  }

  // The sign-inversion guard itself — collapses to `slPts + tgtPts > 0`
  // algebraically, but goes through the real function so this ladder never
  // hand-derives the invariant a second time.
  return validateArmConfig(s0, side, optionType, slPts, tgtPts);
}
