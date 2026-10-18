/** Multi-day straddle from end-of-day bhavcopy: stacked CE + PE closes per day, the underlying close, and a table. */
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, Database, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, chartColors, gridProps, legendStyle, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatDateIST, formatINR, formatNumberIN, formatPct, formatStrike } from "@/lib/options";
import { dailyStraddles, selectionLabel, type StrikeSelection } from "@/lib/straddles";
import { cn } from "@/lib/utils";
import { signTone } from "@/components/expiry/expiryMath";
import { EmptyState, Panel } from "@/components/expiry/ExpiryUi";
import { SpotSparkline } from "@/components/expiry/SpotSparkline";
import type { DailyStraddleData } from "./useDailyStraddles";

interface Props {
  data: DailyStraddleData | undefined;
  loading: boolean;
  error: boolean;
  selection: StrikeSelection;
  mult: number;
  unit: string;
  days: number;
  onDaysChange: (d: number) => void;
}

const shortDate = (iso: string) => formatDateIST(iso).replace(/\s\d{4}$/, "");

export function DailyStraddleView({ data, loading, error, selection, mult, unit, days, onDaysChange, symbol }: Props & { symbol: string }) {
  const rows = useMemo(() => dailyStraddles(data?.days ?? [], selection), [data, selection]);
  const chartRows = useMemo(() => rows.map((r) => ({ date: r.date, ce: r.ce * mult, pe: r.pe * mult, combined: r.combined * mult })), [rows, mult]);
  // Underlying closes indexed by day for the sparkline under the bars (tooltips sync by index).
  const underRows = useMemo(() => rows.map((r, i) => ({ ts: i, spot: r.underlyingClose })), [rows]);
  const dec = mult > 1 ? 0 : 2;
  const sample = data?.mode === "sample";
  const first = rows[0];
  const last = rows[rows.length - 1];

  const badge = sample ? (
    <Badge variant="warning" title="Simulated for illustration. Not market data.">
      <FlaskConical aria-hidden="true" /> Sample data
    </Badge>
  ) : data?.mode === "bhavcopy" ? (
    <Badge variant="info" title={`${data.answered} of ${data.requested} trading days answered`}>
      <Database aria-hidden="true" /> NSE bhavcopy
    </Badge>
  ) : null;

  return (
    <Panel
      title={
        <>
          <CalendarDays className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          Daily straddle
          {badge}
        </>
      }
      subtitle={<>{selectionLabel(selection)} at each day&apos;s close · {unit}</>}
      actions={
        <ToggleGroup type="single" size="sm" value={String(days)} onValueChange={(v) => v && onDaysChange(Number(v))} aria-label="Trading days">
          <ToggleGroupItem value="10">10D</ToggleGroupItem>
          <ToggleGroupItem value="20">20D</ToggleGroupItem>
          <ToggleGroupItem value="40">40D</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {sample && data?.reason ? (
        <p className="mb-3 flex items-start gap-2 rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{data.reason}, so these closes are simulated with the sample chain. They are not market data.</span>
        </p>
      ) : null}
      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading daily bhavcopy">
          <Skeleton className="h-[260px] w-full" />
          <p className="mt-2 text-body-sm text-muted-foreground">Fetching one bhavcopy per trading day through the local proxy. The first load can take a minute.</p>
        </div>
      ) : error ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />} title="Could not load the daily history">
          The bhavcopy request failed. Try again in a minute.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />} title="No daily closes for this pair">
          {selection.kind === "atm" ? "No trading day in range has both legs at the ATM strike." : "The chosen strikes were not listed, or did not trade, on these days. Try the rolling ATM or a strike nearer spot."}
        </EmptyState>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-body-sm">
            <span>
              <span className="text-muted-foreground">Latest close </span>
              <span className="font-num tabular-nums">{formatINR(last.combined * mult, { decimals: dec })}</span>
              <span className="text-muted-foreground"> on {formatDateIST(last.date)}</span>
            </span>
            {rows.length > 1 && first.ceStrike === last.ceStrike && first.peStrike === last.peStrike ? (
              <span>
                <span className="text-muted-foreground">Since {shortDate(first.date)} </span>
                <span className={cn("font-num tabular-nums", signTone(first.combined - last.combined))}>
                  {formatPct(((last.combined - first.combined) / first.combined) * 100, { decimals: 1, signed: true })}
                </span>
              </span>
            ) : null}
            {Number.isFinite(last.combinedPct) ? (
              <span>
                <span className="text-muted-foreground">Premium / spot </span>
                <span className="font-num tabular-nums">{formatPct(last.combinedPct, { decimals: 2 })}</span>
              </span>
            ) : null}
          </div>
          <figure aria-label={`Daily closing premium from ${formatDateIST(first.date)} to ${formatDateIST(last.date)}`}>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} syncId="straddles-daily" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" tickFormatter={shortDate} {...axisProps} minTickGap={16} />
                  <YAxis {...axisProps} width={56} tickFormatter={(v: number) => formatNumberIN(v, 0)} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    cursor={tooltipCursor}
                    labelFormatter={(v: string) => formatDateIST(v)}
                    formatter={(value: number, name: string) => [formatINR(value, { decimals: dec }), name]}
                  />
                  <Legend wrapperStyle={legendStyle} />
                  <Bar dataKey="ce" name="CE close" stackId="pair" fill={chartColors.call} fillOpacity={0.75} isAnimationActive={false} />
                  <Bar dataKey="pe" name="PE close" stackId="pair" fill={chartColors.put} fillOpacity={0.75} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <SpotSparkline
              data={underRows}
              domain={[0, Math.max(1, underRows.length - 1)]}
              syncId="straddles-daily"
              label={`${symbol} close`}
              formatLabel={(i) => (rows[Math.round(i)] ? formatDateIST(rows[Math.round(i)].date) : "")}
              className="hairline-t mt-3 pt-2"
            />
            <figcaption className="mt-2 text-body-sm text-muted-foreground">Bars stack the CE and PE closes, so each bar is the pair&apos;s closing premium. The underlying close sits underneath on its own scale.</figcaption>
          </figure>
          <div className="mt-3 max-h-[360px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Date</TableHead>
                  <TableHead scope="col" className="text-right">Underlying</TableHead>
                  <TableHead scope="col" className="text-right">Strikes</TableHead>
                  <TableHead scope="col" className="hidden text-right sm:table-cell">CE</TableHead>
                  <TableHead scope="col" className="hidden text-right sm:table-cell">PE</TableHead>
                  <TableHead scope="col" className="text-right">Combined</TableHead>
                  <TableHead scope="col" className="text-right">Change</TableHead>
                  <TableHead scope="col" className="hidden text-right md:table-cell">Implied move</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rows].reverse().map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="whitespace-nowrap">{formatDateIST(r.date)}</TableCell>
                    <TableCell className="text-right font-num tabular-nums">{Number.isFinite(r.underlyingClose) ? formatNumberIN(r.underlyingClose, 2) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-num tabular-nums">{r.ceStrike === r.peStrike ? formatStrike(r.ceStrike) : `${formatStrike(r.ceStrike)} / ${formatStrike(r.peStrike)}`}</TableCell>
                    <TableCell className="hidden text-right font-num tabular-nums sm:table-cell">{formatINR(r.ce * mult, { decimals: dec })}</TableCell>
                    <TableCell className="hidden text-right font-num tabular-nums sm:table-cell">{formatINR(r.pe * mult, { decimals: dec })}</TableCell>
                    <TableCell className="text-right font-num tabular-nums">{formatINR(r.combined * mult, { decimals: dec })}</TableCell>
                    <TableCell className={cn("text-right font-num tabular-nums", signTone(-r.change))} title={Number.isFinite(r.change) ? undefined : "First day, or the strikes changed"}>
                      {Number.isFinite(r.changePct) ? formatPct(r.changePct, { decimals: 1, signed: true }) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right font-num tabular-nums md:table-cell">{Number.isFinite(r.impliedMove) ? `±${formatNumberIN(r.impliedMove)}` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-body-sm text-muted-foreground">
            Closing prices from the exchange&apos;s end-of-day file (settlement price when no close is reported). A thinly traded leg can carry a stale close from an earlier trade. For the rolling ATM, change compares each day&apos;s ATM straddle with the previous day&apos;s; for fixed strikes and custom pairs, only while the strikes stay the same. It is coloured from a seller&apos;s view. Implied move is 0.85 × the straddle (straddles only).
          </p>
        </>
      )}
    </Panel>
  );
}
