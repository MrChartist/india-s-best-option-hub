import { useMemo } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  axisProps,
  chartColors,
  gridProps,
  tokenColor,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "@/lib/chartTheme";
import { formatDateIST } from "@/lib/options";
import {
  correlationStrength,
  nextDayCorrelation,
  percentileRank,
  type DailyClose,
  type HistoryPoint,
} from "@/lib/participantsApi";
import { cn } from "@/lib/utils";
import { fmtPct, percentileLabel } from "./format";
import { Stat } from "./ui";

const STRENGTH: Record<ReturnType<typeof correlationStrength>, string> = {
  none: "No relationship",
  weak: "Weak",
  moderate: "Moderate",
  strong: "Strong",
  unknown: "Not enough data",
};

function fmtR(r: number): string {
  if (!Number.isFinite(r)) return "—";
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}`;
}

export interface LeadLagPanelProps {
  series: HistoryPoint[];
  closes: DailyClose[] | null;
  closesLoading: boolean;
  /** Window label, e.g. "1Y" or "60D". */
  windowLabel: string;
}

/**
 * Where today's FII index-futures long % sits in the window, and whether FII positioning has
 * told you anything about NIFTY's next session (Pearson correlation, with the scatter behind it).
 */
export function LeadLagPanel({ series, closes, closesLoading, windowLabel }: LeadLagPanelProps) {
  const latest = series[series.length - 1];
  const rank = useMemo(
    () =>
      latest
        ? percentileRank(
            latest.fiiLongPct,
            series.map((p) => p.fiiLongPct),
          )
        : NaN,
    [latest, series],
  );
  const lag = useMemo(() => (closes ? nextDayCorrelation(series, closes) : null), [series, closes]);
  const strength = correlationStrength(lag?.corrChange ?? NaN);
  const values = series.map((p) => p.fiiLongPct).filter(Number.isFinite);
  const lo = values.length ? Math.min(...values) : NaN;
  const hi = values.length ? Math.max(...values) : NaN;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat
          label={`Long % rank (${windowLabel})`}
          value={Number.isFinite(rank) ? `${Math.round(rank)}` : "—"}
          hint={Number.isFinite(rank) ? percentileLabel(rank, series.length) : "Needs history"}
          help="Share of sessions in the window when FII index-futures long % was at or below today's. Near 0 or 100 marks an extreme for this window."
        />
        <Stat
          label={`Range (${windowLabel})`}
          value={Number.isFinite(lo) ? `${fmtPct(lo, 0)}–${fmtPct(hi, 0)}` : "—"}
          hint={latest ? `Now ${fmtPct(latest.fiiLongPct, 1)}` : undefined}
        />
        <Stat
          label="Δ long % vs next day"
          value={closesLoading ? "…" : fmtR(lag?.corrChange ?? NaN)}
          hint={closesLoading ? "Loading NIFTY closes" : `${STRENGTH[strength]}${lag?.n ? ` · ${lag.n} sessions` : ""}`}
          tone={
            strength === "moderate" || strength === "strong"
              ? (lag?.corrChange ?? 0) > 0
                ? "text-bullish"
                : "text-bearish"
              : undefined
          }
          help="Pearson correlation between the day's change in FII long % and NIFTY's return from that close to the next session's close. +1 would mean rising FII longs always preceded up days."
        />
        <Stat
          label="Long % level vs next day"
          value={closesLoading ? "…" : fmtR(lag?.corrLevel ?? NaN)}
          hint={closesLoading ? "Loading NIFTY closes" : STRENGTH[correlationStrength(lag?.corrLevel ?? NaN)]}
          help="Pearson correlation between the FII long % level and NIFTY's next-day return."
        />
      </div>

      {!closes && !closesLoading ? (
        <p className="rounded-tile bg-muted/40 px-3 py-4 text-center text-body-sm text-muted-foreground">
          NIFTY daily closes are unavailable, so the next-day correlation cannot be worked out. Start the local proxy
          and refresh.
        </p>
      ) : lag && lag.n >= 3 ? (
        <div className="min-w-0">
          <p className="mb-2 text-label text-muted-foreground">Change in FII long % (x) vs next-day NIFTY return (y)</p>
          <div
            className="h-[240px]"
            role="img"
            aria-label={`Scatter of ${lag.n} sessions: change in FII long percent against next-day NIFTY return. Correlation ${fmtR(lag.corrChange)}, ${STRENGTH[strength].toLowerCase()}.`}
          >
            {/* Recharts marks every scatter dot role="img" with no name; the wrapper's label describes the chart. */}
            <div className="h-full w-full" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <ReferenceLine x={0} stroke={tokenColor("muted-foreground", 0.5)} />
                  <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.5)} />
                  <XAxis
                    type="number"
                    dataKey="fiiChange"
                    {...axisProps}
                    tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
                    name="Δ FII long %"
                    unit=" pts"
                  />
                  <YAxis
                    type="number"
                    dataKey="nextRet"
                    {...axisProps}
                    width={48}
                    tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                    name="Next-day NIFTY"
                  />
                  <ZAxis range={[48, 48]} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    cursor={{ strokeDasharray: "3 3" }}
                    labelFormatter={() => ""}
                    formatter={(v: number, name: string) => [
                      name.startsWith("Δ")
                        ? `${v > 0 ? "+" : ""}${v.toFixed(2)} pts`
                        : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`,
                      name,
                    ]}
                  />
                  <Scatter
                    data={lag.points}
                    fill={chartColors.fii}
                    fillOpacity={0.75}
                    stroke={chartColors.card}
                    strokeWidth={1}
                    isAnimationActive={false}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {lag.points.length
              ? `${formatDateIST(lag.points[0].date)} to ${formatDateIST(lag.points[lag.points.length - 1].date)}. `
              : ""}
            Each dot is a session. Dots in the top-right and bottom-left support the idea that FII flows lead the index.
          </p>
        </div>
      ) : (
        <p className="rounded-tile bg-muted/40 px-3 py-4 text-center text-body-sm text-muted-foreground">
          {closesLoading ? "Loading NIFTY closes…" : "Not enough overlapping sessions for a correlation yet."}
        </p>
      )}
      <p className={cn("text-body-sm text-muted-foreground")}>
        Correlation is not a trading signal. Over short windows a few large days dominate, and the relationship changes
        with market regimes. Use the 1Y window for a steadier read.
      </p>
    </div>
  );
}
