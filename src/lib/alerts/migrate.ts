/**
 * Migration from the three alert stores the terminal used to have into the one rule model:
 *
 * 1. Flow rules (`mc_alert_rules_v1`, version 1): already the base shape; they gain optional
 *    fields (label, channels, snooze) and are re-validated.
 * 2. Per-strike chain alerts (`mc_strike_alerts_v1`): become `strike_level` rules with the same id,
 *    so the Option Chain dialog keeps working on the same records.
 * 3. Header alerts (the old in-memory bell panel: price / pcr / iv_spike / oi_spike / vix): price,
 *    PCR and ATM IV map to level rules. OI-spike and VIX conditions have no honest equivalent
 *    (VIX is not read by the engine) and are reported as skipped.
 */
import { isFiniteNumber, isObject, parseAlertRule } from "./validate";
import type { AlertRule } from "./types";

export const LEGACY_STRIKE_ALERTS_KEY = "mc_strike_alerts_v1";

export type MigrationSource = "flow" | "chain" | "header";

export type MigrateResult =
  { ok: true; rule: AlertRule; source: MigrationSource } | { ok: false; error: string; source?: MigrationSource };

/** Shape of a per-strike chain alert (see components/option-chain/alerts.ts). */
export interface LegacyStrikeAlert {
  id: string;
  symbol: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE";
  field: "premium" | "iv" | "oiChange";
  op: "gte" | "lte";
  value: number;
  paused?: boolean;
}

/** Shape of the old header (bell panel) alert. */
export interface LegacyHeaderAlert {
  id: string;
  symbol: string;
  type: "price" | "oi_spike" | "iv_spike" | "pcr" | "vix";
  condition: "above" | "below";
  value: number;
  active?: boolean;
  triggered?: boolean;
  triggeredAt?: number;
}

export function isLegacyStrikeAlert(x: unknown): x is LegacyStrikeAlert {
  if (!isObject(x)) return false;
  return (
    typeof x.id === "string" &&
    typeof x.symbol === "string" &&
    typeof x.expiry === "string" &&
    isFiniteNumber(x.strike) &&
    (x.type === "CE" || x.type === "PE") &&
    (x.field === "premium" || x.field === "iv" || x.field === "oiChange") &&
    (x.op === "gte" || x.op === "lte") &&
    isFiniteNumber(x.value)
  );
}

export function isLegacyHeaderAlert(x: unknown): x is LegacyHeaderAlert {
  if (!isObject(x)) return false;
  return (
    typeof x.id === "string" &&
    typeof x.symbol === "string" &&
    (x.condition === "above" || x.condition === "below") &&
    (x.type === "price" || x.type === "oi_spike" || x.type === "iv_spike" || x.type === "pcr" || x.type === "vix") &&
    isFiniteNumber(x.value)
  );
}

/** Epoch ms encoded in ids like "sa_<base36 time>_<random>" (NaN when absent). */
export function idTimestamp(id: string): number {
  const m = /^[a-z]+_([0-9a-z]{6,10})_/.exec(id);
  if (!m) return NaN;
  const t = parseInt(m[1], 36);
  return t > 1_500_000_000_000 && t < 4_000_000_000_000 ? t : NaN;
}

export function strikeAlertToRule(a: LegacyStrikeAlert, now: number = Date.now()): MigrateResult {
  const ts = idTimestamp(a.id);
  const r = parseAlertRule(
    {
      id: a.id,
      symbol: a.symbol,
      type: "strike_level",
      expiry: a.expiry,
      strike: a.strike,
      side: a.type,
      field: a.field,
      op: a.op,
      value: a.value,
      enabled: a.paused !== true,
      createdAt: Number.isFinite(ts) ? ts : now,
      // The chain alert re-arms when its condition turns false; no time cooldown.
      cooldownMin: 0,
      origin: "chain",
    },
    now,
  );
  return r.ok ? { ok: true, rule: r.rule, source: "chain" } : { ok: false, error: r.error, source: "chain" };
}

/** The chain dialog's view of a strike rule. */
export function ruleToStrikeAlert(r: AlertRule): LegacyStrikeAlert | null {
  if (r.type !== "strike_level") return null;
  const a: LegacyStrikeAlert = {
    id: r.id,
    symbol: r.symbol,
    expiry: r.expiry,
    strike: r.strike,
    type: r.side,
    field: r.field,
    op: r.op,
    value: r.value,
  };
  if (!r.enabled) a.paused = true;
  return a;
}

export function headerAlertToRule(a: LegacyHeaderAlert, now: number = Date.now()): MigrateResult {
  const base = {
    id: a.id.startsWith("h_") ? a.id : `h_${a.id}`.slice(0, 64),
    symbol: a.symbol,
    enabled: a.active !== false,
    createdAt: now,
    cooldownMin: 1,
    origin: "header" as const,
  };
  let body: Record<string, unknown>;
  switch (a.type) {
    case "price":
      body = { type: "price_level", direction: a.condition, level: a.value };
      break;
    case "pcr":
      body = { type: "pcr_cross", direction: a.condition, level: a.value };
      break;
    case "iv_spike":
      body = { type: "iv_level", direction: a.condition, level: a.value };
      break;
    case "oi_spike":
      return {
        ok: false,
        error: "Old 'OI spike' alerts had no strike; recreate them as 'OI change at strike'.",
        source: "header",
      };
    case "vix":
      return {
        ok: false,
        error: "Old VIX alerts are not supported; the engine does not read India VIX.",
        source: "header",
      };
  }
  const r = parseAlertRule({ ...base, ...body }, now);
  return r.ok ? { ok: true, rule: r.rule, source: "header" } : { ok: false, error: r.error, source: "header" };
}

/** Migrate any stored or imported alert record (unified, strike or header shape) to a rule. */
export function migrateAlertRecord(x: unknown, now: number = Date.now()): MigrateResult {
  if (isLegacyStrikeAlert(x)) return strikeAlertToRule(x, now);
  if (isLegacyHeaderAlert(x)) return headerAlertToRule(x, now);
  const r = parseAlertRule(x, now);
  return r.ok ? { ok: true, rule: r.rule, source: "flow" } : { ok: false, error: r.error };
}

export interface MigrationReport {
  rules: AlertRule[];
  skipped: number;
  errors: string[];
  bySource: Record<MigrationSource, number>;
}

/** Migrate a list of records, de-duplicating by id (first wins). */
export function migrateAlertRecords(list: unknown[], now: number = Date.now()): MigrationReport {
  const out: MigrationReport = { rules: [], skipped: 0, errors: [], bySource: { flow: 0, chain: 0, header: 0 } };
  const ids = new Set<string>();
  for (const item of list) {
    const r = migrateAlertRecord(item, now);
    if (!r.ok) {
      out.skipped++;
      if (out.errors.length < 5 && !out.errors.includes(r.error)) out.errors.push(r.error);
      continue;
    }
    if (ids.has(r.rule.id)) continue;
    ids.add(r.rule.id);
    out.rules.push(r.rule);
    out.bySource[r.source]++;
  }
  return out;
}
