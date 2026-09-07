/**
 * Client for the panic layer's HTTP surface (1CLIQ-TRADE-SPEC.md §5,
 * proxy-server.mjs's panic-close-all/panic-cancel-all/panic-lock-state/
 * panic-set-lock cases).
 *
 * Every call mints its own intentId client-side (spec §8: "every keypress
 * mints an intentId") — the server accepts one from the body when present
 * (panicIntentId() in proxy-server.mjs) rather than always generating its own,
 * so the audit trail can be correlated back to the exact F6/F7 press.
 */

import { getDhanEndpoint, postDhanEndpoint } from "@/lib/dhanProxyClient";

function newIntentId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Close-all / cancel-all ──
// Shapes mirror server/lib/panicLayer.mjs's closeAll()/cancelAll() returns.
// Only the fields the UI actually reports on are typed strictly; the wave/pass
// internals are kept loose since they're for the audit log, not the badge.

export interface CancelSweepResult {
  success: boolean | null;
  remainingOrders: unknown[];
}

export interface CloseSweepResult {
  success: boolean;
  remainingPositions: unknown[];
}

export interface PanicCloseAllResult {
  cancelAll: CancelSweepResult;
  closeAll: CloseSweepResult;
}

/** F6 — cancel every resting order, THEN close every position (server enforces this order). */
export async function panicCloseAll(source: string): Promise<PanicCloseAllResult> {
  return postDhanEndpoint<PanicCloseAllResult>("panic-close-all", { intentId: newIntentId("panic-close"), source });
}

/** F7 — cancel resting orders only; open positions are untouched. */
export async function panicCancelAll(source: string): Promise<CancelSweepResult> {
  return postDhanEndpoint<CancelSweepResult>("panic-cancel-all", { intentId: newIntentId("panic-cancel"), source });
}

// ── Trading lock ──
// Mirrors server/lib/tradingLockState.mjs's LOCK_STATES exactly — do not
// hand-roll the string literals at call sites, so a typo can't silently
// fail an `===` comparison against a state the server will never send.
export const LOCK_STATES = {
  UNLOCKED: "unlocked",
  LOCKED_BY_USER: "locked-by-user",
  LOCKED_BY_MTM_LOSS: "locked-by-mtm-loss",
  LOCKED_BY_DAILY_LOSS_LIMIT: "locked-by-daily-loss-limit",
  LOCKED_BY_ENGINE_FAULT: "locked-by-engine-fault",
} as const;

export type LockStateName = (typeof LOCK_STATES)[keyof typeof LOCK_STATES];

export interface TradingLockRecord {
  state: LockStateName;
  since: number | null;
  meta: Record<string, unknown> | null;
  /** Present only on a fail-closed read (corrupt/missing lock file). */
  reason?: string;
}

/**
 * Never throws — a network failure here must read as the strictest state,
 * exactly like the server's own getLockState() fails closed on a bad file
 * (tradingLockState.mjs's header). A trader must never see "unlocked" because
 * this request happened to drop.
 */
export async function fetchLockState(): Promise<TradingLockRecord> {
  try {
    return await getDhanEndpoint<TradingLockRecord>("panic-lock-state");
  } catch (e) {
    return {
      state: LOCK_STATES.LOCKED_BY_ENGINE_FAULT,
      since: null,
      meta: null,
      reason: `Could not reach the trading-lock endpoint: ${(e as Error).message}`,
    };
  }
}

/** User-initiated lock. No friction — matches tradingLockState.mjs's requestUnlock(). */
export async function lockTradingByUser(): Promise<TradingLockRecord> {
  return postDhanEndpoint<TradingLockRecord>("panic-set-lock", { state: LOCK_STATES.LOCKED_BY_USER });
}

/**
 * Clear a lock. For the two loss-triggered states the server enforces a
 * 10-minute cooling timer plus a typed-figure match (spec §5: "the friction
 * is the product") — this just forwards whatever the unlock form collected;
 * the server is the one that actually judges it (requestUnlock()).
 */
export async function clearTradingLock(args: {
  typedFigure?: string;
  actualRealisedLoss?: number;
  coolingElapsedMs?: number;
} = {}): Promise<TradingLockRecord> {
  return postDhanEndpoint<TradingLockRecord>("panic-set-lock", { state: LOCK_STATES.UNLOCKED, ...args });
}
