/** Shared constants and helpers for the alert UI (no components, so fast refresh stays happy). */
import type { ReactNode } from "react";
import {
  Activity,
  Ban,
  BarChart3,
  Briefcase,
  Crosshair,
  Gauge,
  Layers,
  Repeat,
  Sigma,
  Target,
  TrendingUp,
  Waves,
  Zap,
} from "lucide-react";
import { CONTRACT_SPECS } from "@/lib/options";
import type { AlertRuleType, AlertTone } from "@/lib/alerts";
const ICON_CLASS = "h-4 w-4";

export const TYPE_ICON: Record<AlertRuleType, ReactNode> = {
  pcr_cross: <BarChart3 className={ICON_CLASS} aria-hidden="true" />,
  oi_change_strike: <Layers className={ICON_CLASS} aria-hidden="true" />,
  ivp_level: <Gauge className={ICON_CLASS} aria-hidden="true" />,
  iv_level: <Gauge className={ICON_CLASS} aria-hidden="true" />,
  price_level: <TrendingUp className={ICON_CLASS} aria-hidden="true" />,
  atm_iv_spike: <Zap className={ICON_CLASS} aria-hidden="true" />,
  oi_wall_shift: <Layers className={ICON_CLASS} aria-hidden="true" />,
  spot_cross_ref: <Crosshair className={ICON_CLASS} aria-hidden="true" />,
  repeated_hits: <Repeat className={ICON_CLASS} aria-hidden="true" />,
  big_opening_print: <Activity className={ICON_CLASS} aria-hidden="true" />,
  ban_entry: <Ban className={ICON_CLASS} aria-hidden="true" />,
  strike_level: <Target className={ICON_CLASS} aria-hidden="true" />,
  premium_tide: <Waves className={ICON_CLASS} aria-hidden="true" />,
  position_pnl: <Briefcase className={ICON_CLASS} aria-hidden="true" />,
  position_greek: <Sigma className={ICON_CLASS} aria-hidden="true" />,
};

export const TONE_DOT: Record<AlertTone, string> = {
  bullish: "bg-bullish",
  bearish: "bg-bearish",
  warning: "bg-warning",
  info: "bg-info",
};

export const INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];
export const ALL_SYMBOLS = [...new Set([...INDEX_SYMBOLS, ...Object.keys(CONTRACT_SPECS).sort()])];

/** Trigger a browser download of a text file. Returns false when the browser blocks it. */
export function downloadText(filename: string, text: string, type = "application/json"): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
