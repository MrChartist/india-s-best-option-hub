/** Straddles at several fixed strikes around the opening ATM, in rupees or rebased to 100 at the first snapshot. */
import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Layers } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, gridProps, legendStyle, seriesColor, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatINR, formatNumberIN, formatPct, formatStrike } from "@/lib/options";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { multiStrikeRows, strikesAround } from "@/lib/straddles";
import { cn } from "@/lib/utils";
import { hhmmIST, indexSnapshot, openingATM, pairedStrikes, signTone } from "@/components/expiry/expiryMath";
import { DerivedBadge, EmptyState, ModeBadge, Panel } from "@/components/expiry/ExpiryUi";
import type { SessionMode } from "@/components/expiry/useExpirySession";

interface Props {
  snaps: ChainSnapshot[];
  mult: number;
  unit: string;
  mode: SessionMode;
  domain: [number, number];
  /** Strike to highlight (the selected pair's CE strike when it is a straddle). */
  highlight?: number;
}

export function MultiStrikeChart({ snaps, mult, unit, mode, domain, highlight }: Props) {
  const [view, setView] = useState<"rupees" | "pct">("rupees");
  const [width, setWidth] = useState("2");
  const centre = useMemo(() => openingATM(snaps), [snaps]);
  const strikes = useMemo(() => {
    const first = snaps.find((s) => s.rows.length > 0);
    return first ? strikesAround(pairedStrikes(indexSnapshot(first)), centre, Number(width)) : [];
  }, [snaps, centre, width]);
  const { rows, series } = useMemo(() => multiStrikeRows(snaps, strikes, { view, mult }), [snaps, strikes, view, mult]);
  const dec = mult > 1 ? 0 : 2;
  const colorOf = (i: number) => seriesColor(i);

  return (
    <Panel
      title={
        <>
          <Layers className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          Multi-strike comparison
          <ModeBadge mode={mode} />
        </>
      }
      subtitle={<>Straddles fixed at strikes around the opening ATM{Number.isFinite(centre) ? ` (${formatStrike(centre)})` : ""} · {view === "pct" ? "100 = first snapshot" : unit}</>}
      actions={
        <>
          <ToggleGroup type="single" size="sm" value={width} onValueChange={(v) => v && setWidth(v)} aria-label="Strikes either side of ATM">
            <ToggleGroupItem value="1">±1</ToggleGroupItem>
            <ToggleGroupItem value="2">±2</ToggleGroupItem>
            <ToggleGroupItem value="3">±3</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" size="sm" value={view} onValueChange={(v) => v && setView(v as "rupees" | "pct")} aria-label="Scale">
            <ToggleGroupItem value="rupees">₹</ToggleGroupItem>
            <ToggleGroupItem value="pct">% of start</ToggleGroupItem>
          </ToggleGroup>
        </>
      }
    >
      {series.length === 0 || rows.length < 2 ? (
        <EmptyState icon={<Layers className="h-6 w-6" aria-hidden="true" />} title="No strikes to compare yet">
          Needs at least two snapshots with prices on both sides of several strikes.
        </EmptyState>
      ) : (
        <>
          <figure aria-label={`Straddle premium over time at strikes ${series.map((x) => formatStrike(x.strike)).join(", ")}`}>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="ts" type="number" scale="time" domain={domain} tickFormatter={(v: number) => hhmmIST(v)} {...axisProps} minTickGap={28} />
                  <YAxis {...axisProps} width={56} domain={["auto", "auto"]} tickFormatter={(v: number) => (view === "pct" ? `${v.toFixed(0)}` : formatNumberIN(v, 0))} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    cursor={tooltipCursor}
                    labelFormatter={(v: number) => `${hhmmIST(v)} IST`}
                    formatter={(value: number, name: string) => [view === "pct" ? value.toFixed(1) : formatINR(value, { decimals: dec }), name]}
                  />
                  <Legend wrapperStyle={legendStyle} />
                  {series.map((x, i) => (
                    <Line
                      key={x.strike}
                      type="linear"
                      dataKey={`k${x.strike}`}
                      name={`${formatStrike(x.strike)}${x.strike === centre ? " (ATM)" : ""}`}
                      stroke={colorOf(i)}
                      strokeWidth={x.strike === highlight || (highlight === undefined && x.strike === centre) ? 2.25 : 1.25}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </figure>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Strike</TableHead>
                  <TableHead scope="col" className="text-right">Start</TableHead>
                  <TableHead scope="col" className="text-right">Now</TableHead>
                  <TableHead scope="col" className="hidden text-right sm:table-cell">Range</TableHead>
                  <TableHead scope="col" className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {series.map((x, i) => (
                  <TableRow key={x.strike}>
                    <TableCell className="whitespace-nowrap font-num tabular-nums">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(i) }} aria-hidden="true" />
                        {formatStrike(x.strike)}
                        {x.strike === centre ? <span className="text-label uppercase text-muted-foreground">ATM</span> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-num tabular-nums">{formatINR(x.first * mult, { decimals: dec })}</TableCell>
                    <TableCell className="text-right font-num tabular-nums">{formatINR(x.last * mult, { decimals: dec })}</TableCell>
                    <TableCell className="hidden text-right font-num tabular-nums sm:table-cell">
                      {formatNumberIN(x.low * mult, dec)}–{formatNumberIN(x.high * mult, dec)}
                    </TableCell>
                    <TableCell className={cn("text-right font-num tabular-nums", signTone(-x.changePct))}>{Number.isFinite(x.changePct) ? formatPct(x.changePct, { decimals: 1, signed: true }) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
            <DerivedBadge title="From snapshots" />
            Change is coloured from a seller&apos;s view: a falling premium shows green. Strikes away from spot lose value more slowly in rupees but often faster in percent.
          </div>
        </>
      )}
    </Panel>
  );
}
