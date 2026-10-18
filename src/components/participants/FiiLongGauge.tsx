import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import {
  LONG_PCT_BANDS,
  ZONE_TEXT,
  classifyLongPct,
  percentileRank,
  sma,
  type HistoryPoint,
} from "@/lib/participantsApi";
import { cn } from "@/lib/utils";
import { arrow, fmtPct, percentileLabel, shortDate } from "./format";

// ── gauge geometry ──
const W = 240;
const H = 140;
const CX = W / 2;
const CY = 124;
const R = 100;
const STROKE = 18;
// Tick labels render at 10px or more: 12 units at the 260px size and 17 units at the 180px size
// (the viewBox is 280 units wide). 10 / 50 / 90 sit outside the arc with a clear gap after the tick
// mark, anchored away from it; 0 and 100 sit under the arc ends, so "100" never reads as "-100".
// Pad the viewBox so nothing is clipped.
const PAD_X = 20;
const PAD_TOP = 20;
const PAD_BOTTOM = 10;
const VIEWBOX = `${-PAD_X} ${-PAD_TOP} ${W + 2 * PAD_X} ${H + PAD_TOP + PAD_BOTTOM}`;

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

const TONE_CLASS = {
  bullish: "text-bullish",
  bearish: "text-bearish",
  warning: "text-warning",
  neutral: "text-muted-foreground",
} as const;

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
      aria-label={
        ok
          ? `FII index futures long ${value.toFixed(1)} percent, ${ZONE_TEXT[zone].label}`
          : "FII long percent unavailable"
      }
    >
      {BANDS.map((b) => (
        <path key={b.from} d={arc(b.from, b.to)} stroke={b.color} strokeWidth={STROKE} fill="none" />
      ))}
      {[0, 10, 50, 90, 100].map((t) => {
        const fontSize = size === "sm" ? 17 : 12;
        const end = t === 0 || t === 100;
        const o = polar(t, R + STROKE / 2 + 2);
        const i = polar(t, R + STROKE / 2 + 7);
        // Ends: centred under the arc's stroke. Others: past the tick with a gap, anchored outward.
        const l = end ? polar(t, R) : polar(t, R + STROKE / 2 + 10);
        const anchor = end || t === 50 ? "middle" : t < 50 ? "end" : "start";
        const y = end ? CY + STROKE / 2 + fontSize * 0.75 : t === 50 ? l.y - 4 : l.y + fontSize * 0.35;
        return (
          <g key={t}>
            {end ? null : <line x1={o.x} y1={o.y} x2={i.x} y2={i.y} stroke={chartColors.axis} strokeWidth={1} />}
            <text
              x={l.x}
              y={y}
              textAnchor={anchor}
              fontSize={fontSize}
              fill={chartColors.axis}
              fontFamily="Inter, system-ui, sans-serif"
            >
              {t}
            </text>
          </g>
        );
      })}
      {ok ? (
        <g style={{ transition: "transform 500ms cubic-bezier(.16,1,.3,1)" }}>
          <line
            x1={CX}
            y1={CY}
            x2={tip.x}
            y2={tip.y}
            stroke={chartColors.foreground}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
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
  // Zoom the y-axis to the data (at least a 20-point window) so a 20-session trend is not a flat
  // line on a 0-100 scale; reference lines at 10 / 50 / 90 show only when they are in view.
  const domain = useMemo<[number, number]>(() => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 100];
    const mid = (lo + hi) / 2;
    const half = Math.max(10, (hi - lo) / 2 + 4);
    let a = Math.max(0, Math.floor((mid - half) / 5) * 5);
    let b = Math.min(100, Math.ceil((mid + half) / 5) * 5);
    if (b - a < 20) {
      if (a === 0) b = 20;
      else a = Math.max(0, b - 20);
    }
    return [a, b];
  }, [lo, hi]);
  const yTicks = useMemo(() => {
    const [a, b] = domain;
    const step = b - a > 50 ? 20 : b - a > 25 ? 10 : 5;
    const out: number[] = [];
    for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(v);
    return out;
  }, [domain]);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <div className="flex flex-col items-center text-center">
        <GaugeDial value={longPct} />
        <p className="-mt-2 font-num text-num-hero tabular-nums">
          {Number.isFinite(longPct) ? fmtPct(longPct, 1) : "—"}
        </p>
        <p className={cn("mt-1 font-display text-lead font-bold", TONE_CLASS[z.tone])}>{z.label}</p>
        {changePts !== null && Number.isFinite(changePts) ? (
          <p
            className={cn(
              "mt-0.5 font-num text-body-sm tabular-nums",
              changePts > 0 ? "text-bullish" : changePts < 0 ? "text-bearish" : "text-muted-foreground",
            )}
          >
            {arrow(changePts)} {fmtPct(changePts, 2, true).replace("%", " pts")} vs previous day
          </p>
        ) : (
          <p className="mt-0.5 text-body-sm text-muted-foreground">No previous day to compare</p>
        )}
        <p className="mt-2 max-w-[260px] text-body-sm text-muted-foreground">{z.note}</p>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-label text-muted-foreground">
            Last {trend.length} sessions to {shortDate(date)}
          </p>
          <p className="font-num text-body-sm tabular-nums text-muted-foreground">
            Range {fmtPct(lo, 1)} – {fmtPct(hi, 1)}
            {Number.isFinite(pctRank) && series.length >= 10 ? ` · ${percentileLabel(pctRank, series.length)}` : ""}
          </p>
        </div>
        {trend.length < 2 ? (
          <div className="flex h-[180px] items-center justify-center rounded-tile bg-muted/40 text-body-sm text-muted-foreground">
            Not enough history for a trend yet.
          </div>
        ) : (
          <div
            className="h-[180px] w-full"
            role="img"
            aria-label={`FII long percent trend over ${trend.length} sessions, from ${fmtPct(trend[0].longPct, 1)} to ${fmtPct(trend[trend.length - 1].longPct, 1)}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <ReferenceArea
                  y1={0}
                  y2={LONG_PCT_BANDS.extremeLow}
                  fill={tokenColor("warning", 0.12)}
                  stroke="none"
                  ifOverflow="hidden"
                />
                <ReferenceArea
                  y1={LONG_PCT_BANDS.extremeHigh}
                  y2={100}
                  fill={tokenColor("warning", 0.12)}
                  stroke="none"
                  ifOverflow="hidden"
                />
                {domain[0] < 50 && domain[1] > 50 ? (
                  <ReferenceLine y={50} stroke={tokenColor("muted-foreground", 0.5)} strokeDasharray="4 4" />
                ) : null}
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
                <YAxis
                  {...axisProps}
                  domain={domain}
                  ticks={yTicks}
                  allowDataOverflow
                  width={44}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={tooltipCursor}
                  formatter={(v: number, name: string) => [
                    fmtPct(v, 1),
                    name === "avg5" ? "5-day average" : "FII long %",
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="avg5"
                  stroke={tokenColor("muted-foreground", 0.8)}
                  strokeDasharray="4 3"
                  strokeWidth={1.25}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="longPct"
                  stroke={chartColors.fii}
                  strokeWidth={2}
                  dot={{ r: 2, fill: chartColors.fii }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-body-sm text-muted-foreground">
          Shaded bands mark the extremes (below {LONG_PCT_BANDS.extremeLow}% and above {LONG_PCT_BANDS.extremeHigh}%).
          Dashed line: 5-day average.
        </p>
      </div>
    </div>
  );
}
