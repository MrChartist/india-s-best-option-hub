/**
 * Rule-based alert engine (pure logic, no DOM).
 *
 * Every rule is evaluated against a RuleContext built from real chain data (PCR from OI, ATM IV
 * from the chain, IV percentile from recorded history, max pain, gamma flip, walls), the new
 * derived flow prints since the last check and the NSE ban list. Nothing is inferred from VIX.
 *
 * Level rules fire on a CROSSING (previous value on one side, current on the other). Zone rules
 * (IVP, OI change, IV spike) fire when the value ENTERS the zone. Each rule then waits for its
 * cooldown before it can fire again.
 */
import { z } from "zod";
import { formatCompactIN, formatNumberIN, formatStrike } from "@/lib/options";
import type { FlowPrint } from "./types";

export const ALERT_RULES_STORAGE_KEY = "mc_alert_rules_v1";
export const ANY_SYMBOL = "ANY";

export type AlertTone = "bullish" | "bearish" | "warning" | "info";
export type Direction = "above" | "below" | "either";
export type SideSel = "CE" | "PE" | "BOTH";

export type AlertRuleType =
  | "pcr_cross"
  | "oi_change_strike"
  | "ivp_level"
  | "price_level"
  | "atm_iv_spike"
  | "oi_wall_shift"
  | "spot_cross_ref"
  | "repeated_hits"
  | "big_opening_print"
  | "ban_entry";

interface RuleBase {
  id: string;
  /** Underlying, or ANY for flow and ban-list rules. */
  symbol: string;
  enabled: boolean;
  createdAt: number;
  /** Minutes before the same rule can fire again. */
  cooldownMin: number;
  note?: string;
}

export type AlertRuleBody =
  | { type: "pcr_cross"; direction: Direction; level: number }
  | { type: "oi_change_strike"; strike: number; side: SideSel; threshold: number }
  | { type: "ivp_level"; direction: "above" | "below"; level: number }
  | { type: "price_level"; direction: Direction; level: number }
  | { type: "atm_iv_spike"; points: number; windowMin: number }
  | { type: "oi_wall_shift"; side: SideSel }
  | { type: "spot_cross_ref"; ref: "max_pain" | "gamma_flip" }
  | { type: "repeated_hits"; minHits: number; windowMin: number; minPremium: number }
  | { type: "big_opening_print"; minPremium: number }
  | { type: "ban_entry" };

export type AlertRule = RuleBase & AlertRuleBody;
export type NewAlertRule = Omit<RuleBase, "id" | "createdAt" | "enabled" | "cooldownMin"> & Partial<Pick<RuleBase, "enabled" | "cooldownMin">> & AlertRuleBody;

export const RULE_TYPE_LABEL: Record<AlertRuleType, string> = {
  pcr_cross: "PCR cross",
  oi_change_strike: "OI change at strike",
  ivp_level: "IV percentile",
  price_level: "Price level",
  atm_iv_spike: "ATM IV spike",
  oi_wall_shift: "OI wall shift",
  spot_cross_ref: "Spot crosses max pain / flip",
  repeated_hits: "Repeated hits",
  big_opening_print: "Big opening print",
  ban_entry: "Enters F&O ban",
};

/** Rule types that need the option chain of their symbol. */
export function ruleNeedsChain(rule: AlertRule): boolean {
  return rule.type !== "ban_entry" && rule.symbol !== ANY_SYMBOL;
}

// ── Context ──

export interface StrikeOI {
  strike: number;
  ceOi: number;
  peOi: number;
  ceOiChg: number;
  peOiChg: number;
}

export interface SymbolMarket {
  symbol: string;
  /** Epoch ms of the data. */
  ts: number;
  spot: number;
  pcr?: number;
  /** ATM IV in percent. */
  atmIv?: number;
  /** IV percentile 0-100; null when history is too short. */
  ivp?: number | null;
  maxPain?: number;
  gammaFlip?: number | null;
  strikes?: StrikeOI[];
}

