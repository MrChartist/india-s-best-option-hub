/**
 * Referential stability for the chain table.
 *
 * buildChainModel rebuilds every RowView on each poll, so a memoised ChainRow would re-render
 * all ~30 rows even when one quote ticked. These helpers reuse the previous object whenever the
 * fields a row actually renders are unchanged, so only the rows that moved commit.
 */
import { useCallback, useLayoutEffect, useRef } from "react";
import type { LegView, RowView } from "./chainModel";
import type { GammaBadge } from "./gammaLevels";

/** Raw feed fields of a leg that drive what the row shows. */
const LEG_FIELDS = ["ltp", "oi", "oiChange", "volume", "iv", "delta", "gamma", "theta", "vega", "bidPrice", "askPrice", "change", "pChange"] as const;

const same = (a: unknown, b: unknown) => a === b || (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b));

/** True when two leg views render identically: same feed fields, moneyness and derived flags. */
export function legViewEqual(a: LegView, b: LegView): boolean {
  if (a === b) return true;
  if (a.itm !== b.itm || a.buildup !== b.buildup || a.ivDerived !== b.ivDerived || a.greeksDerived !== b.greeksDerived || a.liquidity !== b.liquidity) return false;
  const la = a.leg as unknown as Record<string, unknown>;
  const lb = b.leg as unknown as Record<string, unknown>;
  for (const f of LEG_FIELDS) if (!same(la[f], lb[f])) return false;
  return true;
}

export function rowViewEqual(a: RowView, b: RowView): boolean {
  return a === b || (a.strike === b.strike && legViewEqual(a.ce, b.ce) && legViewEqual(a.pe, b.pe));
}

/**
 * Return `next`, but with each row replaced by its previous object when nothing it renders changed.
 * When every row is reused and the length matches, the previous array itself is returned.
 */
export function stabiliseRows(prev: readonly RowView[] | undefined, next: RowView[]): RowView[] {
  if (!prev || prev.length === 0) return next;
  const byStrike = new Map<number, RowView>();
  for (const r of prev) byStrike.set(r.strike, r);
  let allReused = prev.length === next.length;
  const out = next.map((r, i) => {
    const old = byStrike.get(r.strike);
    if (old && rowViewEqual(old, r)) {
      if (allReused && prev[i] !== old) allReused = false;
      return old;
    }
    allReused = false;
    return r;
  });
  return allReused ? (prev as RowView[]) : out;
}

/** Same idea for strike → badge lists: equal lists keep their previous array identity. */
export function stabiliseBadgeMap(prev: Map<number, GammaBadge[]> | undefined, next: Map<number, GammaBadge[]>): Map<number, GammaBadge[]> {
  if (!prev || prev.size === 0) return next;
  const out = new Map<number, GammaBadge[]>();
  let allReused = prev.size === next.size;
  for (const [k, list] of next) {
    const old = prev.get(k);
    if (old && old.length === list.length && old.every((b, i) => b === list[i])) out.set(k, old);
    else {
      out.set(k, list);
      allReused = false;
    }
  }
  return allReused ? prev : out;
}

function useStabilised<T>(next: T, stabilise: (prev: T | undefined, next: T) => T): T {
  const ref = useRef<T | undefined>(undefined);
  const value = stabilise(ref.current, next);
  // Commit the value after render so an aborted (concurrent) render cannot poison the cache.
  useLayoutEffect(() => {
    ref.current = value;
  });
  return value;
}

/** Rows with stable identities across polls (see stabiliseRows). */
export function useStableRows(rows: RowView[]): RowView[] {
  return useStabilised(rows, stabiliseRows);
}

/** Gamma badge map whose per-strike arrays keep their identity while unchanged. */
export function useStableBadgeMap(map: Map<number, GammaBadge[]>): Map<number, GammaBadge[]> {
  return useStabilised(map, stabiliseBadgeMap);
}

/**
 * A callback with a permanent identity that always calls the latest `fn`. Lets row handlers stay
 * stable while the model they read changes on every poll.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useLatestCallback<A extends any[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
