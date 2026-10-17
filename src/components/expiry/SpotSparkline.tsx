/**
 * Compact spot line that sits under a premium chart on the same time axis (synced tooltips via
 * syncId), so spot gets its own scale instead of a second y-axis on the premium chart.
 */
import { useId, useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, chartColors, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatNumberIN, formatPct } from "@/lib/options";
import { cn } from "@/lib/utils";
import { hhmmIST, signTone } from "./expiryMath";

interface Props {
  data: Array<{ ts: number; spot: number }>;
  /** X domain shared with the chart above (epoch ms). */
  domain?: [number, number];
  syncId?: string;
  symbol?: string;
  /** Overrides the "<symbol> spot" caption. */
  label?: string;
  height?: number;
  className?: string;
  /** Tooltip label for an x value (default: hh:mm IST of an epoch-ms timestamp). */
  formatLabel?: (x: number) => string;
}

export function SpotSparkline({ data, domain, syncId, symbol, label: labelProp, height = 76, className, formatLabel }: Props) {
  const gid = `spot-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rows = useMemo(() => (data ?? []).filter((d) => Number.isFinite(d.spot) && d.spot > 0).map((d) => ({ ts: d.ts, spot: d.spot })), [data]);
  if (rows.length < 2) return null;
  const first = rows[0].spot;
  const last = rows[rows.length - 1].spot;
  const chg = last - first;
  const chgPct = first > 0 ? (chg / first) * 100 : NaN;
  const lo = Math.min(...rows.map((r) => r.spot));
  const hi = Math.max(...rows.map((r) => r.spot));
  const label = labelProp ?? (symbol ? `${symbol} spot` : "Spot");
  return (
    <figure className={cn("min-w-0", className)} aria-label={`${label} from ${formatNumberIN(first, 2)} to ${formatNumberIN(last, 2)}, range ${formatNumberIN(lo, 2)} to ${formatNumberIN(hi, 2)}`}>
      <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-2 text-body-sm text-muted-foreground">
        <span className="text-label uppercase">{label}</span>
        <span className="font-num tabular-nums text-foreground">{formatNumberIN(last, 2)}</span>
        <span className={cn("font-num tabular-nums", signTone(chg))}>
          {chg >= 0 ? "+" : "−"}
          {formatNumberIN(Math.abs(chg), 2)} ({Number.isFinite(chgPct) ? formatPct(chgPct, { decimals: 2, signed: true }) : "—"})
        </span>
        <span className="ml-auto font-num tabular-nums">
          L {formatNumberIN(lo, 0)} · H {formatNumberIN(hi, 0)}
        </span>
      </figcaption>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} syncId={syncId} margin={{ top: 2, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColors.c4} stopOpacity={0.28} />
                <stop offset="100%" stopColor={chartColors.c4} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="ts" type="number" scale={formatLabel ? "linear" : "time"} domain={domain ?? ["dataMin", "dataMax"]} hide />
            <YAxis {...axisProps} width={56} domain={["dataMin - 5", "dataMax + 5"]} tickCount={3} tickFormatter={(v: number) => formatNumberIN(v, 0)} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={tooltipCursor}
              labelFormatter={(v: number) => (formatLabel ? formatLabel(v) : `${hhmmIST(v)} IST`)}
              formatter={(value: number) => [formatNumberIN(value, 2), label]}
            />
            <Area type="linear" dataKey="spot" name={label} stroke={chartColors.c4} strokeWidth={1.25} fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
