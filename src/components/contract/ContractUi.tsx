/** Building blocks for the Contract page (panels, stat tiles, provenance badges, empty states). */
import { useId, type ReactNode } from "react";
import { Clock, FileSpreadsheet, FlaskConical, Info, Radio, Server, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTimeIST } from "@/lib/options";
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
  const headingId = `${useId()}-title`;
  return (
    <Card className={cn("min-w-0 overflow-hidden", className)} role="region" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={headingId} className="flex flex-wrap items-center gap-2 font-display text-lead font-bold tracking-[-0.01em]">
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
      <TooltipContent className="max-w-[300px] text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

export function Stat({ label, value, hint, tone, help }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string; help?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-tile border border-border bg-card px-3 py-2.5 shadow-card">
      <div className="flex items-center gap-1 text-label uppercase text-muted-foreground">
        <span className="truncate">{label}</span>
        {help ? <HelpTip text={help} label={`About ${label}`} /> : null}
      </div>
      <p className={cn("mt-1 truncate font-num text-title tabular-nums", tone)}>{value}</p>
      {hint ? <div className="mt-0.5 truncate text-body-sm text-muted-foreground">{hint}</div> : null}
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

export function PanelSkeleton({ height = 260, label = "Loading" }: { height?: number; label?: string }) {
  return (
    <Card className="p-4" role="status" aria-busy="true" aria-label={label}>
      <Skeleton className="mb-3 h-4 w-40" />
      <Skeleton className="w-full" style={{ height }} />
    </Card>
  );
}

export type Provenance = "live" | "recorded" | "server" | "sample" | "bhavcopy" | "derived" | "empty";

const PROV: Record<Provenance, { text: string; variant: "bullish" | "neutral" | "info" | "warning"; icon: typeof Radio; note: string }> = {
  live: { text: "Live", variant: "bullish", icon: Radio, note: "Live quotes from the proxy, plus snapshots recorded while the market was open." },
  recorded: { text: "Recorded", variant: "neutral", icon: Clock, note: "Option-chain snapshots recorded in this browser (and backfilled from the proxy's recorder when it runs)." },
  server: { text: "Server recorder", variant: "info", icon: Server, note: "Snapshots recorded by the local proxy (RECORD_SYMBOLS) and copied into this browser." },
  sample: { text: "Sample data", variant: "warning", icon: FlaskConical, note: "Simulated with Black-76 on a sample smile for illustration. Not market data." },
  bhavcopy: { text: "NSE bhavcopy", variant: "info", icon: FileSpreadsheet, note: "End-of-day F&O bhavcopy from NSE archives, via the local proxy." },
  derived: { text: "Derived", variant: "info", icon: Sigma, note: "Computed in the browser from the snapshot price, spot and IV with the shared options maths." },
  empty: { text: "No history", variant: "neutral", icon: Clock, note: "Nothing recorded yet for this contract." },
};

export function ProvenanceBadge({ kind, asOf, reason }: { kind: Provenance; asOf?: number | null; reason?: string }) {
  const p = PROV[kind];
  const Icon = p.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-default rounded-chip focus-visible:shadow-ember focus-visible:outline-none" data-provenance={kind}>
          <Badge variant={p.variant}>
            <Icon aria-hidden="true" />
            {p.text}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px] text-xs">
        <p className="font-semibold">{p.text}</p>
        {asOf ? <p className="text-muted-foreground">As of {formatTimeIST(asOf, { seconds: true })}</p> : null}
        <p className="mt-1 text-muted-foreground">{p.note}</p>
        {reason ? <p className="mt-1 text-muted-foreground">{reason}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}
