/**
 * Client for the server risk engine's HTTP surface (1CLIQ-TRADE-SPEC.md §3/§4,
 * proxy-server.mjs's risk-status/risk-arm/risk-disarm cases).
 *
 * Deliberately thin — every real decision (the sign math, the synchronous
 * CAS, the dead-man's switch) lives on the server. This file only shapes the
 * three requests/responses so the rest of the terminal never touches
 * fetch()/URLSearchParams directly.
 */

import { getDhanEndpoint, postDhanEndpoint } from "@/lib/dhanProxyClient";
import type { OptionType, Side } from "./riskLevels";

/** Mirrors proxy-server.mjs's risk-status payload exactly (spec §4's dead-man's switch). */
export interface RiskStatus {
  alive: boolean;
  lastTickAgeMs: number | null;
  armedCount: number;
  dhanConnected: boolean;
}

export interface TrailingConfig {
  mode: "FIXED" | "PERCENT" | "STEP";
  params: Record<string, number>;
}

/** Matches riskEngine.armPosition's config shape — see server/lib/riskEngine.mjs's JSDoc. */
export interface ArmRiskConfig {
  exchangeSegment: string;
  securityId: string | number;
  s0: number;
  side: Side;
  optionType: OptionType;
  slPts: number;
  tgtPts: number;
  trailing?: TrailingConfig | null;
  /** Opaque payload the engine hands back to exitExecutor verbatim on trigger. */
  order?: Record<string, unknown> | null;
}

/**
 * Never resolves silently on a fail-closed status — a network error reads as
 * "not alive" rather than throwing, because the one thing worse than an honest
 * "engine status unknown" badge is a stale "alive" one nobody caught.
 */
export async function fetchRiskStatus(): Promise<RiskStatus> {
  try {
    return await getDhanEndpoint<RiskStatus>("risk-status");
  } catch {
    return { alive: false, lastTickAgeMs: null, armedCount: 0, dhanConnected: false };
  }
}

/**
 * Arm a managed SL/Target position. Throws with the server's verbatim
 * rejection reason (riskArmValidation.mjs) — never invents a friendlier one,
 * per spec §5's "the friction is the product" ethos applied to error copy.
 */
export async function armRiskPosition(config: ArmRiskConfig): Promise<{ ok: true; id: string }> {
  return postDhanEndpoint<{ ok: true; id: string }>("risk-arm", config);
}

export async function disarmRiskPosition(id: string): Promise<{ ok: true }> {
  return postDhanEndpoint<{ ok: true }>("risk-disarm", { id });
}
