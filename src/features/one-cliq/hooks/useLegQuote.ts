/**
 * Live quote for one instrument, scoped so a tick re-renders only this cell.
 *
 * Uses useSyncExternalStore over the per-instrument tick store rather than a
 * useState in a parent, which is what keeps a 40-row grid from repainting
 * wholesale on every tick.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { tickKey, type InstrumentRef } from "@/lib/instrumentKeys";
import { subscribeTick, getTickSnapshot } from "../lib/tickStore";
import type { LegQuote } from "../types";

const EMPTY: LegQuote = {
  ltp: null, open: null, high: null, low: null,
  prevClose: null, change: null, changePercent: null, ageMs: null,
};

/**
 * @param ref instrument to watch, or null when nothing is selected yet
 *   (an unresolved strike, or a chain that has not loaded)
 */
export function useLegQuote(ref: InstrumentRef | null): LegQuote {
  const key = ref ? tickKey(ref.exchangeSegment, ref.securityId) : null;

  const subscribe = useCallback((onChange: () => void) => {
    if (!ref) return () => {};
    return subscribeTick(ref, onChange);
    // Re-subscribe when the instrument changes — that is the arrow-key strike
    // step, which happens several times a minute during a scalp.
  }, [ref?.exchangeSegment, ref?.securityId]); // eslint-disable-line react-hooks/exhaustive-deps

  const getSnapshot = useCallback(() => (key ? getTickSnapshot(key) : undefined), [key]);

  const tick = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => {
    if (!tick) return EMPTY;
    const ltp = Number.isFinite(tick.ltp) ? (tick.ltp as number) : null;
    const prevClose = Number.isFinite(tick.prevClose)
      ? (tick.prevClose as number)
      : (Number.isFinite(tick.close) ? (tick.close as number) : null);

    // Prefer the server's computed change; derive it only when absent, and only
    // when prevClose is non-zero — a far-OTM strike can legitimately close at 0.
    const change = Number.isFinite(tick.change)
      ? (tick.change as number)
      : (ltp !== null && prevClose ? ltp - prevClose : null);
    const changePercent = Number.isFinite(tick.changePercent)
      ? (tick.changePercent as number)
      : (change !== null && prevClose ? (change / prevClose) * 100 : null);

    return {
      ltp,
      open: Number.isFinite(tick.open) ? (tick.open as number) : null,
      high: Number.isFinite(tick.high) ? (tick.high as number) : null,
      low: Number.isFinite(tick.low) ? (tick.low as number) : null,
      prevClose,
      change,
      changePercent,
      ageMs: tick.timestamp ? Date.now() - tick.timestamp : null,
    };
  }, [tick]);
}
