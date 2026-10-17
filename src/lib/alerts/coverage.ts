/**
 * Per-rule status for the UI: is the rule being watched right now, and if not, why? Plus the
 * current value the rule compares, when the runner has it. Pure: reads the runner's status only.
 */
import { formatINR, formatNumberIN, formatTimeIST, istDateString } from "@/lib/options";
import { GREEK_LABEL, STRIKE_FIELD_LABEL, fmtRs, formatGreekValue, formatStrikeValue } from "./describe";
import { portfolioFor, strikeRuleValue } from "./evaluate";
import { isRuleExpired } from "./model";
import { ANY_SYMBOL, type AlertRule, type RuntimeStatus } from "./types";

export type CoverageState =
  "watching" | "waiting" | "paused" | "snoozed" | "expired" | "sample" | "elsewhere" | "unavailable";

export interface RuleCoverage {
  state: CoverageState;
  label: string;
  detail?: string;
}

const MODE_WORD = { live: "live", recorded: "delayed" } as const;

export function ruleCoverage(
  r: AlertRule,
  rt: RuntimeStatus,
  now: number = Date.now(),
  today: string = istDateString(new Date(now)),
): RuleCoverage {
  if (!r.enabled) return { state: "paused", label: "Paused" };
  if (isRuleExpired(r, today))
    return { state: "expired", label: "Expired", detail: "This contract has expired; the rule can never fire again." };
  if (r.snoozeUntil && now < r.snoozeUntil)
    return { state: "snoozed", label: `Snoozed till ${formatTimeIST(r.snoozeUntil)}` };
  if (!rt.running)
    return { state: "unavailable", label: "Not running", detail: "Alerts are checked while the terminal is open." };

  if (r.type === "ban_entry") {
    return rt.banListAvailable
      ? {
          state: "watching",
          label: "Watching",
          detail: rt.banListDate ? `NSE ban list for ${rt.banListDate}` : "NSE ban list",
        }
      : { state: "unavailable", label: "Ban list unavailable", detail: "Needs the local data proxy." };
  }

  if (r.type === "position_pnl" || r.type === "position_greek") {
    if (rt.positions === 0)
      return { state: "waiting", label: "No open positions", detail: "Add positions on the Positions page." };
    const p = rt.portfolio?.[r.symbol];
    if (!p || p.legs === 0)
      return { state: "waiting", label: r.symbol === ANY_SYMBOL ? "No open positions" : `No ${r.symbol} positions` };
    if (p.marked < p.legs)
      return {
        state: "waiting",
        label: `${p.marked} of ${p.legs} legs marked live`,
        detail: "Every leg needs a live chain for its expiry before the rule is checked.",
      };
    return { state: "watching", label: "Watching", detail: `${p.legs} leg${p.legs === 1 ? "" : "s"} marked live` };
  }

  if ((r.type === "repeated_hits" || r.type === "big_opening_print") && r.symbol === ANY_SYMBOL) {
    const live = rt.feeds.filter((f) => f.mode === "live" || f.mode === "recorded");
    if (live.length > 0) return { state: "watching", label: "Watching", detail: live.map((f) => f.symbol).join(", ") };
    return rt.feeds.some((f) => f.mode === "sample")
      ? { state: "sample", label: "Sample data: not checked", detail: "Connect the data proxy for live chains." }
      : { state: "waiting", label: "Waiting for data" };
  }

  const f = rt.feeds.find((x) => x.symbol === r.symbol);
  if (!f || f.mode === "waiting") return { state: "waiting", label: "Waiting for data" };
  if (f.mode === "sample")
    return { state: "sample", label: "Sample data: not checked", detail: "Connect the data proxy for live chains." };
  if (r.type === "strike_level" && f.expiry && f.expiry !== r.expiry) {
    return {
      state: "elsewhere",
      label: "Checked on Option Chain",
      detail: `Only the nearest expiry (${f.expiry}) is polled in the background; open this expiry on the Option Chain page.`,
    };
  }
  return {
    state: "watching",
    label: `Watching · ${MODE_WORD[f.mode]}`,
    detail: f.asOf ? `Data as of ${formatTimeIST(f.asOf, { seconds: true })}` : undefined,
  };
}

/** The value the rule compares, formatted, when the runner has it. */
export function ruleCurrentValue(r: AlertRule, rt: RuntimeStatus): { label: string; value: string } | null {
  const m = rt.markets[r.symbol];
  switch (r.type) {
    case "price_level":
      return m ? { label: "Spot", value: formatNumberIN(m.spot, 2) } : null;
    case "pcr_cross":
      return m && Number.isFinite(m.pcr) ? { label: "PCR", value: (m.pcr as number).toFixed(2) } : null;
    case "iv_level":
    case "atm_iv_spike":
      return m && Number.isFinite(m.atmIv) ? { label: "ATM IV", value: `${(m.atmIv as number).toFixed(2)}%` } : null;
    case "ivp_level":
      return m && Number.isFinite(m.ivp)
        ? { label: "IVP", value: String(Math.round(m.ivp as number)) }
        : m
          ? { label: "IVP", value: "Needs history" }
          : null;
    case "spot_cross_ref": {
      const ref = r.ref === "max_pain" ? m?.maxPain : m?.gammaFlip;
      return m && Number.isFinite(ref)
        ? {
            label: r.ref === "max_pain" ? "Spot / max pain" : "Spot / flip",
            value: `${formatNumberIN(m.spot, 0)} / ${formatNumberIN(ref as number, 0)}`,
          }
        : null;
    }
    case "premium_tide":
      return m && Number.isFinite(m.tideNet)
        ? { label: "Net tide", value: `${(m.tideNet as number) < 0 ? "−" : ""}${fmtRs(Math.abs(m.tideNet as number))}` }
        : null;
    case "strike_level": {
      const v = strikeRuleValue(r, m);
      return Number.isFinite(v) ? { label: STRIKE_FIELD_LABEL[r.field], value: formatStrikeValue(r.field, v) } : null;
    }
    case "position_pnl": {
      const p = portfolioFor(r, rt);
      return p ? { label: "P&L", value: formatINR(p.pnl, { decimals: 0 }) } : null;
    }
    case "position_greek": {
      const p = portfolioFor(r, rt);
      return p ? { label: GREEK_LABEL[r.greek], value: formatGreekValue(r.greek, p[r.greek]) } : null;
    }
    default:
      return null;
  }
}
