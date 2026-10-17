/** Human-readable names and one-line descriptions for every rule type. */
import { formatCompactIN, formatDateIST, formatINR, formatNumberIN, formatStrike } from "@/lib/options";
import { ANY_SYMBOL, type AlertRule, type AlertRuleType, type GreekKey, type SideSel, type StrikeField } from "./types";

export const RULE_TYPE_LABEL: Record<AlertRuleType, string> = {
  price_level: "Price level",
  iv_level: "ATM IV level",
  ivp_level: "IV percentile",
  atm_iv_spike: "ATM IV spike",
  pcr_cross: "PCR cross",
  oi_change_strike: "OI change at strike",
  oi_wall_shift: "OI wall shift",
  spot_cross_ref: "Spot crosses max pain / flip",
  strike_level: "Option contract",
  premium_tide: "Premium Tide",
  repeated_hits: "Repeated hits",
  big_opening_print: "Big opening print",
  ban_entry: "Enters F&O ban",
  position_pnl: "Position P&L",
  position_greek: "Position Greeks",
};

export type RuleCategory = "market" | "chain" | "flow" | "positions";

export const RULE_CATEGORY: Record<AlertRuleType, RuleCategory> = {
  price_level: "market",
  iv_level: "market",
  ivp_level: "market",
  atm_iv_spike: "market",
  pcr_cross: "chain",
  oi_change_strike: "chain",
  oi_wall_shift: "chain",
  spot_cross_ref: "chain",
  strike_level: "chain",
  premium_tide: "flow",
  repeated_hits: "flow",
  big_opening_print: "flow",
  ban_entry: "flow",
  position_pnl: "positions",
  position_greek: "positions",
};

export const CATEGORY_LABEL: Record<RuleCategory, string> = {
  market: "Price & volatility",
  chain: "Option chain",
  flow: "Flow & ban list",
  positions: "Positions",
};

/** Rule types in the order the editor lists them. */
export const RULE_TYPES: AlertRuleType[] = Object.keys(RULE_TYPE_LABEL) as AlertRuleType[];

/** Rule types that may use the ANY placeholder instead of one underlying. */
export const ANY_ALLOWED: ReadonlySet<AlertRuleType> = new Set<AlertRuleType>([
  "repeated_hits",
  "big_opening_print",
  "ban_entry",
  "position_pnl",
  "position_greek",
]);

export const STRIKE_FIELD_LABEL: Record<StrikeField, string> = {
  premium: "Premium (LTP)",
  iv: "IV %",
  oiChange: "OI change",
};

export const GREEK_LABEL: Record<GreekKey, string> = {
  delta: "Net delta",
  gamma: "Net gamma",
  theta: "Net theta",
  vega: "Net vega",
};

/** Unit hint for a greek threshold. */
export const GREEK_UNIT: Record<GreekKey, string> = {
  delta: "units",
  gamma: "units per point",
  theta: "₹ per day",
  vega: "₹ per vol pt",
};

export const fmtRs = (v: number): string => `₹${formatCompactIN(v, { symbol: false })}`;
const sideName = (s: SideSel) => (s === "BOTH" ? "CE/PE" : s);
const dirWord = (d: string) => (d === "either" ? "" : `${d} `);

export function formatStrikeValue(field: StrikeField, v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (field === "iv") return `${formatNumberIN(v, 2)}%`;
  if (field === "premium") return formatINR(v, { decimals: 2 });
  return formatNumberIN(v);
}

export function formatGreekValue(g: GreekKey, v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (g === "theta" || g === "vega") return formatINR(v, { decimals: 0 });
  if (g === "gamma") return formatNumberIN(v, 3);
  return formatNumberIN(v, 1);
}

/** One-line, self-contained description (also used for duplicate detection). */
export function describeRule(r: AlertRule): string {
  const sym = r.symbol === ANY_SYMBOL ? "Any underlying" : r.symbol;
  switch (r.type) {
    case "pcr_cross":
      return `${sym} PCR (OI) crosses ${dirWord(r.direction)}${r.level.toFixed(2)}`;
    case "oi_change_strike":
      return `${sym} ${formatStrike(r.strike)} ${sideName(r.side)} OI change beyond ${formatNumberIN(r.threshold)} contracts`;
    case "ivp_level":
      return `${sym} IV percentile ${r.direction === "above" ? "≥" : "≤"} ${r.level}`;
    case "price_level":
      return `${sym} crosses ${dirWord(r.direction)}${formatNumberIN(r.level, 2, { minDecimals: 0 })}`;
    case "iv_level":
      return `${sym} ATM IV crosses ${dirWord(r.direction)}${formatNumberIN(r.level, 2, { minDecimals: 0 })}%`;
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
    case "strike_level":
      return `${sym} ${formatStrike(r.strike)} ${r.side} (${formatDateIST(r.expiry)}) ${STRIKE_FIELD_LABEL[r.field]} ${r.op === "gte" ? "≥" : "≤"} ${formatStrikeValue(r.field, r.value)}`;
    case "premium_tide":
      return `${sym} net Premium Tide crosses ${dirWord(r.direction)}${r.level < 0 ? "−" : ""}${fmtRs(Math.abs(r.level))}`;
    case "position_pnl": {
      const scope = r.symbol === ANY_SYMBOL ? "All open positions" : `${r.symbol} positions`;
      return `${scope}: P&L ${r.direction === "above" ? "≥" : "≤"} ${r.level < 0 ? "−" : ""}${formatINR(Math.abs(r.level), { decimals: 0 })}`;
    }
    case "position_greek": {
      const scope = r.symbol === ANY_SYMBOL ? "All open positions" : `${r.symbol} positions`;
      const name = GREEK_LABEL[r.greek].toLowerCase();
      const lhs = r.direction === "abs_above" ? `|${name}| ≥` : `${name} ${r.direction === "above" ? "≥" : "≤"}`;
      return `${scope}: ${lhs} ${formatGreekValue(r.greek, r.level)}`;
    }
  }
}

/** The rule's label if set, else its description. */
export function ruleTitle(r: AlertRule): string {
  return r.label?.trim() ? r.label.trim() : describeRule(r);
}
