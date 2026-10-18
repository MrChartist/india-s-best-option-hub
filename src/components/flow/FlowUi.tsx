/** Shared building blocks for the flow components. */
import type { ReactNode } from "react";
import { Clock, FlaskConical, Info, Radio, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeIST } from "@/lib/options";
import type { FeedMode } from "@/lib/flow";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("min-w-0 overflow-hidden", className)}>
      <div className="hairline-b flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-[14px] font-bold leading-snug">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-body-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </Card>
  );
}

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

const MODE_TEXT: Record<FeedMode, string> = { live: "Live · derived", recorded: "Recorded", sample: "Sample data" };

export function ModeBadge({
  mode,
  asOf,
  reason,
  symbol,
}: {
  mode: FeedMode;
  asOf?: number;
  reason?: string;
  symbol?: string;
}) {
  const Icon = mode === "sample" ? FlaskConical : mode === "live" ? Radio : Clock;
  const variant = mode === "sample" ? "warning" : mode === "live" ? "bullish" : "neutral";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex cursor-default rounded-chip focus-visible:shadow-ember focus-visible:outline-none"
        >
          <Badge variant={variant}>
            <Icon aria-hidden="true" />
            {symbol ? `${symbol} · ` : ""}
            {MODE_TEXT[mode]}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-body-sm">
        <p className="font-semibold">{MODE_TEXT[mode]}</p>
        {asOf ? <p className="text-muted-foreground">As of {formatTimeIST(asOf, { seconds: true })}</p> : null}
        {mode === "live" ? (
          <p className="mt-1 text-muted-foreground">Built from successive chain polls in this browser.</p>
        ) : null}
        {mode === "recorded" ? (
          <p className="mt-1 text-muted-foreground">
            Market closed or feed delayed. Showing snapshots recorded in this browser.
          </p>
        ) : null}
        {mode === "sample" ? (
          <p className="mt-1 text-muted-foreground">Simulated session for illustration. Not market data.</p>
        ) : null}
        {reason ? <p className="mt-1 text-muted-foreground">{reason}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function DerivedBadge({ title = "Derived" }: { title?: string }) {
  return (
    <Badge variant="info" title="Computed in the browser from snapshot deltas">
      <Sigma aria-hidden="true" />
      {title}
    </Badge>
  );
}

export function SampleBadge({ title = "Sample data" }: { title?: string }) {
  return (
    <Badge variant="warning" title="Simulated for illustration. Not market data.">
      <FlaskConical aria-hidden="true" />
      {title}
    </Badge>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-tile bg-muted/40 px-4 py-10 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="text-headline font-semibold">{title}</p>
      {children ? <div className="max-w-md text-body-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function PanelSkeleton({ height = 280 }: { height?: number }) {
  return (
    <Card className="p-4" role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-3 h-4 w-40" />
      <Skeleton className="w-full" style={{ height }} />
    </Card>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-tile bg-muted/50 px-3 py-2.5", className)}>
      <p className="text-label text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate font-num text-title tabular-nums", tone)}>{value}</p>
      {hint ? <p className="mt-0.5 line-clamp-2 text-body-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * A row of KPI figures as one macOS group box: hairline gutters between cells instead of a
 * separate bordered card per figure. Pass Stat children with `className={STRIP_CELL}`.
 */
export function StatStrip({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className={cn(
        "grid gap-px overflow-hidden rounded-tile border border-separator bg-separator shadow-card",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Cell style for a Stat inside a StatStrip. */
export const STRIP_CELL = "rounded-none bg-card";
