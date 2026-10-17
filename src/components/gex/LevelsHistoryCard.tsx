import { useMemo, useRef } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ModeBadge } from "@/components/flow/FlowUi";
import { useSessionSeries } from "@/components/flow/useSessionSeries";
import MetricHelp from "@/components/learn/MetricHelp";
import {
  axisProps,
  chartColors,
  compactAxisTick,
  gridProps,
  tooltipCursor,
  tooltipItemStyle,
  tooltipLabelStyle,
  tooltipStyle,
} from "@/lib/chartTheme";
import type { FeedEntry } from "@/lib/flow";
import {
  GEX_CONVENTION_SHORT,
  latestSession,
  levelsChangedSinceOpen,
  levelsForSnapshot,
  priceTicks,
  thinEvenly,
  wallMoves,
  type LevelChange,
  type LevelsPoint,
} from "@/lib/gex";
import type { GexConvention } from "@/lib/gexData";
import { formatTimeIST } from "@/lib/options";
import { cn } from "@/lib/utils";
import { fmtCr, fmtLevel } from "./format";

interface Props {
  symbol: string;
  feed: FeedEntry | null | undefined;
  convention: GexConvention;
  className?: string;
}

const LINES: Array<{
  key: keyof LevelsPoint;
  label: string;
  color: string;
  width: number;
  dash?: string;
  type: "monotone" | "stepAfter";
}> = [
  { key: "spot", label: "Spot", color: chartColors.spot, width: 2, type: "monotone" },
  { key: "callWall", label: "Call wall", color: chartColors.call, width: 1.5, type: "stepAfter" },
  { key: "putWall", label: "Put wall", color: chartColors.put, width: 1.5, type: "stepAfter" },
  { key: "flip", label: "Flip (dealer model)", color: chartColors.warning, width: 1.5, dash: "4 3", type: "monotone" },
];
const LABEL: Record<string, string> = {
  ...Object.fromEntries(LINES.map((l) => [l.key, l.label])),
  totalGex: "Total GEX",
};
const hhmm = (t: number) => formatTimeIST(t).replace(" IST", "");

function changeText(c: LevelChange): string {
  if (c.key === "totalGex") return c.delta === null ? "—" : fmtCr(c.delta, { signed: true });
  if (c.delta === null)
    return c.from === null && c.to !== null ? "appeared" : c.from !== null && c.to === null ? "gone" : "—";
  if (c.delta === 0 || (c.key === "flip" && !c.changed)) return "unchanged";
  const sign = c.delta > 0 ? "+" : "−";
  return `${sign}${fmtLevel(Math.abs(c.delta))} pts`;
}

/**
 * Call wall, put wall, dealer-model flip and total GEX through the session against spot, with a
 * "changed since open" summary. Falls back to a labelled simulated session.
 */
