/**
 * Shared widget state for the dashboard: one consistent way to show loading, error, empty,
 * stale (last saved) and sample/derived data, with the last update time in IST and a Retry button.
 */
import type { ReactNode } from "react";
import { AlertTriangle, Clock, FlaskConical, Inbox, Moon, RefreshCw, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeIST } from "@/lib/options";
import { cn } from "@/lib/utils";

import type { WidgetStatus } from "./dashboardModel";

export type { WidgetStatus };

export interface DataStatusProps {
  status: WidgetStatus;
  /** Epoch ms of the data, shown in IST. */
  lastUpdated?: number | null;
  /** Source name, e.g. "NSE", "Dhan", "Local DB". */
  source?: string;
  /** Extra context for the tooltip. */
  reason?: string;
  className?: string;
  /** Render a plain badge without a focusable tooltip (for use inside links). */
  plain?: boolean;
  /** Pulse the live dot. Use on one chip per page only. */
  pulse?: boolean;
}

const BADGE: Record<WidgetStatus, { text: string; variant: "bullish" | "warning" | "neutral" | "info" | "bearish"; Icon: typeof Clock } | null> = {
  loading: null,
  error: { text: "Error", variant: "bearish", Icon: AlertTriangle },
  empty: null,
  live: { text: "Live", variant: "bullish", Icon: Clock },
  delayed: { text: "Delayed", variant: "info", Icon: Clock },
  stale: { text: "Last saved", variant: "neutral", Icon: Clock },
  sample: { text: "Sample data", variant: "warning", Icon: FlaskConical },
  derived: { text: "Derived", variant: "info", Icon: Sigma },
  closed: { text: "Market closed", variant: "neutral", Icon: Moon },
};

/** Compact status chip for a widget header. Renders nothing while loading or empty. */
export function DataStatus({ status, lastUpdated, source, reason, className, plain, pulse }: DataStatusProps) {
  const b = BADGE[status];
  if (!b) return null;
  const time = lastUpdated && Number.isFinite(lastUpdated) ? formatTimeIST(lastUpdated) : null;
  const text = status === "live" ? (source ? `Live · ${source}` : "Live") : status === "stale" && time ? `Saved ${time}` : b.text;
  const label = [text, source && status !== "live" ? `Source ${source}` : null, time && status !== "stale" ? `as of ${time}` : null, reason].filter(Boolean).join(". ");
  const badge = (
    <Badge variant={b.variant} className={plain ? className : undefined}>
      {status === "live" ? <span className={cn("h-1.5 w-1.5 rounded-full bg-bullish", pulse && "motion-safe:animate-pulse")} aria-hidden="true" /> : <b.Icon aria-hidden="true" />}
      {text}
    </Badge>
  );
  if (plain) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={label} className={cn("inline-flex shrink-0 cursor-default rounded-chip focus-visible:shadow-focus focus-visible:outline-none", className)}>
          {badge}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px] text-body-sm">
        <p className="font-semibold">{text}</p>
        {source ? <p className="text-muted-foreground">Source: {source}</p> : null}
        {time ? <p className="text-muted-foreground">As of {time}</p> : null}
        {reason ? <p className="mt-1 text-muted-foreground">{reason}</p> : null}
        {status === "sample" ? <p className="mt-1 text-muted-foreground">Illustrative numbers, not market data.</p> : null}
        {status === "derived" ? <p className="mt-1 text-muted-foreground">Calculated from rules or other data, not quoted by the exchange.</p> : null}
        {status === "closed" ? <p className="mt-1 text-muted-foreground">Last traded and closing values from the most recent session.</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export interface DataStateProps {
  status: WidgetStatus;
  children?: ReactNode;
  onRetry?: () => void;
  /** Text for the empty state. */
  emptyText?: string;
  /** Secondary line for the empty state (e.g. "Loads during market hours"). */
  emptyHint?: string;
  errorText?: string;
  /** Height reserved while loading, so the layout does not jump. */
  minHeight?: number;
  /** Number of skeleton lines. */
  lines?: number;
  className?: string;
}

/**
 * Body of a widget. Shows a skeleton, an error with Retry, or an empty message; otherwise renders
 * children (for live, delayed, stale, sample and derived data, label those with DataStatus).
 */
export function DataState({ status, children, onRetry, emptyText = "No data yet", emptyHint, errorText = "Could not load this widget.", minHeight = 96, lines = 3, className }: DataStateProps) {
  if (status === "loading") {
    return (
      <div className={cn("space-y-2", className)} style={{ minHeight }} aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading</span>
        {Array.from({ length: lines }, (_, i) => `skeleton-line-${i}`).map((id, i) => (
          <Skeleton key={id} className={cn("h-4", i === 0 ? "w-2/5" : i % 2 ? "w-full" : "w-4/5")} />
        ))}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 text-center", className)} style={{ minHeight }}>
        <AlertTriangle className="h-5 w-5 text-bearish" aria-hidden="true" />
        <p className="text-body text-foreground">{errorText}</p>
        {onRetry ? <RetryButton onRetry={onRetry} /> : null}
      </div>
    );
  }
  if (status === "empty") {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-1.5 text-center", className)} style={{ minHeight }}>
        <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-body font-medium text-muted-foreground">{emptyText}</p>
        {emptyHint ? <p className="text-body-sm text-muted-foreground">{emptyHint}</p> : null}
        {onRetry ? <RetryButton onRetry={onRetry} /> : null}
      </div>
    );
  }
  return <>{children}</>;
}

export function RetryButton({ onRetry, label = "Retry" }: { onRetry: () => void; label?: string }) {
  return (
    <Button type="button" variant="outline" onClick={onRetry}>
      <RefreshCw className="!size-3.5" aria-hidden="true" />
      {label}
    </Button>
  );
}
