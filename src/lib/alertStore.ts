// Alert Store — localStorage-based persistence for user alerts.
// Same minimal pattern as positionStore.ts's getPositions/savePositions.

import type { AlertCondition } from "@/hooks/useAlertEngine";

const STORAGE_KEY = "optionsdesk_alerts";

export function getAlerts(): AlertCondition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore parse errors */ }
  return [];
}

export function saveAlerts(alerts: AlertCondition[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
}
