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
import { formatNumberIN } from "@/lib/options";
import { tideReading, type TidePoint } from "@/lib/flow";
import { cn } from "@/lib/utils";
import { EmptyState } from "./FlowUi";
import { fmtRs, hhmm } from "./format";

interface PremiumTideChartProps {
  points: TidePoint[];
  /** Minimum chart height in px; the chart grows to fill a flex parent. */
  height?: number;
  /** Show the spot line on a secondary axis when points carry spot. */
  showSpot?: boolean;
  compact?: boolean;
  ariaLabel?: string;
  /** Hide the one-line reading under the chart. */
  hideReading?: boolean;
  className?: string;
}

const SERIES: Array<{ key: "ce" | "pe" | "net"; label: string; color: string; width: number; dash?: string }> = [
  { key: "ce", label: "Calls", color: chartColors.call, width: 2 },
  { key: "pe", label: "Puts", color: chartColors.put, width: 2 },
  { key: "net", label: "Net (calls − puts)", color: chartColors.product, width: 1.5, dash: "5 3" },
];
const LABEL: Record<string, string> = {
  ce: "Call premium",
  pe: "Put premium",
  net: "Net (calls − puts)",
  spot: "Spot",
};

/**
 * Premium Tide: cumulative ask-side minus bid-side premium for calls and puts, with the
 * underlying as a thin dashed line on a secondary axis. Calls bought push the call line up
 * (bullish); puts bought push the put line up (bearish).
 */
export function PremiumTideChart({
  points,
  height = 300,
  showSpot = true,
  compact = false,
  ariaLabel = "Premium Tide chart",
  hideReading = false,
  className,
}: PremiumTideChartProps) {
  if (points.length < 2) {
    return (
      <div style={{ minHeight: height }} className={cn("flex items-center", className)}>
        <div className="w-full">
          <EmptyState title="Not enough flow yet">
            The tide needs at least two intervals with trading. It builds through the session.
          </EmptyState>
        </div>
      </div>
    );
  }
  const hasSpot = showSpot && points.some((p) => typeof p.spot === "number" && p.spot > 0);
  const last = points[points.length - 1];
  return (
    <figure className={cn("flex w-full flex-col", className)} aria-label={ariaLabel}>
      <figcaption className="sr-only">
        Cumulative call premium {fmtRs(last.ce, true)}, put premium {fmtRs(last.pe, true)}, net {fmtRs(last.net, true)}{" "}
        as of {hhmm(last.ts)} IST.
      </figcaption>
      <div
        className="mb-1 flex items-center justify-between text-micro uppercase text-muted-foreground"
        aria-hidden="true"
      >
        <span>₹ premium, cumulative</span>
        {hasSpot ? <span>Spot</span> : null}
      </div>
      <div style={{ minHeight: height }} className="relative w-full flex-1">
        <div className="absolute inset-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 6, right: hasSpot ? 0 : 8, bottom: 0, left: 0 }}>
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
              <YAxis yAxisId="prem" tickFormatter={compactAxisTick} width={compact ? 54 : 58} {...axisProps} />
              {hasSpot ? (
                <YAxis
                  yAxisId="spot"
                  orientation="right"
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => formatNumberIN(v)}
                  width={compact ? 48 : 56}
                  {...axisProps}
                />
              ) : null}
              <ReferenceLine yAxisId="prem" y={0} stroke={chartColors.axis} strokeOpacity={0.6} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={tooltipCursor}
                labelFormatter={(t: number) => `${hhmm(t)} IST`}
                formatter={(v: number, name: string) => [
                  name === "spot" ? formatNumberIN(v, 2) : fmtRs(v, true),
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
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  yAxisId="prem"
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
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-body-sm text-muted-foreground" aria-label="Chart legend">
        {SERIES.map((s) => (
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
              <line x1="0" y1="3" x2="16" y2="3" stroke={chartColors.muted} strokeWidth="1.5" strokeDasharray="3 3" />
            </svg>
            Spot (right axis)
          </li>
        ) : null}
      </ul>
      {hideReading ? null : (
        <p className="mt-1.5 text-body-sm text-foreground">{tideReading(last, (v) => fmtRs(v, true))}</p>
      )}
    </figure>
  );
}
