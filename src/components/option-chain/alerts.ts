/**
 * Per-strike alerts for the option chain.
 * Storage: localStorage "mc_strike_alerts_v1" → StrikeAlert[] (schema shared with other pages).
 */
import type { OptionType } from "@/lib/options";
import type { RowView } from "./chainModel";

export const STRIKE_ALERTS_KEY = "mc_strike_alerts_v1";

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
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.symbol === "string" &&
    typeof a.expiry === "string" &&
    typeof a.strike === "number" &&
    (a.type === "CE" || a.type === "PE") &&
    (a.field === "premium" || a.field === "iv" || a.field === "oiChange") &&
    (a.op === "gte" || a.op === "lte") &&
    typeof a.value === "number" &&
    Number.isFinite(a.value)
  );
}

export function readAlerts(): StrikeAlert[] {
  try {
    const raw = localStorage.getItem(STRIKE_ALERTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStrikeAlert) : [];
  } catch {
    return [];
  }
}

export function writeAlerts(alerts: StrikeAlert[]): void {
  try {
    localStorage.setItem(STRIKE_ALERTS_KEY, JSON.stringify(alerts));
  } catch {
    /* blocked storage: alerts live for this session only */
  }
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
 * Evaluate alerts for one symbol + expiry. `armed` holds the ids that already fired and whose
 * condition is still true; an alert fires again only after its condition turns false (re-arm).
 * Returns the new hits and the next armed set (the input set is not mutated).
 */
export function evaluateAlerts(
  alerts: StrikeAlert[],
  rows: RowView[],
  symbol: string,
  expiry: string,
  armed: ReadonlySet<string>,
): { hits: AlertHit[]; fired: Set<string> } {
  const fired = new Set(armed);
  const hits: AlertHit[] = [];
  for (const a of alerts) {
    if (a.symbol !== symbol || a.expiry !== expiry) continue;
    const cur = alertCurrentValue(a, rows);
    const met = alertConditionMet(a, cur);
    if (met && !fired.has(a.id)) {
      hits.push({ alert: a, current: cur });
      fired.add(a.id);
    } else if (!met && Number.isFinite(cur)) {
      fired.delete(a.id);
    }
  }
  return { hits, fired };
}

export function describeAlert(a: StrikeAlert): string {
  const v = a.field === "iv" ? `${a.value}%` : a.field === "premium" ? `₹${a.value}` : a.value.toLocaleString("en-IN");
  return `${a.symbol} ${a.strike} ${a.type} ${ALERT_FIELD_LABEL[a.field]} ${OP_SYMBOL[a.op]} ${v}`;
}