export interface RuleContext {
  now: number;
  markets: Record<string, SymbolMarket>;
  /** Flow prints (all known for the session; the engine only looks at ones newer than it has seen). */
  prints: FlowPrint[];
  /** Today's ban list (symbols), null/undefined when unknown. */
  banList?: string[] | null;
}

export interface RuleMemory {
  last?: number;
  lastSign?: number;
  inZone?: boolean;
  wallCe?: number;
  wallPe?: number;
  ivSeries?: Array<[number, number]>;
  hits?: Record<string, number[]>;
  ban?: string[];
  printTs?: number;
  marketTs?: number;
  lastFiredAt?: number;
  fireCount?: number;
}

export type RuleState = Record<string, RuleMemory>;

export interface AlertEvent {
  id: string;
  ruleId: string;
  type: AlertRuleType;
  symbol: string;
  ts: number;
  title: string;
  message: string;
  tone: AlertTone;
}

// ── Helpers ──

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function crossed(prev: number | undefined, curr: number, level: number, dir: Direction): "up" | "down" | null {
  if (!finite(prev) || !finite(curr) || !finite(level)) return null;
  const up = prev < level && curr >= level;
  const down = prev > level && curr <= level;
  if (up && (dir === "above" || dir === "either")) return "up";
  if (down && (dir === "below" || dir === "either")) return "down";
  return null;
}

/** Strike with the largest OI on a side (NaN when none). */
export function oiWall(strikes: StrikeOI[] | undefined, side: "CE" | "PE"): number {
  let best = NaN;
  let max = 0;
  for (const s of strikes ?? []) {
    const v = side === "CE" ? s.ceOi : s.peOi;
    if (finite(v) && v > max) {
      max = v;
      best = s.strike;
    }
  }
  return best;
}

const fmtRs = (v: number) => `₹${formatCompactIN(v, { symbol: false })}`;
const sideName = (s: SideSel) => (s === "BOTH" ? "CE/PE" : s);

export function describeRule(r: AlertRule): string {
  const sym = r.symbol === ANY_SYMBOL ? "Any underlying" : r.symbol;
  switch (r.type) {
    case "pcr_cross":
      return `${sym} PCR (OI) crosses ${r.direction === "either" ? "" : `${r.direction} `}${r.level.toFixed(2)}`;
    case "oi_change_strike":
      return `${sym} ${formatStrike(r.strike)} ${sideName(r.side)} OI change beyond ${formatNumberIN(r.threshold)} contracts`;
    case "ivp_level":
      return `${sym} IV percentile ${r.direction === "above" ? "≥" : "≤"} ${r.level}`;
    case "price_level":
      return `${sym} crosses ${r.direction === "either" ? "" : `${r.direction} `}${formatNumberIN(r.level, 2)}`;
    case "atm_iv_spike":
      return `${sym} ATM IV up ${r.points} pts within ${r.windowMin} min`;
    case "oi_wall_shift":
      return `${sym} ${r.side === "CE" ? "call wall (resistance)" : r.side === "PE" ? "put wall (support)" : "call or put wall"} moves to a new strike`;
    case "spot_cross_ref":
      return `${sym} spot crosses ${r.ref === "max_pain" ? "max pain" : "the gamma flip"}`;
    case "repeated_hits":
      return `${sym}: same contract prints ≥ ${fmtRs(r.minPremium)} ${r.minHits}× within ${r.windowMin} min`;
    case "big_opening_print":
      return `${sym}: opening print ≥ ${fmtRs(r.minPremium)}`;
    case "ban_entry":
      return r.symbol === ANY_SYMBOL ? "Any stock enters the F&O ban list" : `${r.symbol} enters the F&O ban list`;
  }
}

