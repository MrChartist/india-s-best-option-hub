import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Crosshair, Loader2, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { axisProps, chartColors, compactAxisTick, gridProps, legendStyle, tokenColor, tooltipCursor, tooltipStyle } from "@/lib/chartTheme";
import { formatTimeIST } from "@/lib/options";
import { cumulativeOIChangeSeries, pcrSignal, rangeOIChangeSeries, type OIFlowPoint } from "@/lib/oiUtils";
import { ChartCaption, EmptyState, ModuleHeader, Segmented, SessionBadge, StatTile } from "./shared";
import { fmtOIChange, fmtRatio, fmtStrike } from "./format";
import type { OiSession } from "./useOiSession";

const timeTick = (v: number) => formatTimeIST(v).replace(" IST", "");
const RANGES = [5, 10] as const;

function changePcr(p: OIFlowPoint | undefined): number | null {
  if (!p || !(p.ceChg > 0) || !(p.peChg > 0)) return null;
  return Math.round((p.peChg / p.ceChg) * 100) / 100;
}

function FlowStats({ last }: { last: OIFlowPoint | undefined }) {
  const chgPcr = changePcr(last);
  return (
    <div className="grid grid-cols-2 items-start gap-2 md:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
      <StatTile label="Call OI added" value={last ? fmtOIChange(last.ceChg) : "—"} valueClass="text-bearish" sub="Resistance writing" />
      <StatTile label="Put OI added" value={last ? fmtOIChange(last.peChg) : "—"} valueClass="text-bullish" sub="Support writing" />
      <StatTile label="Net put − call" value={last ? fmtOIChange(last.netChg) : "—"} valueClass={last && last.netChg > 0 ? "text-bullish" : last && last.netChg < 0 ? "text-bearish" : undefined} sub={last ? (last.netChg >= 0 ? "Puts adding faster" : "Calls adding faster") : undefined} />
      <StatTile label="Change PCR" value={fmtRatio(chgPcr)} valueClass={chgPcr === null ? undefined : pcrSignal(chgPcr).className} sub={chgPcr === null ? "Needs both adding" : "Put added ÷ call added"} />
    </div>
  );
}

function FlowChart({ points, spotAxis, label }: { points: OIFlowPoint[]; spotAxis: boolean; label: string }) {
  return (
    <div className="h-[280px] sm:h-[300px]" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 20, right: spotAxis ? 0 : 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis {...axisProps} dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={timeTick} minTickGap={36} />
          <YAxis {...axisProps} yAxisId="oi" tickFormatter={compactAxisTick} width={48} />
          {spotAxis && <YAxis {...axisProps} yAxisId="spot" orientation="right" domain={["auto", "auto"]} tickFormatter={(v: number) => fmtStrike(Math.round(v))} width={56} />}
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={tooltipCursor}
            labelFormatter={(v: number) => formatTimeIST(v)}
            formatter={(v: number, n: string) => [n === "Spot" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : fmtOIChange(v), n]}
          />
          <Legend wrapperStyle={legendStyle} />
          <ReferenceLine yAxisId="oi" y={0} stroke={tokenColor("muted-foreground", 0.6)} />
          <Line yAxisId="oi" type="monotone" dataKey="ceChg" name="Call OI change" stroke={chartColors.call} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line yAxisId="oi" type="monotone" dataKey="peChg" name="Put OI change" stroke={chartColors.put} strokeWidth={2} dot={false} isAnimationActive={false} />
          {spotAxis && <Line yAxisId="spot" type="monotone" dataKey="spot" name="Spot" stroke={chartColors.spot} strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Body({ session, children }: { session: OiSession; children: () => JSX.Element }) {
  if (session.loading && session.snaps.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading snapshots…
      </div>
    );
  }
  if (session.snaps.length < 2) {
    return (
      <EmptyState icon={<TrendingUp className="h-5 w-5" />} title="No intraday session to chart">
        A session needs a spot price and an unexpired contract.
      </EmptyState>
    );
  }
  return children();
}

/** Cumulative call vs put OI change across the whole chain since the first snapshot, with spot on the right axis. */
export function CumulativeOIChange({ session, unit }: { session: OiSession; unit?: "contracts" | "qty" }) {
  const points = useMemo(() => cumulativeOIChangeSeries(session.snaps), [session.snaps]);
  const first = session.snaps[0];
  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<TrendingUp className="h-4 w-4 text-primary-ink" />}
        title="Cumulative call vs put OI change"
        hint="All strikes. Put OI rising faster than call OI is supportive; the reverse caps rallies."
        right={<SessionBadge source={session.source} count={session.snaps.length} />}
      />
      <CardContent className="space-y-3 p-4">
        <Body session={session}>
          {() => (
            <>
              <FlowStats last={points[points.length - 1]} />
              <FlowChart points={points} spotAxis label="Cumulative call and put OI change with spot" />
              <ChartCaption>
                Left axis: OI change since {first ? formatTimeIST(first.ts) : "the first snapshot"}, in {unit === "qty" ? "quantity (shares)" : "contracts"}. Right axis: spot in points.
              </ChartCaption>
            </>
          )}
        </Body>
      </CardContent>
    </Card>
  );
}

/** OI change over time inside a fixed ATM ± 5 or ± 10 strike range. */
export function RangeOIChange({ session, unit }: { session: OiSession; unit?: "contracts" | "qty" }) {
  const [perSide, setPerSide] = useState<number>(5);
  const view = useMemo(() => rangeOIChangeSeries(session.snaps, perSide), [session.snaps, perSide]);
  const lo = view.strikes[0];
  const hi = view.strikes[view.strikes.length - 1];
  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<Crosshair className="h-4 w-4 text-primary-ink" />}
        title={`OI change in ATM ± ${perSide} range`}
        hint="Where the day's writing is concentrated near the money. The range is fixed around the latest ATM."
        right={
          <>
            <SessionBadge source={session.source} count={session.snaps.length} />
            <Segmented<number> label="Strikes each side of ATM" value={perSide} onChange={setPerSide} options={RANGES.map((n) => ({ value: n, label: `± ${n}` }))} />
          </>
        }
      />
      <CardContent className="space-y-3 p-4">
        <Body session={session}>
          {() => (
            <>
              <FlowStats last={view.points[view.points.length - 1]} />
              <FlowChart points={view.points} spotAxis={false} label={`OI change between strikes ${fmtStrike(lo)} and ${fmtStrike(hi)}`} />
              <ChartCaption>
                Y axis: OI change in {unit === "qty" ? "quantity (shares)" : "contracts"} across {fmtStrike(lo)} to {fmtStrike(hi)} ({view.strikes.length} strikes, ATM {fmtStrike(view.atm)} at the latest spot).
              </ChartCaption>
            </>
          )}
        </Body>
      </CardContent>
    </Card>
  );
}
