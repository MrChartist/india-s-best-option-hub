/**
 * One "IV rank" card with a row per index (NIFTY and BANKNIFTY by default): IV rank with its
 * one-year bar, the current 30-day IV, and a Sample / Derived / No history tag where it applies.
 * Replaces the two separate mini cards, which overflowed at phone widths.
 */
import { Link } from "react-router-dom";
import { ArrowUpRight, Gauge } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import MetricHelp from "@/components/learn/MetricHelp";
import { useIvRank } from "@/components/volatility/useVolatility";
import { formatNumberIN } from "@/lib/options";
import { fmtVol } from "@/lib/volatility/format";
import { cn } from "@/lib/utils";

const rankTone = (v: number | null) => (v === null ? "text-muted-foreground" : v > 50 ? "text-bearish" : v < 20 ? "text-bullish" : "text-warning");
const barTone = (v: number) => (v > 50 ? "bg-bearish/70" : v < 20 ? "bg-bullish/70" : "bg-warning/70");

function Row({ symbol }: { symbol: string }) {
  const r = useIvRank(symbol);
  const rank = r.stats.insufficient ? null : r.stats.ivRank;
  const sample = r.currentIsSample || r.historyIsSample;
  const tag = sample ? { text: "Sample", cls: "bg-wash-warning text-warning" } : r.currentIsDerived ? { text: "Derived", cls: "bg-wash-info text-info" } : null;
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <Link to={`/volatility?symbol=${encodeURIComponent(symbol)}`} className="min-w-0 flex-1 truncate rounded-sm text-body font-semibold hover:underline focus-visible:shadow-ember focus-visible:outline-none">
          {symbol}
        </Link>
        {tag ? <span className={cn("shrink-0 rounded-chip px-1 text-micro font-semibold uppercase", tag.cls)}>{tag.text}</span> : null}
        {r.isLoading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <span className="flex shrink-0 items-baseline gap-1.5">
            <span className={cn("font-num text-title font-bold tabular-nums", rankTone(rank))} aria-label={`IV rank ${rank === null ? "unavailable" : Math.round(rank)}`}>
              {rank === null ? "—" : formatNumberIN(rank, 0)}
            </span>
            <span className="font-num text-body-sm tabular-nums text-muted-foreground">IV {fmtVol(r.current)}</span>
          </span>
        )}
      </div>
      {r.isLoading ? null : rank === null ? (
        <p className="mt-1 text-body-sm text-muted-foreground">
          No history yet: {r.stats.n} of 20 days. Build it on the Volatility page.
        </p>
      ) : (
        <div className="mt-1.5">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rank)} aria-label={`${symbol} IV rank`}>
            <div className={cn("absolute inset-y-0 left-0 rounded-full", barTone(rank))} style={{ width: `${rank}%` }} />
          </div>
          <div className="mt-0.5 flex justify-between gap-2 font-num text-body-sm tabular-nums text-muted-foreground">
            <span className="whitespace-nowrap">1Y low {fmtVol(r.stats.low)}</span>
            <span className="whitespace-nowrap">high {fmtVol(r.stats.high)}</span>
          </div>
          {r.basisLabel ? (
            <p className="mt-0.5 truncate text-micro uppercase text-muted-foreground" title={r.basisLabel}>
              Basis: {r.basisLabel}
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}

export function IVRankPairCard({ symbols = ["NIFTY", "BANKNIFTY"], className }: { symbols?: readonly string[]; className?: string }) {
  return (
    <Card className={cn("flex h-full min-w-0 flex-col p-4", className)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-display text-lead font-bold">
            <Gauge className="h-4 w-4 text-primary-ink" aria-hidden="true" />
            <MetricHelp metric="ivr">IV rank</MetricHelp>
          </h3>
          <p className="text-body-sm text-muted-foreground">Where today's IV sits in its one-year range</p>
        </div>
        <Link to="/volatility" className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none" aria-label="Open Volatility">
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      <ul className="flex-1 divide-y divide-border">
        {symbols.map((s) => (
          <Row key={s} symbol={s} />
        ))}
      </ul>
      <p className="mt-2 text-micro uppercase text-muted-foreground">Above 50 rich · below 20 cheap · educational labels</p>
    </Card>
  );
}

export default IVRankPairCard;
