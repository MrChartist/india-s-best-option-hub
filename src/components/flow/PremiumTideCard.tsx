import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Waves } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { premiumSummary, premiumTide } from "@/lib/flow";
import { cn } from "@/lib/utils";
import { FlowFeeder } from "./FlowFeeder";
import { ModeBadge } from "./FlowUi";
import { PremiumTideChart } from "./PremiumTideChart";
import { fmtRs, signClass } from "./format";
import { useFlowState } from "./useFlow";

/**
 * Compact Premium Tide for the dashboard. Polls the underlying's chain itself, so it works
 * without the Flow page being open. Pass `className="flex-1"` (or a height) and the chart grows
 * to fill the card.
 */
export default function PremiumTideCard({ symbol = "NIFTY", className }: { symbol?: string; className?: string }) {
  const sym = symbol.toUpperCase();
  const { feeds } = useFlowState();
  const feed = feeds[sym];
  const points = useMemo(() => (feed ? premiumTide(feed.prints, { bucketMs: 5 * 60_000 }) : []), [feed]);
  const sum = useMemo(() => premiumSummary(feed?.prints ?? []), [feed]);

  return (
    <Card className={cn("flex min-w-0 flex-col overflow-hidden", className)}>
      <FlowFeeder symbol={sym} />
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 font-display text-lead font-bold">
            <Waves className="h-4 w-4 text-primary-ink" aria-hidden="true" />
            Premium Tide · {sym}
          </h2>
          <p className="text-body-sm text-muted-foreground">Interval flow derived from chain snapshots</p>
        </div>
        {feed ? <ModeBadge mode={feed.mode} asOf={feed.asOf} reason={feed.reason} /> : null}
      </div>
      <div className="grid grid-cols-3 gap-2 px-4 pt-3">
        {[
          { label: "Calls net", v: sum.netCe },
          { label: "Puts net", v: sum.netPe },
          { label: "Net", v: sum.net },
        ].map((s) => (
          <div key={s.label} className="min-w-0">
            <p className="text-micro uppercase text-muted-foreground">{s.label}</p>
            <p
              className={cn(
                "truncate font-num text-lead font-bold tabular-nums",
                s.label === "Net" ? signClass(s.v) : "",
              )}
            >
              {feed ? fmtRs(s.v, true) : "—"}
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col px-3 pb-2 pt-2">
        {!feed ? (
          <Skeleton className="min-h-[180px] w-full flex-1" />
        ) : (
          <PremiumTideChart points={points} height={180} compact ariaLabel={`${sym} Premium Tide`} className="flex-1" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-body-sm">
        <span className="text-muted-foreground">
          {feed?.mode === "sample" ? "Sample data: simulated session" : "Not trade-level data"}
        </span>
        <Link
          to="/flow"
          className="inline-flex items-center gap-0.5 font-semibold text-primary-ink hover:underline focus-visible:shadow-ember focus-visible:outline-none"
        >
          Options Flow <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}
