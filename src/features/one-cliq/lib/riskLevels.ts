/**
 * Client-side mirror of server/lib/riskMath.mjs's bias/slLevel/tgtLevel —
 * DISPLAY ONLY. The server is the sole authority on whether a trigger fires
 * (1CLIQ-TRADE-SPEC.md §3: "the browser is a view ... it never places an
 * exit for a managed leg"); this exists purely so a "Set SL" cell can show
 * the resolved absolute spot level ("SL if BANKNIFTY ≤ 58,040") before the
 * trader arms it — spec §13 failure mode #3 calls this out by name as the
 * guard against sign inversion: "the trader eyeballs the sign before
 * arming". Keep this in exact lockstep with riskMath.mjs's bias() — the sign
 * convention must never diverge between what the UI shows and what the
 * server actually enforces.
 */

export type Side = "BUY" | "SELL";
export type OptionType = "CE" | "PE";

/** +1 if the position profits from spot rising, -1 if it profits from spot falling. */
export function legBias(side: Side, optionType: OptionType): 1 | -1 {
  return ((side === "BUY" ? 1 : -1) * (optionType === "CE" ? 1 : -1)) as 1 | -1;
}

/** Absolute spot level at which the SL would fire. */
export function slLevel(s0: number, side: Side, optionType: OptionType, slPts: number): number {
  return s0 - legBias(side, optionType) * slPts;
}

/** Absolute spot level at which the Target would fire. */
export function tgtLevel(s0: number, side: Side, optionType: OptionType, tgtPts: number): number {
  return s0 + legBias(side, optionType) * tgtPts;
}

/**
 * Same invariant as riskMath.mjs's validateArmConfig, so the UI can grey out
 * "Arm" before the server ever sees a doomed request: the target must sit
 * beyond the SL in the favourable direction.
 */
export function isArmConfigSane(side: Side, optionType: OptionType, slPts: number, tgtPts: number): boolean {
  return Number.isFinite(slPts) && Number.isFinite(tgtPts) && slPts > 0 && tgtPts > 0;
}
