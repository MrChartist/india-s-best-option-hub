// Alert model, persistence and pure evaluation logic.
// UI lives in components/AlertSystem.tsx, the runtime in components/AlertEngine.tsx.

import { useSyncExternalStore } from "react";

export type AlertMetric = "price" | "change_pct" | "vix" | "pcr" | "atm_iv";
export type AlertOperator = "above" | "below" | "crosses_above" | "crosses_below";
export type AlertMode = "once" | "repeat";
export type AlertTone = "bullish" | "bearish" | "warning" | "info";

export interface PriceAlert {
  id: string;
  symbol: string;
  metric: AlertMetric;
  operator: AlertOperator;
  value: number;
  mode: AlertMode;
  sound: boolean;
  note?: string;
  active: boolean;
  createdAt: number;
  lastTriggeredAt?: number;
  triggerCount: number;
}

export interface AlertEvent {
  id: string;
  alertId: string;
  symbol: string;
  metric: AlertMetric;
  operator: AlertOperator;
  value: number;
  actual: number;
  at: number;
  note?: string;
}

export interface AlertPrefs {
  sound: boolean;
  browserNotify: boolean;
}

export const VIX_SYMBOL = "INDIAVIX";
export const REPEAT_COOLDOWN_MS = 60_000;
const MAX_HISTORY = 100;

export const METRIC_META: Record<AlertMetric, { label: string; unit: string; needsSymbol: boolean; decimals: number }> = {
  price: { label: "Price", unit: "", needsSymbol: true, decimals: 2 },
  change_pct: { label: "Day change", unit: "%", needsSymbol: true, decimals: 2 },
  vix: { label: "India VIX", unit: "", needsSymbol: false, decimals: 2 },
  pcr: { label: "PCR (OI)", unit: "", needsSymbol: true, decimals: 2 },
  atm_iv: { label: "ATM IV", unit: "%", needsSymbol: true, decimals: 2 },
};

export const OPERATOR_LABEL: Record<AlertOperator, string> = {
  above: "is above",
  below: "is below",
  crosses_above: "crosses above",
  crosses_below: "crosses below",
};

export function toneFor(alert: Pick<PriceAlert, "metric" | "operator">): AlertTone {
  if (alert.metric === "vix" || alert.metric === "atm_iv") return "warning";
  return alert.operator === "above" || alert.operator === "crosses_above" ? "bullish" : "bearish";
}

export function metricKey(symbol: string, metric: AlertMetric): string {
  return `${metric === "vix" ? VIX_SYMBOL : symbol.trim().toUpperCase()}|${metric}`;
}

export function alertMetricKey(alert: Pick<PriceAlert, "symbol" | "metric">): string {
  return metricKey(alert.symbol, alert.metric);
}

