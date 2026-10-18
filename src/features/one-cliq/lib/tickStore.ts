/**
 * External tick store for useSyncExternalStore.
 *
 * The problem this solves: the existing useWebSocket hook clones a Map on every
 * tick (`new Map(prev)`), so a single price update re-renders every consumer.
 * With 3 live quote tiles plus a positions grid, that repaints the whole
 * terminal at tick rate — and drops frames exactly when the user is trying to
 * hit an order button.
 *
 * Here each instrument has its own version counter and its own subscriber set,
 * so a tick on one strike re-renders only the cells watching that strike.
 *
 * Tick delivery is coalesced through requestAnimationFrame: the feed can push
 * faster than the display refreshes, and rendering more often than that is
 * wasted work.
 */

import { marketWS, type TickData } from "@/lib/websocketClient";
import { tickKey, type InstrumentRef } from "@/lib/instrumentKeys";

type Listener = () => void;

const snapshots = new Map<string, TickData>();
const listeners = new Map<string, Set<Listener>>();
const dirty = new Set<string>();
/** Live feed subscriptions, refcounted by this store. */
const feedUnsubs = new Map<string, { unsub: () => void; refs: number }>();

let flushHandle: number | null = null;

function scheduleFlush() {
  if (flushHandle !== null) return;
  const raf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;

  flushHandle = raf(() => {
    flushHandle = null;
    const keys = [...dirty];
    dirty.clear();
    for (const key of keys) listeners.get(key)?.forEach((fn) => fn());
  }) as unknown as number;
}

function ingest(tick: TickData, key: string) {
  const prev = snapshots.get(key);
  // Merge, because Dhan sends prevClose and OI in separate packets from LTP —
  // replacing wholesale would blank the day range between packets.
  snapshots.set(key, prev ? { ...prev, ...tick } : tick);
  dirty.add(key);
  scheduleFlush();
}

/**
 * Subscribe to one instrument's ticks. Returns the unsubscribe function.
 * Refcounted: the underlying feed subscription is released when the last
 * component watching this instrument unmounts.
 */
export function subscribeTick(ref: InstrumentRef, onChange: Listener): () => void {
  const key = tickKey(ref.exchangeSegment, ref.securityId);

  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(onChange);

  const entry = feedUnsubs.get(key);
  if (entry) {
    entry.refs++;
  } else {
    const unsub = marketWS.subscribeInstrument(ref, (tick) => ingest(tick, key));
    feedUnsubs.set(key, { unsub, refs: 1 });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.get(key)?.delete(onChange);
    const e = feedUnsubs.get(key);
    if (!e) return;
    e.refs--;
    if (e.refs > 0) return;
    e.unsub();
    feedUnsubs.delete(key);
    // Keep the last snapshot: remounting the same strike should show its last
    // known price immediately rather than flashing blank.
  };
}

/** Current snapshot for an instrument, or undefined if none has arrived. */
export function getTickSnapshot(key: string): TickData | undefined {
  return snapshots.get(key);
}

/** For tests and for the reconnect path. */
export function __resetTickStore(): void {
  for (const e of feedUnsubs.values()) e.unsub();
  feedUnsubs.clear();
  listeners.clear();
  snapshots.clear();
  dirty.clear();
}
