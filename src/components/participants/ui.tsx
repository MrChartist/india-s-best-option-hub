/** Small shared building blocks for the participants (FII / DII positioning) views. */
import type { ReactNode } from "react";
import { Database, FlaskConical, Info, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DataMode } from "@/lib/participantsApi";
import { cn } from "@/lib/utils";

export function Panel({ title, subtitle, actions, children, className, bodyClassName, id }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <Card className={cn("min-w-0 overflow-hidden", className)} aria-labelledby={id ? `${id}-title` : undefined} role={id ? "region" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="font-display text-lead font-bold tracking-[-0.01em]">
            {title}
          </h2>
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
      <TooltipContent className="max-w-[280px] text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

const MODE_META: Record<DataMode, { label: string; variant: "bullish" | "neutral" | "warning"; note: string }> = {
  live: { label: "NSE", variant: "bullish", note: "From the NSE participant-wise file via the proxy." },
  cache: { label: "Saved copy", variant: "neutral", note: "NSE is unreachable right now. Showing data saved earlier in this browser or by the proxy." },
  sample: { label: "Sample data", variant: "warning", note: "Simulated for illustration. Not market data." },
};

export function SourceBadge({ mode, label, detail }: { mode: DataMode; label?: string; detail?: ReactNode }) {
  const m = MODE_META[mode];
  const Icon = mode === "sample" ? FlaskConical : mode === "live" ? Radio : Database;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-default rounded-chip focus-visible:shadow-ember focus-visible:outline-none">
          <Badge variant={m.variant}>
            <Icon aria-hidden="true" />
            {label ?? m.label}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-xs">
        <p>{m.note}</p>
        {detail ? <p className="mt-1 text-muted-foreground">{detail}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function DerivedBadge({ title = "Derived", note = "Computed in the browser from the NSE participant file." }: { title?: string; note?: string }) {
  return (
    <Badge variant="info" title={note}>
      {title}
    </Badge>
  );
}

export function Stat({ label, value, hint, tone, help }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string; help?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-tile border border-border bg-card px-3 py-2.5 shadow-card">
      <div className="flex items-center gap-1">
        <p className="truncate text-label uppercase text-muted-foreground">{label}</p>
        {help ? <HelpTip text={help} label={`About ${label}`} /> : null}
      </div>
      <p className={cn("mt-1 truncate font-num text-title tabular-nums", tone)}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-body-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-tile border border-dashed border-border px-4 py-10 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="font-display text-lead font-bold">{title}</p>
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

export function LegendDot({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground">
      <span aria-hidden="true" className={cn("inline-block h-0.5 w-4 rounded-full", dashed && "opacity-70")} style={{ background: color }} />
      {label}
    </span>
  );
}