function toneFor(r: AlertRule, detail?: "up" | "down" | "CE" | "PE"): AlertTone {
  switch (r.type) {
    case "price_level":
    case "spot_cross_ref":
      return detail === "down" ? "bearish" : "bullish";
    case "pcr_cross":
      return detail === "down" ? "bearish" : "bullish";
    case "big_opening_print":
    case "repeated_hits":
      return detail === "PE" ? "bearish" : detail === "CE" ? "bullish" : "info";
    case "ban_entry":
    case "atm_iv_spike":
    case "ivp_level":
      return "warning";
    default:
      return "info";
  }
}

// ── Evaluation ──

type Hit = { title: string; message: string; tone: AlertTone; symbol?: string };

function evalOne(rule: AlertRule, ctx: RuleContext, mem: RuleMemory): Hit | null {
  const m = ctx.markets[rule.symbol];
  switch (rule.type) {
    case "pcr_cross": {
      if (!m || !finite(m.pcr)) return null;
      const c = crossed(mem.last, m.pcr, rule.level, rule.direction);
      mem.last = m.pcr;
      if (!c) return null;
      return { title: `${rule.symbol} PCR ${c === "up" ? "rose above" : "fell below"} ${rule.level.toFixed(2)}`, message: `PCR (OI) is now ${m.pcr.toFixed(2)}.`, tone: toneFor(rule, c) };
    }
    case "price_level": {
      if (!m || !(m.spot > 0)) return null;
      const c = crossed(mem.last, m.spot, rule.level, rule.direction);
      mem.last = m.spot;
      if (!c) return null;
      return { title: `${rule.symbol} ${c === "up" ? "crossed above" : "crossed below"} ${formatNumberIN(rule.level, 2)}`, message: `Last ${formatNumberIN(m.spot, 2)}.`, tone: toneFor(rule, c) };
    }
    case "ivp_level": {
      if (!m || !finite(m.ivp)) return null;
      const inZone = rule.direction === "above" ? m.ivp >= rule.level : m.ivp <= rule.level;
      const entered = inZone && !mem.inZone;
      mem.inZone = inZone;
      if (!entered) return null;
      return { title: `${rule.symbol} IV percentile ${Math.round(m.ivp)}`, message: rule.direction === "above" ? "Options are expensive versus recorded history." : "Options are cheap versus recorded history.", tone: toneFor(rule) };
    }
    case "oi_change_strike": {
      const s = m?.strikes?.find((x) => x.strike === rule.strike);
      if (!s) return null;
      const ce = Math.abs(s.ceOiChg);
      const pe = Math.abs(s.peOiChg);
      const val = rule.side === "CE" ? ce : rule.side === "PE" ? pe : Math.max(ce, pe);
      const inZone = val > rule.threshold;
      const entered = inZone && !mem.inZone;
      mem.inZone = inZone;
      if (!entered) return null;
      const which = rule.side === "BOTH" ? (ce >= pe ? "CE" : "PE") : rule.side;
      const chg = which === "CE" ? s.ceOiChg : s.peOiChg;
      return { title: `${rule.symbol} ${formatStrike(rule.strike)} ${which} OI ${chg >= 0 ? "+" : "−"}${formatNumberIN(Math.abs(chg))}`, message: `OI change passed ${formatNumberIN(rule.threshold)} contracts.`, tone: "info" };
    }
    case "atm_iv_spike": {
      if (!m || !finite(m.atmIv) || m.atmIv <= 0) return null;
      const windowMs = Math.max(1, rule.windowMin) * 60_000;
      const series = (mem.ivSeries ?? []).filter(([t]) => ctx.now - t <= windowMs);
      const lowest = series.reduce((mn, [, v]) => Math.min(mn, v), Infinity);
      series.push([m.ts || ctx.now, m.atmIv]);
      mem.ivSeries = series.slice(-200);
      const jump = finite(lowest) ? m.atmIv - lowest : 0;
      const inZone = jump >= rule.points;
      const entered = inZone && !mem.inZone;
      mem.inZone = inZone;
      if (!entered) return null;
      return { title: `${rule.symbol} ATM IV +${jump.toFixed(1)} pts`, message: `ATM IV ${m.atmIv.toFixed(1)}% (from ${lowest.toFixed(1)}% within ${rule.windowMin} min).`, tone: toneFor(rule) };
    }
    case "oi_wall_shift": {
      if (!m?.strikes?.length) return null;
      const ce = oiWall(m.strikes, "CE");
      const pe = oiWall(m.strikes, "PE");
      const msgs: string[] = [];
      let detail: "CE" | "PE" | undefined;
      if ((rule.side === "CE" || rule.side === "BOTH") && finite(mem.wallCe) && finite(ce) && ce !== mem.wallCe) {
        msgs.push(`Call wall ${formatStrike(mem.wallCe)} → ${formatStrike(ce)}`);
        detail = "CE";
      }
      if ((rule.side === "PE" || rule.side === "BOTH") && finite(mem.wallPe) && finite(pe) && pe !== mem.wallPe) {
        msgs.push(`Put wall ${formatStrike(mem.wallPe)} → ${formatStrike(pe)}`);
        detail = detail ?? "PE";
      }
      if (finite(ce)) mem.wallCe = ce;
      if (finite(pe)) mem.wallPe = pe;
      if (msgs.length === 0) return null;
      return { title: `${rule.symbol} OI wall moved`, message: msgs.join(" · "), tone: detail === "CE" ? "bearish" : "bullish" };
    }
    case "spot_cross_ref": {
      const ref = rule.ref === "max_pain" ? m?.maxPain : m?.gammaFlip;
      if (!m || !(m.spot > 0) || !finite(ref) || ref <= 0) return null;
      const sign = Math.sign(m.spot - ref);
      const prev = mem.lastSign;
      if (sign !== 0) mem.lastSign = sign;
      if (!finite(prev) || prev === 0 || sign === 0 || sign === prev) return null;
      const name = rule.ref === "max_pain" ? "max pain" : "gamma flip";
      return { title: `${rule.symbol} crossed ${sign > 0 ? "above" : "below"} ${name}`, message: `Spot ${formatNumberIN(m.spot, 2)} vs ${name} ${formatNumberIN(ref, 0)}.`, tone: toneFor(rule, sign > 0 ? "up" : "down") };
    }
    case "repeated_hits":
    case "big_opening_print": {
      const since = mem.printTs ?? -Infinity;
      const fresh = (ctx.prints ?? []).filter((p) => p && p.ts > since && (rule.symbol === ANY_SYMBOL || p.symbol === rule.symbol));
      const maxTs = fresh.reduce((mx, p) => Math.max(mx, p.ts), since);
      // First look: set the baseline without replaying the whole session.
      const firstLook = mem.printTs === undefined;
      mem.printTs = finite(maxTs) ? maxTs : mem.printTs ?? ctx.now;
      if (firstLook) return null;
      if (rule.type === "big_opening_print") {
        const big = fresh.filter((p) => p.tag === "OPENING" && p.premium >= rule.minPremium).sort((a, b) => b.premium - a.premium);
        if (big.length === 0) return null;
        const p = big[0];
        const more = big.length > 1 ? ` (+${big.length - 1} more)` : "";
        return {
          title: `${p.symbol} ${formatStrike(p.strike)} ${p.type} opening print ${fmtRs(p.premium)}`,
          message: `${formatNumberIN(p.dVol)} contracts at ₹${p.ltp.toFixed(2)}, ${p.aggressor === "ASK" ? "at the ask" : p.aggressor === "BID" ? "at the bid" : "mid-market"}, OI +${formatNumberIN(p.dOI)}${more}.`,
          tone: toneFor(rule, p.type),
          symbol: p.symbol,
        };
      }
      const windowMs = Math.max(1, rule.windowMin) * 60_000;
      const hits: Record<string, number[]> = {};
      for (const [k, arr] of Object.entries(mem.hits ?? {})) {
        const kept = arr.filter((t) => ctx.now - t <= windowMs);
        if (kept.length) hits[k] = kept;
      }
      let fired: { key: string; p: FlowPrint; n: number } | null = null;
      for (const p of fresh.filter((x) => x.premium >= rule.minPremium).sort((a, b) => a.ts - b.ts)) {
        const key = `${p.symbol}|${p.expiry}|${p.strike}|${p.type}`;
        const arr = (hits[key] ??= []);
        arr.push(p.ts);
        if (arr.length >= rule.minHits && (!fired || arr.length > fired.n)) fired = { key, p, n: arr.length };
      }
      if (fired) delete hits[fired.key];
      mem.hits = hits;
      if (!fired) return null;
      const p = fired.p;
      return {
        title: `${p.symbol} ${formatStrike(p.strike)} ${p.type}: ${fired.n} big prints`,
        message: `${fired.n} intervals of ${fmtRs(rule.minPremium)}+ within ${rule.windowMin} min. Last ${fmtRs(p.premium)} at ₹${p.ltp.toFixed(2)}.`,
        tone: toneFor(rule, p.type),
        symbol: p.symbol,
      };
    }
    case "ban_entry": {
      if (!Array.isArray(ctx.banList)) return null;
      const now = [...new Set(ctx.banList.map((s) => String(s).toUpperCase()))];
      const before = mem.ban;
      mem.ban = now;
      if (rule.symbol === ANY_SYMBOL) {
        if (!before) return null;
        const added = now.filter((s) => !before.includes(s));
        if (added.length === 0) return null;
        return { title: `F&O ban: ${added.join(", ")}`, message: "New positions are not allowed in banned stocks; only reducing trades.", tone: "warning" };
      }
      const inNow = now.includes(rule.symbol);
      const wasIn = before ? before.includes(rule.symbol) : false;
      if (!inNow || wasIn) return null;
      return { title: `${rule.symbol} entered the F&O ban`, message: "MWPL crossed 95%. Only position-reducing trades are allowed.", tone: "warning" };
    }
  }
}

