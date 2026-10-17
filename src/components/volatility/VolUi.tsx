/** Small shared building blocks for the volatility components. */
import type { ReactNode } from "react";
import { FlaskConical, Info, Sigma, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function HelpTip({ text, label = "What is this?" }: { text: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

export function SampleBadge({ title = "Sample data" }: { title?: string }) {
  return (
    <Badge variant="warning" title="Generated for illustration. Not market data.">
      <FlaskConical aria-hidden="true" />
      {title}
    </Badge>
  );
}

export function DerivedBadge({ title = "Derived" }: { title?: string }) {
  return (
    <Badge variant="info" title="Computed in the browser from market prices">
      <Sigma aria-hidden="true" />
      {title}
    </Badge>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
  help,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "bullish" | "bearish" | "warning" | "info" | "muted";
  help?: ReactNode;
  className?: string;
}) {
  const toneCls = {
    default: "text-foreground",
    bullish: "text-bullish",
    bearish: "text-bearish",
    warning: "text-warning",
    info: "text-info",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <div className={cn("min-w-0 rounded-tile border border-border bg-surface/60 p-3", className)}>
      <div className="flex items-center gap-1.5">
        <p className="truncate text-label uppercase text-muted-foreground">{label}</p>
        {help ? <HelpTip text={help} label={`About ${label}`} /> : null}
      </div>
      <p className={cn("mt-1.5 font-num text-title tabular-nums", toneCls)}>{value}</p>
      {sub ? <div className="mt-1 text-body-sm text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

export function PanelHeader({ icon: Icon, title, subtitle, right }: { icon: LucideIcon; title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <CardHeader className="flex flex-col gap-2 space-y-0 p-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 font-display text-lead font-bold">
          <Icon className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
          {title}
        </h3>
        {subtitle ? <p className="mt-1 text-body-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-1.5">{right}</div> : null}
    </CardHeader>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center" role="status">
      <Icon className="h-7 w-7 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-lead text-foreground">{title}</p>
      {body ? <div className="max-w-md text-body-sm text-muted-foreground">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function PanelSkeleton({ height = 280 }: { height?: number }) {
  return (
    <Card aria-busy="true" aria-label="Loading">
      <CardContent className="space-y-3 p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="w-full" style={{ height }} />
      </CardContent>
    </Card>
  );
}

/** Legend chip for a chart series (colour swatch + label). */
export function LegendChip({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground">
      <span
        aria-hidden="true"
        className="inline-block h-0 w-4 border-t-2"
        style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
      />
      {label}
    </span>
  );
}
