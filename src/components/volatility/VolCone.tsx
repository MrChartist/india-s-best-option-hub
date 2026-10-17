import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Cone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { axisProps, chartColors, gridProps, tokenColor, tooltipCursor, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { volCone, type OHLC } from "@/lib/options";
import type { TermPoint } from "@/lib/volatility/surface";
import { DerivedBadge, EmptyState, HelpTip, LegendChip, PanelHeader, SampleBadge } from "./VolUi";
import { fmtVol } from "@/lib/volatility/format";

const CONE_WINDOWS = [5, 10, 20, 30, 60, 90];

export interface VolConeProps {
  symbol: string;
  bars: OHLC[] | undefined;
  barsLoading: boolean;
  term: TermPoint[];
  isSample: boolean;
}

const pct = (x: number) => Math.round(x * 10000) / 100;

export function VolCone({ symbol, bars, barsLoading, term, isSample }: VolConeProps) {
  const cone = useMemo(() => {
    const closes = (bars ?? []).map((b) => b.c);
    return volCone(closes, CONE_WINDOWS).map((c) => ({
      window: c.window,
      min: pct(c.min),
      p25: pct(c.p25),
      median: pct(c.median),
      p75: pct(c.p75),
      max: pct(c.max),
      current: pct(c.current),
      band: [pct(c.min), pct(c.max)] as [number, number],
      iqr: [pct(c.p25), pct(c.p75)] as [number, number],
    }));
  }, [bars]);

  // Plot each expiry's ATM IV at its trading-day horizon so IV and realised vol share an axis.
  const ivPts = useMemo(() => term.filter((t) => t.tradingDte >= 1 && t.tradingDte <= 95).map((t) => ({ window: t.tradingDte, iv: t.atmIv, expiry: t.expiry })), [term]);
  const years = bars && bars.length > 1 ? (bars[bars.length - 1].t - bars[0].t) / (365 * 86400000) : 0;

  if (cone.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Cone}
          title={barsLoading ? "Loading daily candles…" : "Volatility cone unavailable"}
          body={barsLoading ? undefined : "The cone needs at least 90 days of daily closes from the proxy (Yahoo Finance)."}
        />
      </Card>
    );
  }

  return (
    <Card>
      <PanelHeader
        icon={Cone}
        title={`${symbol} volatility cone`}
        subtitle={`Realised volatility percentiles over ${years.toFixed(1)} years of daily closes, by window length in trading days.`}
        right={
          <>
            <DerivedBadge />
            {isSample ? <SampleBadge title="IV overlay: sample" /> : null}
          </>
        }
      />
      <CardContent className="space-y-3 p-4 pt-0">
        <p className="flex items-start gap-1.5 text-body-sm text-muted-foreground">
          <HelpTip text="Each window shows the lowest, 25th percentile, median, 75th percentile and highest realised vol seen over the history. Dots show today's ATM IV for each expiry placed at its trading days to expiry. IV near the top of the cone means options are rich versus history." />
          When the IV dots sit above the median line, options price more movement than is typical for that horizon.
        </p>
        <div className="h-[320px]" role="img" aria-label="Volatility cone with current implied volatility">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={cone} margin={{ top: 10, right: 12, bottom: 0, left: -10 }}>
              <CartesianGrid {...gridProps} />
              <XAxis type="number" dataKey="window" domain={[0, 95]} ticks={CONE_WINDOWS} {...axisProps} tickFormatter={(v: number) => `${v}d`} />
              <YAxis {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                cursor={tooltipCursor}
                labelFormatter={(v: number) => `${v} trading days`}
                formatter={(v: number | [number, number], name: string) => [Array.isArray(v) ? `${fmtVol(v[0])} – ${fmtVol(v[1])}` : fmtVol(v), name]}
              />
              <Area dataKey="band" name="Min – max" stroke="none" fill={tokenColor("chart-2", 0.1)} isAnimationActive={false} />
              <Area dataKey="iqr" name="25th – 75th pct" stroke="none" fill={tokenColor("chart-2", 0.22)} isAnimationActive={false} />
              <Line dataKey="median" name="Median" stroke={chartColors.iv} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line dataKey="current" name="Realised now" stroke={chartColors.foreground} strokeWidth={1.75} dot={{ r: 2.5 }} isAnimationActive={false} />
              {ivPts.length ? (
                <Line data={ivPts} dataKey="iv" name="ATM IV by expiry" stroke={chartColors.spot} strokeWidth={2} dot={{ r: 4, fill: chartColors.spot }} isAnimationActive={false} />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-4">
          <LegendChip color={tokenColor("chart-2", 0.5)} label="Min – max / IQR band" />
          <LegendChip color={chartColors.iv} label="Median" dashed />
          <LegendChip color={chartColors.foreground} label="Realised now" />
          <LegendChip color={chartColors.spot} label="ATM IV term structure" />
        </div>
        <div className="overflow-x-auto rounded-tile border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Window</TableHead>
                <TableHead className="text-right">Min</TableHead>
                <TableHead className="text-right">25th</TableHead>
                <TableHead className="text-right">Median</TableHead>
                <TableHead className="text-right">75th</TableHead>
                <TableHead className="text-right">Max</TableHead>
                <TableHead className="text-right">Now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cone.map((c) => (
                <TableRow key={c.window}>
                  <TableCell className="font-medium">{c.window} days</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtVol(c.min)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtVol(c.p25)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtVol(c.median)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtVol(c.p75)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtVol(c.max)}</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${c.current > c.p75 ? "text-bearish" : c.current < c.p25 ? "text-bullish" : ""}`}>{fmtVol(c.current)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
