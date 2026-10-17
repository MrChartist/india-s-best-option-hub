import { useId, useMemo, useState, type ReactNode, type RefObject } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { CalendarClock, LineChart as LineChartIcon, Percent, RotateCcw, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { axisProps, chartColors, gridProps, payoffFills, tooltipCursor, tooltipStyle, zeroCrossOffset } from "@/lib/chartTheme";
import {
  dteLabel,
  expectedMoveFromIV,
  formatCompactIN,
  formatINR,
  formatPct,
  formatStrike,
  forwardFromSpot,
  payoffDateKey,
  payoffSeries,
  strategyValueAt,
  type Leg,
} from "@/lib/options";
import { Segmented } from "./Segmented";
import { timeLabel, type TimePoint } from "./strategyState";

export interface PayoffChartProps {
  legs: Leg[];
  spot: number;
  now: Date;
  r: number;
  q: number;
  timeline: TimePoint[];
  targetIndex: number;
  onTargetIndex: (i: number) => void;
  /** Parallel IV shift in decimal vol points. */
  ivShift: number;
  onIvShift: (v: number) => void;
  /** Decimal ATM IV (front expiry). */
  atmIv: number;
  breakevens: number[];
  multiExpiry: boolean;
  frontAt: Date | null;
  frontExpiry: string;
  chartRef?: RefObject<HTMLDivElement>;
  badge?: ReactNode;
}

const ZOOMS = [
  { value: "0.03", label: "±3%" },
  { value: "0.06", label: "±6%" },
  { value: "0.1", label: "±10%" },
  { value: "0.2", label: "±20%" },
] as const;
type Zoom = (typeof ZOOMS)[number]["value"];

const YEAR_MS = 365 * 24 * 3600 * 1000;

/** Round tick positions (1, 2, 2.5, 5 × 10^n) between lo and hi. */
function niceTicks(lo: number, hi: number, target = 6): number[] {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

interface Row {
  spot: number;
  target: number;
  expiry: number;
}

export function PayoffChart(props: PayoffChartProps) {
  const { legs, spot, now, r, q, timeline, targetIndex, onTargetIndex, ivShift, onIvShift, atmIv, breakevens, multiExpiry, frontAt, frontExpiry, chartRef, badge } = props;
  const [zoom, setZoom] = useState<Zoom>("0.06");
  const uid = useId().replace(/:/g, "");
  const idx = Math.max(0, Math.min(targetIndex, timeline.length - 1));
  const target = timeline[idx] ?? { at: now, label: "Now", final: false };
  const targetAt = target.at;

  const data = useMemo<Row[]>(() => {
    if (legs.length === 0 || !(spot > 0)) return [];
    const pct = Number(zoom);
    const lo = spot * (1 - pct);
    const hi = spot * (1 + pct);
    const grid: number[] = [];
    const n = 200;
    for (let i = 0; i <= n; i++) grid.push(Math.round((lo + ((hi - lo) * i) / n) * 100) / 100);
    for (const k of [spot, ...breakevens, ...legs.filter((l) => l.type !== "FUT").map((l) => l.strike)]) if (k >= lo && k <= hi) grid.push(Math.round(k * 100) / 100);
    const sortedGrid = Array.from(new Set(grid)).sort((a, b) => a - b);
    const dates = multiExpiry && frontAt ? [targetAt, frontAt] : [targetAt];
    const rows = payoffSeries(legs, sortedGrid, { dates, ivShift, now, spot, r, q });
    const tKey = payoffDateKey(targetAt);
    const eKey = multiExpiry && frontAt ? payoffDateKey(frontAt) : "expiry";
    return rows.map((row) => ({ spot: row.spot, target: Math.round(row[tKey] ?? NaN), expiry: Math.round(row[eKey] ?? NaN) }));
  }, [legs, spot, zoom, breakevens, multiExpiry, frontAt, targetAt, ivShift, now, r, q]);

  const offset = useMemo(() => zeroCrossOffset(data.map((d) => d.target)), [data]);
  const spotPnl = useMemo(() => (legs.length ? strategyValueAt(legs, spot, { now, atDate: targetAt, ivShift, r, q, spot }) : NaN), [legs, spot, now, targetAt, ivShift, r, q]);

  const bands = useMemo(() => {
    const frontT = frontAt ? Math.max((frontAt.getTime() - now.getTime()) / YEAR_MS, 0) : 0;
    let Tt = Math.max((targetAt.getTime() - now.getTime()) / YEAR_MS, 0);
    if (Tt < 1 / (365 * 24)) Tt = frontT;
    const sigma = Math.max(atmIv + ivShift, 0.01);
    const F = forwardFromSpot(spot, Tt, r, q);
    return { one: expectedMoveFromIV(F, sigma, Tt, 1), two: expectedMoveFromIV(F, sigma, Tt, 2), T: Tt };
  }, [frontAt, now, targetAt, atmIv, ivShift, spot, r, q]);

  const xMin = data[0]?.spot ?? 0;
  const xMax = data[data.length - 1]?.spot ?? 0;
  const clamp = (v: number) => Math.min(Math.max(v, xMin), xMax);
  const crushTo = -Math.min(0.1, Math.max(0.02, Math.round(atmIv * 0.3 * 200) / 200));
  const flat = data.length > 0 && data.every((d) => d.target === data[0].target);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <LineChartIcon className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Payoff
            {badge}
          </CardTitle>
          <Segmented ariaLabel="Spot zoom" value={zoom} options={ZOOMS} onChange={setZoom} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label htmlFor={`${uid}-date`} className="flex items-center gap-1 font-medium">
                <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Target date
              </label>
              <span className="truncate font-num text-muted-foreground" aria-live="polite">
                {idx === 0 ? "Now" : target.label === "At expiry" ? "At expiry" : timeLabel(targetAt)}
              </span>
            </div>
            <Slider
              id={`${uid}-date`}
              value={[idx]}
              min={0}
              max={Math.max(timeline.length - 1, 0)}
              step={1}
              onValueChange={([v]) => onTargetIndex(v)}
              aria-label="Target date"
              aria-valuetext={target.label}
              disabled={timeline.length < 2}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Now</span>
              <span>{frontExpiry ? `${dteLabel(frontExpiry, now)} to expiry` : ""}</span>
              <span>Expiry</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label htmlFor={`${uid}-iv`} className="flex items-center gap-1 font-medium">
                <Percent className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> IV shift
              </label>
              <div className="flex items-center gap-1">
                <span className={`font-num ${ivShift > 0 ? "text-info" : ivShift < 0 ? "text-warning" : "text-muted-foreground"}`}>
                  {ivShift >= 0 ? "+" : "−"}
                  {Math.abs(ivShift * 100).toFixed(1)} pts · IV {((atmIv + ivShift) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
            <Slider id={`${uid}-iv`} value={[ivShift * 100]} min={-10} max={10} step={0.5} onValueChange={([v]) => onIvShift(v / 100)} aria-label="IV shift in vol points" />
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-muted-foreground">−10</span>
              <div className="flex gap-1">
                <Button type="button" variant="outline" size="pill" className="h-6 text-[11px]" onClick={() => onIvShift(crushTo)} title="Typical post-event drop of about 30% of ATM IV">
                  <Zap /> IV crush
                </Button>
                <Button type="button" variant="ghost" size="pill" className="h-6 text-[11px]" onClick={() => onIvShift(0)} disabled={ivShift === 0}>
                  <RotateCcw /> Reset
                </Button>
              </div>
              <span className="text-[10px] text-muted-foreground">+10</span>
            </div>
          </div>
        </div>

        <div ref={chartRef} className="h-[300px] sm:h-[360px]" role="img" aria-label={`Payoff chart. P&L at the current spot on the target date is ${formatINR(spotPnl, { decimals: 0 })}.`}>
          {data.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-tile border border-dashed border-border text-sm text-muted-foreground">Add legs to see the payoff.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 18, right: 12, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset={0} stopColor={payoffFills.profitStroke} stopOpacity={0.28} />
                    <stop offset={offset} stopColor={payoffFills.profitStroke} stopOpacity={0.06} />
                    <stop offset={offset} stopColor={payoffFills.lossStroke} stopOpacity={0.06} />
                    <stop offset={1} stopColor={payoffFills.lossStroke} stopOpacity={0.28} />
                  </linearGradient>
                  <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset={offset} stopColor={payoffFills.profitStroke} />
                    <stop offset={offset} stopColor={payoffFills.lossStroke} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                {Number.isFinite(bands.two.lower) && bands.T > 0 && (
                  <ReferenceArea x1={clamp(bands.two.lower)} x2={clamp(bands.two.upper)} fill={payoffFills.expectedMoveBand} fillOpacity={1} ifOverflow="hidden" />
                )}
                {Number.isFinite(bands.one.lower) && bands.T > 0 && (
                  <ReferenceArea
                    x1={clamp(bands.one.lower)}
                    x2={clamp(bands.one.upper)}
                    fill={payoffFills.expectedMoveBand}
                    fillOpacity={1}
                    ifOverflow="hidden"
                    label={{ value: "1σ", position: "insideTopLeft", fill: chartColors.info, fontSize: 10 }}
                  />
                )}
                <XAxis
                  {...axisProps}
                  dataKey="spot"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v: number) => formatStrike(Math.round(v))}
                  ticks={niceTicks(xMin, xMax)}
                />
                <YAxis {...axisProps} width={58} tickFormatter={(v: number) => formatCompactIN(v, { decimals: 1 })} />
                <Tooltip content={<PayoffTooltip spot={spot} multiExpiry={multiExpiry} />} cursor={tooltipCursor} />
                <ReferenceLine y={0} stroke={payoffFills.zeroLine} strokeWidth={1} />
                <ReferenceLine
                  x={spot}
                  stroke={payoffFills.spotLine}
                  strokeDasharray="4 4"
                  label={{ value: `Spot ${formatStrike(Math.round(spot))}`, position: "top", fill: chartColors.primary, fontSize: 10 }}
                />
                {breakevens.filter((b) => b >= xMin && b <= xMax).map((b) => (
                  <ReferenceLine key={b} x={b} stroke={payoffFills.breakeven} strokeDasharray="3 3" label={{ value: `BE ${formatStrike(Math.round(b))}`, position: "insideBottomRight", fill: chartColors.warning, fontSize: 9 }} />
                ))}
                <Line type="linear" dataKey="expiry" stroke={payoffFills.expiryLine} strokeOpacity={0.55} strokeWidth={1.25} strokeDasharray="5 4" dot={false} isAnimationActive={false} name={multiExpiry ? "Front expiry" : "At expiry"} />
                <Area
                  type="monotone"
                  dataKey="target"
                  baseValue={0}
                  stroke={flat ? (data[0]?.target >= 0 ? payoffFills.profitStroke : payoffFills.lossStroke) : `url(#${uid}-stroke)`}
                  strokeWidth={2.25}
                  fill={`url(#${uid}-fill)`}
                  dot={false}
                  activeDot={{ r: 4, stroke: chartColors.card, strokeWidth: 2 }}
                  isAnimationActive={false}
                  name="Target date"
                />
                {Number.isFinite(spotPnl) && (
                  <ReferenceDot x={spot} y={Math.round(spotPnl)} r={5} fill={spotPnl >= 0 ? chartColors.bullish : chartColors.bearish} stroke={chartColors.card} strokeWidth={2} ifOverflow="extendDomain" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <LegendSwatch className="bg-bullish" label={idx === 0 ? "Today (T+0)" : "Target date"} />
          <LegendSwatch dashed label={multiExpiry ? "Front expiry (later legs at model value)" : "At expiry"} />
          <LegendSwatch className="bg-info/25" label={`1σ / 2σ expected move${bands.T > 0 ? ` (±${formatPct(bands.one.pct, { decimals: 1 })})` : ""}`} />
          <LegendSwatch className="bg-warning" label="Breakeven" />
          <span className="ml-auto font-num">
            P&L at spot: <span className={spotPnl >= 0 ? "text-bullish" : "text-bearish"}>{formatINR(spotPnl, { decimals: 0 })}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function LegendSwatch({ className, label, dashed }: { className?: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {dashed ? <span className="inline-block h-0 w-4 border-t border-dashed border-foreground/60" /> : <span className={`inline-block h-2 w-3 rounded-[2px] ${className ?? ""}`} />}
      {label}
    </span>
  );
}

function PayoffTooltip({ active, payload, spot, multiExpiry }: TooltipProps<number, string> & { spot: number; multiExpiry: boolean }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row) return null;
  const pct = spot > 0 ? ((row.spot - spot) / spot) * 100 : NaN;
  return (
    <div style={tooltipStyle} className="min-w-[170px]">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="font-num font-semibold">{formatStrike(Math.round(row.spot))}</span>
        <span className="font-num text-[11px] text-muted-foreground">{formatPct(pct, { decimals: 2, signed: true })}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground">Target date</span>
        <span className={`font-num font-semibold ${row.target >= 0 ? "text-bullish" : "text-bearish"}`}>{formatINR(row.target, { decimals: 0 })}</span>
      </div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{multiExpiry ? "Front expiry" : "At expiry"}</span>
        <span className={`font-num ${row.expiry >= 0 ? "text-bullish" : "text-bearish"}`}>{formatINR(row.expiry, { decimals: 0 })}</span>
      </div>
    </div>
  );
}
