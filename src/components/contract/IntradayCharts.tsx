/** Intraday charts for one contract: LTP vs spot, OI with OI-change bars, IV, Greeks and volume. */
import { useMemo, type ReactElement } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  axisProps,
  barCursor,
  chartColors,
  compactAxisTick,
  gridProps,
  legendStyle,
  seriesColor,
  signedColor,
  tooltipCursor,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "@/lib/chartTheme";
import { formatCompactIN, formatGreek, formatINR, formatNumberIN, formatPct, formatSigned, formatTimeIST, istDateString, toISTDate, type OptionType } from "@/lib/options";
import { hhmmIST, type EnrichedPoint } from "@/lib/history/contractSeries";

const hhmm = hhmmIST;

/** One shared session axis (09:15–15:30 IST) so every intraday chart lines up tick for tick. */
const SESSION_TICKS = ["09:15", "10:30", "11:45", "13:00", "14:15", "15:30"];

interface SessionAxis {
  domain: [number, number];
  ticks: number[];
}

const xAxis = (axis: SessionAxis) => (
  <XAxis dataKey="ts" type="number" scale="time" domain={axis.domain} ticks={axis.ticks} tickFormatter={hhmm} interval="preserveStartEnd" minTickGap={16} allowDataOverflow {...axisProps} />
);

function ChartFrame({ label, height = 220, children }: { label: string; height?: number; children: ReactElement }) {
  return (
    <figure aria-label={label} className="m-0 w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </figure>
  );
}

function useDomain(points: EnrichedPoint[]): SessionAxis {
  return useMemo(() => {
    const date = istDateString(points.length ? new Date(points[0].ts) : new Date());
    const ticks = SESSION_TICKS.map((t) => toISTDate(date, t).getTime());
    const open = ticks[0];
    const close = ticks[ticks.length - 1];
    // Widen only if a snapshot falls outside the session (pre-open or late recorder writes).
    const first = points.length ? points[0].ts : open;
    const last = points.length ? points[points.length - 1].ts : close;
    return { domain: [Math.min(open, first), Math.max(close, last)], ticks };
  }, [points]);
}

/** Legend for the OI chart: the OI-change swatch is split green/red to match the signed bars. */
function OiLegend({ type }: { type: OptionType }) {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-4 p-0" style={legendStyle}>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-flex h-2.5 w-2.5 overflow-hidden rounded-[2px]">
          <span className="h-full w-1/2" style={{ background: chartColors.bullish, opacity: 0.7 }} />
          <span className="h-full w-1/2" style={{ background: chartColors.bearish, opacity: 0.7 }} />
        </span>
        OI change (added / cut)
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block h-0.5 w-3.5 rounded" style={{ background: type === "CE" ? chartColors.call : chartColors.put }} />
        Open interest
      </li>
    </ul>
  );
}

const tooltipBase = {
  contentStyle: tooltipStyle,
  labelStyle: tooltipLabelStyle,
  itemStyle: tooltipItemStyle,
  labelFormatter: (v: number) => formatTimeIST(v),
};

export function PriceChart({ points, type }: { points: EnrichedPoint[]; type: OptionType }) {
  const domain = useDomain(points);
  const last = points[points.length - 1];
  return (
    <ChartFrame label={`Option price and spot through the session${last ? `, last ${formatINR(last.ltp)} with spot at ${formatNumberIN(last.spot, 2)}` : ""}`} height={260}>
      <ComposedChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        {xAxis(domain)}
        <YAxis yAxisId="p" {...axisProps} width={52} domain={["auto", "auto"]} tickFormatter={(v: number) => formatNumberIN(v, v < 10 ? 2 : 0)} />
        <YAxis yAxisId="s" orientation="right" {...axisProps} width={56} domain={["auto", "auto"]} tickFormatter={(v: number) => formatNumberIN(v, 0)} />
        <Tooltip
          {...tooltipBase}
          cursor={tooltipCursor}
          formatter={(value: number, name: string) => (name === "Spot" ? [formatNumberIN(value, 2), name] : [formatINR(value), name])}
        />
        <Legend wrapperStyle={legendStyle} />
        <Line yAxisId="s" type="linear" dataKey="spot" name="Spot" stroke={chartColors.c4} strokeOpacity={0.6} strokeWidth={1.25} dot={false} isAnimationActive={false} />
        <Line yAxisId="p" type="linear" dataKey="ltp" name={`${type} LTP`} stroke={type === "CE" ? chartColors.call : chartColors.put} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ChartFrame>
  );
}

