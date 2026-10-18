import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { History } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, barCursor, gridProps, tokenColor, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { cumulativeCash, monthlyCashTotals, type CashFlowDay } from "@/lib/participantsApi";
import { cn } from "@/lib/utils";
import { LegendDot, Stat } from "./ui";
import { PARTICIPANT_COLOR, fmtCrore, shortDate, toneClass } from "./format";

type Range = "20" | "60" | "all";
type View = "daily" | "cumulative";

const MONTH_FMT = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return MONTH_FMT.format(new Date(Date.UTC(y, m - 1, 1)));
}

interface Props {
  days: CashFlowDay[];
  isSample: boolean;
}

export function CashFlowBars({ days, isSample }: Props) {
  const [range, setRange] = useState<Range>("20");
  const [view, setView] = useState<View>("daily");

  const shown = useMemo(() => (range === "all" ? days : days.slice(-Number(range))), [days, range]);
  const chartData = useMemo(() => cumulativeCash(shown).map((d) => ({ ...d, label: shortDate(d.date) })), [shown]);
  const months = useMemo(() => monthlyCashTotals(days).slice(-6), [days]);

  const last = days[days.length - 1];
  const currentMonth = last ? months.find((m) => m.month === last.date.slice(0, 7)) : undefined;
  const windowFii = shown.reduce((s, d) => s + d.fiiNet, 0);
  const windowDii = shown.reduce((s, d) => s + d.diiNet, 0);

  if (!last) {
    return <p className="text-body-sm text-muted-foreground">No FII / DII cash data yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label={`FII net · ${shortDate(last.date)}`} value={fmtCrore(last.fiiNet, { signed: true })} tone={toneClass(last.fiiNet)} hint={`Bought ${fmtCrore(last.fiiBuy)} · sold ${fmtCrore(last.fiiSell)}`} />
        <Stat label={`DII net · ${shortDate(last.date)}`} value={fmtCrore(last.diiNet, { signed: true })} tone={toneClass(last.diiNet)} hint={`Bought ${fmtCrore(last.diiBuy)} · sold ${fmtCrore(last.diiSell)}`} />
        <Stat label="FII month to date" value={fmtCrore(currentMonth?.fiiNet ?? NaN, { signed: true })} tone={toneClass(currentMonth?.fiiNet ?? 0)} hint={currentMonth ? `${currentMonth.days} day${currentMonth.days === 1 ? "" : "s"} ${isSample ? "simulated" : "recorded"}` : undefined} />
        <Stat label="DII month to date" value={fmtCrore(currentMonth?.diiNet ?? NaN, { signed: true })} tone={toneClass(currentMonth?.diiNet ?? 0)} hint={currentMonth ? `${currentMonth.days} day${currentMonth.days === 1 ? "" : "s"} ${isSample ? "simulated" : "recorded"}` : undefined} />
      </div>

      {!isSample && days.length < 5 ? (
        <p role="note" className="flex items-start gap-2 rounded-tile bg-muted/50 px-3 py-2 text-body-sm text-muted-foreground">
          <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          NSE publishes only the latest day of cash-market flows. This page saves each day in your browser, so the history and monthly totals fill in as you come back. {days.length} day{days.length === 1 ? "" : "s"} saved so far.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as View)} aria-label="Chart view">
          <ToggleGroupItem value="daily" size="sm">
            Daily net
          </ToggleGroupItem>
          <ToggleGroupItem value="cumulative" size="sm">
            Cumulative
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" value={range} onValueChange={(v) => v && setRange(v as Range)} aria-label="Range">
          <ToggleGroupItem value="20" size="sm">
            20D
          </ToggleGroupItem>
          <ToggleGroupItem value="60" size="sm">
            60D
          </ToggleGroupItem>
          <ToggleGroupItem value="all" size="sm">
            All
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex flex-wrap gap-3">
        <LegendDot color={PARTICIPANT_COLOR.FII} label="FII / FPI" />
        <LegendDot color={PARTICIPANT_COLOR.DII} label="DII" />
        <span className="font-num text-body-sm tabular-nums text-muted-foreground">
          Window: FII <span className={toneClass(windowFii)}>{fmtCrore(windowFii, { signed: true })}</span> · DII <span className={toneClass(windowDii)}>{fmtCrore(windowDii, { signed: true })}</span>
        </span>
      </div>

      <div className="h-[260px]" role="img" aria-label={`FII and DII ${view === "daily" ? "daily net" : "cumulative net"} cash flows over ${shown.length} sessions, in rupees crore`}>
        <ResponsiveContainer width="100%" height="100%">
          {view === "daily" ? (
            <BarChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barGap={1}>
              <CartesianGrid {...gridProps} />
              <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.7)} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
              <YAxis {...axisProps} width={60} tickFormatter={(v: number) => `${Math.round(v).toLocaleString("en-IN")}`} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={barCursor} formatter={(v: number, name: string) => [fmtCrore(v, { signed: true, decimals: 2 }), name === "fiiNet" ? "FII net" : "DII net"]} />
              <Bar dataKey="fiiNet" fill={PARTICIPANT_COLOR.FII} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={18} />
              <Bar dataKey="diiNet" fill={PARTICIPANT_COLOR.DII} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={18} />
            </BarChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.7)} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
              <YAxis {...axisProps} width={64} tickFormatter={(v: number) => `${Math.round(v).toLocaleString("en-IN")}`} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={tooltipCursor} formatter={(v: number, name: string) => [fmtCrore(v, { signed: true }), name === "fiiCum" ? "FII cumulative" : "DII cumulative"]} />
              <Line type="monotone" dataKey="fiiCum" stroke={PARTICIPANT_COLOR.FII} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="diiCum" stroke={PARTICIPANT_COLOR.DII} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <p className="text-body-sm text-muted-foreground">Values in ₹ crore (provisional figures from NSE, cash market only).</p>

      <div>
        <p className="mb-2 text-label text-muted-foreground">Monthly totals</p>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <Table className="min-w-[420px]">
            <caption className="sr-only">FII and DII net cash flows by month, in rupees crore</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">FII net</TableHead>
                <TableHead className="text-right">DII net</TableHead>
                <TableHead className="text-right">Combined</TableHead>
                <TableHead className="text-right">Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...months].reverse().map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="whitespace-nowrap font-medium">{monthLabel(m.month)}</TableCell>
                  <TableCell className={cn("text-right font-num tabular-nums", toneClass(m.fiiNet))}>{fmtCrore(m.fiiNet, { signed: true })}</TableCell>
                  <TableCell className={cn("text-right font-num tabular-nums", toneClass(m.diiNet))}>{fmtCrore(m.diiNet, { signed: true })}</TableCell>
                  <TableCell className={cn("text-right font-num tabular-nums", toneClass(m.fiiNet + m.diiNet))}>{fmtCrore(m.fiiNet + m.diiNet, { signed: true })}</TableCell>
                  <TableCell className="text-right font-num tabular-nums text-muted-foreground">{m.days}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-1 text-body-sm text-muted-foreground">Totals cover only the days {isSample ? "in the sample" : "saved"}; check Days before comparing months.</p>
      </div>
    </div>
  );
}
