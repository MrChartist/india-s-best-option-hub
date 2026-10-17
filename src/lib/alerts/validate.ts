/**
 * Hand-written validation for alert rules (no schema library). `parseAlertRule` accepts unknown
 * input (storage, imports, the editor), applies defaults, normalises the symbol and returns either a
 * clean rule or the first problem in plain English.
 */
import { isValidIsoDate } from "@/lib/options";
import { ANY_ALLOWED, RULE_TYPES } from "./describe";
import {
  ANY_SYMBOL,
  type AlertRule,
  type AlertRuleType,
  type ChannelKey,
  type Direction,
  type GreekDirection,
  type GreekKey,
  type RuleChannels,
  type SideSel,
  type StrikeField,
  type StrikeOp,
  type ZoneDirection,
} from "./types";

export type ParseResult = { ok: true; rule: AlertRule } | { ok: false; error: string; field?: string };

type Obj = Record<string, unknown>;

export const isObject = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
export const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const oneOf = <T extends string>(x: unknown, list: readonly T[]): x is T =>
  typeof x === "string" && (list as readonly string[]).includes(x);

const DIRECTIONS: readonly Direction[] = ["above", "below", "either"];
const ZONES: readonly ZoneDirection[] = ["above", "below"];
const SIDES: readonly SideSel[] = ["CE", "PE", "BOTH"];
const FIELDS: readonly StrikeField[] = ["premium", "iv", "oiChange"];
const OPS: readonly StrikeOp[] = ["gte", "lte"];
const GREEKS: readonly GreekKey[] = ["delta", "gamma", "theta", "vega"];
const GREEK_DIRS: readonly GreekDirection[] = ["above", "below", "abs_above"];
const CHANNELS: readonly ChannelKey[] = ["toast", "desktop", "sound", "webhook"];
const ORIGINS = ["flow", "chain", "header", "import"] as const;

const SYMBOL_RE = /^[A-Z0-9&_-]{1,24}$/;

export function isAlertRuleType(x: unknown): x is AlertRuleType {
  return oneOf(x, RULE_TYPES);
}

class Invalid extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

function num(o: Obj, key: string, check: (v: number) => boolean, msg: string): number {
  const v = o[key];
  if (!isFiniteNumber(v) || !check(v)) throw new Invalid(key, msg);
  return v;
}

function pick<T extends string>(o: Obj, key: string, list: readonly T[], msg: string): T {
  const v = o[key];
  if (!oneOf(v, list)) throw new Invalid(key, msg);
  return v;
}

const positive =
  (max = Infinity) =>
  (v: number) =>
    v > 0 && v <= max;

function parseChannels(x: unknown): RuleChannels | undefined {
  if (!isObject(x)) return undefined;
  const out: RuleChannels = {};
  for (const k of CHANNELS) if (typeof x[k] === "boolean") out[k] = x[k] as boolean;
  return Object.keys(out).length ? out : undefined;
}

function body(o: Obj, type: AlertRuleType): Obj {
  switch (type) {
    case "pcr_cross":
      return {
        type,
        direction: pick(o, "direction", DIRECTIONS, "Pick a direction."),
        level: num(o, "level", positive(10), "PCR level must be between 0 and 10."),
      };
    case "price_level":
      return {
        type,
        direction: pick(o, "direction", DIRECTIONS, "Pick a direction."),
        level: num(o, "level", positive(), "Enter a price above zero."),
      };
    case "iv_level":
      return {
        type,
        direction: pick(o, "direction", DIRECTIONS, "Pick a direction."),
        level: num(o, "level", positive(300), "ATM IV must be between 0 and 300%."),
      };
    case "ivp_level":
      return {
        type,
        direction: pick(o, "direction", ZONES, "Pick above or below."),
        level: num(o, "level", (v) => v >= 0 && v <= 100, "IV percentile must be 0 to 100."),
      };
    case "oi_change_strike":
      return {
        type,
        strike: num(o, "strike", positive(), "Enter a strike."),
        side: pick(o, "side", SIDES, "Pick CE, PE or either."),
        threshold: num(o, "threshold", positive(), "Enter an OI change above zero."),
      };
    case "atm_iv_spike":
      return {
        type,
        points: num(o, "points", positive(50), "IV rise must be between 0 and 50 points."),
        windowMin: num(o, "windowMin", positive(375), "Window must be 1 to 375 minutes."),
      };
    case "oi_wall_shift":
      return { type, side: pick(o, "side", SIDES, "Pick a wall.") };
    case "spot_cross_ref":
      return { type, ref: pick(o, "ref", ["max_pain", "gamma_flip"] as const, "Pick max pain or the gamma flip.") };
    case "repeated_hits": {
      const minHits = num(
        o,
        "minHits",
        (v) => Number.isInteger(v) && v >= 2 && v <= 50,
        "Hits must be a whole number from 2 to 50.",
      );
      return {
        type,
        minHits,
        windowMin: num(o, "windowMin", positive(375), "Window must be 1 to 375 minutes."),
        minPremium: num(o, "minPremium", positive(), "Enter a minimum premium."),
      };
    }
    case "big_opening_print":
      return { type, minPremium: num(o, "minPremium", positive(), "Enter a minimum premium.") };
    case "ban_entry":
      return { type };
    case "strike_level": {
      const expiry = o.expiry;
      if (typeof expiry !== "string" || !isValidIsoDate(expiry)) throw new Invalid("expiry", "Pick an expiry date.");
      const field = pick(o, "field", FIELDS, "Pick premium, IV or OI change.");
      const op = pick(o, "op", OPS, "Pick ≥ or ≤.");
      const value = num(
        o,
        "value",
        field === "oiChange" ? () => true : positive(),
        field === "oiChange" ? "Enter an OI change." : "Enter a value above zero.",
      );
      return {
        type,
        expiry,
        strike: num(o, "strike", positive(), "Enter a strike."),
        side: pick(o, "side", ["CE", "PE"] as const, "Pick CE or PE."),
        field,
        op,
        value,
      };
    }
    case "premium_tide":
      return {
        type,
        direction: pick(o, "direction", DIRECTIONS, "Pick a direction."),
        level: num(o, "level", (v) => Math.abs(v) <= 1e13, "Enter a tide level in rupees."),
      };
    case "position_pnl":
      return {
        type,
        direction: pick(o, "direction", ZONES, "Pick above or below."),
        level: num(o, "level", (v) => Math.abs(v) <= 1e11, "Enter a P&L level in rupees."),
      };
    case "position_greek": {
      const direction = pick(o, "direction", GREEK_DIRS, "Pick a comparison.");
      return {
        type,
        greek: pick(o, "greek", GREEKS, "Pick a Greek."),
        direction,
        level: num(
          o,
          "level",
          direction === "abs_above" ? (v) => v > 0 : (v) => Math.abs(v) <= 1e11,
          direction === "abs_above" ? "Enter a level above zero." : "Enter a level.",
        ),
      };
    }
  }
}

