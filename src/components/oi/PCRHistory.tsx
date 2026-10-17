import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarRange, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useOiSession } from "./useOiSession";
import { axisProps, chartColors, compactAxisTick, gridProps, legendStyle, tokenColor, tooltipCursor, tooltipStyle } from "@/lib/chartTheme";
import { formatDateIST, formatTimeIST } from "@/lib/options";
import { PCR_BANDS, pcrSignal, percentileRank, quantile, snapshotSeries } from "@/lib/oiUtils";
import { getDailyStats } from "@/lib/snapshotStore";
import { cn } from "@/lib/utils";
import MetricHelp from "@/components/learn/MetricHelp";
import { ChartCaption, EmptyState, ModuleHeader, SessionBadge, StatTile } from "./shared";
import { fmtRatio, fmtStrike } from "./format";

const HISTORY_DAYS = 60;
const MIN_DAYS_FOR_BANDS = 10;

/** PCR signal bands as Recharts children (returned as an array: Recharts ignores wrapper components). */
function pcrBands(yAxisId: string, max: number) {
  const out = [
    <ReferenceArea key="low" yAxisId={yAxisId} y1={0} y2={PCR_BANDS.low} fill={tokenColor("bearish", 0.05)} stroke="none" />,
    <ReferenceArea key="high" yAxisId={yAxisId} y1={PCR_BANDS.high} y2={Math.min(max, PCR_BANDS.extreme)} fill={tokenColor("bullish", 0.05)} stroke="none" />,
    <ReferenceLine key="one" yAxisId={yAxisId} y={1} stroke={tokenColor("muted-foreground", 0.5)} strokeDasharray="3 3" />,
  ];
  if (max > PCR_BANDS.extreme) out.push(<ReferenceArea key="ext" yAxisId={yAxisId} y1={PCR_BANDS.extreme} y2={max} fill={tokenColor("warning", 0.07)} stroke="none" />);
  return out;
}

/**
 * Intraday PCR vs spot from the latest recorded session; before this browser has recorded one, a
 * labelled sample session anchored to the sample chain at the current spot.
 */
export function IntradayPCR({ symbol, expiry, spot = 0 }: { symbol: string; expiry: string; spot?: number }) {
  const session = useOiSession(symbol, expiry, spot);
  const isLoading = session.loading;
  const series = useMemo(() => snapshotSeries(session.snaps), [session.snaps]);
  const pcrMax = Math.max(2, ...series.map((p) => p.pcrOI ?? 0)) * 1.05;
  const first = series[0];
  const last = series[series.length - 1];
  const dayLabel = last ? formatDateIST(last.ts) : "";

  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<Clock className="h-4 w-4 text-primary-ink" />}
        title="Intraday PCR vs spot"
        hint={
          series.length >= 2
            ? session.source === "sample"
              ? `${dayLabel} · sample session until this browser records one during market hours`
              : `${dayLabel} · ${series.length} snapshots recorded in this browser`
            : "Built from snapshots this browser records during market hours."
        }
        right={series.length >= 2 ? <SessionBadge source={session.source} count={series.length} /> : undefined}
      />
      <CardContent className="p-4">
        {series.length < 2 ? (
          <EmptyState icon={<Clock className="h-5 w-5" />} title={isLoading ? "Reading snapshots…" : "Recording starts when the market is open; keep this tab open"}>
            Snapshots of the {symbol} chain are saved about once a minute between 09:15 and 15:30 IST.
          </EmptyState>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatTile label={<MetricHelp metric="pcr" value={last?.pcrOI ?? undefined}>PCR now</MetricHelp>} value={fmtRatio(last?.pcrOI)} valueClass={pcrSignal(last?.pcrOI ?? NaN).className} />
              <StatTile label="PCR at first snapshot" value={fmtRatio(first?.pcrOI)} sub={first ? formatTimeIST(first.ts) : undefined} />
              <StatTile label="Change" value={first?.pcrOI && last?.pcrOI ? `${last.pcrOI - first.pcrOI >= 0 ? "+" : ""}${(last.pcrOI - first.pcrOI).toFixed(2)}` : "—"} />
              <StatTile label="Volume PCR now" value={fmtRatio(last?.pcrVol)} />
            </div>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 20, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis {...axisProps} dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => formatTimeIST(v).replace(" IST", "")} minTickGap={30} />
                  <YAxis {...axisProps} yAxisId="pcr" domain={[0, pcrMax]} tickFormatter={compactAxisTick} width={36} />
                  <YAxis {...axisProps} yAxisId="spot" orientation="right" domain={["auto", "auto"]} tickFormatter={(v: number) => fmtStrike(v)} width={58} />
                  <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(v: number) => formatTimeIST(v)} formatter={(v: number, n: string) => [n === "Spot" ? fmtStrike(v) : fmtRatio(v), n]} />
                  <Legend wrapperStyle={legendStyle} />
                  {pcrBands("pcr", pcrMax)}
                  <Line yAxisId="pcr" type="monotone" dataKey="pcrOI" name="PCR (OI)" stroke={chartColors.c2} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  <Line yAxisId="pcr" type="monotone" dataKey="pcrVol" name="PCR (volume)" stroke={chartColors.c4} strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                  <Line yAxisId="spot" type="monotone" dataKey="spot" name="Spot" stroke={chartColors.spot} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ChartCaption className="mt-2">Left axis: put-call ratio (puts ÷ calls, unit-free). Right axis: spot in points. Shaded bands mark the call-heavy, put-heavy and extreme zones.</ChartCaption>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** 60-day end-of-day PCR from the recorder's daily stats, with percentile and extreme bands. */
