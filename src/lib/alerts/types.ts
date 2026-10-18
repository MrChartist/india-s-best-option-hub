/**
 * The one alert rule model for the whole terminal.
 *
 * Every alert (header rules, per-strike chain alerts, flow rules, position thresholds) is an
 * `AlertRule`: a common base plus a body discriminated by `type`. Rules persist as a plain JSON
 * array under ALERT_RULES_STORAGE_KEY so older builds and exports stay readable.
 */
import type { FlowPrint } from "@/lib/flow/types";

export const ALERT_RULES_STORAGE_KEY = "mc_alert_rules_v1";
/** Underlying placeholder for flow, ban-list and portfolio-wide rules. */
export const ANY_SYMBOL = "ANY";

export type AlertTone = "bullish" | "bearish" | "warning" | "info";
export type Direction = "above" | "below" | "either";
export type ZoneDirection = "above" | "below";
export type SideSel = "CE" | "PE" | "BOTH";
export type StrikeField = "premium" | "iv" | "oiChange";
export type StrikeOp = "gte" | "lte";
export type GreekKey = "delta" | "gamma" | "theta" | "vega";
/** "abs_above" compares |value| with the level (e.g. |net delta| above 50). */
export type GreekDirection = "above" | "below" | "abs_above";

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
  | "ban_entry"
  | "iv_level"
  | "strike_level"
  | "premium_tide"
  | "position_pnl"
  | "position_greek";

export type ChannelKey = "toast" | "desktop" | "sound" | "webhook";
/** Per-rule channel overrides. A missing key follows the global setting. */
export type RuleChannels = Partial<Record<ChannelKey, boolean>>;

export interface RuleBase {
  id: string;
  /** Underlying, or ANY for flow, ban-list and portfolio-wide rules. */
  symbol: string;
  enabled: boolean;
  createdAt: number;
  /** Minutes before the same rule can fire again. */
  cooldownMin: number;
  /** Optional short name shown instead of the generated description. */
  label?: string;
  note?: string;
  /** Epoch ms; the rule is evaluated but does not fire until then. */
  snoozeUntil?: number;
  channels?: RuleChannels;
  /** Where the rule came from when it was migrated (for support and de-duplication). */
  origin?: "flow" | "chain" | "header" | "import";
}

export type AlertRuleBody =
  | { type: "pcr_cross"; direction: Direction; level: number }
  | { type: "oi_change_strike"; strike: number; side: SideSel; threshold: number }
  | { type: "ivp_level"; direction: ZoneDirection; level: number }
  | { type: "price_level"; direction: Direction; level: number }
  | { type: "atm_iv_spike"; points: number; windowMin: number }
  | { type: "oi_wall_shift"; side: SideSel }
  | { type: "spot_cross_ref"; ref: "max_pain" | "gamma_flip" }
  | { type: "repeated_hits"; minHits: number; windowMin: number; minPremium: number }
  | { type: "big_opening_print"; minPremium: number }
  | { type: "ban_entry" }
  /** ATM IV (percent) crosses a level. */
  | { type: "iv_level"; direction: Direction; level: number }
  /** One option contract's premium, IV or OI change against a value (the chain's per-strike alert). */
  | {
      type: "strike_level";
      expiry: string;
      strike: number;
      side: "CE" | "PE";
      field: StrikeField;
      op: StrikeOp;
      value: number;
    }
  /** Net Premium Tide (₹, ask-side minus bid-side, calls minus puts) crosses a level. */
  | { type: "premium_tide"; direction: Direction; level: number }
  /** Open positions' mark-to-market P&L (₹, before charges) enters a zone. */
  | { type: "position_pnl"; direction: ZoneDirection; level: number }
  /** Open positions' net Greek enters a zone. Delta in units, theta and vega in ₹. */
  | { type: "position_greek"; greek: GreekKey; direction: GreekDirection; level: number };

export type AlertRule = RuleBase & AlertRuleBody;
export type NewAlertRule = Omit<RuleBase, "id" | "createdAt" | "enabled" | "cooldownMin"> &
  Partial<Pick<RuleBase, "enabled" | "cooldownMin">> &
  AlertRuleBody;

// ── Evaluation context ──

export interface StrikeOI {
  strike: number;
  ceOi: number;
  peOi: number;
  ceOiChg: number;
  peOiChg: number;
}

export interface LegQuote {
  ltp: number;
  /** IV in percent. */
  iv: number;
  oiChange: number;
}

