/**
 * Polls tradingLockState (1CLIQ-TRADE-SPEC.md §5) and exposes the unlock
 * ritual for the two loss-triggered states.
 *
 * Deliberately server-polled rather than optimistic, same reasoning as
 * useRiskStatus: a lock the UI merely *thinks* is cleared is worse than one
 * that lags a couple of seconds behind the real (fail-closed) server state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLockState, lockTradingByUser, clearTradingLock, LOCK_STATES, type TradingLockRecord,
} from "../lib/panicApi";

const POLL_MS = 2000;

const UNKNOWN_LOCK: TradingLockRecord = {
  state: LOCK_STATES.LOCKED_BY_ENGINE_FAULT,
  since: null,
  meta: null,
  reason: "Lock state not yet loaded.",
};

export function useTradingLock() {
  const [lock, setLock] = useState<TradingLockRecord>(UNKNOWN_LOCK);
  const [busy, setBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const next = await fetchLockState(); // never throws — see panicApi.ts
      if (mountedRef.current) setLock(next);
      timer = setTimeout(poll, POLL_MS);
    };
    poll();

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
    };
  }, []);

  const lockNow = useCallback(async () => {
    setBusy(true);
    try {
      const next = await lockTradingByUser();
      setLock(next);
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * `coolingElapsedMs` is measured HERE from `lock.since`, not trusted from
   * any caller-supplied clock — tradingLockState.mjs's requestUnlock() takes
   * it as a plain argument and does no timing of its own (see its header).
   */
  const requestUnlock = useCallback(async (typedFigure: string, actualRealisedLoss: number) => {
    setBusy(true);
    setUnlockError(null);
    try {
      const coolingElapsedMs = lock.since ? Date.now() - lock.since : 0;
      const next = await clearTradingLock({ typedFigure, actualRealisedLoss, coolingElapsedMs });
      setLock(next);
      return true;
    } catch (e) {
      setUnlockError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [lock.since]);

  const unlockDirect = useCallback(async () => {
    // No friction for unlocked / locked-by-user (tradingLockState.mjs's
    // requestUnlock treats both as ok:true with no cooling/typed-figure ritual).
    setBusy(true);
    setUnlockError(null);
    try {
      const next = await clearTradingLock();
      setLock(next);
      return true;
    } catch (e) {
      setUnlockError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    lock,
    isLocked: lock.state !== LOCK_STATES.UNLOCKED,
    isLossTriggered: lock.state === LOCK_STATES.LOCKED_BY_MTM_LOSS || lock.state === LOCK_STATES.LOCKED_BY_DAILY_LOSS_LIMIT,
    busy,
    unlockError,
    lockNow,
    requestUnlock,
    unlockDirect,
  };
}
