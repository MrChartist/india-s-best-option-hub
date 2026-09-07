import { Activity, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RiskStatus } from "../lib/riskApi";

interface Props {
  status: RiskStatus;
}

/**
 * The dead-man's-switch readout (1CLIQ-TRADE-SPEC.md §4).
 *
 * Renders ONLY from useRiskStatus's poll of /api/risk-status — never from
 * whatever the UI thinks it just armed. This is deliberately a separate
 * badge from ArmBanner: ArmBanner is the client-only one-click HOT/SAFE gate
 * (never persisted, by design — see liveArm.ts); this is "is the server-side
 * risk engine actually alive and watching the feed right now", which is the
 * one thing that must NEVER be optimistic.
 */
export function RiskEngineStatusBadge({ status }: Props) {
  const { alive, armedCount, dhanConnected, lastTickAgeMs } = status;
  const healthy = alive && dhanConnected;

  const staleness = Number.isFinite(lastTickAgeMs as number) && (lastTickAgeMs as number) > 5000
    ? ` · feed ${Math.round((lastTickAgeMs as number) / 1000)}s stale`
    : "";

  return (
    <Badge
      variant="outline"
      className={`h-6 font-normal gap-1.5 ${healthy ? "border-bullish/40 text-bullish" : "border-bearish/40 text-bearish"}`}
      title="Server-side risk engine status — never optimistic; this is what actually manages armed SL/Target legs."
    >
      {healthy ? <Activity className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
      Risk engine: {healthy ? "alive" : alive ? "feed disconnected" : "unreachable"}
      {armedCount > 0 && ` · ${armedCount} leg${armedCount > 1 ? "s" : ""} armed`}
      {staleness}
    </Badge>
  );
}
