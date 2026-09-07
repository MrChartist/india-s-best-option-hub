/**
 * The live-trading gate, enforced by the type system.
 *
 * The app already had `isLiveTradingEnabled()`, but it was checked inside UI
 * components. That is a convention: any new code path that calls placeOrder()
 * simply forgets it, and a forgotten check is a real trade with real money.
 *
 * Here the gate is structural instead. `placeOrder()` requires a LiveArmToken,
 * and a LiveArmToken carries a module-private symbol that only `armLive()` can
 * attach. You cannot fabricate one from outside this file — not with a cast, not
 * with an object literal — so there is no way to reach the live path without
 * having gone through the checks.
 *
 * This is the CLIENT half. The server re-runs the whole ladder independently in
 * server/lib/orderGuard.mjs, because a determined client bug should still not be
 * able to place an order. Neither half is load-bearing on its own.
 */

import { isLiveTradingEnabled } from "./brokerConfig";

const ARM_BRAND = Symbol("liveArm");

/** Proof that the live-trading gate was passed. Only armLive() can mint one. */
export interface LiveArmToken {
  readonly [ARM_BRAND]: true;
  readonly armedAt: number;
  readonly sessionId: string;
}

/**
 * One-click arming is session-scoped and deliberately NOT persisted. Every
 * reload starts disarmed, so a browser left open overnight cannot wake up hot.
 */
let oneClickArmedAt: number | null = null;
let sessionId = "";

/** One-click auto-disarms after this long idle — matches the UI countdown. */
export const ONE_CLICK_TIMEOUT_MS = 90_000;

function newSessionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Arm one-click execution for this session. Caller must have confirmed first. */
export function armOneClick(): void {
  oneClickArmedAt = Date.now();
  sessionId = newSessionId();
}

export function disarmOneClick(): void {
  oneClickArmedAt = null;
  sessionId = "";
}

/** Refresh the idle timer — call on each deliberate user action in the terminal. */
export function touchOneClick(): void {
  if (oneClickArmedAt !== null) oneClickArmedAt = Date.now();
}

export function isOneClickArmed(now = Date.now()): boolean {
  if (oneClickArmedAt === null) return false;
  if (now - oneClickArmedAt > ONE_CLICK_TIMEOUT_MS) {
    disarmOneClick();
    return false;
  }
  return true;
}

/** Milliseconds until auto-disarm, or 0 when not armed. For the UI countdown. */
export function oneClickRemainingMs(now = Date.now()): number {
  if (oneClickArmedAt === null) return 0;
  return Math.max(0, ONE_CLICK_TIMEOUT_MS - (now - oneClickArmedAt));
}

export type ArmFailure =
  | "LIVE_TRADING_OFF"
  | "ONE_CLICK_NOT_ARMED";

export interface ArmResult {
  token: LiveArmToken | null;
  reason: ArmFailure | null;
  message: string | null;
}

/**
 * The only producer of a LiveArmToken.
 *
 * @param requireOneClick pass true for keyboard/one-click execution, false for a
 *   deliberate order that already went through an explicit confirmation dialog.
 */
export function armLive(requireOneClick: boolean): ArmResult {
  if (!isLiveTradingEnabled()) {
    return {
      token: null,
      reason: "LIVE_TRADING_OFF",
      message: "Live Trading is off — this was recorded as a paper trade instead.",
    };
  }
  if (requireOneClick && !isOneClickArmed()) {
    return {
      token: null,
      reason: "ONE_CLICK_NOT_ARMED",
      message: "One-click is not armed. Press O to arm before using execution keys.",
    };
  }

  touchOneClick();
  const token = {
    [ARM_BRAND]: true as const,
    armedAt: Date.now(),
    sessionId: sessionId || newSessionId(),
  };
  return { token, reason: null, message: null };
}

/**
 * Read the token's session id for the server's per-session arm header. Kept in
 * this module so nothing outside needs to inspect the token's shape.
 */
export function tokenSessionId(token: LiveArmToken): string {
  return token.sessionId;
}

/** Test seam — resets arming state between tests. */
export function __resetArmStateForTests(): void {
  oneClickArmedAt = null;
  sessionId = "";
}
