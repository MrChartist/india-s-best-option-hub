/**
 * Index day-change bars (spot, from the live index feed) and the India VIX history.
 * No futures prices are invented: the card shows spot performance only.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, BarChart3 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { useStoredCandles } from "@/hooks/useMarketData";
import { useChartData } from "@/hooks/useChartData";
import { axisProps, chartColors, gridProps, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatNumberIN, formatPct, formatSigned, istDateString } from "@/lib/options";
import { cn } from "@/lib/utils";
import { ARROW, signTone, sourceName, statusFrom, vixRegime, TONE_TEXT } from "./dashboardModel";
import { DataState, DataStatus } from "./DataState";
import { useDensityClasses } from "./density";
import { sampleVixHistory } from "./sampleMarket";
import { useDashAllIndices, useDashIndices } from "./useDashboardData";

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });

export function FuturesVIX() {
  const qc = useQueryClient();
  const d = useDensityClasses();
  const idx = useDashIndices();
  const all = useDashAllIndices();
  const stored = useStoredCandles("INDIAVIX", "5");
  // Daily closes built from the 5-minute candles saved by the database manager (last close per IST day).
  const storedDaily = useMemo(() => {
    const byDay = new Map<string, { time: number; close: number }>();
    for (const c of stored.data?.candles ?? []) byDay.set(istDateString(new Date(c.time)), { time: c.time, close: c.close });
    return Array.from(byDay.values()).sort((a, b) => a.time - b.time);
  }, [stored.data]);
  const hasStored = storedDaily.length >= 5;
  const api = useChartData("INDIAVIX", "3M", stored.isFetched && !hasStored && !all.isSample);

  const rows = useMemo(() => idx.data.data.filter((r) => r.ltp > 0), [idx.data.data]);
  const maxAbs = useMemo(() => Math.max(0.5, ...rows.map((r) => Math.abs(r.changePercent))), [rows]);
  const idxStatus = statusFrom({ isLoading: idx.isLoading, hasData: rows.length > 0, source: idx.source, stale: idx.stale, isLive: idx.data.isLive });

  const vix = all.data.vix;
  const sampleValue = all.isSample ? vix?.value ?? 0 : 0;
  const vixSeries = useMemo(() => {
    // A sample VIX is only ever drawn with the sample history generated to end at it.
    if (sampleValue > 0) return { points: sampleVixHistory(sampleValue).map((c) => ({ t: dateFmt.format(new Date(c.time)), vix: c.close })), source: "Sample history", sample: true };
    if (hasStored) return { points: storedDaily.map((c) => ({ t: dateFmt.format(new Date(c.time)), vix: c.close })), source: "Local DB", sample: false };
    if (api.data && api.data.length > 1) return { points: api.data.map((c) => ({ t: dateFmt.format(new Date(c.time * 1000)), vix: c.close })), source: "Historical API", sample: false };
    return null;
  }, [sampleValue, hasStored, storedDaily, api.data]);

  const regime = vixRegime(vix?.value);
  const vixStatus = statusFrom({ isLoading: all.isLoading && !vix, hasData: !!vix, source: all.source, stale: all.stale, isLive: all.data.isLive });
  const chartStatus = vixSeries ? (vixSeries.sample ? "sample" : hasStored ? "stale" : "delayed") : stored.isLoading || api.isLoading ? "loading" : "empty";

  return (
    <div className={cn("grid lg:grid-cols-5", d.gap)}>
      <Card className="lg:col-span-2">
        <div className={cn("flex items-center gap-2", d.headPad)}>
          <BarChart3 className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          <h3 className="font-display text-headline">Index day change</h3>
          <div className="ml-auto">
            <DataStatus status={idxStatus} lastUpdated={idx.asOf} source={sourceName(idx.source)} />
          </div>
        </div>
        <div className={cn("pt-0", d.pad)}>
          <DataState status={idxStatus} onRetry={() => void qc.invalidateQueries({ queryKey: ["nse-indices"] })} emptyText="No index prices yet">
            <ul className="space-y-2.5" aria-label="Index change today">
              {rows.map((r) => {
                const w = (Math.abs(r.changePercent) / maxAbs) * 50;
                const up = r.changePercent >= 0;
                return (
                  <li key={r.symbol} className="grid grid-cols-[88px_1fr_72px] items-center gap-2">
                    <Link to={`/option-chain?symbol=${r.symbol}`} className="truncate rounded-sm text-body font-medium hover:underline focus-visible:shadow-focus focus-visible:outline-none">
                      {r.symbol}
                    </Link>
                    <div className="relative h-3 rounded-full bg-muted" aria-hidden="true">
                      <div className="absolute inset-y-[-3px] left-1/2 w-px bg-muted-foreground/40" />
                      <div className={cn("absolute inset-y-0 rounded-full", up ? "left-1/2 bg-bullish/70" : "right-1/2 bg-bearish/70")} style={{ width: `${w}%` }} />
                    </div>
                    <span className={cn("text-right font-num text-body-sm font-semibold tabular-nums", signTone(r.changePercent))}>
                      <span aria-hidden="true">{ARROW[r.changePercent > 0 ? "up" : r.changePercent < 0 ? "down" : "flat"]}</span> {formatPct(r.changePercent, { signed: true })}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-body-sm text-muted-foreground">Spot change vs the previous close. Futures basis is on the Option Chain page.</p>
          </DataState>
        </div>
      </Card>

      <Card className="lg:col-span-3">
        <div className={cn("flex flex-wrap items-center gap-2", d.headPad)}>
          <Activity className="h-4 w-4 text-warning" aria-hidden="true" />
          <h3 className="font-display text-headline">India VIX</h3>
          {vix ? (
            <span className="font-num text-lead font-semibold tabular-nums">
              {formatNumberIN(vix.value, 2, { minDecimals: 2 })}{" "}
              <span className={cn("text-body-sm font-medium", vix.changePercent > 0 ? "text-bearish" : vix.changePercent < 0 ? "text-bullish" : "text-muted-foreground")}>
                {formatPct(vix.changePercent, { signed: true })}
              </span>
            </span>
          ) : null}
          {regime ? <span className={cn("text-body-sm font-semibold", TONE_TEXT[regime.tone])}>{regime.label}</span> : null}
          <div className="ml-auto flex items-center gap-1.5">
            <DataStatus status={vixStatus} lastUpdated={all.asOf} source={sourceName(all.source)} />
          </div>
        </div>
        <div className={cn("pt-0", d.pad)}>
          {vix ? (
            <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
              {[
                { k: "Change", v: Number.isFinite(vix.change) ? formatSigned(vix.change, 2) : "—" },
                { k: "Day low", v: vix.low ? formatNumberIN(vix.low, 2) : "—" },
                { k: "Day high", v: vix.high ? formatNumberIN(vix.high, 2) : "—" },
              ].map((x) => (
                <div key={x.k} className="rounded-md bg-surface px-2 py-1.5">
                  <dt className="text-micro text-muted-foreground">{x.k}</dt>
                  <dd className="font-num text-body font-semibold tabular-nums">{x.v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <DataState status={chartStatus} minHeight={140} emptyText="No VIX history yet" emptyHint="Download history from the database manager, or wait for the historical feed.">
            {vixSeries ? (
              <figure>
                <div className="h-[150px]" role="img" aria-label={`India VIX history, ${vixSeries.points.length} sessions`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={vixSeries.points} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="dash-vix-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={chartColors.vix} stopOpacity={0.28} />
                          <stop offset="100%" stopColor={chartColors.vix} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="t" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
                      <YAxis {...axisProps} domain={["auto", "auto"]} width={44} allowDecimals={false} tickCount={5} tickFormatter={(v: number) => formatNumberIN(v, Number.isInteger(v) ? 0 : 1)} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={tooltipCursor} formatter={(v: number) => [formatNumberIN(v, 2), "VIX"]} />
                      <Area type="monotone" dataKey="vix" stroke={chartColors.vix} fill="url(#dash-vix-grad)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <figcaption className="mt-1 text-body-sm text-muted-foreground">Daily closes · {vixSeries.source}</figcaption>
              </figure>
            ) : null}
          </DataState>
        </div>
      </Card>
    </div>
  );
}
