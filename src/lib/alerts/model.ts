/** Rule creation, persistence, import/export, templates and feed planning. */
import { isValidIsoDate, istDateString } from "@/lib/options";
import { describeRule } from "./describe";
import { migrateAlertRecords, type MigrationSource } from "./migrate";
import { ALERT_RULES_STORAGE_KEY, ANY_SYMBOL, type AlertRule, type NewAlertRule } from "./types";

export function newRuleId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createRule(r: NewAlertRule, now: number = Date.now()): AlertRule {
  return {
    enabled: true,
    cooldownMin: 15,
    ...r,
    symbol: String(r.symbol || "NIFTY").toUpperCase(),
    id: newRuleId(),
    createdAt: now,
  } as AlertRule;
}

export const RULES_FILE_VERSION = 2;

export interface RulesFile {
  app: "mr-chartist-terminal";
  kind: "alert-rules";
  version: number;
  exportedAt: string;
  rules: AlertRule[];
}

export function exportRulesJSON(rules: AlertRule[], now: Date = new Date()): string {
  const file: RulesFile = {
    app: "mr-chartist-terminal",
    kind: "alert-rules",
    version: RULES_FILE_VERSION,
    exportedAt: now.toISOString(),
    rules,
  };
  return JSON.stringify(file, null, 2);
}

export interface ParsedRules {
  rules: AlertRule[];
  skipped: number;
  error?: string;
  /** First few reasons rules were skipped. */
  errors?: string[];
  bySource?: Record<MigrationSource, number>;
}

/** Most records read from one import file. Never applied to the user's own stored rules. */
export const IMPORT_RULES_LIMIT = 500;

/**
 * Parse an exported rules file (any version), a bare array, or a list of legacy chain/header
 * alerts. Invalid records are skipped and reported; at most `limit` records are read (500 for
 * imports; pass Infinity for the stored list).
 */

export function parseRulesJSON(
  text: string,
  now: number = Date.now(),
  { limit = IMPORT_RULES_LIMIT }: { limit?: number } = {},
): ParsedRules {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { rules: [], skipped: 0, error: "Not valid JSON." };
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { rules?: unknown }).rules)
      ? (raw as { rules: unknown[] }).rules
      : null;
  if (!list) return { rules: [], skipped: 0, error: "No rules array found." };
  const cap = limit > 0 ? limit : IMPORT_RULES_LIMIT;
  const report = migrateAlertRecords(Number.isFinite(cap) ? list.slice(0, cap) : list, now);
  return {
    rules: report.rules,
    skipped: report.skipped + (Number.isFinite(cap) ? Math.max(0, list.length - cap) : 0),
    errors: report.errors,
    bySource: report.bySource,
  };
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

