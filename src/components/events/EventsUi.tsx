/** Small building blocks shared by the events components (panel shell, provenance badges, stat tile). */
import { useId, type ReactNode } from "react";
import { CircleAlert, FlaskConical, Info, Radio, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function EventsPanel({
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
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={headingId} className="flex flex-wrap items-center gap-2 font-display text-lead font-bold tracking-[-0.01em]">
            {title}
          </h2>
          {subtitle ? <div className="mt-0.5 text-body-sm text-muted-foreground">{subtitle}</div> : null}
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
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px] text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

function TipBadge({ children, tip, variant }: { children: ReactNode; tip: ReactNode; variant: "warning" | "bullish" | "info" | "neutral" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex cursor-default rounded-chip focus-visible:shadow-ember focus-visible:outline-none">
          <Badge variant={variant}>{children}</Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px] text-xs leading-relaxed">{tip}</TooltipContent>
    </Tooltip>
  );
}

export function SampleBadge({ label = "Sample data", tip }: { label?: string; tip?: ReactNode }) {
  return (
    <TipBadge variant="warning" tip={tip ?? "Simulated for illustration. Not market data."}>
      <FlaskConical aria-hidden="true" />
      {label}
    </TipBadge>
  );
}

export function LiveBadge({ label, tip }: { label: string; tip: ReactNode }) {
  return (
    <TipBadge variant="bullish" tip={tip}>
      <Radio aria-hidden="true" />
      {label}
    </TipBadge>
  );
}

export function VerifyBadge({ label = "Verify dates", tip }: { label?: string; tip?: ReactNode }) {
  return (
    <TipBadge variant="neutral" tip={tip ?? "Compiled from published schedules or estimated from the usual pattern. Check the official source before trading around it."}>
      <CircleAlert aria-hidden="true" />
      {label}
    </TipBadge>
  );
}

export function DerivedBadge({ label = "Derived", tip }: { label?: string; tip?: ReactNode }) {
  return (
    <TipBadge variant="info" tip={tip ?? "Computed in the browser."}>
      <Sigma aria-hidden="true" />
      {label}
    </TipBadge>
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

export function StatTile({ label, value, hint, tone, help, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string; help?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-tile border border-border bg-card px-3 py-2.5 shadow-card", className)}>
      <div className="flex min-w-0 items-center gap-1 text-label uppercase text-muted-foreground">
        <span className="truncate">{label}</span>
        {help ? <HelpTip text={help} label={`About ${label}`} /> : null}
      </div>
      <p className={cn("mt-1 truncate font-num text-title tabular-nums", tone)}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-body-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
