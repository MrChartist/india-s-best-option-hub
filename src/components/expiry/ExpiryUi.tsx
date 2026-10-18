/** Shared building blocks for the expiry-day components. */
import { useId, type ReactNode } from "react";
import { Clock, FlaskConical, Info, Radio, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeIST } from "@/lib/options";
import { cn } from "@/lib/utils";
import type { SessionMode } from "./useExpirySession";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const autoId = useId();
  const headingId = `${id ?? autoId}-title`;
  return (
    <Card className={cn("min-w-0 overflow-hidden", className)} role="region" aria-labelledby={headingId} id={id}>
      <div className="hairline-b flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          {/* Same type as CardTitle so every card on the page reads alike. */}
          <div role="heading" aria-level={2} id={headingId} className="flex flex-wrap items-center gap-2 font-display text-[14px] font-bold leading-snug [&>svg]:h-4 [&>svg]:w-4">
            {title}
          </div>
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
          className="inline-flex h-4 w-4 items-center justify-center rounded-capsule text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px] text-body-sm">{text}</TooltipContent>
    </Tooltip>
  );
}

const MODE_TEXT: Record<SessionMode, string> = {
  live: "Live",
  recorded: "Recorded",
  sample: "Sample data",
  empty: "No history",
};

export function ModeBadge({ mode, asOf, reason, source }: { mode: SessionMode; asOf?: number; reason?: string; source?: string }) {
  const Icon = mode === "sample" ? FlaskConical : mode === "live" ? Radio : Clock;
  const variant = mode === "sample" ? "warning" : mode === "live" ? "bullish" : "neutral";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-default rounded-chip focus-visible:shadow-focus focus-visible:outline-none">
          <Badge variant={variant}>
            <Icon aria-hidden="true" />
            {MODE_TEXT[mode]}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-body-sm">
        <p className="font-semibold">{MODE_TEXT[mode]}</p>
        {asOf ? <p className="text-muted-foreground">As of {formatTimeIST(asOf, { seconds: true })}</p> : null}
        {mode === "live" ? <p className="mt-1 text-muted-foreground">Live chain{source ? ` (${source.toUpperCase()})` : ""}, plus snapshots kept while this page is open.</p> : null}
        {mode === "recorded" ? <p className="mt-1 text-muted-foreground">Market closed or feed delayed. Showing snapshots recorded in this browser.</p> : null}
        {mode === "sample" ? <p className="mt-1 text-muted-foreground">Simulated session for illustration. Not market data.</p> : null}
        {mode === "empty" ? <p className="mt-1 text-muted-foreground">No snapshots were recorded in this browser for this session. History fills while the page is open in market hours.</p> : null}
        {reason ? <p className="mt-1 text-muted-foreground">{reason}</p> : null}
      </TooltipContent>
    </Tooltip>
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

export function DerivedBadge({ title = "Derived", hint = "Computed in the browser from the option chain or snapshot deltas" }: { title?: string; hint?: string }) {
  return (
    <Badge variant="info" title={hint}>
      <Sigma aria-hidden="true" />
      {title}
    </Badge>
  );
}

export function ModelBadge() {
  return (
    <Badge variant="neutral" title="Black-76 model value, not a market price">
      Model
    </Badge>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-tile bg-control-track px-4 py-10 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="text-headline text-foreground">{title}</p>
      {children ? <div className="max-w-md text-body-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function PanelSkeleton({ height = 280, label = "Loading" }: { height?: number; label?: string }) {
  return (
    <Card className="p-4" role="status" aria-busy="true" aria-label={label}>
      <Skeleton className="mb-3 h-4 w-40" />
      <Skeleton className="w-full" style={{ height }} />
    </Card>
  );
}

/**
 * Metric tile. "box" (default) is a flat group box for tiles on the window; "inset" is a filled
 * well for tiles that sit inside a card.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
  help,
  tag,
  className,
  variant = "box",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
  help?: ReactNode;
  tag?: ReactNode;
  className?: string;
  variant?: "box" | "inset";
}) {
  return (
    <div
      className={cn(
        "min-w-0 px-3 py-2",
        variant === "box" ? "rounded-tile border border-separator bg-card shadow-card" : "rounded-md bg-control-track",
        className,
      )}
    >
      {/* div, not p: the HelpTip tooltip content renders inline (not portalled) as a div. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-body-sm font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {help ? <HelpTip text={help} label={`About ${label}`} /> : null}
        {tag ? <span className="ml-auto shrink-0">{tag}</span> : null}
      </div>
      <p className={cn("mt-0.5 truncate font-num text-title tabular-nums", tone)}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-body-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

