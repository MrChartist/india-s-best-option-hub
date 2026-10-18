import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/strategy/Segmented";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import MetricHelp from "@/components/learn/MetricHelp";
import {
  axisProps,
  barCursor,
  chartColors,
  compactAxisTick,
  gridProps,
  signedColor,
  tooltipLabelStyle,
  tooltipStyle,
} from "@/lib/chartTheme";
import { strikeAxisTicks } from "@/lib/gex";
import type { GammaLevels, GexTotals, StrikeExposure } from "@/lib/gexData";
import type { VixSnapshot } from "@/lib/marketApi";
import { cn } from "@/lib/utils";
import { fmtCr } from "./format";

export type ExposureMetric = "gex" | "dex" | "vex" | "cex";

const METRICS: Record<ExposureMetric, { label: string; name: string; unit: string; help: string }> = {
  gex: {
    label: "GEX",
    name: "Gamma exposure",
    unit: "₹ Cr per 1% move",
    help: "Futures hedging needed per 1% index move, split by calls and puts.",
  },
  dex: {
    label: "DEX",
    name: "Delta exposure",
    unit: "₹ Cr delta-notional",
    help: "Delta-notional held at each strike.",
  },
  vex: {
    label: "VEX",
    name: "Vanna exposure",
    unit: "₹ Cr per 1 vol point",
    help: "Change in hedge delta for a 1-point change in implied volatility.",
  },
  cex: {
    label: "CEX",
    name: "Charm exposure",
    unit: "₹ Cr per day",
    help: "Drift in hedge delta per calendar day from time decay alone.",
  },
};

type Window = "10" | "20" | "all";

interface Props {
  rows: StrikeExposure[];
  spot: number;
  levels: GammaLevels | null;
  totals: GexTotals | null;
  vix: VixSnapshot | null;
  loading?: boolean;
  /** Underlying, for round strike ticks (250 for NIFTY, 500 for BANKNIFTY). */
  symbol?: string;
  className?: string;
}

function nearestStrike(strikes: number[], x: number): number | undefined {
  let best: number | undefined;
  for (const k of strikes) if (best === undefined || Math.abs(k - x) < Math.abs(best - x)) best = k;
  return best;
}

