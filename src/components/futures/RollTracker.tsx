import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  axisProps,
  chartColors,
  gridProps,
  tokenColor,
  tooltipCursor,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "@/lib/chartTheme";
import { formatDateIST } from "@/lib/options";
import { dateAtTradingDte, type RollTrackerPoint } from "@/lib/futures/model";
import { ScrollRegion } from "@/components/ScrollRegion";
import { useIsDark } from "@/hooks/useIsDark";
import { cn } from "@/lib/utils";

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

export interface RollTrackerProps {
  points: RollTrackerPoint[];
  currentExpiry: string;
  priorExpiries: string[];
}

/** Expiry-week roll tracker: this cycle's rollover in its last sessions vs the previous cycles. */
export function RollTracker({ points, currentExpiry, priorExpiries }: RollTrackerProps) {
  const data = points.map((p) => ({ ...p, band: p.min !== null && p.max !== null ? [p.min, p.max] : null }));
  const hasAvg = points.some((p) => p.average !== null);
  const hasCurrent = points.some((p) => p.current !== null);
  const windowStart = points[0] ? dateAtTradingDte(currentExpiry, points[0].tdte) : currentExpiry;
  // The prior-range band needs more alpha on the dark canvas to be visible at all.
  const isDark = useIsDark();
  const bandFill = tokenColor("muted-foreground", isDark ? 0.3 : 0.16);
  const windowNote = `Roll window starts ${formatDateIST(windowStart).replace(/ \d{4}$/, "")}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-body-sm text-muted-foreground">
        {hasCurrent ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-primary" />
            This cycle ({formatDateIST(currentExpiry)})
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-chip bg-muted px-1.5 py-0.5 text-foreground">
            {windowNote} (cycle to {formatDateIST(currentExpiry)})
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" />
          Average of last {priorExpiries.length}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-4 rounded-sm" style={{ background: bandFill }} />
          Range
        </span>
      </div>
      {!hasAvg && !hasCurrent ? (
        <div className="flex h-[200px] items-center justify-center rounded-tile border border-dashed border-border px-4 text-center text-body-sm text-muted-foreground">
          No roll-window history yet. Load NSE history to fill the last sessions before each expiry.
        </div>
      ) : (
        <div
          className="h-[220px]"
          role="img"
          aria-label={`Rollover in the last ${points.length} sessions before expiry. ${hasCurrent ? "" : `${windowNote}. `}${points.map((p) => (hasCurrent ? `${p.label}: this cycle ${pct(p.current)}, average ${pct(p.average)}` : `${p.label}: average ${pct(p.average)}`)).join("; ")}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis
                {...axisProps}
                width={44}
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={tooltipCursor}
                formatter={(v: number | number[], name: string) =>
                  name === "band" && Array.isArray(v)
                    ? [`${v[0].toFixed(1)}% – ${v[1].toFixed(1)}%`, "Prior range"]
                    : [pct(v as number), name === "current" ? "This cycle" : "Average"]
                }
              />
              <Area dataKey="band" stroke="none" fill={bandFill} isAnimationActive={false} connectNulls />
              <Line
                dataKey="average"
                stroke={chartColors.muted}
                strokeWidth={1.75}
                strokeDasharray="5 4"
                dot={{ r: 3 }}
                isAnimationActive={false}
                connectNulls
              />
              {hasCurrent ? (
                <Line
                  dataKey="current"
                  stroke={chartColors.primary}
                  strokeWidth={2.25}
                  dot={{ r: 4 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <ScrollRegion label="Roll tracker table" className="relative">
        <table className="w-full min-w-[420px] text-body-sm">
          <caption className="sr-only">Rollover by trading days to expiry, this cycle and the previous cycles</caption>
          <thead>
            <tr className="border-b border-border text-label uppercase text-muted-foreground">
              <th scope="col" className="sticky left-0 z-10 bg-card py-1.5 pr-2 text-left">
                Day
              </th>
              {hasCurrent ? (
                <th scope="col" className="px-2 py-1.5 text-right">
                  This cycle
                </th>
              ) : null}
              <th scope="col" className="px-2 py-1.5 text-right">
                Average
              </th>
              {priorExpiries.map((e) => (
                <th key={e} scope="col" className="px-2 py-1.5 text-right">
                  {formatDateIST(e).replace(/^\d+\s/, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => {
              const diff = p.current !== null && p.average !== null ? p.current - p.average : null;
              return (
                <tr key={p.tdte} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="sticky left-0 z-10 bg-card py-1.5 pr-2 text-left font-medium">
                    {p.label}
                  </th>
                  {hasCurrent ? (
                    <td
                      className={cn(
                        "px-2 text-right font-num tabular-nums",
                        diff !== null && (diff >= 2 ? "text-bullish" : diff <= -2 ? "text-bearish" : ""),
                      )}
                    >
                      {pct(p.current)}
                    </td>
                  ) : null}
                  <td className="px-2 text-right font-num tabular-nums text-muted-foreground">{pct(p.average)}</td>
                  {p.priors.map((v, k) => (
                    <td
                      key={priorExpiries[k] ?? k}
                      className="px-2 text-right font-num tabular-nums text-muted-foreground"
                    >
                      {pct(v)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="text-body-sm text-muted-foreground">
        {hasCurrent ? "" : `This cycle's roll window starts on ${formatDateIST(windowStart)}. `}Rollover that runs ahead
        of the average with a rising roll cost suggests longs carrying positions forward; running behind suggests
        positions being closed rather than rolled.
      </p>
    </div>
  );
}
