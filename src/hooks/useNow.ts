/**
 * Shared clock: `useNow(ms)` re-renders every `ms` milliseconds, aligned to the wall-clock boundary
 * (a 60 s clock ticks just after each minute, so 15:30 IST rollovers land on time), and refreshes
 * when the tab becomes visible again.
 *
 * All components that ask for the same period share ONE timer through useSyncExternalStore, instead
 * of each mounted copy running its own interval and drifting from the others.
 */
import { useSyncExternalStore } from "react";

interface ClockStore {
  ms: number;
  now: Date;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => Date;
}

const stores = new Map<number, ClockStore>();
/** Fire a little after the boundary so the new minute/second is already current. */
const ALIGN_SLACK_MS = 50;

const bucket = (t: number, ms: number) => Math.floor(t / ms);

function createStore(ms: number): ClockStore {
  const store: ClockStore = {
    ms,
    now: new Date(),
    listeners: new Set(),
    timer: null,
    subscribe: (cb) => {
      store.listeners.add(cb);
      if (store.listeners.size === 1) start();
      return () => {
        store.listeners.delete(cb);
        if (store.listeners.size === 0) stop();
      };
    },
    getSnapshot: () => {
      // Idle stores have no timer; refresh on read once the period has rolled over (stable within a period).
      if (store.listeners.size === 0 && bucket(Date.now(), ms) !== bucket(store.now.getTime(), ms)) store.now = new Date();
      return store.now;
    },
  };

  const emit = () => {
    store.now = new Date();
    store.listeners.forEach((l) => l());
  };
  const schedule = () => {
    const slack = ms >= 1000 ? ALIGN_SLACK_MS : 0;
    const delay = ms - (Date.now() % ms) + slack;
    store.timer = setTimeout(() => {
      emit();
      schedule();
    }, delay);
  };
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") emit();
  };
  const start = () => {
    if (bucket(Date.now(), ms) !== bucket(store.now.getTime(), ms)) store.now = new Date();
    schedule();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  };
  const stop = () => {
    if (store.timer !== null) clearTimeout(store.timer);
    store.timer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
  };
  return store;
}

function getStore(ms: number): ClockStore {
  const period = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 1000;
  let s = stores.get(period);
  if (!s) {
    s = createStore(period);
    stores.set(period, s);
  }
  return s;
}

/** Current time, refreshed every `ms` (default 1 s), aligned to the boundary and shared across components. */
export function useNow(ms = 1000): Date {
  const store = getStore(ms);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
