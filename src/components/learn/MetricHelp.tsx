import { useMemo, useState, type ReactNode } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { ArrowRight, Info } from "lucide-react";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { formatMetricValue, getMetric } from "@/content/learn/metrics";
import type { MetricInfo } from "@/content/learn/types";
import { cn } from "@/lib/utils";

/** Look up a metric explainer by key or alias ("ivr", "IV Rank", "call-wall"). */
// eslint-disable-next-line react-refresh/only-export-components
export function useMetric(metric: string): MetricInfo | undefined {
  return useMemo(() => getMetric(metric), [metric]);
}

function LearnMoreLink({ to, children }: { to: string; children: ReactNode }) {
  const inRouter = useInRouterContext();
  const cls =
    "inline-flex items-center gap-1 rounded-chip text-body-sm font-semibold text-primary-ink underline-offset-4 hover:underline focus-visible:shadow-ember focus-visible:outline-none";
  if (inRouter) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <a href={to} className={cls}>
      {children}
    </a>
  );
}

export interface MetricHelpProps {
  /** Metric key from src/content/learn/metrics.ts, e.g. "ivr", "maxPain", "callWall". */
  metric: string;
  /** Optional live value from the host page, shown as "Now: …" and formatted by the metric's unit. */
  value?: number | string;
  className?: string;
  /** Optional label rendered before the info icon. */
  children?: ReactNode;
}

/**
 * Inline explainer for a metric: an info button that opens a hover card (hover, focus or tap)
 * with the formula, how to read it, an Indian example and a link to the lesson.
 */
export default function MetricHelp({ metric, value, className, children }: MetricHelpProps): JSX.Element {
  const info = useMetric(metric);
  const [open, setOpen] = useState(false);
  const live = formatMetricValue(metric, value);

  if (!info) return <>{children ?? null}</>;

  return (
    <span className={cn("inline-flex items-center gap-1 align-middle", className)}>
      {children}
      <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={120}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label={`What is ${info.title}?`}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            className="inline-grid h-4 w-4 shrink-0 place-items-center rounded-capsule text-muted-foreground transition-colors duration-fast hover:text-primary-ink focus-visible:text-primary-ink focus-visible:shadow-ember focus-visible:outline-none"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </HoverCardTrigger>
        <HoverCardPortal>
          <HoverCardContent
            side="top"
            align="start"
            collisionPadding={16}
            className="w-80 max-w-[calc(100vw-2rem)] bg-popover p-0 text-left font-sans normal-case tracking-normal"
            onEscapeKeyDown={() => setOpen(false)}
          >
            <div role="dialog" aria-label={info.title} className="space-y-2.5 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-lead font-bold leading-tight text-foreground">{info.title}</p>
                {live !== undefined ? (
                  <span className="shrink-0 rounded-chip bg-wash-brand px-1.5 py-0.5 font-num text-body-sm font-semibold tabular-nums text-primary-ink">Now: {live}</span>
                ) : null}
              </div>
              <p className="text-body text-foreground">{info.oneLiner}</p>
              <div className="rounded-tile border border-border bg-surface px-2.5 py-2 font-mono text-body-sm leading-relaxed text-foreground">{info.formula}</div>
              <div>
                <p className="text-label uppercase text-muted-foreground">How to read it</p>
                <p className="mt-0.5 text-body-sm text-foreground">{info.howToRead}</p>
              </div>
              <div>
                <p className="text-label uppercase text-muted-foreground">India example</p>
                <p className="mt-0.5 text-body-sm text-foreground">{info.indiaExample}</p>
              </div>
              {info.pitfalls[0] ? (
                <p className="rounded-tile bg-wash-warning px-2.5 py-1.5 text-body-sm text-warning">
                  <span className="font-semibold">Watch out: </span>
                  {info.pitfalls[0]}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                <span className="text-micro uppercase text-muted-foreground">Learn with NISMExams.com</span>
                <LearnMoreLink to={`/learn/${info.lessonSlug}`}>
                  Learn more <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </LearnMoreLink>
              </div>
            </div>
          </HoverCardContent>
        </HoverCardPortal>
      </HoverCard>
    </span>
  );
}
