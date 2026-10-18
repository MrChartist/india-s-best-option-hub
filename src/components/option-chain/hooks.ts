import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { alertStore, ruleToStrikeAlert, type AlertRule } from "@/lib/alerts";
import { BASKET_KEY, readBasket, writeBasket, type BasketLeg } from "./basket";
import { describeAlert, evaluateAlerts, writeAlerts, type StrikeAlert } from "./alerts";
import type { RowView } from "./chainModel";

/**
 * State persisted to localStorage. The updater stays pure: the next value is computed from a ref
 * that mirrors the latest state, then setState and the storage write happen outside React's
 * updater queue (StrictMode runs updaters twice, and a failing write must not throw from there).
 */
function usePersistedList<T>(read: () => T[], write: (v: T[]) => void, key: string) {
  const [value, setValueState] = useState<T[]>(read);
  const latest = useRef(value);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      const v = read();
      latest.current = v;
      setValueState(v);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, read]);

  const setValue = useCallback(
    (next: T[] | ((prev: T[]) => T[])) => {
      const v = typeof next === "function" ? next(latest.current) : next;
      latest.current = v;
      setValueState(v);
      try {
        write(v);
      } catch {
        /* storage full or blocked: keep the in-memory state */
      }
    },
    [write],
  );

  return [value, setValue] as const;
}

/** Basket persisted in localStorage and kept in sync across tabs. */
export function useBasket() {
  const [legs, setLegs] = usePersistedList<BasketLeg>(readBasket, writeBasket, BASKET_KEY);
  return { legs, setLegs };
}

function notify(title: string, body: string) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") new Notification(title, { body, tag: `mc-alert-${title}` });
  } catch {
    /* some browsers throw when constructing notifications outside a service worker */
  }
}

export function requestNotificationPermission() {
  try {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
}

const strikeAlertsOf = (rules: AlertRule[]): StrikeAlert[] =>
  rules.map(ruleToStrikeAlert).filter((a): a is StrikeAlert => a !== null);
const getRules = () => alertStore.getState().rules;

/**
 * Strike alerts: read live from the unified alert store (so deletes, pauses and edits made in the
 * Alerts sheet or page in this tab apply at once; the store itself follows other tabs through the
 * storage event), plus evaluation on every poll (`version` changes per fetch).
 * An alert fires once, then re-arms when its condition turns false.
 */
export function useStrikeAlerts(symbol: string, expiry: string, rows: RowView[], version: number) {
  const rules = useSyncExternalStore(alertStore.subscribe, getRules, getRules);
  const alerts = useMemo(() => strikeAlertsOf(rules), [rules]);
  const armed = useRef<Set<string>>(new Set());

  /** Apply a change to the store's current strike alerts (never a stale copy). */
  const setAlerts = useCallback((fn: (prev: StrikeAlert[]) => StrikeAlert[]) => {
    try {
      writeAlerts(fn(strikeAlertsOf(getRules())));
    } catch {
      /* storage full or blocked: the store keeps the in-memory state */
    }
  }, []);

  const addAlert = useCallback(
    (a: StrikeAlert) => {
      setAlerts((prev) => [...prev, a]);
      requestNotificationPermission();
      toast.success("Alert saved", { description: describeAlert(a) });
    },
    [setAlerts],
  );

  const deleteAlert = useCallback(
    (id: string) => {
      armed.current.delete(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    },
    [setAlerts],
  );

  useEffect(() => {
    if (!version || rows.length === 0 || alerts.length === 0 || !expiry) return;
    const { hits, fired } = evaluateAlerts(alerts, rows, symbol, expiry, armed.current);
    armed.current = fired;
    for (const h of hits) {
      const text = describeAlert(h.alert);
      const now = h.alert.field === "iv" ? `${h.current.toFixed(2)}%` : h.alert.field === "premium" ? `₹${h.current.toFixed(2)}` : h.current.toLocaleString("en-IN");
      toast.warning(`Alert: ${text}`, { description: `Now ${now}` });
      notify("Option Hub alert", `${text} (now ${now})`);
    }
  }, [version, rows, alerts, symbol, expiry]);

  return { alerts, addAlert, deleteAlert };
}
