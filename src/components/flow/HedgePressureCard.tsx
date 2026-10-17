import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/strategy/Segmented";
import {
  axisProps,
  chartColors,
  compactAxisTick,
  gridProps,
  tooltipCursor,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "@/lib/chartTheme";
import {
  hedgePressureReading,
  hedgePressureSeries,
  hedgePressureSummary,
  hedgePrintCount,
  type FeedEntry,
} from "@/lib/flow";
import { formatCrore, formatNumberIN, formatPct } from "@/lib/options";
import { cn } from "@/lib/utils";
import { EmptyState, HelpTip, ModeBadge } from "./FlowUi";
import { hhmm, signClass } from "./format";
import { useSessionSeries } from "./useSessionSeries";

interface HedgePressureCardProps {
  symbol: string;
  feed: FeedEntry | null | undefined;
  /** Offer a symbol switcher (Flow page). */
  symbols?: readonly string[];
  onSymbolChange?: (s: string) => void;
  className?: string;
  /** Chart height in px (minimum). Default 280. */
  height?: number;
}

const SERIES: Array<{
  key: "total" | "calls" | "puts" | "zeroDte";
  label: string;
  color: string;
  width: number;
  dash?: string;
}> = [
  { key: "total", label: "Net hedge flow", color: chartColors.foreground, width: 2.25 },
  { key: "calls", label: "From calls", color: chartColors.call, width: 1.5 },
  { key: "puts", label: "From puts", color: chartColors.put, width: 1.5 },
  { key: "zeroDte", label: "0DTE only", color: chartColors.warning, width: 1.5, dash: "5 3" },
];
const LABEL: Record<string, string> = { ...Object.fromEntries(SERIES.map((s) => [s.key, s.label])), spot: "Spot" };

const cr = (v: number) => formatCrore(v, { signed: true });

/**
 * HIRO-style hedging pressure: cumulative estimated futures hedging by option writers through the
 * session (Σ dOI × delta × lot × spot, ₹ Cr), split by calls, puts and 0DTE, against spot.
 */
export function HedgePressureCard({
  symbol,
  feed,
  symbols,
  onSymbolChange,
  className,
  height = 280,
}: HedgePressureCardProps) {
  const sym = symbol.toUpperCase();
  const session = useSessionSeries(sym, feed);
  const series = useMemo(() => (session ? hedgePressureSeries(session.prints, { symbol: sym }) : []), [session, sym]);
  const printCount = useMemo(() => (session ? hedgePrintCount(session.prints, sym) : 0), [session, sym]);
  const summary = useMemo(() => hedgePressureSummary(series, printCount), [series, printCount]);
  const reading = hedgePressureReading(summary, (v) => formatCrore(v));
  const hasSpot = series.some((p) => typeof p.spot === "number" && p.spot > 0);
  const hasZeroDte = series.some((p) => p.zeroDte !== 0);
  const last = series[series.length - 1];

  const kpis = [
    { label: "Net hedge flow", v: summary.total, tone: signClass(summary.total) },
    { label: "From calls", v: summary.calls },
    { label: "From puts", v: summary.puts },
    { label: "0DTE only", v: summary.zeroDte, muted: !hasZeroDte },
  ];

  return (
    <Card className={cn("flex min-w-0 flex-col overflow-hidden", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 font-display text-lead font-bold tracking-[-0.01em]">
            <Scale className="h-4 w-4 text-primary-ink" aria-hidden="true" />
            Hedging pressure · {sym}
            <HelpTip
              label="How hedging pressure is estimated"
              text="For every interval, option writers are assumed short the change in OI (India seller view). To stay delta-neutral they trade futures worth dOI × delta × lot × spot. New call OI means writers buy futures (+); new put OI means they sell (−); closing OI unwinds the hedge. Delta uses Black-76 at the LTP-implied volatility. A model, not observed trades."
            />
          </h2>
          <p className="mt-0.5 text-body-sm text-muted-foreground">
            Cumulative estimated futures hedging by option writers since the open, in ₹ Cr
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info" title="Computed in your browser from OI changes between chain snapshots">
            Derived estimate
          </Badge>
          {session ? <ModeBadge mode={session.mode} asOf={session.asOf} reason={session.reason} /> : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {symbols && symbols.length > 1 && onSymbolChange ? (
          <Segmented ariaLabel="Underlying for hedging pressure" value={sym} onChange={onSymbolChange} options={symbols.map((s) => ({ value: s, label: s }))} />
        ) : null}

        {session?.fallback ? (
          <p className="rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning" role="status">
            Sample session: only {session.realSnapCount} live snapshot{session.realSnapCount === 1 ? "" : "s"} recorded
            so far, so a simulated day stands in. Real hedging builds while this page is open during market hours.
          </p>
        ) : null}

        {!feed ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {kpis.map((k) => (
                <Skeleton key={k.label} className="h-12" />
              ))}
            </div>
            <Skeleton className="w-full flex-1" style={{ minHeight: height }} />
          </>
        ) : series.length < 2 ? (
          <div className="flex flex-1 items-center" style={{ minHeight: height }}>
            <div className="w-full">
              <EmptyState title="No open-interest changes yet">
                Hedging pressure needs at least two intervals in which open interest moved.
              </EmptyState>
            </div>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {kpis.map((k) => (
                <div key={k.label} className="min-w-0 rounded-tile bg-muted px-3 py-2">
                  <dt className="text-micro uppercase text-muted-foreground">{k.label}</dt>
                  <dd
                    className={cn(
                      "truncate font-num text-lead font-semibold tabular-nums",
                      k.tone,
                      k.muted && "text-muted-foreground",
                    )}
                  >
                    {k.muted ? "None today" : cr(k.v)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-body-sm text-foreground" role="note">
              {reading}
            </p>
            <figure className="flex flex-1 flex-col" aria-label={`${sym} hedging pressure chart`}>
              <figcaption className="sr-only">
                Net estimated hedge flow {cr(summary.total)} as of {last ? hhmm(last.ts) : ""} IST: calls{" "}
                {cr(summary.calls)}, puts {cr(summary.puts)}, 0DTE {cr(summary.zeroDte)}.
              </figcaption>
              <div
                className="mb-1 flex items-center justify-between text-micro uppercase text-muted-foreground"
                aria-hidden="true"
              >
                <span>₹ Cr, cumulative</span>
                {hasSpot ? <span>Spot</span> : null}
              </div>
              <div className="relative w-full flex-1" style={{ minHeight: height }}>
                <div className="absolute inset-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={series} margin={{ top: 6, right: hasSpot ? 0 : 8, bottom: 0, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        scale="time"
                        tickFormatter={(t: number) => hhmm(t)}
                        minTickGap={36}
                        {...axisProps}
                      />
                      <YAxis yAxisId="flow" tickFormatter={compactAxisTick} width={48} {...axisProps} />
                      {hasSpot ? (
                        <YAxis
                          yAxisId="spot"
                          orientation="right"
                          domain={["auto", "auto"]}
                          tickFormatter={(v: number) => formatNumberIN(v)}
                          width={56}
                          {...axisProps}
                        />
                      ) : null}
                      <ReferenceLine yAxisId="flow" y={0} stroke={chartColors.axis} strokeOpacity={0.6} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={tooltipItemStyle}
                        cursor={tooltipCursor}
                        labelFormatter={(t: number) => `${hhmm(t)} IST`}
                        formatter={(v: number, name: string) => [
                          name === "spot" ? formatNumberIN(v, 2) : cr(v),
                          LABEL[name] ?? name,
                        ]}
                      />
                      {hasSpot ? (
                        <Line
                          yAxisId="spot"
                          type="monotone"
                          dataKey="spot"
                          stroke={chartColors.muted}
                          strokeWidth={1}
                          strokeDasharray="3 3"
                          dot={false}
                          isAnimationActive={false}
                          connectNulls
                        />
                      ) : null}
                      {SERIES.filter((s) => s.key !== "zeroDte" || hasZeroDte).map((s) => (
                        <Line
                          key={s.key}
                          yAxisId="flow"
                          type="monotone"
                          dataKey={s.key}
                          stroke={s.color}
                          strokeWidth={s.width}
                          strokeDasharray={s.dash}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <ul
                className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-muted-foreground"
                aria-label="Chart legend"
              >
                {SERIES.filter((s) => s.key !== "zeroDte" || hasZeroDte).map((s) => (
                  <li key={s.key} className="flex items-center gap-1.5">
                    <svg width="16" height="6" aria-hidden="true">
                      <line x1="0" y1="3" x2="16" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
                    </svg>
                    {s.label}
                  </li>
                ))}
                {hasSpot ? (
                  <li className="flex items-center gap-1.5">
                    <svg width="16" height="6" aria-hidden="true">
                      <line
                        x1="0"
                        y1="3"
                        x2="16"
                        y2="3"
                        stroke={chartColors.muted}
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                      />
                    </svg>
                    {sym} spot (right axis)
                    {Number.isFinite(summary.spotChangePct) ? (
                      <span className={cn("font-num", signClass(summary.spotChangePct))}>
                        {formatPct(summary.spotChangePct, { signed: true })}
                      </span>
                    ) : null}
                  </li>
                ) : null}
              </ul>
            </figure>
          </>
        )}
      </div>
      <p className="border-t border-border px-4 py-2 text-body-sm text-muted-foreground">
        Positive = writers' hedges buy futures (supportive); negative = they sell. Built from{" "}
        {formatNumberIN(printCount)} OI changes. Not trade-level data.
      </p>
    </Card>
  );
}

export default HedgePressureCard;
