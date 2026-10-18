import { useId, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  axisProps,
  chartColors,
  compactAxisTick,
  gridProps,
  tokenColor,
  tooltipCursor,
  tooltipLabelStyle,
  tooltipStyle,
  zeroCrossOffset,
} from "@/lib/chartTheme";
import { priceTicks } from "@/lib/gex";
import type { GammaLevels, GexConvention, GexProfilePoint } from "@/lib/gexData";
import { cn } from "@/lib/utils";
import { fmtCr, fmtLevel } from "./format";

interface Props {
  profile: GexProfilePoint[];
  spot: number;
  levels: GammaLevels | null;
  /** Flip from the dealer model, drawn when the seller view (which has no flip) is active. */
  dealerFlip?: number | null;
  convention: GexConvention;
  loading?: boolean;
  title?: string;
  /** Underlying, for round price ticks (250 for NIFTY, 500 for BANKNIFTY). */
  symbol?: string;
  className?: string;
}

interface LegendItem {
  key: string;
  label: string;
  value: number | null | undefined;
  color: string;
  dash?: string;
}

/** Total GEX recomputed over a hypothetical spot grid. Above zero = damped, below = amplified. */
export function GexProfileChart({
  profile,
  spot,
  levels,
  dealerFlip,
  convention,
  loading,
  title = "GEX profile",
  symbol,
  className,
}: Props) {
  const gradId = useId().replace(/:/g, "");
  const values = useMemo(() => profile.map((p) => p.totalGex), [profile]);
  const offset = zeroCrossOffset(values);
  const flip = levels?.flip ?? null;
  const shownFlip = flip ?? (convention === "sellerShortBoth" ? (dealerFlip ?? null) : null);
  const flipIsDealer = flip === null && shownFlip !== null;
  const lo = profile[0]?.spot ?? 0;
  const hi = profile[profile.length - 1]?.spot ?? 0;
  const inRange = (v: number | null | undefined): v is number =>
    v !== null && v !== undefined && Number.isFinite(v) && v >= lo && v <= hi;
  const seller = convention === "sellerShortBoth";
  const hasPositive = !seller && values.some((v) => v > 0);
  const hasNegative = !seller && values.some((v) => v < 0);
  const xTicks = useMemo(() => priceTicks(symbol, lo, hi, 11), [symbol, lo, hi]);

  const legend: LegendItem[] = [
    { key: "spot", label: "Spot", value: spot, color: chartColors.spot },
    {
      key: "flip",
      label: flipIsDealer ? "Flip (dealer model)" : "Gamma flip",
      value: shownFlip,
      color: chartColors.warning,
      dash: "4 3",
    },
    { key: "cw", label: "Call wall", value: levels?.callWall, color: chartColors.call, dash: "2 3" },
    { key: "pw", label: "Put wall", value: levels?.putWall, color: chartColors.put, dash: "2 3" },
  ];

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-lead">
            <Activity className="h-4 w-4 text-primary-ink" aria-hidden />
            {title}
          </CardTitle>
          <p className="mt-0.5 text-body-sm text-muted-foreground">
            Total GEX if spot moved ±5%, IV per strike held fixed.{" "}
            {seller
              ? "Seller view: writers are short gamma at every level, so the curve stays below zero."
              : "Above zero hedging damps moves; below zero it amplifies them."}
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-body-sm" aria-label="Chart markers">
          {legend.map((l) => (
            <li key={l.key} className="flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden>
                <line x1="0" y1="3" x2="16" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} />
              </svg>
              <span className="text-muted-foreground">{l.label}</span>
              <span className="font-num font-semibold">{fmtLevel(l.value)}</span>
            </li>
          ))}
        </ul>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col pt-0">
        {loading ? (
          <Skeleton className="min-h-[320px] w-full flex-1 rounded-tile" />
        ) : profile.length < 2 ? (
          <div className="flex min-h-[320px] flex-1 items-center justify-center rounded-tile bg-muted/40 text-body text-muted-foreground">
            No open interest to build a profile.
          </div>
        ) : (
          <>
            <p className="mb-1 text-micro text-muted-foreground" aria-hidden>
              ₹ Cr per 1% move
            </p>
            <div
              className="relative min-h-[320px] w-full flex-1"
              role="img"
              aria-label={`GEX profile from ${fmtLevel(lo)} to ${fmtLevel(hi)}. ${shownFlip !== null ? `Flip at ${fmtLevel(shownFlip)}.` : "No flip in range."}`}
            >
              {hasPositive && (
                <span className="pointer-events-none absolute left-14 top-2 z-10 rounded-chip bg-wash-profit px-1.5 py-0.5 text-micro text-bullish">
                  Volatility damped
                </span>
              )}
              {hasNegative && (
                <span className="pointer-events-none absolute bottom-9 left-14 z-10 rounded-chip bg-wash-loss px-1.5 py-0.5 text-micro text-bearish">
                  Volatility amplified
                </span>
              )}
              {seller && values.length > 0 && (
                <span className="pointer-events-none absolute bottom-9 left-14 z-10 rounded-chip bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
                  Writers short gamma
                </span>
              )}
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={profile} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`gexFill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset={0} stopColor={chartColors.bullish} stopOpacity={0.32} />
                        <stop offset={offset} stopColor={chartColors.bullish} stopOpacity={0.06} />
                        <stop offset={offset} stopColor={chartColors.bearish} stopOpacity={0.06} />
                        <stop offset={1} stopColor={chartColors.bearish} stopOpacity={0.32} />
                      </linearGradient>
                      <linearGradient id={`gexStroke-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset={offset} stopColor={chartColors.bullish} />
                        <stop offset={offset} stopColor={chartColors.bearish} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis
                      {...axisProps}
                      dataKey="spot"
                      type="number"
                      domain={[lo, hi]}
                      tickFormatter={(v: number) => Math.round(v).toLocaleString("en-IN")}
                      ticks={xTicks.length >= 2 ? xTicks : undefined}
                      interval="preserveStartEnd"
                      minTickGap={8}
                    />
                    <YAxis {...axisProps} width={48} tickFormatter={compactAxisTick} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={tooltipLabelStyle}
                      cursor={tooltipCursor}
                      labelFormatter={(v: number) => `Spot ${Math.round(v).toLocaleString("en-IN")}`}
                      formatter={(v: number) => [fmtCr(v, { signed: true }), "Total GEX"]}
                    />
                    <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.6)} />
                    {inRange(levels?.putWall) && (
                      <ReferenceLine x={levels?.putWall} stroke={chartColors.put} strokeDasharray="2 3" />
                    )}
                    {inRange(levels?.callWall) && (
                      <ReferenceLine x={levels?.callWall} stroke={chartColors.call} strokeDasharray="2 3" />
                    )}
                    {inRange(shownFlip) && (
                      <ReferenceLine
                        x={shownFlip}
                        stroke={chartColors.warning}
                        strokeDasharray="4 3"
                        strokeWidth={1.5}
                      />
                    )}
                    <ReferenceLine x={spot} stroke={chartColors.spot} strokeWidth={1.5} />
                    <Area
                      type="monotone"
                      dataKey="totalGex"
                      stroke={`url(#gexStroke-${gradId})`}
                      strokeWidth={2}
                      fill={`url(#gexFill-${gradId})`}
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