/** GEX / DEX / VEX / CEX by strike with a strike window around spot. */
export function ExposureBars({ rows, spot, levels, totals, vix, loading, symbol, className }: Props) {
  const [metric, setMetric] = useState<ExposureMetric>("gex");
  const [win, setWin] = useState<Window>("20");

  const data = useMemo(() => {
    if (win === "all" || rows.length === 0) return rows;
    const n = Number(win);
    const atmIdx = rows.reduce(
      (bi, r, i) => (Math.abs(r.strike - spot) < Math.abs(rows[bi].strike - spot) ? i : bi),
      0,
    );
    return rows.slice(Math.max(0, atmIdx - n), atmIdx + n + 1);
  }, [rows, spot, win]);

  const strikes = useMemo(() => data.map((r) => r.strike), [data]);
  const spotStrike = nearestStrike(strikes, spot);
  const meta = METRICS[metric];
  const total = totals ? totals[metric === "gex" ? "netGex" : metric] : NaN;
  const vixChange = vix && Number.isFinite(vix.change) ? vix.change : null;

  const impact = useMemo(() => {
    if (!totals) return null;
    if (metric === "vex" && vixChange !== null) {
      return {
        text: `India VIX ${vixChange >= 0 ? "+" : "−"}${Math.abs(vixChange).toFixed(2)} pts today → about ${fmtCr(totals.vex * vixChange, { signed: true })} change in hedge delta (net VEX × ΔVIX, VIX used as a proxy for chain IV).`,
        value: totals.vex * vixChange,
      };
    }
    if (metric === "cex") {
      return {
        text: `Time decay alone shifts hedge delta by about ${fmtCr(totals.cex, { signed: true })} per day.`,
        value: totals.cex,
      };
    }
    return null;
  }, [metric, totals, vixChange]);

  const xTick = (v: number) => v.toLocaleString("en-IN");
  const xTicks = useMemo(() => strikeAxisTicks(symbol, strikes, 11), [symbol, strikes]);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lead">
              <BarChart3 className="h-4 w-4 text-primary-ink" aria-hidden />
              Exposure by strike
            </CardTitle>
            <p className="mt-0.5 text-body-sm text-muted-foreground">
              {meta.name} · {meta.unit}. {meta.help}
            </p>
          </div>
          <div className="text-right">
            <p className="flex items-center justify-end gap-1 text-label text-muted-foreground">
              Net {meta.label}
              {metric === "gex" ? <MetricHelp metric="gex" value={Number.isFinite(total) ? total : undefined} /> : null}
            </p>
            <p className={`font-num text-title ${total > 0 ? "text-bullish" : total < 0 ? "text-bearish" : ""}`}>
              {fmtCr(total, { signed: true })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="Exposure metric"
              value={metric}
              onChange={(v) => setMetric(v)}
              options={(Object.keys(METRICS) as ExposureMetric[]).map((m) => ({
                value: m,
                label: METRICS[m].label,
                title: METRICS[m].name,
              }))}
            />
            <Badge
              variant={
                vixChange === null ? "neutral" : vixChange > 0 ? "bearish" : vixChange < 0 ? "bullish" : "neutral"
              }
              className="h-6 normal-case"
              aria-label={
                vix ? `India VIX ${vix.value.toFixed(2)}, change ${vix.change.toFixed(2)}` : "India VIX unavailable"
              }
            >
              {vixChange !== null && vixChange > 0 ? (
                <TrendingUp aria-hidden />
              ) : vixChange !== null && vixChange < 0 ? (
                <TrendingDown aria-hidden />
              ) : null}
              <span>India VIX</span>
              <span className="font-num">
                {vix
                  ? `${vix.value.toFixed(2)} (${vix.change >= 0 ? "+" : "−"}${Math.abs(vix.change).toFixed(2)})`
                  : "—"}
              </span>
            </Badge>
          </div>
          <ToggleGroup
            type="single"
            value={win}
            onValueChange={(v) => v && setWin(v as Window)}
            aria-label="Strike window"
          >
            {(["10", "20", "all"] as Window[]).map((w) => (
              <ToggleGroupItem
                key={w}
                value={w}
                aria-label={w === "all" ? "All strikes" : `${w} strikes either side of spot`}
              >
                {w === "all" ? "All" : `±${w}`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col pt-0">
        {loading ? (
          <Skeleton className="min-h-[320px] w-full flex-1 rounded-tile" />
        ) : data.length === 0 ? (
          <div className="flex min-h-[320px] flex-1 items-center justify-center rounded-tile bg-muted/40 text-body text-muted-foreground">
            No strikes with open interest.
          </div>
        ) : (
          <>
            <p className="mb-1 text-micro text-muted-foreground" aria-hidden>
              {meta.unit}
            </p>
            <div
              className="relative min-h-[320px] w-full flex-1"
              role="img"
              aria-label={`${meta.name} by strike, net ${fmtCr(total)}`}
            >
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  {metric === "gex" ? (
                    <ComposedChart
                      data={data}
                      margin={{ top: SPOT_PILL_SPACE, right: 8, bottom: 0, left: 0 }}
                      stackOffset="sign"
                    >
                      <CartesianGrid {...gridProps} />
                      <XAxis
                        {...axisProps}
                        dataKey="strike"
                        tickFormatter={xTick}
                        ticks={xTicks}
                        interval="preserveStartEnd"
                        minTickGap={8}
                      />
                      <YAxis {...axisProps} width={48} tickFormatter={compactAxisTick} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        cursor={barCursor}
                        labelFormatter={(v: number) => `Strike ${v.toLocaleString("en-IN")}`}
                        formatter={(v: number, name: string) => [fmtCr(v, { signed: true }), name]}
                      />
                      <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.5} />
                      {spotStrike !== undefined && (
                        <ReferenceLine
                          x={spotStrike}
                          stroke={chartColors.spot}
                          strokeDasharray="4 4"
                          label={<SpotPill />}
                        />
                      )}
                      {levels && strikes.includes(levels.callWall) && (
                        <ReferenceLine x={levels.callWall} stroke={chartColors.call} strokeDasharray="2 3" />
                      )}
                      {levels && strikes.includes(levels.putWall) && (
                        <ReferenceLine x={levels.putWall} stroke={chartColors.put} strokeDasharray="2 3" />
                      )}
                      <Bar
                        dataKey="callGex"
                        name="Call GEX"
                        stackId="g"
                        fill={chartColors.call}
                        fillOpacity={0.8}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="putGex"
                        name="Put GEX"
                        stackId="g"
                        fill={chartColors.put}
                        fillOpacity={0.8}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="netGex"
                        name="Net GEX"
                        type="monotone"
                        stroke={chartColors.foreground}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  ) : (
                    <BarChart data={data} margin={{ top: SPOT_PILL_SPACE, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis
                        {...axisProps}
                        dataKey="strike"
                        tickFormatter={xTick}
                        ticks={xTicks}
                        interval="preserveStartEnd"
                        minTickGap={8}
                      />
                      <YAxis {...axisProps} width={48} tickFormatter={compactAxisTick} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        cursor={barCursor}
                        labelFormatter={(v: number) => `Strike ${v.toLocaleString("en-IN")}`}
                        formatter={(v: number) => [fmtCr(v, { signed: true }), meta.label]}
                      />
                      <ReferenceLine y={0} stroke={chartColors.axis} strokeOpacity={0.5} />
                      {spotStrike !== undefined && (
                        <ReferenceLine
                          x={spotStrike}
                          stroke={chartColors.spot}
                          strokeDasharray="4 4"
                          label={<SpotPill />}
                        />
                      )}
                      <Bar dataKey={metric} name={meta.label} isAnimationActive={false} radius={[2, 2, 0, 0]}>
                        {data.map((r) => (
                          <Cell key={r.strike} fill={signedColor(r[metric])} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
        {metric === "gex" && !loading && data.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-chart-call" aria-hidden />
              Call GEX
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-chart-put" aria-hidden />
              Put GEX
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-foreground" aria-hidden />
              Net GEX
            </span>
          </div>
        )}
        {impact && !loading && (
          <p className="mt-2 rounded-tile bg-muted px-3 py-2 text-body-sm text-muted-foreground" role="note">
            {impact.text}
          </p>
        )}
        {metric === "vex" && vixChange === null && !loading && (
          <p className="mt-2 text-body-sm text-muted-foreground">India VIX change unavailable right now.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Space above the plot area that holds the spot label, clear of the bars. */
const SPOT_PILL_SPACE = 22;

/**
 * "Spot" label for the reference line, drawn above the plot area on a card-coloured pill so it
 * never sits on top of the (same-hue) call bars.
 */
function SpotPill({ viewBox }: { viewBox?: { x?: number; y?: number } }) {
  const x = viewBox?.x;
  const y = viewBox?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;
  const w = 34;
  const h = 16;
  return (
    <g pointerEvents="none">
      <rect
        x={x - w / 2}
        y={y - h - 3}
        width={w}
        height={h}
        rx={4}
        fill={chartColors.card}
        stroke={chartColors.spot}
        strokeWidth={1}
      />
      <text
        x={x}
        y={y - 3 - h / 2}
        dy="0.35em"
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill={chartColors.spot}
      >
        Spot
      </text>
    </g>
  );
}
