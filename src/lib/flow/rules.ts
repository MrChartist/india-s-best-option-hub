/**
 * Alert rules, as seen from the flow module.
 *
 * The rule model now lives in "@/lib/alerts" (one model for header, chain, flow and position
 * alerts). This file keeps every name the flow module has always exported so `@/lib/flow`
 * consumers keep working; validation is hand-written (no schema library).
 */
export {
  ALERT_RULES_STORAGE_KEY,
  ANY_SYMBOL,
  type AlertTone,
  type Direction,
  type SideSel,
  type AlertRuleType,
  type AlertRuleBody,
  type AlertRule,
  type NewAlertRule,
  type StrikeOI,
  type SymbolMarket,
  type RuleContext,
  type RuleMemory,
  type RuleState,
  type AlertEvent,
} from "@/lib/alerts/types";
export { RULE_TYPE_LABEL, describeRule } from "@/lib/alerts/describe";
export { crossed, oiWall, ruleNeedsChain, evaluateRules } from "@/lib/alerts/evaluate";
export { alertRuleSchema, parseAlertRule, isAlertRule } from "@/lib/alerts/validate";
export {
  newRuleId,
  createRule,
  exportRulesJSON,
  parseRulesJSON,
  mergeRules,
  loadRules,
  saveRules,
  safeStorage,
  RULE_IDEAS,
  alertFeedSymbols,
  type RulesFile,
  type RuleIdea,
} from "@/lib/alerts/model";