/** Evaluate every enabled rule. Returns the events that fired and the next state (input state is not mutated). */
export function evaluateRules(rules: AlertRule[], ctx: RuleContext, state: RuleState = {}): { events: AlertEvent[]; state: RuleState } {
  const next: RuleState = {};
  const events: AlertEvent[] = [];
  for (const rule of rules ?? []) {
    if (!rule?.id) continue;
    const mem: RuleMemory = { ...(state[rule.id] ?? {}) };
    if (mem.ivSeries) mem.ivSeries = [...mem.ivSeries];
    if (mem.hits) mem.hits = Object.fromEntries(Object.entries(mem.hits).map(([k, v]) => [k, [...v]]));
    next[rule.id] = mem;
    if (!rule.enabled) continue;
    // Chain rules only re-evaluate on new data.
    const m = ctx.markets[rule.symbol];
    const chainRule = ruleNeedsChain(rule) && rule.type !== "repeated_hits" && rule.type !== "big_opening_print";
    if (chainRule) {
      if (!m) continue;
      if (mem.marketTs !== undefined && m.ts <= mem.marketTs) continue;
      mem.marketTs = m.ts;
    }
    const hit = evalOne(rule, ctx, mem);
    if (!hit) continue;
    const cooling = finite(mem.lastFiredAt) && ctx.now - mem.lastFiredAt < Math.max(0, rule.cooldownMin) * 60_000;
    if (cooling) continue;
    mem.lastFiredAt = ctx.now;
    mem.fireCount = (mem.fireCount ?? 0) + 1;
    events.push({ id: `${rule.id}:${ctx.now}`, ruleId: rule.id, type: rule.type, symbol: hit.symbol ?? rule.symbol, ts: ctx.now, title: hit.title, message: hit.message, tone: hit.tone });
  }
  return { events, state: next };
}