export function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadRules(storage: Pick<Storage, "getItem"> | null = safeStorage()): AlertRule[] {
  if (!storage) return [];
  try {
    const text = storage.getItem(ALERT_RULES_STORAGE_KEY);
    if (!text) return [];
    // Stored rules are the user's own: read them all (the import cap would silently drop the rest
    // and the next save would make the loss permanent).
    return parseRulesJSON(text, Date.now(), { limit: Infinity }).rules;
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

/** True when a rule with the same description already exists (used to grey out templates). */
export function hasEquivalentRule(rules: AlertRule[], r: AlertRule): boolean {
  const d = describeRule(r);
  return rules.some((x) => x.id !== r.id && describeRule(x) === d);
}

/** Strike rules whose expiry has passed (they can never fire again). */
export function isRuleExpired(r: AlertRule, today: string = istDateString()): boolean {
  return r.type === "strike_level" && isValidIsoDate(r.expiry) && r.expiry < today;
}

// ── Ideas (templates shown as cards) ──

export interface RuleIdea {
  id: string;
  title: string;
  why: string;
  make: (symbol: string, spot?: number) => NewAlertRule;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export const RULE_IDEAS: RuleIdea[] = [
  {
    id: "pcr-1",
    title: "PCR crosses 1.00",
    why: "Put OI overtaking call OI often marks a shift in positioning.",
    make: (symbol) => ({ symbol, type: "pcr_cross", direction: "either", level: 1 }),
  },
  {
    id: "ivp-high",
    title: "IV percentile above 80",
    why: "Premiums are rich versus recorded history: worth knowing before buying options.",
    make: (symbol) => ({ symbol, type: "ivp_level", direction: "above", level: 80 }),
  },
  {
    id: "ivp-low",
    title: "IV percentile below 20",
    why: "Premiums are cheap versus recorded history: worth knowing before selling options.",
    make: (symbol) => ({ symbol, type: "ivp_level", direction: "below", level: 20 }),
  },
  {
    id: "iv-spike",
    title: "ATM IV jumps 1.5 pts in 15 min",
    why: "A fast IV jump often comes before or with a sharp move or news.",
    make: (symbol) => ({ symbol, type: "atm_iv_spike", points: 1.5, windowMin: 15 }),
  },
  {
    id: "wall",
    title: "Call or put wall moves",
    why: "Writers rolling the highest-OI strike shifts the range traders watch.",
    make: (symbol) => ({ symbol, type: "oi_wall_shift", side: "BOTH" }),
  },
  {
    id: "maxpain",
    title: "Spot crosses max pain",
    why: "Useful context on expiry week; max pain is not a target.",
    make: (symbol) => ({ symbol, type: "spot_cross_ref", ref: "max_pain" }),
  },
  {
    id: "flip",
    title: "Spot crosses the gamma flip",
    why: "Below the flip, dealer hedging can amplify moves (model-dependent).",
    make: (symbol) => ({ symbol, type: "spot_cross_ref", ref: "gamma_flip" }),
  },
  {
    id: "price",
    title: "Price crosses a round level",
    why: "A plain level alert on the underlying.",
    make: (symbol, spot) => ({
      symbol,
      type: "price_level",
      direction: "either",
      level: spot && spot > 0 ? roundTo(spot, spot > 20000 ? 100 : spot > 2000 ? 50 : 10) : 25000,
    }),
  },
  {
    id: "tide",
    title: "Premium Tide flips sign",
    why: "Net ask-side call premium versus put premium turning over is a sentiment shift.",
    make: (symbol) => ({ symbol, type: "premium_tide", direction: "either", level: 0 }),
  },
  {
    id: "opening",
    title: "Big opening print (₹50L+)",
    why: "Large premium with rising OI: fresh positions, derived from snapshots.",
    make: (symbol) => ({ symbol, type: "big_opening_print", minPremium: 50_00_000 }),
  },
  {
    id: "repeat",
    title: "Repeated hits on one contract",
    why: "The same strike printing big premium again and again.",
    make: (symbol) => ({ symbol, type: "repeated_hits", minHits: 3, windowMin: 30, minPremium: 10_00_000 }),
  },
  {
    id: "ban",
    title: "Any stock enters the F&O ban",
    why: "Banned stocks only allow position-reducing trades.",
    make: () => ({ symbol: ANY_SYMBOL, type: "ban_entry" }),
  },
  {
    id: "pnl-stop",
    title: "Portfolio loss of ₹10,000",
    why: "A mental stop on open positions, marked from live chains.",
    make: () => ({ symbol: ANY_SYMBOL, type: "position_pnl", direction: "below", level: -10_000 }),
  },
  {
    id: "delta",
    title: "Net delta beyond ±100 units",
    why: "Your book has drifted directional; consider whether that is intended.",
    make: () => ({ symbol: ANY_SYMBOL, type: "position_greek", greek: "delta", direction: "abs_above", level: 100 }),
  },
];

/**
 * Underlyings whose chains must be polled for the enabled rules. ANY flow rules follow `universe`;
 * position rules follow `positionSymbols` (underlyings of open positions).
 */
export function alertFeedSymbols(
  rules: AlertRule[],
  universe: readonly string[] = ["NIFTY", "BANKNIFTY", "SENSEX"],
  positionSymbols: readonly string[] = [],
): string[] {
  const out = new Set<string>();
  for (const r of rules ?? []) {
    if (!r?.enabled) continue;
    if (r.type === "ban_entry") continue;
    if (r.type === "position_pnl" || r.type === "position_greek") {
      for (const s of positionSymbols) if (r.symbol === ANY_SYMBOL || r.symbol === s) out.add(s);
      continue;
    }
    if (r.symbol === ANY_SYMBOL) {
      if (r.type === "repeated_hits" || r.type === "big_opening_print") for (const u of universe) out.add(u);
      continue;
    }
    out.add(r.symbol);
  }
  return [...out].sort();
}
