/**
 * Combined premium of a straddle (or custom CE/PE pair) over a session, with its running VWAP, the
 * opening level, and a constant-IV decay curve when the pair is a same-strike straddle. Spot sits in
 * its own sparkline underneath on the same time axis. Presentational: the page owns the strike mode,
 * the ₹/unit or ₹/lot toggle and the analytics, so the KPI row and the chart always agree.
 */
import { useId, useMemo, type ReactNode } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FlaskConical, LineChart as LineChartIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { axisProps, chartColors, gridProps, legendStyle, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatINR, formatNumberIN, formatPct } from "@/lib/options";
import { niceTicks } from "@/lib/charts/niceTicks";
import { hhmmIST, type StraddleAnalytics } from "./expiryMath";
import { DerivedBadge, EmptyState, HelpTip, ModeBadge, ModelBadge, Panel, PanelSkeleton } from "./ExpiryUi";
import { SpotSparkline } from "./SpotSparkline";
import type { SessionMode } from "./useExpirySession";

export interface StraddleChartProps {
  /** Analytics for the selected strike mode (analyseStraddle). */
  a: StraddleAnalytics;
  /** Lot multiplier already decided by the page: 1 for ₹/unit, the lot size for ₹/lot. */
  mult: number;
  /** Unit text for the subtitle, e.g. "per unit" or "per lot (75)". */
  unit: string;
  mode: SessionMode;
  asOf?: number;
  reason?: string;
  source?: string;
  loading?: boolean;
  window: { start: number; end: number };
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  symbol?: string;
  /** Draw the constant-IV decay curve (default: when the analytics have one). */
  showTheory?: boolean;
  onShowSample?: () => void;
  emptyHint?: ReactNode;
  height?: number;
}

type Row = { ts: number; straddle?: number; vwap?: number; theory?: number };

