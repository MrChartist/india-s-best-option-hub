/**
 * Daily market brief card: one headline sentence and seven short lines, each linking to the page
 * that explains it. Lines that need live data are left out here and named in the dashboard's
 * "Needs live data" strip instead.
 */
import { Link } from "react-router-dom";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "./dashboardModel";
import { DataStatus } from "./DataState";
import { useMarketBrief } from "./useMarketBrief";
import { useDensityClasses } from "./density";

export function DailyBrief() {
  const d = useDensityClasses();
  const b = useMarketBrief();
  const shown = b.items.filter((x) => x.available);

  return (
    <Card className="overflow-hidden">
      <div className={cn("flex flex-wrap items-start gap-2", d.headPad)}>
        <Newspaper className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
        <p className="min-w-0 flex-1 font-display text-lead font-bold leading-snug" aria-live="polite">
          {b.isLoading ? "Preparing today's brief…" : b.headline}
        </p>
        {b.anySample ? <DataStatus status="sample" reason="Some lines use the labelled sample snapshot because the proxy is offline." /> : null}
      </div>
      {b.isLoading ? (
        <div className={cn("grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4", d.gap, d.pad, "pt-0")} aria-busy="true">
          <span className="sr-only">Loading the daily brief</span>
          {["sk-a", "sk-b", "sk-c", "sk-d"].map((id) => (
            <Skeleton key={id} className="h-16 w-full rounded-tile" />
          ))}
        </div>
      ) : (
        <ul className={cn("grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4", d.gap === "gap-2" ? "gap-1.5" : "gap-2", d.pad, "pt-0")} aria-label="Daily market brief">
          {shown.map((item) => (
            <li key={item.key} className="min-w-0">
              <Link
                to={item.to}
                className="group flex h-full min-w-0 flex-col rounded-tile border border-border/70 bg-surface/60 px-3 py-2 transition-colors duration-150 hover:border-primary/40 hover:bg-wash-brand/40 focus-visible:shadow-ember focus-visible:outline-none"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-label uppercase text-muted-foreground">{item.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.sample ? <span className="rounded-chip bg-wash-warning px-1 text-micro font-semibold uppercase text-warning">Sample</span> : null}
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-primary-ink" aria-hidden="true" />
                  </span>
                </span>
                <span className={cn("mt-0.5 font-num text-lead font-bold tabular-nums", TONE_TEXT[item.tone] === "text-muted-foreground" ? "text-foreground" : TONE_TEXT[item.tone])}>{item.value}</span>
                <span className="mt-0.5 text-body-sm leading-snug text-muted-foreground">{item.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default DailyBrief;