// ── Creation, validation, persistence ──

export function newRuleId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createRule(r: NewAlertRule, now: number = Date.now()): AlertRule {
  return { enabled: true, cooldownMin: 15, ...r, symbol: String(r.symbol || "NIFTY").toUpperCase(), id: newRuleId(), createdAt: now } as AlertRule;
}

const symbolSchema = z.string().trim().min(1).max(24).regex(/^[A-Z0-9&\-_]+$/i).transform((s) => s.toUpperCase());
const pos = z.number().finite().positive();
const base = {
  id: z.string().min(1).max(64),
  symbol: symbolSchema,
  enabled: z.boolean().default(true),
  createdAt: z.number().finite().default(() => Date.now()),
  cooldownMin: z.number().finite().min(0).max(1440).default(15),
  note: z.string().max(200).optional(),
};
const dir = z.enum(["above", "below", "either"]);
const side = z.enum(["CE", "PE", "BOTH"]);

export const alertRuleSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("pcr_cross"), direction: dir, level: pos.max(10) }),
  z.object({ ...base, type: z.literal("oi_change_strike"), strike: pos, side, threshold: pos }),
  z.object({ ...base, type: z.literal("ivp_level"), direction: z.enum(["above", "below"]), level: z.number().finite().min(0).max(100) }),
  z.object({ ...base, type: z.literal("price_level"), direction: dir, level: pos }),
  z.object({ ...base, type: z.literal("atm_iv_spike"), points: pos.max(50), windowMin: pos.max(375) }),
  z.object({ ...base, type: z.literal("oi_wall_shift"), side }),
  z.object({ ...base, type: z.literal("spot_cross_ref"), ref: z.enum(["max_pain", "gamma_flip"]) }),
  z.object({ ...base, type: z.literal("repeated_hits"), minHits: z.number().int().min(2).max(50), windowMin: pos.max(375), minPremium: pos }),
  z.object({ ...base, type: z.literal("big_opening_print"), minPremium: pos }),
  z.object({ ...base, type: z.literal("ban_entry") }),
]);

