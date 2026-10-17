/** Small shared building blocks for the Positions and Paper Trading pages. */
import { useId, type ReactNode } from "react";
import { FlaskConical, Info, Radio, Clock, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeIST } from "@/lib/options";
import { cn } from "@/lib/utils";
import type { QuoteSource } from "./helpers";

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
  const id = useId();
  return (
    <Card className={cn("min-w-0 overflow-hidden", className)} role="region" aria-labelledby={`${id}-t`}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div role="heading" aria-level={2} id={`${id}-t`} className="flex flex-wrap items-center gap-2 font-display text-lead font-bold tracking-[-0.01em]">
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
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px] text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  help,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "bullish" | "bearish" | "warning" | "muted";
  help?: ReactNode;
  className?: string;
}) {
  const toneClass = tone === "bullish" ? "text-bullish" : tone === "bearish" ? "text-bearish" : tone === "warning" ? "text-warning" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className={cn("min-w-0 rounded-tile border border-border bg-card px-3 py-2.5 shadow-card", className)}>
      <div className="flex items-center gap-1 text-label uppercase text-muted-foreground">
        <span className="truncate">{label}</span>
        {help ? <HelpTip text={help} label={`About ${typeof label === "string" ? label : "this metric"}`} /> : null}
      </div>
      <div className={cn("mt-1 truncate font-num text-title tabular-nums", toneClass)}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-body-sm text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

const SOURCE_META: Record<QuoteSource, { label: string; variant: "bullish" | "neutral" | "warning" | "info" | "outline"; icon: typeof Radio; tip: string }> = {
  live: { label: "Live", variant: "bullish", icon: Radio, tip: "Last traded price from the live option chain." },
  delayed: { label: "Delayed", variant: "neutral", icon: Clock, tip: "Closing or last saved chain. Prices are not moving right now." },
  sample: { label: "Sample", variant: "warning", icon: FlaskConical, tip: "Generated sample data. Not a market price." },
  manual: { label: "Manual", variant: "info", icon: PencilLine, tip: "Price typed by you. The live feed will not overwrite it." },
  entry: { label: "Entry", variant: "outline", icon: Clock, tip: "No quote for this contract yet, so the entry price is used." },
  none: { label: "No quote", variant: "outline", icon: Clock, tip: "No quote available." },
};

export function SourceBadge({ source, asOf, className }: { source: QuoteSource; asOf?: number; className?: string }) {
  const m = SOURCE_META[source];
  const Icon = m.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("inline-flex cursor-default rounded-chip focus-visible:shadow-ember focus-visible:outline-none", className)}>
          <Badge variant={m.variant}>
            <Icon aria-hidden="true" />
            {m.label}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-xs">
        {m.tip}
        {asOf ? ` As of ${formatTimeIST(asOf)}.` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function EduNote({ children }: { children?: ReactNode }) {
  return (
    <p className="border-t border-border pt-3 text-body-sm text-muted-foreground">
      {children ? <>{children} </> : null}
      Data for education and research. Not investment advice.
    </p>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-tile border border-dashed border-border bg-surface/40 px-4 py-10 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="font-display text-lead font-bold">{title}</p>
      {children ? <div className="max-w-md text-body-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}
