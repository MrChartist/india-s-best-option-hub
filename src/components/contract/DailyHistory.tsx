/** End-of-day history for one contract from the NSE F&O bhavcopy (or a labelled sample). */
import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, barCursor, chartColors, compactAxisTick, gridProps, legendStyle, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatCompactIN, formatDateIST, formatINR, formatNumberIN, formatSigned, type OptionType } from "@/lib/options";
import type { ContractDailyRow } from "@/lib/history/sampleSession";
import { cn } from "@/lib/utils";
import { EmptyState, Panel, PanelSkeleton, ProvenanceBadge } from "./ContractUi";
import type { DailyResult } from "./useContractData";

const shortDate = (iso: string) => formatDateIST(iso).replace(/ \d{4}$/, "");

export function DailyHistory({
  type,
  result,
  loading,
  fetching,
  error,
  days,
  onDaysChange,
  onRetry,
}: {
  type: OptionType;
  result: DailyResult | undefined;
  loading: boolean;
  fetching: boolean;
  error: boolean;
  days: number;
  onDaysChange: (d: number) => void;
  onRetry: () => void;
}) {
  const rows = useMemo<ContractDailyRow[]>(() => result?.rows ?? [], [result]);
  const title = (
    <>
      <CalendarDays className="h-4 w-4 text-primary-ink" aria-hidden="true" />
      Daily history
      {result ? <ProvenanceBadge kind={result.mode === "sample" ? "sample" : result.mode === "bhavcopy" ? "bhavcopy" : "empty"} reason={result.reason} /> : null}
    </>
  );
  const actions = (
    <ToggleGroup type="single" size="sm" value={String(days)} onValueChange={(v) => v && onDaysChange(Number(v))} aria-label="Trading days of history">
      <ToggleGroupItem value="5">5D</ToggleGroupItem>
      <ToggleGroupItem value="10">10D</ToggleGroupItem>
      <ToggleGroupItem value="20">20D</ToggleGroupItem>
    </ToggleGroup>
  );

  if (loading) return <PanelSkeleton height={240} label="Loading daily history" />;

  if (error || !result || result.mode === "unavailable" || rows.length === 0) {
    return (
      <Panel title={title} actions={actions} subtitle="Close, settlement price, OI and volume for each trading day">
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />}
          title={result?.mode === "unavailable" || error ? "Daily history is unavailable" : "This contract has no daily rows yet"}
          action={
            result?.mode !== "sample" ? (
              <Button size="sm" variant="outline" onClick={onRetry} disabled={fetching}>
                {fetching ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />} Try again
              </Button>
            ) : undefined
          }
        >
          {result?.reason ??
            (result && result.answered > 0
              ? `NSE published ${result.answered} bhavcopy file${result.answered === 1 ? "" : "s"} for the period, but this strike was not listed. New strikes are added as the market moves.`
              : "The NSE F&O bhavcopy is read through the local proxy (npm run proxy).")}
        </EmptyState>
      </Panel>
    );
  }

  const lineColour = type === "CE" ? chartColors.call : chartColors.put;
  return (
    <Panel
      title={title}
      actions={actions}
      subtitle={
        result.mode === "sample"
          ? "Simulated end-of-day rows for illustration. Not market data."
          : `From ${result.answered} NSE bhavcopy file${result.answered === 1 ? "" : "s"}; ${rows.length} day${rows.length === 1 ? "" : "s"} listed this contract.`
      }
    >
      <figure aria-label={`Daily close and open interest over ${rows.length} trading days`} className="m-0 h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={20} {...axisProps} />
            <YAxis yAxisId="p" {...axisProps} width={52} domain={["auto", "auto"]} tickFormatter={(v: number) => formatNumberIN(v, v < 10 ? 2 : 0)} />
            <YAxis yAxisId="oi" orientation="right" {...axisProps} width={48} tickFormatter={compactAxisTick} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={barCursor}
              labelFormatter={(v: string) => formatDateIST(v)}
              formatter={(value: number, name: string) => (name === "Open interest" ? [formatNumberIN(value), name] : [formatINR(value), name])}
            />
            <Legend wrapperStyle={legendStyle} />
            <Bar yAxisId="oi" dataKey="oi" name="Open interest" fill={lineColour} fillOpacity={0.22} maxBarSize={22} isAnimationActive={false} />
            <Line yAxisId="p" type="linear" dataKey="close" name="Close" stroke={lineColour} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </figure>

      <div className="mt-4 overflow-x-auto rounded-tile border border-border">
        <table className="w-full min-w-[560px] text-body-sm">
          <caption className="sr-only">Daily close, settlement, open interest, OI change, volume and underlying close</caption>
          <thead className="bg-muted/50 text-label uppercase text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Date</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Close</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Settle</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">OI</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">OI chg</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Volume</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Underlying</th>
            </tr>
          </thead>
          <tbody className="font-num tabular-nums">
            {[...rows].reverse().map((r) => (
              <tr key={r.date} className="border-t border-border">
                <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium">{formatDateIST(r.date)}</th>
                <td className="px-3 py-1.5 text-right">{formatINR(r.close)}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{formatINR(r.settle)}</td>
                <td className="px-3 py-1.5 text-right">{formatCompactIN(r.oi)}</td>
                <td className={cn("px-3 py-1.5 text-right", r.chgOi > 0 ? "text-bullish" : r.chgOi < 0 ? "text-bearish" : "text-muted-foreground")}>{formatSigned(r.chgOi, 0)}</td>
                <td className="px-3 py-1.5 text-right">{formatCompactIN(r.volume)}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{r.underlyingClose > 0 ? formatNumberIN(r.underlyingClose, 2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
