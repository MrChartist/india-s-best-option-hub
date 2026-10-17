import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, chartColors, gridProps, legendStyle, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatCompactIN, formatNumberIN } from "@/lib/options";
import type { TidePoint } from "@/lib/flow";
import { EmptyState } from "./FlowUi";
import { fmtRs, hhmm } from "./format";

interface PremiumTideChartProps {
  points: TidePoint[];
  height?: number;
  /** Show the spot line on a secondary axis when points carry spot. */
  showSpot?: boolean;
  compact?: boolean;
  ariaLabel?: string;
}

const SERIES_LABEL: Record<string, string> = { ce: "Call premium", pe: "Put premium", net: "Net (calls − puts)", spot: "Spot" };

/**
 * Premium Tide: cumulative ask-side minus bid-side premium for calls and puts, with the
 * underlying on a secondary axis. Calls bought push the call line up (bullish); puts bought push
 * the put line up (bearish).
 */
export function PremiumTideChart({ points, height = 300, showSpot = true, compact = false, ariaLabel = "Premium Tide chart" }: PremiumTideChartProps) {
  if (points.length < 2) {
    return (
      <div style={{ minHeight: height }} className="flex items-center">
        <div className="w-full">
          <EmptyState title="Not enough flow yet">The tide needs at least two intervals with trading. It builds through the session.</EmptyState>
        </div>
      </div>
    );
  }
  const hasSpot = showSpot && points.some((p) => typeof p.spot === "number" && p.spot > 0);
  const last = points[points.length - 1];
  return (
    <figure className="w-full" aria-label={ariaLabel}>
      <figcaption className="sr-only">
        Cumulative call premium {fmtRs(last.ce, true)}, put premium {fmtRs(last.pe, true)}, net {fmtRs(last.net, true)} as of {hhmm(last.ts)} IST.
      </figcaption>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: hasSpot ? 4 : 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={(t: number) => hhmm(t)} minTickGap={36} {...axisProps} />
            <YAxis yAxisId="prem" tickFormatter={(v: number) => formatCompactIN(v)} width={compact ? 44 : 56} {...axisProps} />
            {hasSpot ? (
              <YAxis yAxisId="spot" orientation="right" domain={["auto", "auto"]} tickFormatter={(v: number) => formatNumberIN(v)} width={compact ? 48 : 60} {...axisProps} />
            ) : null}
            <ReferenceLine yAxisId="prem" y={0} stroke={chartColors.axis} strokeOpacity={0.5} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={tooltipCursor}
              labelFormatter={(t: number) => `${hhmm(t)} IST`}
              formatter={(v: number, name: string) => [name === "spot" ? formatNumberIN(v, 2) : fmtRs(v, true), SERIES_LABEL[name] ?? name]}
            />
            {!compact ? <Legend wrapperStyle={legendStyle} formatter={(v: string) => SERIES_LABEL[v] ?? v} /> : null}
            <Line yAxisId="prem" type="monotone" dataKey="ce" stroke={chartColors.bullish} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line yAxisId="prem" type="monotone" dataKey="pe" stroke={chartColors.bearish} strokeWidth={2} dot={false} isAnimationActive={false} />
            {!compact ? <Line yAxisId="prem" type="monotone" dataKey="net" stroke={chartColors.product} strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} /> : null}
            {hasSpot ? <Line yAxisId="spot" type="monotone" dataKey="spot" stroke={chartColors.spot} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
