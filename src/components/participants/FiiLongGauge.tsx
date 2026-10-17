import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, chartColors, gridProps, tokenColor, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { LONG_PCT_BANDS, ZONE_TEXT, classifyLongPct, percentileRank, sma, type HistoryPoint } from "@/lib/participantsApi";
import { cn } from "@/lib/utils";
import { arrow, fmtPct, shortDate } from "./format";

// ── gauge geometry ──
const W = 240;
const H = 140;
const CX = W / 2;
const CY = 124;
const R = 100;
const STROKE = 18;
// The tick labels sit outside the arc (radius R + STROKE/2 + 16 = 125), which reaches past the
// 0..W / 0..H box at the 0, 50 and 100 ticks. Pad the viewBox so they are not clipped.
const PAD_X = 18;
const PAD_TOP = 12;
const VIEWBOX = `${-PAD_X} ${-PAD_TOP} ${W + 2 * PAD_X} ${H + PAD_TOP}`;

function polar(pct: number, r = R): { x: number; y: number } {
  const a = Math.PI * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}

function arc(from: number, to: number, r = R): string {
  const a = polar(from, r);
  const b = polar(to, r);
  const large = to - from > 50 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

const BANDS: Array<{ from: number; to: number; color: string }> = [
  { from: 0, to: LONG_PCT_BANDS.extremeLow, color: tokenColor("warning", 0.75) },
  { from: LONG_PCT_BANDS.extremeLow, to: LONG_PCT_BANDS.heavyLow, color: tokenColor("bearish", 0.55) },
  { from: LONG_PCT_BANDS.heavyLow, to: 50, color: tokenColor("bearish", 0.2) },
  { from: 50, to: LONG_PCT_BANDS.heavyHigh, color: tokenColor("bullish", 0.2) },
  { from: LONG_PCT_BANDS.heavyHigh, to: LONG_PCT_BANDS.extremeHigh, color: tokenColor("bullish", 0.55) },
  { from: LONG_PCT_BANDS.extremeHigh, to: 100, color: tokenColor("warning", 0.75) },
];

const TONE_CLASS = { bullish: "text-bullish", bearish: "text-bearish", warning: "text-warning", neutral: "text-muted-foreground" } as const;

export function GaugeDial({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const ok = Number.isFinite(value);
  const tip = polar(ok ? value : 50, R - STROKE / 2 - 6);
  const zone = classifyLongPct(value);
  return (
    <svg
      viewBox={VIEWBOX}
      overflow="visible"
      className={cn("w-full", size === "sm" ? "max-w-[180px]" : "max-w-[260px]")}
      role="img"
      aria-label={ok ? `FII index futures long ${value.toFixed(1)} percent, ${ZONE_TEXT[zone].label}` : "FII long percent unavailable"}
    >
      {BANDS.map((b) => (
        <path key={b.from} d={arc(b.from, b.to)} stroke={b.color} strokeWidth={STROKE} fill="none" />
      ))}
      {[0, 10, 50, 90, 100].map((t) => {
        const o = polar(t, R + STROKE / 2 + 2);
        const i = polar(t, R + STROKE / 2 + 7);
        const l = polar(t, R + STROKE / 2 + 16);
        return (
          <g key={t}>
            <line x1={o.x} y1={o.y} x2={i.x} y2={i.y} stroke={chartColors.axis} strokeWidth={1} />
            <text x={l.x} y={l.y + 3} textAnchor="middle" fontSize={9} fill={chartColors.axis} fontFamily="Inter, system-ui, sans-serif">
              {t}
            </text>
          </g>
        );
      })}
      {ok ? (
        <g style={{ transition: "transform 500ms cubic-bezier(.16,1,.3,1)" }}>
          <line x1={CX} y1={CY} x2={tip.x} y2={tip.y} stroke={chartColors.foreground} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={CX} cy={CY} r={6} fill={chartColors.foreground} />
          <circle cx={CX} cy={CY} r={2.5} fill={chartColors.card} />
        </g>
      ) : null}
    </svg>
  );
}

interface Props {
  longPct: number;
  /** change in percentage points vs the previous day */
  changePts: number | null;
  series: HistoryPoint[];
  date: string;
}

export function FiiLongGauge({ longPct, changePts, series, date }: Props) {
  const zone = classifyLongPct(longPct);
  const z = ZONE_TEXT[zone];

  const trend = useMemo(() => {
    const avg = sma(
      series.map((p) => p.fiiLongPct),
      5,
    );
    return series.slice(-20).map((p, i, arr) => {
      const a = avg[series.length - arr.length + i];
      return { date: p.date, label: shortDate(p.date), longPct: p.fiiLongPct, avg5: Number.isFinite(a) ? a : null };
    });
  }, [series]);

  const pctRank = useMemo(
    () =>
      percentileRank(
        longPct,
        series.map((p) => p.fiiLongPct),
      ),
    [longPct, series],
  );
  const hi = trend.length ? Math.max(...trend.map((t) => t.longPct).filter(Number.isFinite)) : NaN;
  const lo = trend.length ? Math.min(...trend.map((t) => t.longPct).filter(Number.isFinite)) : NaN;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <div className="flex flex-col items-center text-center">
        <GaugeDial value={longPct} />
        <p className="-mt-2 font-num text-num-hero tabular-nums">{Number.isFinite(longPct) ? fmtPct(longPct, 1) : "—"}</p>
        <p className={cn("mt-1 font-display text-lead font-bold", TONE_CLASS[z.tone])}>{z.label}</p>
        {changePts !== null && Number.isFinite(changePts) ? (
          <p className={cn("mt-0.5 font-num text-body-sm tabular-nums", changePts > 0 ? "text-bullish" : changePts < 0 ? "text-bearish" : "text-muted-foreground")}>
            {arrow(changePts)} {fmtPct(changePts, 2, true).replace("%", " pts")} vs previous day
          </p>
        ) : (
          <p className="mt-0.5 text-body-sm text-muted-foreground">No previous day to compare</p>
        )}
        <p className="mt-2 max-w-[260px] text-body-sm text-muted-foreground">{z.note}</p>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-label uppercase text-muted-foreground">Last {trend.length} sessions to {shortDate(date)}</p>
          <p className="font-num text-body-sm tabular-nums text-muted-foreground">
            Range {fmtPct(lo, 1)} – {fmtPct(hi, 1)}
            {Number.isFinite(pctRank) && series.length >= 10 ? ` · ${Math.round(pctRank)}th pct of ${series.length}d` : ""}
          </p>
        </div>
        {trend.length < 2 ? (
          <div className="flex h-[180px] items-center justify-center rounded-tile border border-dashed border-border text-body-sm text-muted-foreground">Not enough history for a trend yet.</div>
        ) : (
          <div className="h-[180px] w-full" role="img" aria-label={`FII long percent trend over ${trend.length} sessions, from ${fmtPct(trend[0].longPct, 1)} to ${fmtPct(trend[trend.length - 1].longPct, 1)}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <ReferenceArea y1={0} y2={LONG_PCT_BANDS.extremeLow} fill={tokenColor("warning", 0.12)} stroke="none" ifOverflow="hidden" />
                <ReferenceArea y1={LONG_PCT_BANDS.extremeHigh} y2={100} fill={tokenColor("warning", 0.12)} stroke="none" ifOverflow="hidden" />
                <ReferenceLine y={50} stroke={tokenColor("muted-foreground", 0.5)} strokeDasharray="4 4" />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
                <YAxis {...axisProps} domain={[0, 100]} ticks={[0, 10, 50, 90, 100]} width={44} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={tooltipCursor}
                  formatter={(v: number, name: string) => [fmtPct(v, 1), name === "avg5" ? "5-day average" : "FII long %"]}
                />
                <Line type="monotone" dataKey="avg5" stroke={tokenColor("muted-foreground", 0.8)} strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
                <Line type="monotone" dataKey="longPct" stroke={chartColors.fii} strokeWidth={2} dot={{ r: 2, fill: chartColors.fii }} activeDot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-body-sm text-muted-foreground">
          Shaded bands mark the extremes (below {LONG_PCT_BANDS.extremeLow}% and above {LONG_PCT_BANDS.extremeHigh}%). Dashed line: 5-day average.
        </p>
      </div>
    </div>
  );
}
