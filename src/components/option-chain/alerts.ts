/**
 * Per-strike alerts for the option chain.
 *
 * Storage: these are `strike_level` rules in the unified alert store ("@/lib/alerts", key
 * mc_alert_rules_v1), so the Alerts Centre can list, pause, edit and log them. This module keeps
 * the chain's original StrikeAlert view and API; the legacy mc_strike_alerts_v1 list is migrated
 * on first read.
 */
import type { OptionType } from "@/lib/options";
import {
  ALERT_RULES_STORAGE_KEY,
  alertStore,
  deliveredBy,
  isLegacyStrikeAlert,
  loadAllRules,
  markDelivered,
  safeStorage,
  ruleToStrikeAlert,
  strikeAlertToRule,
  type AlertRule,
} from "@/lib/alerts";
import { flowStore } from "@/lib/flow/flowStore";
import type { RowView } from "./chainModel";

/** Storage key the chain listens on for cross-tab changes (the unified rules key). */
export const STRIKE_ALERTS_KEY = ALERT_RULES_STORAGE_KEY;
export { LEGACY_STRIKE_ALERTS_KEY } from "@/lib/alerts";

/** Surface name recorded when the chain page shows an alert (for de-duplication and the log). */
export const CHAIN_SURFACE = "Option Chain";

export type AlertField = "premium" | "iv" | "oiChange";
export type AlertOp = "gte" | "lte";

export interface StrikeAlert {
  id: string;
  symbol: string;
  expiry: string;
  strike: number;
  type: OptionType;
  field: AlertField;
  op: AlertOp;
  value: number;
  /** Paused in the Alerts Centre: kept but never evaluated. */
  paused?: boolean;
}

export const ALERT_FIELD_LABEL: Record<AlertField, string> = {
  premium: "Premium (LTP)",
  iv: "IV %",
  oiChange: "OI change",
};

/** Which operators each field supports (per spec: premium ≥/≤, IV ≥, OI change ≥). */
export const ALERT_FIELD_OPS: Record<AlertField, AlertOp[]> = {
  premium: ["gte", "lte"],
  iv: ["gte"],
  oiChange: ["gte"],
};

export const OP_SYMBOL: Record<AlertOp, string> = { gte: "≥", lte: "≤" };

export function isStrikeAlert(x: unknown): x is StrikeAlert {
  if (!isLegacyStrikeAlert(x)) return false;
  const paused = (x as { paused?: unknown }).paused;
  return paused === undefined || typeof paused === "boolean";
}

/** The chain's strike alerts, read fresh from storage (falls back to memory when storage is blocked). */
export function readAlerts(): StrikeAlert[] {
  const rules: AlertRule[] = safeStorage() ? loadAllRules().rules : alertStore.getState().rules;
  return rules.map(ruleToStrikeAlert).filter((a): a is StrikeAlert => a !== null);
}

/** Replace the chain's strike alerts in the unified store (other rule types are untouched). */
export function writeAlerts(alerts: StrikeAlert[]): void {
  const rules: AlertRule[] = [];
  for (const a of alerts) {
    if (!isStrikeAlert(a)) continue;
    const r = strikeAlertToRule(a);
    if (r.ok) rules.push(r.rule);
  }
  alertStore.replaceStrikeRules(rules);
}

export function newAlertId(): string {
  return `sa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Current value of the alert's field from the chain rows (NaN when the strike is missing). */
export function alertCurrentValue(alert: StrikeAlert, rows: RowView[]): number {
  const row = rows.find((r) => r.strike === alert.strike);
  if (!row) return NaN;
  const lv = alert.type === "CE" ? row.ce : row.pe;
  switch (alert.field) {
    case "premium":
      return lv.leg.ltp > 0 ? lv.leg.ltp : NaN;
    case "iv":
      return lv.leg.iv > 0 ? lv.leg.iv : NaN;
    case "oiChange":
      return Number.isFinite(lv.leg.oiChange) ? lv.leg.oiChange : NaN;
  }
}

export function alertConditionMet(alert: StrikeAlert, current: number): boolean {
  if (!Number.isFinite(current)) return false;
  return alert.op === "gte" ? current >= alert.value : current <= alert.value;
}

export interface AlertHit {
  alert: StrikeAlert;
  current: number;
}

/**
 * True when the shared flow store holds real (live or delayed) data for the underlying. The
 * background runner feeds every symbol that has strike alerts, from the same request the chain
 * page uses, so a sample or missing feed means the chain is showing sample data.
 */
export function chainDataIsReal(symbol: string): boolean {
  const mode = flowStore.getState().feeds[symbol.toUpperCase()]?.mode;
  return mode === "live" || mode === "recorded";
}

/**
 * Evaluate alerts for one symbol + expiry. `armed` holds the ids that already fired and whose
 * condition is still true; an alert fires again only after its condition turns false (re-arm).
 * Paused alerts are skipped, and nothing fires while the underlying's data is sample (see
 * chainDataIsReal). An alert the background runner showed in the last two minutes is
 * armed without a hit, so one crossing gives one toast. Hits are recorded for the same reason.
 * Returns the new hits and the next armed set (the input set is not mutated).
 */
export function evaluateAlerts(
  alerts: StrikeAlert[],
  rows: RowView[],
  symbol: string,
  expiry: string,
  armed: ReadonlySet<string>,
  now: number = Date.now(),
  isRealData: (symbol: string) => boolean = chainDataIsReal,
): { hits: AlertHit[]; fired: Set<string> } {
  const fired = new Set(armed);
  const hits: AlertHit[] = [];
  // Sample data never triggers an alert: keep the armed set as it is and wait for real data.
  if (!isRealData(symbol)) return { hits, fired };
  for (const a of alerts) {
    if (a.symbol !== symbol || a.expiry !== expiry) continue;
    if (a.paused) {
      fired.delete(a.id);
      continue;
    }
    const cur = alertCurrentValue(a, rows);
    const met = alertConditionMet(a, cur);
    if (met && !fired.has(a.id)) {
      fired.add(a.id);
      const by = deliveredBy(a.id, now);
      if (by && by !== CHAIN_SURFACE) continue;
      hits.push({ alert: a, current: cur });
      markDelivered(a.id, CHAIN_SURFACE, now);
    } else if (!met && Number.isFinite(cur)) {
      fired.delete(a.id);
    }
  }
  return { hits, fired };
}

export function describeAlert(a: StrikeAlert): string {
  const v = a.field === "iv" ? `${a.value}%` : a.field === "premium" ? `₹${a.value}` : a.value.toLocaleString("en-IN");
  return `${a.symbol} ${a.strike} ${a.type} ${ALERT_FIELD_LABEL[a.field]} ${OP_SYMBOL[a.op]} ${v}${a.paused ? " (paused)" : ""}`;
}
