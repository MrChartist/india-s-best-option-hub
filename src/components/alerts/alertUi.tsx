import { Badge } from "@/components/ui/badge";
import type { AlertTone, CoverageState, RuleCoverage } from "@/lib/alerts";
import { cn } from "@/lib/utils";
import { TONE_DOT } from "./alertConstants";

export function ToneDot({ tone, className }: { tone: AlertTone; className?: string }) {
  return (
    <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", TONE_DOT[tone], className)} aria-hidden="true" />
  );
}

const COVERAGE_VARIANT: Record<CoverageState, "bullish" | "neutral" | "warning" | "info" | "bearish"> = {
  watching: "bullish",
  waiting: "neutral",
  paused: "neutral",
  snoozed: "info",
  expired: "bearish",
  sample: "warning",
  elsewhere: "info",
  unavailable: "neutral",
};

export function CoverageBadge({ coverage }: { coverage: RuleCoverage }) {
  return (
    <Badge
      variant={COVERAGE_VARIANT[coverage.state]}
      title={coverage.detail}
      className="max-w-full truncate normal-case"
    >
      {coverage.label}
    </Badge>
  );
}
