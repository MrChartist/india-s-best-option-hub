import { Fragment, Suspense, useMemo, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, OctagonAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetErrorBoundary } from "@/components/ErrorBoundary";
import { METRICS } from "@/content/learn/metrics";
import type { CalloutTone, LessonBlock, MetricKey, SimId } from "@/content/learn/types";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { CONTRACT_SPECS, dteLabel, formatDateIST, formatNumberIN, getExpiries } from "@/lib/options";
import { cn } from "@/lib/utils";
import MetricHelp from "./MetricHelp";

const SIMS: Record<SimId, LazyExoticComponent<ComponentType>> = {
  payoff: lazyWithRetry(() => import("./sims/PayoffSim")),
  ivStraddle: lazyWithRetry(() => import("./sims/IVStraddleSim")),
  greeks: lazyWithRetry(() => import("./sims/GreeksSim")),
  thetaDecay: lazyWithRetry(() => import("./sims/ThetaDecaySim")),
  pop: lazyWithRetry(() => import("./sims/POPSim")),
  charges: lazyWithRetry(() => import("./sims/ChargesSim")),
};

const SIM_LABEL: Record<SimId, string> = {
  payoff: "Payoff builder",
  ivStraddle: "IV and straddle simulator",
  greeks: "Greeks explorer",
  thetaDecay: "Theta decay simulator",
  pop: "Probability of profit simulator",
  charges: "Charges simulator",
};

