import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollRegion } from "@/components/ScrollRegion";
import { axisProps, chartColors, gridProps, seriesColor, tooltipCursor, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { dteLabel, formatDateIST, formatNumberIN } from "@/lib/options";
import { expiryChartRows, expiryMarkers, expirySourceCounts } from "@/lib/volatility/atmHistory";
import { computeIvStats, type IvPoint } from "@/lib/volatility/history";
import type { TermPoint } from "@/lib/volatility/surface";
import { fmtVol } from "@/lib/volatility/format";
import { DataState, EmptyState, HelpTip, LegendChip, PanelHeader, SampleBadge, SampleWatermark, DerivedBadge } from "./VolUi";
import { useExpiryAtmHistory } from "./useVolatility";

export interface AtmIvHistoryProps {
  symbol: string;
  term: TermPoint[];
  isSample: boolean;
  /** One-year IV history used for the IVR / IVP reference lines (IV30, India VIX or sample). */
  rankHistory: IvPoint[];
  rankLabel: string;
  rankIsSample: boolean;
}

const shortDate = (iso: string) => formatDateIST(iso).split(" ").slice(0, 2).join(" ");
const MAX_EXPIRIES = 4;

export function AtmIvHistory({ symbol, term, isSample, rankHistory, rankLabel, rankIsSample }: AtmIvHistoryProps) {
  const expiries = useMemo(() => term.filter((t) => t.dte >= 1).slice(0, MAX_EXPIRIES).map((t) => t.expiry), [term]);
  const hist = useExpiryAtmHistory(symbol, expiries, isSample, rankHistory);
  const rows = useMemo(() => expiryChartRows(hist.data, expiries), [hist.data, expiries]);
  const markers = useMemo(() => new Map(expiries.map((e) => [e, expiryMarkers(hist.data[e] ?? [])])), [hist.data, expiries]);
  const yearStats = useMemo(() => computeIvStats(NaN, rankHistory), [rankHistory]);
  const median = useMemo(() => {
    const xs = rankHistory.slice(-252).map((p) => p.iv).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : NaN;
  }, [rankHistory]);
  const counts = useMemo(() => expirySourceCounts(hist.data), [hist.data]);
  const showRefs = yearStats.n >= 20;

  return (
    <Card>
      <PanelHeader
        icon={History}
        title="ATM IV history by expiry"
        subtitle={`Each listed expiry's ATM IV over time. Reference lines mark the one-year ${rankLabel} low (IVR 0), median (IVP 50) and high (IVR 100).`}
        right={hist.isSample || rankIsSample ? <SampleBadge /> : <DerivedBadge />}
      />
      <CardContent className="space-y-3 p-4 pt-0">
        <DataState status={hist.isLoading ? "loading" : "live"} minHeight={240} lines={4}>
          {rows.length < 2 ? (
            <EmptyState
              icon={History}
              title="No per-expiry IV history yet"
              body="Use the bhavcopy backfill on the Overview tab, or keep the Option Chain open during market hours so daily snapshots are recorded in this browser."
            />
          ) : (
            <>
              <div className="relative h-[280px]" role="img" aria-label={`ATM implied volatility over time for ${expiries.length} ${symbol} expiries${hist.isSample ? " (sample data)" : ""}`}>
                {hist.isSample ? <SampleWatermark /> : null}
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={32} />
                    <YAxis {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={tooltipLabelStyle}
                      cursor={tooltipCursor}
                      labelFormatter={(l: string) => formatDateIST(l)}
                      formatter={(v: number, name: string) => [fmtVol(v, 2), name]}
                    />
                    {showRefs ? (
                      <>
                        <ReferenceLine y={yearStats.low} stroke={chartColors.bullish} strokeDasharray="4 4" label={{ value: `IVR 0 · ${fmtVol(yearStats.low)}`, fill: chartColors.muted, fontSize: 10, position: "insideBottomRight" }} />
                        <ReferenceLine y={median} stroke={chartColors.muted} strokeDasharray="2 4" label={{ value: `IVP 50 · ${fmtVol(median)}`, fill: chartColors.muted, fontSize: 10, position: "insideTopRight" }} />
                        <ReferenceLine y={yearStats.high} stroke={chartColors.bearish} strokeDasharray="4 4" label={{ value: `IVR 100 · ${fmtVol(yearStats.high)}`, fill: chartColors.muted, fontSize: 10, position: "insideTopRight" }} />
                      </>
                    ) : null}
                    {expiries.map((e, i) => (
                      <Line key={e} dataKey={e} name={formatDateIST(e)} stroke={seriesColor(i)} strokeWidth={i === 0 ? 2.25 : 1.5} dot={false} connectNulls isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-4">
                {expiries.map((e, i) => (
                  <LegendChip key={e} color={seriesColor(i)} label={`${formatDateIST(e)} · ${dteLabel(e)}`} />
                ))}
                {showRefs ? <LegendChip color={chartColors.muted} label={`One-year ${rankLabel} markers`} dashed /> : null}
              </div>
            </>
          )}
        </DataState>

        <ScrollRegion label="ATM IV markers by expiry" className="rounded-tile hairline">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Latest</TableHead>
                <TableHead className="text-right">High</TableHead>
                <TableHead className="text-right">Low</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    IVR in life <HelpTip text="Where the latest ATM IV sits between this expiry's own lowest (0) and highest (100) recorded ATM IV. Needs 20 or more days." />
                  </span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    IVP vs 1y <HelpTip text={`Share of the last year of ${rankLabel} readings below this expiry's latest ATM IV. Compares a single expiry with a 30-day measure, so treat it as a guide.`} />
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expiries.map((e) => {
                const m = markers.get(e);
                const vsYear = m && Number.isFinite(m.latest) ? computeIvStats(m.latest, rankHistory) : null;
                return (
                  <TableRow key={e}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatDateIST(e)} <span className="text-muted-foreground">{dteLabel(e)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m?.n ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtVol(m?.latest)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {fmtVol(m?.high)} {m?.highDate ? <span className="text-muted-foreground">{shortDate(m.highDate)}</span> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {fmtVol(m?.low)} {m?.lowDate ? <span className="text-muted-foreground">{shortDate(m.lowDate)}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m?.ivRank === null || m?.ivRank === undefined ? "—" : formatNumberIN(m.ivRank, 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{vsYear && !vsYear.insufficient && vsYear.ivPercentile !== null ? formatNumberIN(vsYear.ivPercentile, 0) : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollRegion>
        <p className="text-body-sm text-muted-foreground">
          Sources:{" "}
          {[
            counts.bhavcopy ? `${counts.bhavcopy} bhavcopy points` : null,
            counts.snapshot ? `${counts.snapshot} recorded snapshot points` : null,
            counts.sample ? `${counts.sample} sample points (illustration, not market data)` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "none yet"}
          .
        </p>
      </CardContent>
    </Card>
  );
}