export function LevelsHistoryCard({ symbol, feed, convention, className }: Props) {
  const sym = symbol.toUpperCase();
  const session = useSessionSeries(sym, feed);
  const cache = useRef(new Map<string, LevelsPoint | null>());

  const points = useMemo(() => {
    if (!session) return [];
    const snaps = thinEvenly(latestSession(session.snaps), 40);
    const out: LevelsPoint[] = [];
    for (const s of snaps) {
      const key = `${s.symbol}|${s.expiry}|${s.ts}|${session.mode}|${convention}|${session.lotSize}`;
      let p = cache.current.get(key);
      if (p === undefined) {
        p = levelsForSnapshot(s, session.lotSize, { convention });
        cache.current.set(key, p);
      }
      if (p) out.push(p);
    }
    if (cache.current.size > 400) cache.current.clear();
    return out;
  }, [session, convention]);

  const changes = useMemo(() => levelsChangedSinceOpen(points), [points]);
  const priceDomain = useMemo<[number, number] | null>(() => {
    const vals = points
      .flatMap((p) => [p.spot, p.callWall, p.putWall, p.flip])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length === 0) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.08, hi * 0.001);
    return [lo - pad, hi + pad];
  }, [points]);
  const yTicks = useMemo(
    () => (priceDomain ? priceTicks(sym, priceDomain[0], priceDomain[1], 6) : []),
    [priceDomain, sym],
  );
  const moves = { call: wallMoves(points, "callWall"), put: wallMoves(points, "putWall") };
  const changedCount = changes.filter((c) => c.changed && c.key !== "spot" && c.key !== "totalGex").length;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <Card className={cn("flex min-w-0 flex-col rounded-card", className)}>
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lead">
              <History className="h-4 w-4 text-primary-ink" aria-hidden />
              Levels through the session
            </CardTitle>
            <p className="mt-0.5 text-body-sm text-muted-foreground">
              Walls and flip recomputed for each snapshot of the nearest expiry, against spot. Total GEX uses the{" "}
              {GEX_CONVENTION_SHORT[convention]}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {session ? <ModeBadge mode={session.mode} asOf={session.asOf} reason={session.reason} /> : null}
            <Badge variant="outline">Derived</Badge>
          </div>
        </div>
        {session?.fallback ? (
          <p className="rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning" role="status">
            Sample session: levels need at least two recorded snapshots. This simulated day shows how the chart reads;
            live levels build while the page is open in market hours.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 pt-0 lg:flex-row">
        {!feed ? (
          <Skeleton className="min-h-[300px] w-full flex-1 rounded-tile" />
        ) : points.length < 2 ? (
          <div className="flex min-h-[240px] flex-1 items-center justify-center rounded-tile border border-dashed border-border px-4 text-center text-body text-muted-foreground">
            Not enough snapshots with open interest to track levels yet.
          </div>
        ) : (
          <>
            <figure className="flex min-w-0 flex-1 flex-col" aria-label={`${sym} gamma levels through the session`}>
              <figcaption className="sr-only">
                From {hhmm(first.ts)} to {hhmm(last.ts)} IST: call wall {fmtLevel(first.callWall)} to{" "}
                {fmtLevel(last.callWall)}, put wall {fmtLevel(first.putWall)} to {fmtLevel(last.putWall)}, spot{" "}
                {fmtLevel(first.spot)} to {fmtLevel(last.spot)}.
              </figcaption>
              <div className="relative min-h-[260px] w-full flex-1">
                <div className="absolute inset-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        scale="time"
                        tickFormatter={hhmm}
                        minTickGap={36}
                        {...axisProps}
                      />
                      <YAxis
                        domain={priceDomain ?? ["auto", "auto"]}
                        ticks={yTicks.length >= 2 ? yTicks : undefined}
                        tickFormatter={(v: number) => Math.round(v).toLocaleString("en-IN")}
                        width={56}
                        allowDataOverflow
                        {...axisProps}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={tooltipItemStyle}
                        cursor={tooltipCursor}
                        labelFormatter={(t: number) => `${hhmm(t)} IST`}
                        formatter={(v: number, name: string) => [fmtLevel(v), LABEL[name] ?? name]}
                      />
                      {LINES.map((l) => (
                        <Line
                          key={l.key}
                          type={l.type}
                          dataKey={l.key}
                          stroke={l.color}
                          strokeWidth={l.width}
                          strokeDasharray={l.dash}
                          dot={false}
                          isAnimationActive={false}
                          connectNulls
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <ul
                className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body-sm text-muted-foreground"
                aria-label="Chart legend"
              >
                {LINES.map((l) => (
                  <li key={l.key} className="flex items-center gap-1.5">
                    <svg width="16" height="6" aria-hidden="true">
                      <line x1="0" y1="3" x2="16" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} />
                    </svg>
                    {l.label}
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <p className="mb-1 flex items-center gap-1 text-micro uppercase text-muted-foreground">
                  Total GEX, ₹ Cr per 1% <MetricHelp metric="gex" />
                </p>
                <div className="h-[84px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" hide />
                      <YAxis tickFormatter={compactAxisTick} width={56} tickCount={3} {...axisProps} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={tooltipItemStyle}
                        cursor={tooltipCursor}
                        labelFormatter={(t: number) => `${hhmm(t)} IST`}
                        formatter={(v: number) => [fmtCr(v, { signed: true }), "Total GEX"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="totalGex"
                        stroke={chartColors.primary}
                        fill={chartColors.primary}
                        fillOpacity={0.12}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </figure>

            <section className="w-full shrink-0 lg:w-[280px]" aria-labelledby="levels-changed-heading">
              <h3 id="levels-changed-heading" className="text-label uppercase text-muted-foreground">
                Changed since open · {hhmm(first.ts)} to {hhmm(last.ts)} IST
              </h3>
              <p className="mt-0.5 text-body-sm text-muted-foreground">
                {changedCount === 0 ? "Walls and flip are where they opened." : `${changedCount} of 3 levels moved.`}{" "}
                Call wall moved {moves.call} time{moves.call === 1 ? "" : "s"}, put wall {moves.put} time
                {moves.put === 1 ? "" : "s"}.
              </p>
              <ul className="mt-2 space-y-1.5">
                {changes.map((c) => (
                  <li
                    key={c.key}
                    className="flex items-center justify-between gap-2 rounded-tile border border-border bg-surface px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-semibold">{c.label}</p>
                      <p className="font-num text-body-sm text-muted-foreground">
                        {c.key === "totalGex" ? fmtCr(c.from ?? NaN) : fmtLevel(c.from)} →{" "}
                        {c.key === "totalGex" ? fmtCr(c.to ?? NaN) : fmtLevel(c.to)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-chip px-1.5 py-0.5 font-num text-micro font-semibold",
                        c.changed && c.key !== "spot" && c.key !== "totalGex"
                          ? "bg-wash-warning text-warning"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {changeText(c)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default LevelsHistoryCard;