export function formatMetricValue(metric: AlertMetric, value: number): string {
  const { decimals, unit } = METRIC_META[metric];
  const text = value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${text}${unit}`;
}

export function describeAlert(a: Pick<PriceAlert, "symbol" | "metric" | "operator" | "value">): string {
  const subject = a.metric === "vix" ? "India VIX" : `${a.symbol} ${METRIC_META[a.metric].label.toLowerCase()}`;
  return `${subject} ${OPERATOR_LABEL[a.operator]} ${formatMetricValue(a.metric, a.value)}`;
}

// ── Pure evaluation ──

export function conditionMet(op: AlertOperator, current: number, target: number, prev?: number): boolean {
  switch (op) {
    case "above": return current > target;
    case "below": return current < target;
    case "crosses_above": return prev !== undefined && prev <= target && current > target;
    case "crosses_below": return prev !== undefined && prev >= target && current < target;
  }
}

/**
 * Decide whether an alert fires on this tick.
 * - above/below are level alerts: they fire on the false→true edge, not on every tick.
 * - crosses_* fire on the tick where the level is actually crossed.
 * - `wasMet` is undefined on the first observation after page load. If the alert has
 *   already fired before, a still-true level is treated as already handled, so reloads
 *   never replay old alerts.
 */
export function shouldFire(
  alert: PriceAlert,
  current: number,
  prev: number | undefined,
  wasMet: boolean | undefined,
  now: number,
): { fire: boolean; met: boolean } {
  const met = conditionMet(alert.operator, current, alert.value, prev);
  const isLevel = alert.operator === "above" || alert.operator === "below";

  let edge: boolean;
  if (isLevel) {
    const before = wasMet ?? (alert.triggerCount > 0);
    edge = met && !before;
  } else {
    edge = met;
  }

  const cooledDown = alert.lastTriggeredAt === undefined || now - alert.lastTriggeredAt >= REPEAT_COOLDOWN_MS;
  return { fire: edge && cooledDown, met };
}

/** Distance from the trigger level as a percentage of that level (positive = still to travel). */
export function distanceToTrigger(alert: Pick<PriceAlert, "operator" | "value">, current: number): number | null {
  if (!alert.value) return null;
  const pct = ((alert.value - current) / Math.abs(alert.value)) * 100;
  const wantsUp = alert.operator === "above" || alert.operator === "crosses_above";
  return wantsUp ? pct : -pct;
}

// ── Store (localStorage-backed, useSyncExternalStore-friendly) ──

const ALERTS_KEY = "mrchartist_alerts_v1";
const HISTORY_KEY = "mrchartist_alert_history_v1";
const PREFS_KEY = "mrchartist_alert_prefs_v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — alerts still work for the session */
  }
}

interface PersistedState {
  alerts: PriceAlert[];
  history: AlertEvent[];
  prefs: AlertPrefs;
}

let state: PersistedState = {
  alerts: read<PriceAlert[]>(ALERTS_KEY, []),
  history: read<AlertEvent[]>(HISTORY_KEY, []),
  prefs: read<AlertPrefs>(PREFS_KEY, { sound: true, browserNotify: false }),
};
let metrics: Record<string, number> = {};
let panelOpen = false;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function commit(next: Partial<PersistedState>) {
  state = { ...state, ...next };
  if (next.alerts) write(ALERTS_KEY, state.alerts);
  if (next.history) write(HISTORY_KEY, state.history);
  if (next.prefs) write(PREFS_KEY, state.prefs);
  emit();
}

export const alertStore = {
  getState: () => state,
  getMetrics: () => metrics,

  add(input: Omit<PriceAlert, "id" | "createdAt" | "triggerCount" | "active"> & { active?: boolean }): PriceAlert {
    const alert: PriceAlert = {
      ...input,
      symbol: input.metric === "vix" ? VIX_SYMBOL : input.symbol.trim().toUpperCase(),
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      triggerCount: 0,
      active: input.active ?? true,
    };
    commit({ alerts: [alert, ...state.alerts] });
    return alert;
  },

  update(id: string, patch: Partial<PriceAlert>) {
    commit({ alerts: state.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  },

  remove(id: string) {
    commit({ alerts: state.alerts.filter((a) => a.id !== id) });
  },

  /** Re-arm: clears trigger history for the alert and turns it back on. */
  rearm(id: string) {
    commit({
      alerts: state.alerts.map((a) => (a.id === id ? { ...a, active: true, triggerCount: 0, lastTriggeredAt: undefined } : a)),
    });
  },

  recordTrigger(alert: PriceAlert, actual: number): AlertEvent {
    const at = Date.now();
    const event: AlertEvent = {
      id: `${at.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      alertId: alert.id,
      symbol: alert.symbol,
      metric: alert.metric,
      operator: alert.operator,
      value: alert.value,
      actual,
      at,
      note: alert.note,
    };
    commit({
      alerts: state.alerts.map((a) =>
        a.id === alert.id
          ? { ...a, lastTriggeredAt: at, triggerCount: a.triggerCount + 1, active: a.mode === "repeat" }
          : a,
      ),
      history: [event, ...state.history].slice(0, MAX_HISTORY),
    });
    return event;
  },

  clearHistory() {
    commit({ history: [] });
  },

  setPrefs(patch: Partial<AlertPrefs>) {
    commit({ prefs: { ...state.prefs, ...patch } });
  },

  /** Merge live readings. Only notifies subscribers when a value actually changed. */
  setMetrics(patch: Record<string, number>) {
    let changed = false;
    const next = { ...metrics };
    for (const [k, v] of Object.entries(patch)) {
      if (Number.isFinite(v) && next[k] !== v) {
        next[k] = v;
        changed = true;
      }
    }
    if (changed) {
      metrics = next;
      emit();
    }
  },

  setPanelOpen(open: boolean) {
    if (panelOpen !== open) {
      panelOpen = open;
      emit();
    }
  },
  isPanelOpen: () => panelOpen,
};

export const useAlertState = () => useSyncExternalStore(subscribe, alertStore.getState);
export const useAlertMetrics = () => useSyncExternalStore(subscribe, alertStore.getMetrics);
export const useAlertPanelOpen = () => useSyncExternalStore(subscribe, alertStore.isPanelOpen);

export function countArmed(alerts: PriceAlert[]): number {
  return alerts.filter((a) => a.active).length;
}