export interface RulesFile {
  app: "mr-chartist-terminal";
  kind: "alert-rules";
  version: 1;
  exportedAt: string;
  rules: AlertRule[];
}

export function exportRulesJSON(rules: AlertRule[], now: Date = new Date()): string {
  const file: RulesFile = { app: "mr-chartist-terminal", kind: "alert-rules", version: 1, exportedAt: now.toISOString(), rules };
  return JSON.stringify(file, null, 2);
}

/** Parse an exported rules file (or a bare array). Invalid rules are skipped and reported. */
export function parseRulesJSON(text: string): { rules: AlertRule[]; skipped: number; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { rules: [], skipped: 0, error: "Not valid JSON." };
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { rules?: unknown }).rules) ? (raw as { rules: unknown[] }).rules : null;
  if (!list) return { rules: [], skipped: 0, error: "No rules array found." };
  const rules: AlertRule[] = [];
  let skipped = 0;
  for (const item of list.slice(0, 200)) {
    const r = alertRuleSchema.safeParse(item);
    if (r.success) rules.push(r.data as AlertRule);
    else skipped++;
  }
  return { rules, skipped };
}

/** Merge imported rules into existing ones; imported ids that clash get fresh ids. */
export function mergeRules(existing: AlertRule[], incoming: AlertRule[]): AlertRule[] {
  const ids = new Set(existing.map((r) => r.id));
  const out = [...existing];
  for (const r of incoming) {
    const id = ids.has(r.id) ? newRuleId() : r.id;
    ids.add(id);
    out.push({ ...r, id });
  }
  return out;
}

export function loadRules(storage: Pick<Storage, "getItem"> | null = safeStorage()): AlertRule[] {
  if (!storage) return [];
  try {
    const text = storage.getItem(ALERT_RULES_STORAGE_KEY);
    if (!text) return [];
    return parseRulesJSON(text).rules;
  } catch {
    return [];
  }
}

