import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EquityPoint } from "@/lib/backtest";
import { axisProps, chartColors, compactAxisTick, gridProps, tokenColor, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatDateIST, formatINR, formatPct } from "@/lib/options";
import { monthTick, signedINR } from "./format";

/** Month-start ticks so the axis reads Oct '25, Nov '25 … whatever the window. */
function monthTicks(points: EquityPoint[]): string[] {
  const out: string[] = [];
  let last = "";
  for (const p of points) {
    const m = p.date.slice(0, 7);
    if (m !== last) {
      out.push(p.date);
      last = m;
    }
  }
  const every = Math.max(1, Math.ceil(out.length / 7));
  return out.filter((_, i) => i % every === 0);
}

/** Cumulative net P&L (marked to market at each close) with the drawdown underneath. */
export function EquityChart({ points, capital, sample }: { points: EquityPoint[]; capital: number; sample: boolean }) {
  const ticks = useMemo(() => monthTicks(points), [points]);
  const last = points[points.length - 1];
  const up = (last?.pnl ?? 0) >= 0;
  const stroke = up ? chartColors.bullish : chartColors.bearish;
  const gradId = up ? "bt-eq-up" : "bt-eq-down";
  const summary = last
    ? `Equity curve from ${formatDateIST(points[0].date)} to ${formatDateIST(last.date)}: ${signedINR(last.pnl)} net, lowest drawdown ${formatPct(Math.min(...points.map((p) => p.drawdownPct)), { decimals: 1 })}.`
    : "No data";
  return (
    <figure className="space-y-1" aria-label={summary}>
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="h-[220px] w-full sm:h-[260px]" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} syncId="bt-equity">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} ticks={ticks} tickFormatter={monthTick} minTickGap={12} hide />
            <YAxis {...axisProps} width={52} tickFormatter={compactAxisTick} />
            <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.6)} strokeDasharray="4 4" />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={tooltipCursor}
              labelFormatter={(d: string) => `${formatDateIST(d)}${sample ? " · sample" : ""}`}
              formatter={(v: number, _n, item) => {
                const p = item?.payload as EquityPoint | undefined;
                return [`${signedINR(v)} · equity ${formatINR(p?.equity ?? capital + v, { decimals: 0 })}${p?.inTrade ? " · in trade" : ""}`, "Net P&L"];
              }}
            />
            <Area type="monotone" dataKey="pnl" stroke={stroke} strokeWidth={1.75} fill={`url(#${gradId})`} isAnimationActive={false} dot={false} activeDot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="h-[92px] w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} syncId="bt-equity">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} ticks={ticks} tickFormatter={monthTick} minTickGap={12} />
            <YAxis {...axisProps} width={52} tickFormatter={(v: number) => `${compactAxisTick(v)}%`} domain={["dataMin", 0]} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={tooltipCursor}
              labelFormatter={(d: string) => formatDateIST(d)}
              formatter={(v: number, _n, item) => {
                const p = item?.payload as EquityPoint | undefined;
                return [`${formatPct(v, { decimals: 1 })} (${formatINR(p?.drawdown ?? 0, { decimals: 0 })})`, "Drawdown"];
              }}
            />
            <Area type="monotone" dataKey="drawdownPct" stroke={chartColors.bearish} strokeWidth={1.25} fill={tokenColor("bearish", 0.16)} isAnimationActive={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
