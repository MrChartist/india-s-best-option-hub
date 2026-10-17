/**
 * Fixed-strike straddle vs Black-76 theory: pure time decay (spot and IV frozen), the constant-IV
 * value along the actual spot path, and an attribution of the change since the open into time,
 * spot and IV. Plus a decay schedule at fixed IST checkpoints.
 */
import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { axisProps, chartColors, gridProps, legendStyle, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatINR, formatPct, formatSigned } from "@/lib/options";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { cn } from "@/lib/utils";
import { analyseStraddle, constantIvWithSpot, decaySchedule, hhmmIST, openingATM, premiumDomain, signTone } from "./expiryMath";
import { EmptyState, HelpTip, ModelBadge, Panel, PanelSkeleton, SampleBadge } from "./ExpiryUi";
import type { SessionMode } from "./useExpirySession";

interface Props {
  snaps: ChainSnapshot[];
  expiry: string;
  r: number;
  q: number;
  mode: SessionMode;
  loading?: boolean;
}

export function StraddleDecayVsTheory({ snaps, expiry, r, q, mode, loading }: Props) {
  const K0 = useMemo(() => openingATM(snaps), [snaps]);
  const a = useMemo(() => (Number.isFinite(K0) ? analyseStraddle(snaps, { expiry, r, q, mode: { kind: "fixed", strike: K0 } }) : null), [snaps, expiry, r, q, K0]);
  const withSpot = useMemo(
    () => (a && Number.isFinite(a.sigmaOpen) ? constantIvWithSpot(a.points, { expiry, r, q, sigma: a.sigmaOpen, strike: a.theoryStrike }) : []),
    [a, expiry, r, q],
  );
  const schedule = useMemo(() => (a ? decaySchedule(a, { expiry, r, q }) : []), [a, expiry, r, q]);

  const rows = useMemo(() => {
    if (!a) return [];
    const m = new Map<number, { ts: number; actual?: number; theory?: number; withSpot?: number }>();
    a.points.forEach((p, i) => m.set(p.ts, { ts: p.ts, actual: p.straddle, withSpot: Number.isFinite(withSpot[i]) ? withSpot[i] : undefined }));
    for (const t of a.theory) m.set(t.ts, { ...(m.get(t.ts) ?? { ts: t.ts }), theory: t.theory });
    return [...m.values()].sort((x, y) => x.ts - y.ts);
  }, [a, withSpot]);

  if (loading) return <PanelSkeleton height={260} label="Loading decay vs theory" />;

  const title = (
    <>
      <TrendingDown className="h-4 w-4 text-primary-ink" aria-hidden="true" />
      Decay vs theory
      {mode === "sample" ? <SampleBadge /> : null}
      <ModelBadge />
    </>
  );

  if (!a || a.points.length < 2 || !a.open || !a.last) {
    return (
      <Panel title={title} subtitle="Fixed opening-ATM straddle against Black-76 at constant IV">
        <EmptyState title="Needs at least two snapshots">The comparison starts once the session has two recorded chains for this expiry.</EmptyState>
      </Panel>
    );
  }

  const open = a.open;
  const last = a.last;
  const lastWithSpot = withSpot[withSpot.length - 1];
  const total = last.straddle - open.straddle;
  const timeEffect = Number.isFinite(a.theoryNow) ? a.theoryNow - open.straddle : NaN;
  const spotEffect = Number.isFinite(lastWithSpot) && Number.isFinite(a.theoryNow) ? lastWithSpot - a.theoryNow : NaN;
  const ivEffect = Number.isFinite(lastWithSpot) ? last.straddle - lastWithSpot : NaN;
  const attribution = [
    { label: "Time decay", value: timeEffect, help: "Constant-IV, constant-spot model value now minus the opening straddle." },
    { label: "Spot move", value: spotEffect, help: "Extra value from spot moving away from (or towards) the strike, at the opening IV." },
    { label: "IV change", value: ivEffect, help: "What is left: the market straddle minus the constant-IV value on the actual spot path. Negative means IV has been crushed." },
  ];

  return (
    <Panel
      title={title}
      subtitle={`${a.theoryStrike} straddle (opening ATM) · opening IV ${Number.isFinite(a.sigmaOpenCalendar) ? formatPct(a.sigmaOpenCalendar * 100, { decimals: 1 }) : "—"} → now ${Number.isFinite(a.sigmaNowCalendar) ? formatPct(a.sigmaNowCalendar * 100, { decimals: 1 }) : "—"}`}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <figure aria-label="Actual straddle compared with the model decay curves">
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => hhmmIST(v)} {...axisProps} minTickGap={28} />
                <YAxis {...axisProps} width={52} domain={premiumDomain(1)} tickFormatter={(v: number) => v.toFixed(0)} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={tooltipCursor}
                  labelFormatter={(v: number) => `${hhmmIST(v)} IST`}
                  formatter={(value: number, name: string) => [formatINR(value), name]}
                />
                <Legend wrapperStyle={legendStyle} />
                <Line type="monotone" dataKey="theory" name="Pure time decay" stroke={chartColors.axis} strokeDasharray="5 4" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                <Line type="linear" dataKey="withSpot" name="Constant IV, actual spot" stroke={chartColors.iv} strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} />
                <Line type="linear" dataKey="actual" name="Market straddle" stroke={chartColors.primary} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </figure>

        <div className="space-y-2">
          <p className="text-label uppercase text-muted-foreground">Change since {hhmmIST(open.ts)} IST (₹/unit)</p>
          <dl className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-1.5">
              <dt className="font-semibold">Total</dt>
              <dd className={cn("font-num tabular-nums font-semibold", signTone(total))}>{formatSigned(total, 2)}</dd>
            </div>
            {attribution.map((x) => (
              <div key={x.label} className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1 text-body-sm text-muted-foreground">
                  {x.label} <HelpTip text={x.help} label={`About ${x.label}`} />
                </dt>
                <dd className={cn("font-num text-body-sm tabular-nums", signTone(x.value))}>{Number.isFinite(x.value) ? formatSigned(x.value, 2) : "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-body-sm text-muted-foreground">
            {Number.isFinite(ivEffect) && Math.abs(ivEffect) > 0.5
              ? ivEffect < 0
                ? "IV has come off since the open: sellers are earning more than time decay alone."
                : "IV has risen since the open: the straddle is holding value better than theory."
              : "The straddle is tracking the constant-IV model closely."}
          </p>
        </div>
      </div>

      {schedule.length > 0 ? (
        <div className="mt-4">
          <div className="mb-1 flex items-center gap-1 text-label uppercase text-muted-foreground">
            Model decay schedule from the open <HelpTip text="Black-76 value of the opening straddle at each time if spot and IV stayed where they were at the open. On expiry day most of the premium goes in the last two hours." />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Time (IST)</TableHead>
                  {schedule.map((s) => (
                    <TableHead key={s.time} scope="col" className={cn("text-right", last.ts >= s.ts ? "text-muted-foreground" : "")}>
                      {s.time}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableHead scope="row">Value</TableHead>
                  {schedule.map((s) => (
                    <TableCell key={s.time} className="text-right font-num tabular-nums">
                      {formatINR(s.value, { decimals: 1 })}
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableHead scope="row">Left</TableHead>
                  {schedule.map((s) => (
                    <TableCell key={s.time} className="text-right font-num tabular-nums text-muted-foreground">
                      {formatPct(s.remainingPct * 100, { decimals: 0 })}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