export interface StrikeQuote {
  strike: number;
  ce: LegQuote;
  pe: LegQuote;
}

export interface SymbolMarket {
  symbol: string;
  /** Epoch ms of the data. */
  ts: number;
  spot: number;
  /** Expiry of the chain this context was built from (ISO). */
  expiry?: string;
  pcr?: number;
  /** ATM IV in percent. */
  atmIv?: number;
  /** IV percentile 0-100; null when history is too short. */
  ivp?: number | null;
  maxPain?: number;
  gammaFlip?: number | null;
  strikes?: StrikeOI[];
  /** Per-strike quotes for strike rules (same expiry as `expiry`). */
  quotes?: StrikeQuote[];
  /** Latest net Premium Tide in ₹ for the session. */
  tideNet?: number;
}

export interface PortfolioSnapshot {
  /** Mark-to-market P&L before charges, ₹. */
  pnl: number;
  /** Net delta in units of the underlying. */
  delta: number;
  gamma: number;
  /** ₹ per calendar day. */
  theta: number;
  /** ₹ per 1 vol point. */
  vega: number;
  /** Open legs in scope. */
  legs: number;
  /** Legs marked from a live chain. Rules only evaluate when every leg is marked. */
  marked: number;
  /** Oldest chain time used for the marks (epoch ms). */
  ts: number;
}

export interface RuleContext {
  now: number;
  markets: Record<string, SymbolMarket>;
  /** Flow prints (all known for the session; the engine only looks at ones newer than it has seen). */
  prints: FlowPrint[];
  /** Today's ban list (symbols), null/undefined when unknown. */
  banList?: string[] | null;
  /** Portfolio snapshots keyed by underlying, plus ANY for all open positions. */
  portfolio?: Record<string, PortfolioSnapshot>;
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

/** What the market looked like when a rule fired (kept in the trigger log). */
export interface AlertSnapshot {
  symbol?: string;
  spot?: number;
  pcr?: number;
  atmIv?: number;
  ivp?: number | null;
  maxPain?: number;
  gammaFlip?: number | null;
  tideNet?: number;
  expiry?: string;
  /** The value the rule compared (premium, P&L, net delta…). */
  value?: number;
  valueLabel?: string;
  /** Epoch ms of the data behind the event. */
  dataTs?: number;
  pnl?: number;
  netDelta?: number;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  type: AlertRuleType;
  symbol: string;
  ts: number;
  title: string;
  message: string;
  tone: AlertTone;
  snapshot?: AlertSnapshot;
}

// ── Channels, log and runtime status ──

export interface ChannelSettings {
  toast: boolean;
  sound: boolean;
  /** 0-1. */
  volume: number;
  desktop: boolean;
  webhook: boolean;
  /** Generic webhook (https). Receives a JSON POST per alert. */
  webhookUrl: string;
}

export const DEFAULT_CHANNELS: ChannelSettings = {
  toast: true,
  sound: true,
  volume: 0.25,
  desktop: false,
  webhook: false,
  webhookUrl: "",
};

export type DeliveryOutcome = "sent" | "skipped" | "failed" | "blocked";

export interface TriggerLogEntry extends AlertEvent {
  /** Rule description at fire time (the rule may be edited or deleted later). */
  rule: string;
  /** Per-channel outcome. */
  delivery: Partial<Record<ChannelKey, DeliveryOutcome>>;
  /** True for the test-fire button. */
  test?: boolean;
  /** Set when another surface (the Option Chain page) already showed this alert. */
  shownElsewhere?: string;
}

export type FeedModeLike = "live" | "recorded" | "sample" | "waiting";

export interface FeedStatus {
  symbol: string;
  mode: FeedModeLike;
  asOf?: number;
  expiry?: string;
}

export interface RuntimeStatus {
  /** True once a runner is mounted and evaluating. */
  running: boolean;
  feeds: FeedStatus[];
  banListAvailable: boolean;
  banListDate: string;
  lastEvalAt?: number;
  /** Open positions considered by position rules. */
  positions: number;
  portfolio?: Record<string, PortfolioSnapshot>;
  /** Last evaluated market context per symbol (for coverage and the page's "now" column). */
  markets: Record<string, SymbolMarket>;
}

export const EMPTY_RUNTIME: RuntimeStatus = {
  running: false,
  feeds: [],
  banListAvailable: false,
  banListDate: "",
  positions: 0,
  markets: {},
};
