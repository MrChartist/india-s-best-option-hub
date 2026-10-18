/**
 * The editor's string-based draft and its conversion to and from a rule. Pure, so the editor's
 * validation is tested without rendering.
 */
import {
  ANY_ALLOWED,
  ANY_SYMBOL,
  parseAlertRule,
  type AlertRule,
  type AlertRuleType,
  type ChannelKey,
  type GreekDirection,
  type GreekKey,
  type RuleChannels,
  type StrikeField,
  type StrikeOp,
} from "@/lib/alerts";

export type ChannelChoice = "default" | "on" | "off";

export interface RuleDraft {
  type: AlertRuleType;
  symbol: string;
  label: string;
  direction: "above" | "below" | "either";
  level: string;
  strike: string;
  side: "CE" | "PE" | "BOTH";
  threshold: string;
  points: string;
  windowMin: string;
  ref: "max_pain" | "gamma_flip";
  minHits: string;
  premiumLakh: string;
  /** Tide level in ₹ crore (signed). */
  tideCrore: string;
  expiry: string;
  field: StrikeField;
  op: StrikeOp;
  value: string;
  greek: GreekKey;
  greekDirection: GreekDirection;
  cooldownMin: string;
  channels: Record<ChannelKey, ChannelChoice>;
}

export const DEFAULT_DRAFT: RuleDraft = {
  type: "price_level",
  symbol: "NIFTY",
  label: "",
  direction: "either",
  level: "",
  strike: "",
  side: "BOTH",
  threshold: "50000",
  points: "1.5",
  windowMin: "15",
  ref: "max_pain",
  minHits: "3",
  premiumLakh: "25",
  tideCrore: "0",
  expiry: "",
  field: "premium",
  op: "gte",
  value: "",
  greek: "delta",
  greekDirection: "abs_above",
  cooldownMin: "15",
  channels: { toast: "default", desktop: "default", sound: "default", webhook: "default" },
};

/** Sensible starting values when the rule type changes in the editor. */
export function retypeDraft(d: RuleDraft, type: AlertRuleType, spot?: number): RuleDraft {
  const next: RuleDraft = { ...d, type };
  if (type === "ban_entry") next.symbol = ANY_SYMBOL;
  else if (
    (type === "position_pnl" || type === "position_greek") &&
    d.type !== "position_pnl" &&
    d.type !== "position_greek"
  )
    next.symbol = ANY_SYMBOL;
  else if (d.symbol === ANY_SYMBOL && !ANY_ALLOWED.has(type)) next.symbol = "NIFTY";
  if (type === "pcr_cross") next.level = "1";
  else if (type === "ivp_level") next.level = "80";
  else if (type === "iv_level") next.level = "15";
  else if (type === "position_pnl") next.level = "-10000";
  else if (type === "position_greek") next.level = "100";
  else if (type === "price_level")
    next.level = spot && spot > 0 ? String(Math.round(spot / 100) * 100) : d.type === "price_level" ? d.level : "";
  if ((type === "ivp_level" || type === "position_pnl") && next.direction === "either")
    next.direction = type === "position_pnl" ? "below" : "above";
  if (type === "strike_level" && next.side === "BOTH") next.side = "CE";
  if (type === "strike_level" && next.cooldownMin === "15") next.cooldownMin = "0";
  if (type === "position_greek") next.greekDirection = next.greek === "delta" ? "abs_above" : next.greekDirection;
  return next;
}

/** Parse a draft field. A blank field is NaN (not 0) so it fails validation with the field's own message. */
const num = (s: string) => {
  const t = String(s).replace(/[,\s₹]/g, "");
  return t === "" ? NaN : Number(t);
};

function channelsFromDraft(c: RuleDraft["channels"]): RuleChannels | undefined {
  const out: RuleChannels = {};
  for (const k of Object.keys(c) as ChannelKey[]) if (c[k] !== "default") out[k] = c[k] === "on";
  return Object.keys(out).length ? out : undefined;
}