/** Validate and normalise one rule. Missing enabled/createdAt/cooldown get defaults. */
export function parseAlertRule(x: unknown, now: number = Date.now()): ParseResult {
  if (!isObject(x)) return { ok: false, error: "Not a rule object." };
  try {
    if (!isAlertRuleType(x.type)) throw new Invalid("type", "Unknown rule type.");
    const type = x.type;
    if (typeof x.id !== "string" || x.id.length < 1 || x.id.length > 64) throw new Invalid("id", "Missing rule id.");
    const symbol = typeof x.symbol === "string" ? x.symbol.trim().toUpperCase() : "";
    if (!SYMBOL_RE.test(symbol)) throw new Invalid("symbol", "Pick an underlying.");
    if (symbol === ANY_SYMBOL && !ANY_ALLOWED.has(type))
      throw new Invalid("symbol", "Pick an underlying for this rule type.");
    const cooldownMin =
      x.cooldownMin === undefined
        ? 15
        : num(x, "cooldownMin", (v) => v >= 0 && v <= 1440, "Cooldown must be 0 to 1,440 minutes.");
    if (x.enabled !== undefined && typeof x.enabled !== "boolean")
      throw new Invalid("enabled", "Enabled must be true or false.");
    const rule: Obj = {
      id: x.id,
      symbol,
      enabled: x.enabled ?? true,
      createdAt: isFiniteNumber(x.createdAt) ? x.createdAt : now,
      cooldownMin,
      ...body(x, type),
    };
    if (typeof x.label === "string" && x.label.trim()) rule.label = x.label.trim().slice(0, 80);
    if (typeof x.note === "string" && x.note.trim()) rule.note = x.note.slice(0, 200);
    if (isFiniteNumber(x.snoozeUntil) && x.snoozeUntil > 0) rule.snoozeUntil = x.snoozeUntil;
    const channels = parseChannels(x.channels);
    if (channels) rule.channels = channels;
    if (oneOf(x.origin, ORIGINS)) rule.origin = x.origin;
    return { ok: true, rule: rule as unknown as AlertRule };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message, field: e.field };
    return { ok: false, error: "Invalid rule." };
  }
}

/** Type guard: true when `x` is already a clean rule (parsing changes nothing that matters). */
export function isAlertRule(x: unknown): x is AlertRule {
  return (
    parseAlertRule(x).ok &&
    isObject(x) &&
    typeof x.enabled === "boolean" &&
    isFiniteNumber(x.createdAt) &&
    isFiniteNumber(x.cooldownMin)
  );
}

/**
 * Compatibility shim for code that used the old zod schema: same `safeParse` shape, backed by the
 * hand-written guard above.
 */
export const alertRuleSchema = {
  safeParse(
    x: unknown,
  ):
    | { success: true; data: AlertRule }
    | { success: false; error: { issues: Array<{ path: string[]; message: string }> } } {
    const r = parseAlertRule(x);
    return r.ok
      ? { success: true, data: r.rule }
      : { success: false, error: { issues: [{ path: r.field ? [r.field] : [], message: r.error }] } };
  },
};
