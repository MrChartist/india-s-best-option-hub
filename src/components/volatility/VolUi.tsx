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
      <TooltipContent className="max-w-[280px] text-body-sm">{text}</TooltipContent>
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
    <div className={cn("min-w-0 rounded-tile bg-muted/50 p-3", className)}>
      <div className="flex items-center gap-1.5">
        <p className="truncate text-label text-muted-foreground">{label}</p>
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
        <h2 className="flex items-center gap-2 font-display text-[14px] font-bold leading-snug">
          <Icon className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-body-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-1.5">{right}</div> : null}
    </CardHeader>
  );
}

/**
 * Empty state for a volatility panel, styled to match the shared dashboard DataState (same icon
 * size, type scale and spacing) but with room for guidance and an action. Use DataState itself for
 * plain loading, error and "no data" bodies.
 */
export function EmptyState({ icon: Icon, title, body, action, className }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[160px] flex-col items-center justify-center gap-1.5 px-4 py-8 text-center", className)} role="status">
      <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-body font-medium text-foreground">{title}</p>
      {body ? <div className="max-w-md text-body-sm text-muted-foreground">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { DataState, RetryButton } from "@/components/dashboard/DataState";

/**
 * Diagonal "Sample data" watermark laid over a chart or table so a screenshot can never pass as
 * market data. The parent must be `relative`. Decorative: pair it with a visible SampleBadge.
 */
export function SampleWatermark({ label = "Sample data" }: { label?: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex select-none items-center justify-center overflow-hidden">
      <span className="-rotate-12 whitespace-nowrap rounded-chip border-2 border-dashed border-warning/40 px-4 py-1 font-display text-title font-bold text-warning/40">
        {label}
      </span>
    </div>
  );
}

/** Small tooltip-backed chip, wraps on narrow screens. */
export function HintChip({ children, hint, variant = "neutral" }: { children: ReactNode; hint: ReactNode; variant?: "neutral" | "warning" | "info" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex max-w-full rounded-chip focus-visible:shadow-ember focus-visible:outline-none">
          <Badge variant={variant} className="h-auto cursor-help whitespace-normal py-0.5 text-left leading-snug">
            {children}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px] text-body-sm">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

export function PanelSkeleton({ height = 280 }: { height?: number }) {
  return (
    <Card role="status" aria-busy="true" aria-label="Loading">
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