/** Build the rule body from a draft (no validation). */
function draftBody(d: RuleDraft): Record<string, unknown> {
  switch (d.type) {
    case "pcr_cross":
    case "price_level":
    case "iv_level":
      return { type: d.type, direction: d.direction, level: num(d.level) };
    case "ivp_level":
      return { type: d.type, direction: d.direction === "below" ? "below" : "above", level: num(d.level) };
    case "oi_change_strike":
      return { type: d.type, strike: num(d.strike), side: d.side, threshold: num(d.threshold) };
    case "atm_iv_spike":
      return { type: d.type, points: num(d.points), windowMin: num(d.windowMin) };
    case "oi_wall_shift":
      return { type: d.type, side: d.side };
    case "spot_cross_ref":
      return { type: d.type, ref: d.ref };
    case "repeated_hits":
      return {
        type: d.type,
        minHits: Math.round(num(d.minHits)),
        windowMin: num(d.windowMin),
        minPremium: num(d.premiumLakh) * 1_00_000,
      };
    case "big_opening_print":
      return { type: d.type, minPremium: num(d.premiumLakh) * 1_00_000 };
    case "ban_entry":
      return { type: d.type };
    case "strike_level":
      return {
        type: d.type,
        expiry: d.expiry,
        strike: num(d.strike),
        side: d.side === "PE" ? "PE" : "CE",
        field: d.field,
        op: d.op,
        value: num(d.value),
      };
    case "premium_tide":
      return { type: d.type, direction: d.direction, level: num(d.tideCrore) * 1_00_00_000 };
    case "position_pnl":
      return { type: d.type, direction: d.direction === "above" ? "above" : "below", level: num(d.level) };
    case "position_greek":
      return { type: d.type, greek: d.greek, direction: d.greekDirection, level: num(d.level) };
  }
}

/**
 * Validate a draft. `base` is the rule being edited (keeps id, createdAt, enabled, origin);
 * without it a fresh id is generated by the caller via the returned rule's `id: "draft"`.
 */
export function draftToRule(
  d: RuleDraft,
  base?: AlertRule,
  now: number = Date.now(),
): { ok: true; rule: AlertRule } | { ok: false; error: string; field?: string } {
  if (d.type === "strike_level" && !d.expiry) return { ok: false, error: "Pick an expiry date.", field: "expiry" };
  const candidate = {
    id: base?.id ?? "draft",
    enabled: base?.enabled ?? true,
    createdAt: base?.createdAt ?? now,
    origin: base?.origin,
    snoozeUntil: base?.snoozeUntil,
    note: base?.note,
    symbol: d.symbol,
    label: d.label,
    cooldownMin: d.cooldownMin.trim() === "" ? 15 : num(d.cooldownMin),
    channels: channelsFromDraft(d.channels),
    ...draftBody(d),
  };
  const r = parseAlertRule(candidate, now);
  return r.ok ? r : { ok: false, error: r.error, field: r.field };
}

const str = (v: number) => (Number.isFinite(v) ? String(v) : "");

/** Load a rule into the editor. */
export function draftFromRule(r: AlertRule): RuleDraft {
  const d: RuleDraft = {
    ...DEFAULT_DRAFT,
    type: r.type,
    symbol: r.symbol,
    label: r.label ?? "",
    cooldownMin: String(r.cooldownMin),
    channels: {
      toast: r.channels?.toast === undefined ? "default" : r.channels.toast ? "on" : "off",
      desktop: r.channels?.desktop === undefined ? "default" : r.channels.desktop ? "on" : "off",
      sound: r.channels?.sound === undefined ? "default" : r.channels.sound ? "on" : "off",
      webhook: r.channels?.webhook === undefined ? "default" : r.channels.webhook ? "on" : "off",
    },
  };
  switch (r.type) {
    case "pcr_cross":
    case "price_level":
    case "iv_level":
      return { ...d, direction: r.direction, level: str(r.level) };
    case "ivp_level":
    case "position_pnl":
      return { ...d, direction: r.direction, level: str(r.level) };
    case "oi_change_strike":
      return { ...d, strike: str(r.strike), side: r.side, threshold: str(r.threshold) };
    case "atm_iv_spike":
      return { ...d, points: str(r.points), windowMin: str(r.windowMin) };
    case "oi_wall_shift":
      return { ...d, side: r.side };
    case "spot_cross_ref":
      return { ...d, ref: r.ref };
    case "repeated_hits":
      return { ...d, minHits: str(r.minHits), windowMin: str(r.windowMin), premiumLakh: str(r.minPremium / 1_00_000) };
    case "big_opening_print":
      return { ...d, premiumLakh: str(r.minPremium / 1_00_000) };
    case "ban_entry":
      return d;
    case "strike_level":
      return {
        ...d,
        expiry: r.expiry,
        strike: str(r.strike),
        side: r.side,
        field: r.field,
        op: r.op,
        value: str(r.value),
      };
    case "premium_tide":
      return { ...d, direction: r.direction, tideCrore: str(r.level / 1_00_00_000) };
    case "position_greek":
      return { ...d, greek: r.greek, greekDirection: r.direction, level: str(r.level) };
  }
}
