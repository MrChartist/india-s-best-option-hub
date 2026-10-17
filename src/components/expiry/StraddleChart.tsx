/** ATM straddle over the session with VWAP, % decayed, a constant-IV decay curve and theta per minute. */
import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FlaskConical, LineChart as LineChartIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, chartColors, gridProps, legendStyle, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatINR, formatPct, formatStrike } from "@/lib/options";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { analyseStraddle, hhmmIST, openingATM, type StraddleAnalytics, signTone } from "./expiryMath";
import { DerivedBadge, EmptyState, HelpTip, ModeBadge, ModelBadge, Panel, PanelSkeleton, Stat } from "./ExpiryUi";
import type { SessionMode } from "./useExpirySession";

interface Props {
  snaps: ChainSnapshot[];
  expiry: string;
  r: number;
  q: number;
  lotSize: number;
  mode: SessionMode;
  asOf?: number;
  reason?: string;
  source?: string;
  loading?: boolean;
  /** Floating-ATM analytics already computed by the page (saves a recompute). */
  floating: StraddleAnalytics;
  window: { start: number; end: number };
  onShowSample?: () => void;
}

type Row = { ts: number; straddle?: number; vwap?: number; theory?: number; spot?: number; strike?: number };

export function StraddleChart({ snaps, expiry, r, q, lotSize, mode, asOf, reason, source, loading, floating, window, onShowSample }: Props) {
  const [strikeMode, setStrikeMode] = useState<"floating" | "fixed">("floating");
  const [perLot, setPerLot] = useState(false);
  const [showSpot, setShowSpot] = useState(true);

  const fixedStrike = useMemo(() => openingATM(snaps), [snaps]);
  const fixed = useMemo(
    () => (strikeMode === "fixed" && Number.isFinite(fixedStrike) ? analyseStraddle(snaps, { expiry, r, q, mode: { kind: "fixed", strike: fixedStrike } }) : null),
    [strikeMode, fixedStrike, snaps, expiry, r, q],
  );
  const a = strikeMode === "fixed" && fixed ? fixed : floating;
  const mult = perLot && lotSize > 0 ? lotSize : 1;
  const unit = perLot && lotSize > 0 ? `per lot (${lotSize})` : "per unit";

  const rows = useMemo<Row[]>(() => {
    const m = new Map<number, Row>();
    a.points.forEach((p, i) => m.set(p.ts, { ts: p.ts, straddle: p.straddle * mult, vwap: a.vwap[i] * mult, spot: p.spot, strike: p.strike }));
    for (const t of a.theory) {
      const row = m.get(t.ts) ?? { ts: t.ts };
      row.theory = t.theory * mult;
      m.set(t.ts, row);
    }
    return [...m.values()].sort((x, y) => x.ts - y.ts);
  }, [a, mult]);

  if (loading) return <PanelSkeleton height={320} label="Loading straddle chart" />;

  const last = a.last;
  const open = a.open;
  const xEnd = Number.isFinite(a.curveEnd) ? Math.max(a.curveEnd, last?.ts ?? 0) : window.end;
  const xStart = open ? Math.min(open.ts, window.start) : window.start;
  const vwapNow = a.vwap[a.vwap.length - 1];
  const vsVwap = last && Number.isFinite(vwapNow) ? last.straddle - vwapNow : NaN;
  const strikeChanges = strikeMode === "floating" ? new Set(a.points.map((p) => p.strike)).size - 1 : 0;

  const header = (
    <>
      <LineChartIcon className="h-4 w-4 text-primary-ink" aria-hidden="true" />
      {strikeMode === "fixed" && Number.isFinite(fixedStrike) ? `${fixedStrike} straddle` : "ATM straddle"}
      <ModeBadge mode={mode} asOf={asOf} reason={reason} source={source} />
    </>
  );

  const actions = (
    <>
      <ToggleGroup type="single" size="sm" value={strikeMode} onValueChange={(v) => v && setStrikeMode(v as "floating" | "fixed")} aria-label="Strike selection">
        <ToggleGroupItem value="floating" aria-label="Floating ATM strike">Floating ATM</ToggleGroupItem>
        <ToggleGroupItem value="fixed" aria-label="Fixed at the opening ATM strike">Fixed K₀</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="single" size="sm" value={perLot ? "lot" : "unit"} onValueChange={(v) => v && setPerLot(v === "lot")} aria-label="Units">
        <ToggleGroupItem value="unit">₹/unit</ToggleGroupItem>
        <ToggleGroupItem value="lot" disabled={!(lotSize > 0)}>₹/lot</ToggleGroupItem>
      </ToggleGroup>
    </>
  );

  if (a.points.length < 2) {
    return (
      <Panel title={header} actions={actions} subtitle="Straddle premium through the session">
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
          The chart builds from option-chain snapshots recorded in this browser. Keep this page open during market hours (09:15–15:30 IST) and a point is added about every 15 seconds.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title={header}
      actions={actions}
      subtitle={
        <>
          {strikeMode === "floating" ? "Nearest strike to spot at each snapshot" : "Strike fixed at the opening ATM, a tradeable position"} · mid prices where quotes are tight · {unit}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Straddle now" value={last ? formatINR(last.straddle * mult, { decimals: perLot ? 0 : 2 }) : "—"} hint={last ? `${formatStrike(last.strike)} · ${hhmmIST(last.ts)} IST` : undefined} />
        <Stat label="At open" value={open ? formatINR(open.straddle * mult, { decimals: perLot ? 0 : 2 }) : "—"} hint={open ? `${formatStrike(open.strike)} · ${hhmmIST(open.ts)} IST` : undefined} />
        <Stat
          label="Decayed"
          value={Number.isFinite(a.decayPct) ? formatPct(a.decayPct * 100, { decimals: 1 }) : "—"}
          tone={a.decayPct > 0 ? "text-bullish" : a.decayPct < 0 ? "text-bearish" : ""}
          hint={Number.isFinite(a.theoryDecayPct) ? `Constant-IV model: ${formatPct(a.theoryDecayPct * 100, { decimals: 1 })}` : "vs the opening straddle"}
          help="Share of the opening straddle premium lost so far. Positive is good for straddle sellers. The model figure is what pure time decay would have taken with spot and IV unchanged."
        />
        <Stat
          label={a.vwapBasis === "volume" ? "VWAP" : "TWAP"}
          value={Number.isFinite(vwapNow) ? formatINR(vwapNow * mult, { decimals: perLot ? 0 : 2 }) : "—"}
          tone={signTone(-vsVwap)}
          hint={Number.isFinite(vsVwap) ? `Straddle ${vsVwap < 0 ? "below" : "above"} by ${formatINR(Math.abs(vsVwap) * mult, { decimals: perLot ? 0 : 2 })}` : undefined}
          help={a.vwapBasis === "volume" ? "Volume-weighted average straddle price, weighted by the increase in CE+PE volume at the strike between snapshots. Straddle below VWAP is the usual short-straddle signal." : "No volume increments were available, so this is a time-weighted average."}
        />
        <Stat
          label="Theta / min"
          value={Number.isFinite(a.thetaPerMin) ? formatINR(a.thetaPerMin * mult, { decimals: perLot ? 1 : 3 }) : "—"}
          tone="text-bearish"
          hint={unit}
          help="Black-76 theta of the ATM straddle (CE + PE) per trading day, divided by the 375-minute session, at the current straddle IV. It is the model decay per session minute for a long straddle; a seller earns the same amount."
        />
        <Stat
          label="Next 15 min"
          value={Number.isFinite(a.decayNext15) ? formatINR(-a.decayNext15 * mult, { decimals: perLot ? 0 : 2 }) : "—"}
          tone="text-bearish"
          hint="Model decay, spot and IV unchanged"
        />
      </div>

      <figure className="mt-4" aria-label={`Straddle premium from ${open ? hhmmIST(open.ts) : ""} to ${last ? hhmmIST(last.ts) : ""} IST, now ${last ? formatINR(last.straddle * mult) : "unknown"}`}>
        <div className="h-[300px] w-full sm:h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={[xStart, xEnd]}
                tickFormatter={(v: number) => hhmmIST(v)}
                {...axisProps}
                minTickGap={28}
              />
              <YAxis yAxisId="p" {...axisProps} width={56} domain={["auto", "auto"]} tickFormatter={(v: number) => (perLot ? `${Math.round(v)}` : v.toFixed(0))} />
              {showSpot ? <YAxis yAxisId="s" orientation="right" {...axisProps} width={56} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(0)} /> : null}
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipItemStyle}
                cursor={tooltipCursor}
                labelFormatter={(v: number) => `${hhmmIST(v)} IST`}
                formatter={(value: number, name: string) => {
                  if (name === "Spot") return [value.toFixed(2), name];
                  return [formatINR(value, { decimals: perLot ? 0 : 2 }), name];
                }}
              />
              <Legend wrapperStyle={legendStyle} />
              {open ? <ReferenceLine yAxisId="p" y={open.straddle * mult} stroke={chartColors.muted} strokeDasharray="2 4" strokeOpacity={0.6} /> : null}
              <Line yAxisId="p" type="monotone" dataKey="theory" name="Constant-IV decay" stroke={chartColors.axis} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
              <Line yAxisId="p" type="monotone" dataKey="vwap" name={a.vwapBasis === "volume" ? "VWAP" : "TWAP"} stroke={chartColors.iv} strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} />
              <Line yAxisId="p" type="linear" dataKey="straddle" name="Straddle" stroke={chartColors.primary} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              {showSpot ? <Line yAxisId="s" type="linear" dataKey="spot" name="Spot" stroke={chartColors.c4} strokeOpacity={0.55} strokeWidth={1} dot={false} connectNulls isAnimationActive={false} /> : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <figcaption className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-muted-foreground">
          <DerivedBadge title="From snapshots" />
          <ModelBadge />
          <span>
            Dashed curve: Black-76 at the opening straddle IV ({Number.isFinite(a.sigmaOpenCalendar) ? formatPct(a.sigmaOpenCalendar * 100, { decimals: 1 }) : "—"}), spot frozen, time in session minutes.
          </span>
          {strikeChanges > 0 ? <span>ATM strike changed {strikeChanges} time{strikeChanges === 1 ? "" : "s"}.</span> : null}
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={showSpot} onChange={(e) => setShowSpot(e.target.checked)} />
            Show spot
          </label>
          <HelpTip text="If the straddle sits above the dashed curve, IV has risen or spot has moved away from the strike since the open. Below it, the market is pricing decay faster than the model." />
        </figcaption>
      </figure>
    </Panel>
  );
}