export function StraddleChart({
  a,
  mult,
  unit,
  mode,
  asOf,
  reason,
  source,
  loading,
  window,
  title,
  subtitle,
  actions,
  symbol,
  showTheory,
  onShowSample,
  emptyHint,
  height = 300,
}: StraddleChartProps) {
  const syncId = `straddle-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const theoryOn = (showTheory ?? true) && a.theory.length > 0;
  const perLot = mult > 1;

  const rows = useMemo<Row[]>(() => {
    const m = new Map<number, Row>();
    a.points.forEach((p, i) => m.set(p.ts, { ts: p.ts, straddle: p.straddle * mult, vwap: a.vwap[i] * mult }));
    if (theoryOn) {
      for (const t of a.theory) {
        const row = m.get(t.ts) ?? { ts: t.ts };
        row.theory = t.theory * mult;
        m.set(t.ts, row);
      }
    }
    return [...m.values()].sort((x, y) => x.ts - y.ts);
  }, [a, mult, theoryOn]);
  const spotRows = useMemo(() => a.points.map((p) => ({ ts: p.ts, spot: p.spot })), [a.points]);
  // Evenly spaced y-ticks: compute nice ticks over every plotted value (and the opening line) ourselves,
  // instead of letting a padded function domain produce uneven end ticks.
  const openLevel = a.open ? a.open.straddle * mult : NaN;
  const yTicks = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    const take = (v: number | undefined) => {
      if (v !== undefined && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    };
    rows.forEach((r) => {
      take(r.straddle);
      take(r.vwap);
      take(r.theory);
    });
    take(openLevel);
    if (!Number.isFinite(lo)) return undefined;
    const t = niceTicks(Math.max(0, lo), hi, 5).filter((v) => v >= 0);
    return t.length >= 2 ? t : undefined;
  }, [rows, openLevel]);

  const header = (
    <>
      <LineChartIcon className="h-4 w-4 text-primary-ink" aria-hidden="true" />
      {title ?? "ATM straddle"}
      <ModeBadge mode={mode} asOf={asOf} reason={reason} source={source} />
    </>
  );

  if (loading) return <PanelSkeleton height={height} label="Loading straddle chart" />;

  if (a.points.length < 2) {
    return (
      <Panel title={header} actions={actions} subtitle={subtitle ?? "Combined premium through the session"}>
        <EmptyState
          icon={<LineChartIcon className="h-6 w-6" aria-hidden="true" />}
          title="No straddle history for this session yet"
          action={
            onShowSample ? (
              <Button size="sm" variant="outline" onClick={onShowSample}>
                <FlaskConical aria-hidden="true" /> Show a sample session
              </Button>
            ) : undefined
          }
        >
          {emptyHint ?? "The chart builds from option-chain snapshots recorded in this browser. Keep this page open during market hours (09:15–15:30 IST) and a point is added about every 15 seconds."}
        </EmptyState>
      </Panel>
    );
  }

  const last = a.last;
  const open = a.open;
  const xEnd = theoryOn && Number.isFinite(a.curveEnd) ? Math.max(a.curveEnd, last?.ts ?? 0) : Math.max(window.end, last?.ts ?? 0);
  const xStart = open ? Math.min(open.ts, window.start) : window.start;
  const domain: [number, number] = [xStart, xEnd];
  const vwapName = a.vwapBasis === "volume" ? "Premium VWAP" : "Premium TWAP";
  let strikeChanges = 0;
  for (let i = 1; i < a.points.length; i++) if (a.points[i].strike !== a.points[i - 1].strike || a.points[i].peStrike !== a.points[i - 1].peStrike) strikeChanges++;
  const decimals = perLot ? 0 : 2;

  return (
    <Panel title={header} actions={actions} subtitle={subtitle ?? <>Combined CE + PE premium · mid prices where quotes are tight · {unit}</>}>
      <figure aria-label={`Combined premium from ${open ? hhmmIST(open.ts) : ""} to ${last ? hhmmIST(last.ts) : ""} IST, now ${last ? formatINR(last.straddle * mult, { decimals }) : "unknown"}`}>
        <div className="w-full" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} syncId={syncId} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="ts" type="number" scale="time" domain={domain} tickFormatter={(v: number) => hhmmIST(v)} {...axisProps} minTickGap={28} />
              <YAxis
                {...axisProps}
                width={56}
                domain={yTicks ? [yTicks[0], yTicks[yTicks.length - 1]] : ["auto", "auto"]}
                ticks={yTicks}
                interval={0}
                allowDecimals={!perLot}
                tickFormatter={(v: number) => formatNumberIN(v, yTicks && yTicks.some((t) => !Number.isInteger(t)) ? 1 : 0)}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={tooltipCursor}
                labelFormatter={(v: number) => `${hhmmIST(v)} IST`}
                formatter={(value: number, name: string) => [formatINR(value, { decimals }), name]}
              />
              <Legend wrapperStyle={legendStyle} />
              {open ? (
                <ReferenceLine
                  y={openLevel}
                  stroke={chartColors.muted}
                  strokeDasharray="2 4"
                  strokeOpacity={0.6}
                  ifOverflow="extendDomain"
                  label={{ value: `Open ${formatNumberIN(openLevel, decimals)}`, position: "insideTopRight", fill: chartColors.axis, fontSize: 10 }}
                />
              ) : null}
              {theoryOn ? <Line type="monotone" dataKey="theory" name="Constant-IV decay" stroke={chartColors.axis} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} /> : null}
              <Line type="monotone" dataKey="vwap" name={vwapName} stroke={chartColors.iv} strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} />
              <Line type="linear" dataKey="straddle" name="Premium" stroke={chartColors.primary} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <SpotSparkline data={spotRows} domain={domain} syncId={syncId} symbol={symbol} className="mt-3 border-t border-border pt-2" />
        <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-muted-foreground">
          <DerivedBadge title="From snapshots" />
          {theoryOn ? <ModelBadge /> : null}
          {theoryOn ? (
            <span>
              Dashed curve: Black-76 at the opening straddle IV ({Number.isFinite(a.sigmaOpenCalendar) ? formatPct(a.sigmaOpenCalendar * 100, { decimals: 1 }) : "—"}), spot frozen, time in session minutes.
            </span>
          ) : null}
          <span>Dotted line: opening premium.</span>
          {strikeChanges > 0 ? <span>ATM strike changed {strikeChanges} time{strikeChanges === 1 ? "" : "s"}.</span> : null}
          <HelpTip text={`${vwapName}: ${a.vwapBasis === "volume" ? "weighted by the rise in CE + PE volume between snapshots. Premium under VWAP is the usual short-straddle signal; above it, buyers are in control." : "no volume increments were available, so this is a time-weighted average."}${theoryOn ? " Above the dashed curve, IV has risen or spot has moved away from the strike since the open." : ""}`} />
        </figcaption>
      </figure>
    </Panel>
  );
}