export function saveRules(rules: AlertRule[], storage: Pick<Storage, "setItem"> | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ALERT_RULES_STORAGE_KEY, JSON.stringify(rules));
    return true;
  } catch {
    return false;
  }
}

export function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

// ── Ideas (templates shown as cards in the alert panel) ──

export interface RuleIdea {
  id: string;
  title: string;
  why: string;
  make: (symbol: string, spot?: number) => NewAlertRule;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export const RULE_IDEAS: RuleIdea[] = [
  { id: "pcr-1", title: "PCR crosses 1.00", why: "Put OI overtaking call OI often marks a shift in positioning.", make: (symbol) => ({ symbol, type: "pcr_cross", direction: "either", level: 1 }) },
  { id: "ivp-high", title: "IV percentile above 80", why: "Premiums are rich versus recorded history: worth knowing before buying options.", make: (symbol) => ({ symbol, type: "ivp_level", direction: "above", level: 80 }) },
  { id: "ivp-low", title: "IV percentile below 20", why: "Premiums are cheap versus recorded history: worth knowing before selling options.", make: (symbol) => ({ symbol, type: "ivp_level", direction: "below", level: 20 }) },
  { id: "iv-spike", title: "ATM IV jumps 1.5 pts in 15 min", why: "A fast IV jump often comes before or with a sharp move or news.", make: (symbol) => ({ symbol, type: "atm_iv_spike", points: 1.5, windowMin: 15 }) },
  { id: "wall", title: "Call or put wall moves", why: "Writers rolling the highest-OI strike shifts the range traders watch.", make: (symbol) => ({ symbol, type: "oi_wall_shift", side: "BOTH" }) },
  { id: "maxpain", title: "Spot crosses max pain", why: "Useful context on expiry week; max pain is not a target.", make: (symbol) => ({ symbol, type: "spot_cross_ref", ref: "max_pain" }) },
  { id: "flip", title: "Spot crosses the gamma flip", why: "Below the flip, dealer hedging can amplify moves (model-dependent).", make: (symbol) => ({ symbol, type: "spot_cross_ref", ref: "gamma_flip" }) },
  {
    id: "price",
    title: "Price crosses a round level",
    why: "A plain level alert on the underlying.",
    make: (symbol, spot) => ({ symbol, type: "price_level", direction: "either", level: spot && spot > 0 ? roundTo(spot, spot > 20000 ? 100 : spot > 2000 ? 50 : 10) : 25000 }),
  },
  { id: "opening", title: "Big opening print (₹50L+)", why: "Large premium with rising OI: fresh positions, derived from snapshots.", make: (symbol) => ({ symbol, type: "big_opening_print", minPremium: 50_00_000 }) },
  { id: "repeat", title: "Repeated hits on one contract", why: "The same strike printing big premium again and again.", make: (symbol) => ({ symbol, type: "repeated_hits", minHits: 3, windowMin: 30, minPremium: 10_00_000 }) },
  { id: "ban", title: "Any stock enters the F&O ban", why: "Banned stocks only allow position-reducing trades.", make: () => ({ symbol: ANY_SYMBOL, type: "ban_entry" }) },
];

/** Underlyings whose chains must be polled for the enabled rules. ANY flow rules follow `universe`. */
export function alertFeedSymbols(rules: AlertRule[], universe: readonly string[] = ["NIFTY", "BANKNIFTY", "SENSEX"]): string[] {
  const out = new Set<string>();
  for (const r of rules ?? []) {
    if (!r?.enabled) continue;
    if (r.type === "ban_entry") continue;
    if (r.symbol === ANY_SYMBOL) {
      if (r.type === "repeated_hits" || r.type === "big_opening_print") for (const u of universe) out.add(u);
      continue;
    }
    out.add(r.symbol);
  }
  return [...out].sort();
}
