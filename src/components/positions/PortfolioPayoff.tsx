/** Combined T+0 and expiry payoff for one underlying (open legs, live IVs). */
import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, chartColors, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { breakevens, formatCompactIN, formatDateIST, formatNumberIN, getDividendYield, payoffDateKey, payoffSeries, spotGrid, toISTDate } from "@/lib/options";
import type { TrackedPosition } from "@/lib/positionStore";
import { legsWithIv, type PositionLive } from "./analytics";
import { signedINR } from "./helpers";
import { EmptyState } from "./ui";

export function PortfolioPayoff({
  positions,
  live,
  spots,
  r,
  now,
}: {
  positions: TrackedPosition[];
  live: Record<string, PositionLive>;
  spots: Record<string, number>;
  r: number;
  now: Date;
}) {
  const symbols = useMemo(() => Array.from(new Set(positions.filter((p) => !live[p.id]?.expired && live[p.id]?.expiryIso).map((p) => p.symbol))).sort(), [positions, live]);
  const [picked, setPicked] = useState<string>("");
  const symbol = symbols.includes(picked) ? picked : symbols[0] ?? "";
  const spot = spots[symbol] ?? NaN;

  const model = useMemo(() => {
    if (!symbol || !(spot > 0)) return null;
    const list = positions.filter((p) => p.symbol === symbol && !live[p.id]?.expired);
    const legs = legsWithIv(list, live);
    if (!legs.length) return null;
    const expiries = Array.from(new Set(legs.map((l) => l.expiry))).sort();
    const nearest = expiries[0];
    const nearestAt = toISTDate(nearest, "15:30");
    const multiExpiry = expiries.length > 1;
    const grid = spotGrid(legs, spot, { pctRange: 0.08, points: 121 });
    const dates = multiExpiry ? [now, nearestAt] : [now];
    const series = payoffSeries(legs, grid, { dates, now, spot, r, q: getDividendYield(symbol) });
    const kNow = payoffDateKey(now);
    const kExp = payoffDateKey(nearestAt);
    const data = series.map((row) => ({
      spot: row.spot,
      t0: row[kNow],
      expiry: multiExpiry ? row[kExp] : row.expiry,
    }));
    return { data, nearest, multiExpiry, bes: multiExpiry ? [] : breakevens(legs) };
  }, [symbol, spot, positions, live, now, r]);

  if (symbols.length === 0) return <EmptyState title="No open legs with an expiry">Add positions with an expiry date to see the payoff.</EmptyState>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {symbols.length > 1 ? (
          <ToggleGroup type="single" value={symbol} onValueChange={(v) => v && setPicked(v)} aria-label="Underlying" size="sm" className="flex-wrap justify-start">
            {symbols.map((s) => (
              <ToggleGroupItem key={s} value={s} className="px-2.5 text-body-sm">
                {s}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <span className="font-semibold">{symbol}</span>
        )}
        <div className="flex flex-wrap items-center gap-3 text-body-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-primary" aria-hidden="true" /> T+0 (now)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-info" aria-hidden="true" /> {model?.multiExpiry ? `At ${formatDateIST(model.nearest)} (nearest expiry)` : "At expiry"}
          </span>
        </div>
      </div>
      {!model ? (
        <EmptyState title="Waiting for a spot price">The payoff needs a spot for {symbol}.</EmptyState>
      ) : (
        <div className="h-[300px] w-full" role="img" aria-label={`Payoff chart for ${symbol}: profit and loss against spot, now and at expiry`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={model.data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="spot" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => formatNumberIN(v)} {...axisProps} />
              <YAxis tickFormatter={(v: number) => formatCompactIN(v)} width={56} {...axisProps} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                labelFormatter={(v: number) => `Spot ${formatNumberIN(v, 2)}`}
                formatter={(v: number, name: string) => [signedINR(v), name === "t0" ? "T+0" : "Expiry"]}
              />
              <ReferenceLine y={0} stroke={chartColors.axis} />
              <ReferenceLine x={spot} stroke={chartColors.spot} strokeDasharray="4 3" label={{ value: "Spot", position: "top", fill: chartColors.axis, fontSize: 11 }} />
              {model.bes.map((b) => (
                <ReferenceLine key={b} x={b} stroke={chartColors.warning} strokeDasharray="2 3" />
              ))}
              <Area type="linear" dataKey="expiry" stroke={chartColors.info} fill={chartColors.info} fillOpacity={0.08} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="t0" stroke={chartColors.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {model && model.bes.length ? <p className="text-body-sm text-muted-foreground">Breakevens at expiry: {model.bes.map((b) => formatNumberIN(b, 0)).join(" · ")}</p> : null}
    </div>
  );
}
