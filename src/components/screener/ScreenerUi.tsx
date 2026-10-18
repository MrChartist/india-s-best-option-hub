/** Shared building blocks for the F&O screener. */
import type { ReactNode } from "react";
import { Clock, FlaskConical, Info, Radio, Database, Sigma, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BUILDUP_LABEL, formatTimeIST, type Buildup } from "@/lib/options";
import { MWPL_BAN_PCT, MWPL_DANGER_PCT, MWPL_NEAR_PCT, type MwplStatus } from "@/lib/screener/metrics";
import type { FeedMeta } from "@/lib/screener/banList";
import { cn } from "@/lib/utils";
import { BuildupBadge as SharedBuildupBadge } from "@/components/ui/buildup-badge";
import { BUILDUP_KIND } from "@/lib/screener/display";

export function HelpTip({ text, label = "What is this?" }: { text: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-capsule text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
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

export function DerivedBadge({
  title = "Derived",
  hint = "Computed in your browser from exchange data",
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <Badge variant="info" title={hint}>
      <Sigma aria-hidden="true" />
      {title}
    </Badge>
  );
}

const SOURCE_NAME: Record<string, string> = {
  dhan: "Dhan",
  nse: "NSE",
  bse: "BSE",
  yahoo: "Yahoo",
  cache: "Cache",
  sample: "Sample",
  database: "Local DB",
};

/** Feed source chip: Sample / Live / Last saved, with as-of time and reason in a tooltip. */
export function FeedBadge({
  meta,
  label,
  eod = false,
}: {
  meta: FeedMeta | null | undefined;
  label?: string;
  eod?: boolean;
}) {
  if (!meta) return null;
  if (meta.source === "sample") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex rounded-chip focus-visible:shadow-focus focus-visible:outline-none">
            <SampleBadge title={label ? `${label}: sample` : "Sample data"} />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-body-sm">
          <p className="font-semibold">Sample data</p>
          {meta.reason ? <p className="text-muted-foreground">{meta.reason}</p> : null}
          <p className="mt-1 text-muted-foreground">Generated for illustration. Not market data.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  const name = SOURCE_NAME[meta.source] ?? meta.source.toUpperCase();
  const Icon = meta.stale ? Clock : eod ? Database : Radio;
  const variant = meta.stale ? "neutral" : eod ? "info" : "bullish";
  const text = `${label ? `${label} · ` : ""}${meta.stale ? "Last saved" : eod ? "End of day" : "Live"} · ${name}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-chip focus-visible:shadow-focus focus-visible:outline-none">
          <Badge variant={variant}>
            <Icon aria-hidden="true" />
            {text}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-body-sm">
        <p className="font-semibold">{text}</p>
        <p className="text-muted-foreground">As of {formatTimeIST(meta.asOf)}</p>
        {meta.reason ? <p className="mt-1 text-muted-foreground">{meta.reason}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** The app-wide OI build-up badge, keyed by the screener's Buildup enum. Neutral renders a muted dash. */
export function BuildupBadge({ buildup, short = false }: { buildup: Buildup; short?: boolean }) {
  const kind = BUILDUP_KIND[buildup];
  if (!kind) {
    return (
      <span className="text-muted-foreground" title={BUILDUP_LABEL.NEUTRAL}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{BUILDUP_LABEL.NEUTRAL}</span>
      </span>
    );
  }
  return <SharedBuildupBadge kind={kind} variant={short ? "compact" : "full"} />;
}

const MWPL_TONE: Record<MwplStatus, string> = {
  BAN: "bg-bearish",
  DANGER: "bg-bearish/80",
  NEAR: "bg-warning",
  OK: "bg-muted-foreground/45",
};

/** Compact MWPL meter with the 80/85/95 marks. */
export function MwplMeter({
  pct,
  status,
  banned,
  className,
}: {
  pct: number | null;
  status: MwplStatus | null;
  banned?: boolean;
  className?: string;
}) {
  if (pct === null && !banned) return <span className="text-muted-foreground">—</span>;
  const w = Math.max(0, Math.min(100, pct ?? 100));
  return (
    <div className={cn("flex min-w-[96px] items-center gap-2", className)}>
      <div
        className="relative h-1.5 w-14 overflow-hidden rounded-capsule bg-control-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-label={`MWPL used ${pct === null ? "not available" : `${pct.toFixed(1)}%`}`}
      >
        <div
          className={cn("h-full rounded-capsule", status ? MWPL_TONE[status] : "bg-muted-foreground/45")}
          style={{ width: `${w}%` }}
        />
        {[MWPL_NEAR_PCT, MWPL_DANGER_PCT, MWPL_BAN_PCT].map((m) => (
          <span key={m} aria-hidden="true" className="absolute top-0 h-full w-px bg-card" style={{ left: `${m}%` }} />
        ))}
      </div>
      <span
        className={cn(
          "font-num tabular-nums",
          status === "BAN" || status === "DANGER" ? "text-bearish" : status === "NEAR" ? "text-warning" : "",
        )}
      >
        {banned ? "Ban" : `${(pct ?? 0).toFixed(1)}%`}
      </span>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-headline text-foreground">{title}</p>
      {body ? <p className="max-w-md text-body-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}

export function PanelHeader({
  title,
  icon,
  children,
  help,
}: {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
  help?: ReactNode;
}) {
  return (
    <div className="hairline-b flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      {/* Same type as CardTitle so every card on the page reads alike. */}
      <h2 className="flex items-center gap-2 font-display text-[14px] font-bold leading-snug [&>svg]:h-4 [&>svg]:w-4">
        {icon}
        {title}
        {help ? <HelpTip text={help} label={`About ${title}`} /> : null}
      </h2>
      {children ? <div className="flex flex-wrap items-center gap-1.5">{children}</div> : null}
    </div>
  );
}

/** Small signed value with bullish/bearish ink. */
export function Signed({
  value,
  decimals = 2,
  suffix = "%",
}: {
  value: number | null;
  decimals?: number;
  suffix?: string;
}) {
  if (value === null || !Number.isFinite(value)) return <span className="text-muted-foreground">—</span>;
  const cls = value > 0 ? "text-bullish" : value < 0 ? "text-bearish" : "text-muted-foreground";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return (
    <span className={cn("font-num tabular-nums", cls)}>
      {sign}
      {Math.abs(value).toFixed(decimals)}
      {suffix}
    </span>
  );
}