/** Inline marks: **bold** and `code`. Everything else is plain text (no HTML injection). */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={`${i}-${p}`} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`")) return <code key={`${i}-${p}`} className="rounded-chip bg-muted px-1 py-0.5 font-mono text-[0.92em]">{p.slice(1, -1)}</code>;
        return <Fragment key={`${i}-${p}`}>{p}</Fragment>;
      })}
    </>
  );
}

const CALLOUT: Record<CalloutTone, { cls: string; icon: ReactNode }> = {
  info: { cls: "border-info/25 bg-wash-info", icon: <Info className="h-4 w-4 text-info" aria-hidden="true" /> },
  warning: { cls: "border-warning/30 bg-wash-warning", icon: <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" /> },
  success: { cls: "border-bullish/25 bg-wash-profit", icon: <CheckCircle2 className="h-4 w-4 text-bullish" aria-hidden="true" /> },
  danger: { cls: "border-bearish/30 bg-wash-loss", icon: <OctagonAlert className="h-4 w-4 text-bearish" aria-hidden="true" /> },
};

function SimSkeleton() {
  return (
    <div className="rounded-card border border-separator bg-card p-5" role="status" aria-busy="true" aria-label="Loading simulator">
      <Skeleton className="h-5 w-48" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

function SimBlock({ sim, caption }: { sim: SimId; caption?: string }) {
  const Comp = SIMS[sim];
  return (
    <figure className="my-6">
      <WidgetErrorBoundary label={SIM_LABEL[sim]}>
        <Suspense fallback={<SimSkeleton />}>
          <Comp />
        </Suspense>
      </WidgetErrorBoundary>
      {caption ? <figcaption className="mt-2 text-body-sm text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}

function MetricsBlock({ metrics }: { metrics: MetricKey[] }) {
  return (
    <div className="my-6">
      <p className="mb-2 text-label text-muted-foreground">Metric explainers used in the terminal</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {metrics.map((k) => {
          const m = METRICS[k];
          return (
            <div key={k} className="rounded-tile border border-separator bg-surface p-3">
              <div className="flex items-center gap-1 font-semibold text-foreground">
                <MetricHelp metric={k}>{m.title}</MetricHelp>
              </div>
              <p className="mt-1 text-body-sm text-muted-foreground">{m.oneLiner}</p>
              <p className="mt-2 rounded-chip bg-card px-2 py-1 font-mono text-body-sm text-foreground">{m.formula}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ContractTable() {
  const rows = Object.values(CONTRACT_SPECS).filter((s) => s.kind === "INDEX");
  return (
    <div className="my-6 overflow-x-auto rounded-tile border border-separator">
      <table className="w-full min-w-[520px] text-body">
        <caption className="border-b border-separator bg-surface px-3 py-2 text-left text-body-sm text-muted-foreground">
          Index contract specs from the terminal's instrument registry{" "}
          <Badge variant="warning" className="ml-1 align-middle">
            Verify
          </Badge>
        </caption>
        <thead>
          <tr className="border-b border-separator text-label text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left">Index</th>
            <th scope="col" className="px-3 py-2 text-right">Lot size</th>
            <th scope="col" className="px-3 py-2 text-right">Strike step</th>
            <th scope="col" className="px-3 py-2 text-left">Expiry</th>
            <th scope="col" className="px-3 py-2 text-right">Freeze qty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.symbol} className="border-b border-separator last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-semibold">
                {s.symbol} <span className="font-normal text-muted-foreground">· {s.exchange}</span>
              </th>
              <td className="px-3 py-2 text-right font-num tabular-nums">{formatNumberIN(s.lotSize)}</td>
              <td className="px-3 py-2 text-right font-num tabular-nums">{formatNumberIN(s.strikeStep)}</td>
              <td className="px-3 py-2">
                {s.weekly ? `Weekly, ${WEEKDAY[s.expiryWeekday]}` : `Monthly, last ${WEEKDAY[s.expiryWeekday]}`}
              </td>
              <td className="px-3 py-2 text-right font-num tabular-nums">{s.freezeQty ? formatNumberIN(s.freezeQty) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpiryList({ symbols }: { symbols: string[] }) {
  const [now] = useState(() => new Date());
  const lists = useMemo(() => symbols.map((s) => ({ symbol: s, expiries: getExpiries(s, now, 4) })), [symbols, now]);
  return (
    <div className="my-6 grid gap-3 sm:grid-cols-3">
      {lists.map(({ symbol, expiries }) => (
        <div key={symbol} className="rounded-tile border border-separator bg-surface p-3">
          <div className="flex items-center justify-between gap-2 font-semibold text-foreground">
            {symbol}
            <Badge variant="neutral">Next expiries</Badge>
          </div>
          {expiries.length === 0 ? (
            <p className="mt-2 text-body-sm text-muted-foreground">No upcoming expiries found.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-body-sm">
              {expiries.map((e) => (
                <li key={e.date} className="flex items-baseline justify-between gap-2">
                  <span className="font-num tabular-nums text-foreground">
                    {formatDateIST(e.date)}
                    {e.type === "monthly" ? <span className="ml-1 text-micro text-primary-ink">Monthly</span> : null}
                  </span>
                  <span className="text-muted-foreground">{dteLabel(e.date, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Block({ block }: { block: LessonBlock }) {
  switch (block.kind) {
    case "h":
      return <h2 className="mb-2 mt-8 font-display text-title text-foreground">{block.text}</h2>;
    case "p":
      return (
        <p className="my-3 text-lead font-normal leading-relaxed text-foreground/90">
          <RichText text={block.text} />
        </p>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={cn("my-3 space-y-1.5 pl-5 text-lead font-normal leading-relaxed text-foreground/90", block.ordered ? "list-decimal" : "list-disc marker:text-primary")}>
          {block.items.map((it, i) => (
            <li key={`${i}-${it}`}>
              <RichText text={it} />
            </li>
          ))}
        </Tag>
      );
    }
    case "callout": {
      const c = CALLOUT[block.tone];
      return (
        <div className={cn("my-5 flex gap-3 rounded-tile border p-4", c.cls)} role={block.tone === "danger" || block.tone === "warning" ? "note" : undefined}>
          <span className="mt-0.5 shrink-0">{c.icon}</span>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{block.title}</p>
            <p className="mt-1 text-body leading-relaxed text-foreground/85">
              <RichText text={block.text} />
            </p>
          </div>
        </div>
      );
    }
    case "formula":
      return (
        <div className="my-5 rounded-tile border border-separator bg-surface px-4 py-3">
          {block.label ? <p className="text-label text-muted-foreground">{block.label}</p> : null}
          <p className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-body text-foreground">{block.text}</p>
        </div>
      );
    case "table":
      return (
        <div className="my-5 overflow-x-auto rounded-tile border border-separator">
          <table className="w-full min-w-[420px] text-body">
            {block.caption ? <caption className="border-b border-separator bg-surface px-3 py-2 text-left text-body-sm text-muted-foreground">{block.caption}</caption> : null}
            <thead>
              <tr className="border-b border-separator text-label text-muted-foreground">
                {block.head.map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={`${i}-${r[0]}`} className="border-b border-separator last:border-0">
                  {r.map((c, j) =>
                    j === 0 ? (
                      <th key={`${j}-${c}`} scope="row" className="px-3 py-2 text-left font-semibold text-foreground">
                        {c}
                      </th>
                    ) : (
                      <td key={`${j}-${c}`} className="px-3 py-2 text-foreground/90">
                        {c}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "sim":
      return <SimBlock sim={block.sim} caption={block.caption} />;
    case "metrics":
      return <MetricsBlock metrics={block.metrics} />;
    case "contractTable":
      return <ContractTable />;
    case "expiryList":
      return <ExpiryList symbols={block.symbols} />;
    case "source":
      return (
        <p className="my-3 text-body-sm text-muted-foreground">
          Source:{" "}
          <a href={block.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary-ink underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
            {block.label} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          {block.note ? <span> · {block.note}</span> : null}
        </p>
      );
  }
}

export default function LessonBlocks({ blocks }: { blocks: LessonBlock[] }) {
  return (
    <div>
      {blocks.map((b, i) => (
        <Block key={`${i}-${b.kind}`} block={b} />
      ))}
    </div>
  );
}