export function PCRHistory({ symbol, currentPcr, sample }: { symbol: string; currentPcr: number; sample?: boolean }) {
  const { data: stats = [], isLoading, isError } = useQuery({
    queryKey: ["daily-stats", symbol.toUpperCase(), HISTORY_DAYS],
    queryFn: () => getDailyStats(symbol, HISTORY_DAYS),
    staleTime: 5 * 60_000,
    retry: 0,
  });

  const view = useMemo(() => {
    const rows = stats
      .filter((s) => Number.isFinite(s.pcrOi) && s.pcrOi > 0)
      .map((s) => ({ date: s.date, pcr: Math.round(s.pcrOi * 100) / 100, maxPain: Number.isFinite(s.maxPain) ? s.maxPain : null, spot: Number.isFinite(s.spot) ? s.spot : null }));
    const values = rows.map((r) => r.pcr);
    const p10 = quantile(values, 0.1);
    const p90 = quantile(values, 0.9);
    const median = quantile(values, 0.5);
    const latest = rows[rows.length - 1]?.pcr ?? NaN;
    // Live PCR from sample data must not be ranked against real history.
    const ref = !sample && currentPcr > 0 ? currentPcr : latest;
    return {
      rows,
      p10,
      p90,
      median,
      min: values.length ? Math.min(...values) : NaN,
      max: values.length ? Math.max(...values) : NaN,
      ref,
      refIsLive: !sample && currentPcr > 0,
      rank: percentileRank(ref, values),
    };
  }, [stats, currentPcr, sample]);

  const enough = view.rows.length >= MIN_DAYS_FOR_BANDS;
  const yMax = Math.max(2, view.max || 0) * 1.05;
  const zone = view.rank === null ? null : view.rank >= 90 ? "high" : view.rank <= 10 ? "low" : null;

  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<CalendarRange className="h-4 w-4 text-primary-ink" />}
        title="PCR history (60 days)"
        hint="One end-of-day reading per trading day, saved by this browser's recorder after 15:30 IST."
        right={view.rows.length > 0 ? <Badge variant="info">{view.rows.length} days</Badge> : undefined}
      />
      <CardContent className="p-4">
        {isError ? (
          <EmptyState icon={<CalendarRange className="h-5 w-5" />} title="Could not read stored history">
            Browser storage (IndexedDB) may be blocked in this window.
          </EmptyState>
        ) : view.rows.length < 2 ? (
          <EmptyState icon={<CalendarRange className="h-5 w-5" />} title={isLoading ? "Reading history…" : "Not enough history yet"}>
            History builds up one day at a time while this terminal is open during market hours. Percentile bands appear after {MIN_DAYS_FOR_BANDS} trading days.
          </EmptyState>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatTile
                label={view.refIsLive ? "PCR now" : "Last close PCR"}
                value={fmtRatio(view.ref)}
                valueClass={cn(zone === "high" && "text-warning", zone === "low" && "text-bearish")}
                sub={enough && view.rank !== null ? `${view.rank}th percentile` : `Percentile after ${MIN_DAYS_FOR_BANDS} days`}
              />
              <StatTile label="Median" value={fmtRatio(view.median)} />
              <StatTile label="10th–90th pct" value={enough ? `${fmtRatio(view.p10)}–${fmtRatio(view.p90)}` : "—"} />
              <StatTile label="Range" value={`${fmtRatio(view.min)}–${fmtRatio(view.max)}`} />
            </div>
            {zone && enough && (
              <p className={cn("mb-3 rounded-tile border px-3 py-2 text-xs", zone === "high" ? "border-warning/30 bg-wash-warning/50" : "border-bearish/30 bg-wash-loss/50")}>
                {zone === "high"
                  ? "PCR is in the top 10% of its recent range. Extreme put writing often marks crowded positioning."
                  : "PCR is in the bottom 10% of its recent range. Extreme call writing can precede short covering."}
              </p>
            )}
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={view.rows} margin={{ top: 20, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis {...axisProps} dataKey="date" tickFormatter={(v: string) => formatDateIST(v).replace(/ \d{4}$/, "")} minTickGap={24} />
                  <YAxis {...axisProps} yAxisId="pcr" domain={[0, yMax]} tickFormatter={compactAxisTick} width={36} />
                  <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(v: string) => formatDateIST(v)} formatter={(v: number, n: string) => [fmtRatio(v), n]} />
                  <Legend wrapperStyle={legendStyle} />
                  {enough && Number.isFinite(view.p10) && Number.isFinite(view.p90) && (
                    <ReferenceArea yAxisId="pcr" y1={view.p10} y2={view.p90} fill={tokenColor("info", 0.08)} stroke="none" label={{ value: "10th–90th pct", position: "insideTopLeft", fill: chartColors.info, fontSize: 10 }} />
                  )}
                  {enough && Number.isFinite(view.p90) && <ReferenceLine yAxisId="pcr" y={view.p90} stroke={chartColors.warning} strokeDasharray="4 3" />}
                  {enough && Number.isFinite(view.p10) && <ReferenceLine yAxisId="pcr" y={view.p10} stroke={chartColors.bearish} strokeDasharray="4 3" />}
                  <ReferenceLine yAxisId="pcr" y={1} stroke={tokenColor("muted-foreground", 0.5)} strokeDasharray="3 3" />
                  <Line yAxisId="pcr" type="monotone" dataKey="pcr" name="PCR (OI, close)" stroke={chartColors.c2} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ChartCaption className="mt-2">Y axis: closing OI put-call ratio (puts ÷ calls, unit-free).</ChartCaption>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Max pain vs close over the stored daily history (drift over days). */
export function MaxPainDrift({ symbol }: { symbol: string }) {
  const { data: stats = [] } = useQuery({
    queryKey: ["daily-stats", symbol.toUpperCase(), HISTORY_DAYS],
    queryFn: () => getDailyStats(symbol, HISTORY_DAYS),
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const rows = useMemo(
    () => stats.filter((s) => Number.isFinite(s.maxPain) && s.maxPain > 0).map((s) => ({ date: s.date, maxPain: s.maxPain, spot: Number.isFinite(s.spot) ? s.spot : null })),
    [stats],
  );
  return (
    <Card className="overflow-hidden">
      <ModuleHeader icon={<CalendarRange className="h-4 w-4 text-primary-ink" />} title="Max pain drift (daily)" hint="Nearest-expiry max pain at each close against the closing spot." />
      <CardContent className="p-4">
        {rows.length < 2 ? (
          <EmptyState icon={<CalendarRange className="h-5 w-5" />} title="Not enough history yet">
            One reading is saved per trading day after 15:30 IST while this terminal is open.
          </EmptyState>
        ) : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 20, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis {...axisProps} dataKey="date" tickFormatter={(v: string) => formatDateIST(v).replace(/ \d{4}$/, "")} minTickGap={24} />
                <YAxis {...axisProps} domain={["auto", "auto"]} tickFormatter={(v: number) => fmtStrike(v)} width={58} />
                <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(v: string) => formatDateIST(v)} formatter={(v: number, n: string) => [fmtStrike(v), n]} />
                <Legend wrapperStyle={legendStyle} />
                <Line type="stepAfter" dataKey="maxPain" name="Max pain" stroke={chartColors.warning} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="spot" name="Close" stroke={chartColors.spot} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        {rows.length >= 2 && <ChartCaption className="mt-2">Y axis: index level in points.</ChartCaption>}
      </CardContent>
    </Card>
  );
}