export function OiChart({ points, type }: { points: EnrichedPoint[]; type: OptionType }) {
  const domain = useDomain(points);
  const data = useMemo(() => points.map((p, i) => ({ ...p, dOiBar: i === 0 ? null : p.dOi })), [points]);
  return (
    <ChartFrame label="Open interest and change in open interest between snapshots" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        {xAxis(domain)}
        <YAxis yAxisId="oi" {...axisProps} width={56} domain={["auto", "auto"]} tickFormatter={(v: number) => formatCompactIN(v, { decimals: 2 })} />
        <YAxis yAxisId="d" orientation="right" {...axisProps} width={48} tickFormatter={compactAxisTick} />
        <Tooltip
          {...tooltipBase}
          cursor={barCursor}
          formatter={(value: number, name: string) => (name === "OI change" ? [formatSigned(value, 0), name] : [formatNumberIN(value), name])}
        />
        <Legend content={() => <OiLegend type={type} />} />
        <Bar yAxisId="d" dataKey="dOiBar" name="OI change" fill={chartColors.muted} maxBarSize={10} isAnimationActive={false}>
          {data.map((p) => (
            <Cell key={p.ts} fill={signedColor(p.dOi)} fillOpacity={0.7} />
          ))}
        </Bar>
        <Line yAxisId="oi" type="stepAfter" dataKey="oi" name="Open interest" stroke={type === "CE" ? chartColors.call : chartColors.put} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ChartFrame>
  );
}

export function IvChart({ points }: { points: EnrichedPoint[] }) {
  const domain = useDomain(points);
  const data = useMemo(() => points.map((p) => ({ ts: p.ts, iv: p.sigma > 0 ? p.sigma * 100 : null, solved: p.ivSource === "solved" })), [points]);
  return (
    <ChartFrame label="Implied volatility through the session" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        {xAxis(domain)}
        <YAxis {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${formatNumberIN(v, 1)}%`} />
        <Tooltip {...tooltipBase} cursor={tooltipCursor} formatter={(value: number) => [formatPct(value, { decimals: 2 }), "IV"]} />
        <Line type="monotone" dataKey="iv" name="IV" stroke={chartColors.iv} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ChartFrame>
  );
}

const GREEKS: Array<{ key: "delta" | "gamma" | "theta" | "vega"; label: string; symbol: string; unit: string }> = [
  { key: "delta", label: "Delta", symbol: "Δ", unit: "per ₹1 in spot" },
  { key: "gamma", label: "Gamma", symbol: "Γ", unit: "Δ change per ₹1" },
  { key: "theta", label: "Theta", symbol: "Θ", unit: "₹ per day, per unit" },
  { key: "vega", label: "Vega", symbol: "ν", unit: "₹ per vol point" },
];

export function GreeksCharts({ points }: { points: EnrichedPoint[] }) {
  const domain = useDomain(points);
  const last = points[points.length - 1];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {GREEKS.map((g, i) => (
        <div key={g.key} className="min-w-0 rounded-tile border border-border p-3">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <p className="text-label uppercase text-muted-foreground">
              <span aria-hidden="true" className="mr-1 font-display text-body normal-case text-foreground">
                {g.symbol}
              </span>
              {g.label}
            </p>
            <p className="font-num text-body-sm tabular-nums text-foreground">{last ? formatGreek(g.key, last[g.key]) : "—"}</p>
          </div>
          <ChartFrame label={`${g.label} through the session, ${g.unit}`} height={120}>
            <LineChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              {xAxis(domain)}
              <YAxis {...axisProps} width={62} domain={["auto", "auto"]} tickFormatter={(v: number) => formatGreek(g.key, v)} />
              <Tooltip {...tooltipBase} cursor={tooltipCursor} formatter={(value: number) => [formatGreek(g.key, value), g.label]} />
              <Line type="monotone" dataKey={g.key} name={g.label} stroke={seriesColor(i)} strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ChartFrame>
          <p className="mt-1 text-body-sm text-muted-foreground">{g.unit}</p>
        </div>
      ))}
    </div>
  );
}

export function VolumeChart({ points }: { points: EnrichedPoint[] }) {
  const domain = useDomain(points);
  const data = useMemo(() => points.slice(1).map((p) => ({ ts: p.ts, dVol: p.dVol })), [points]);
  return (
    <ChartFrame label="Contracts traded between snapshots" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps} />
        {xAxis(domain)}
        <YAxis {...axisProps} width={48} tickFormatter={compactAxisTick} />
        <Tooltip {...tooltipBase} cursor={barCursor} formatter={(value: number) => [formatCompactIN(value), "Traded"]} />
        <Bar dataKey="dVol" name="Traded" fill={chartColors.product} fillOpacity={0.75} maxBarSize={10} isAnimationActive={false} />
      </BarChart>
    </ChartFrame>
  );
}
