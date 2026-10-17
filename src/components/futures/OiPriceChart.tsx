import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  axisProps,
  barCursor,
  chartColors,
  gridProps,
  tooltipCursor,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "@/lib/chartTheme";
import { formatDateIST } from "@/lib/options";
import type { OiPricePoint } from "@/lib/futures/model";
import { fmtOi, fmtPrice, shortDate } from "./format";

const SERIES = [
  { key: "near", label: "Near", color: chartColors.c1 },
  { key: "next", label: "Next", color: chartColors.c2 },
  { key: "far", label: "Far", color: chartColors.c3 },
] as const;

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-body-sm text-muted-foreground">
      {SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label} OI
        </span>
      ))}
    </div>
  );
}

/**
 * Futures OI by series (stacked bars) above the near-month price (line), on a shared date axis.
 * Two aligned panels instead of one dual-axis chart, so neither scale distorts the other.
 */
export function OiPriceChart({ points }: { points: OiPricePoint[] }) {
  const data = points.map((p) => ({ ...p, label: shortDate(p.date) }));
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label uppercase text-muted-foreground">Futures OI by series (contracts)</p>
        <Legend />
      </div>
      <div
        className="h-[170px]"
        role="img"
        aria-label={`Futures open interest over ${points.length} sessions, from ${fmtOi(first?.total)} on ${first ? formatDateIST(first.date) : ""} to ${fmtOi(last?.total)} on ${last ? formatDateIST(last.date) : ""}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            syncId="fut-oi-price"
            barCategoryGap="18%"
          >
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} hide />
            <YAxis {...axisProps} width={56} tickFormatter={(v: number) => fmtOi(v)} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={barCursor}
              formatter={(v: number, name: string) => [
                fmtOi(v),
                `${SERIES.find((s) => s.key === name)?.label ?? name} OI`,
              ]}
            />
            {SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="oi"
                fill={s.color}
                stroke={chartColors.card}
                strokeWidth={1}
                radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-label uppercase text-muted-foreground">Near-month futures price</p>
      <div
        className="h-[150px]"
        role="img"
        aria-label={`Near-month futures price from ${fmtPrice(first?.price)} to ${fmtPrice(last?.price)}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} syncId="fut-oi-price">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={18} />
            <YAxis
              {...axisProps}
              width={56}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => fmtPrice(v).replace(/\.00$/, "")}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={tooltipCursor}
              formatter={(v: number, name: string) => [fmtPrice(v), name === "price" ? "Near future" : "Spot"]}
            />
            <Line
              type="monotone"
              dataKey="underlying"
              stroke={chartColors.muted}
              strokeDasharray="4 3"
              strokeWidth={1.25}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke={chartColors.foreground}
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-body-sm text-muted-foreground">
        Solid line: near future · dashed: spot. Rising OI with a rising price is long buildup; rising OI with a falling
        price is short buildup.
      </p>
    </div>
  );
}
