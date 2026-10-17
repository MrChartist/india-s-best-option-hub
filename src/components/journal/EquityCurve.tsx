/** Cumulative gross vs net P&L by trade: the widening gap is what charges cost. */
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, chartColors, compactAxisTick, gridProps, tokenColor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatDateIST } from "@/lib/options";
import { signedINR } from "@/components/positions/helpers";

export function EquityCurve({ data }: { data: Array<{ i: number; date: string; cum: number; grossCum: number }> }) {
  if (data.length < 2) return <p className="py-8 text-center text-body-sm text-muted-foreground">At least two closed trades are needed for a curve.</p>;
  const last = data[data.length - 1];
  return (
    <figure className="space-y-2">
      <div className="h-[240px] w-full" role="img" aria-label={`Cumulative P&L over ${data.length} trades: gross ${signedINR(last.grossCum)}, net ${signedINR(last.cum)} after charges.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="i" {...axisProps} tickFormatter={(v: number) => `#${v}`} minTickGap={24} />
            <YAxis {...axisProps} width={56} tickFormatter={compactAxisTick} />
            <ReferenceLine y={0} stroke={chartColors.axis} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              labelFormatter={(_, payload) => {
                const d = payload?.[0]?.payload as { i: number; date: string } | undefined;
                return d ? `Trade #${d.i} · closed ${formatDateIST(d.date)}` : "";
              }}
              formatter={(v: number, name: string) => [signedINR(v), name === "grossCum" ? "Gross (before charges)" : "Net (after charges)"]}
            />
            <Area type="monotone" dataKey="grossCum" stroke={chartColors.muted} strokeDasharray="4 3" strokeWidth={1.5} fill={tokenColor("muted-foreground", 0.08)} isAnimationActive={false} />
            <Line type="monotone" dataKey="cum" stroke={chartColors.primary} strokeWidth={2.25} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-primary" aria-hidden="true" /> Net after charges
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden="true" /> Gross before charges
        </span>
        <span>The shaded gap is what brokerage, STT, exchange fees, stamp duty and GST cost you.</span>
      </figcaption>
    </figure>
  );
}
