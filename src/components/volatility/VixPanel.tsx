import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, CalendarRange, Gauge, Layers, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollRegion } from "@/components/ScrollRegion";
import { axisProps, chartColors, gridProps, tokenColor, tooltipCursor, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatDateIST, formatNumberIN, formatPct } from "@/lib/options";
import {
  VIX_ZONE_LABEL,
  vixBands,
  vixImpliedMove,
  vixMoveHitStats,
  vixRegimeStats,
  vixSpotRows,
  vixVrpSeries,
  vixZone,
  vrpSummary,
  weeklyVsMonthly,
} from "@/lib/volatility/vix";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";
import { DataState, DerivedBadge, EmptyState, HelpTip, LegendChip, PanelHeader, SampleBadge, SampleWatermark, StatTile } from "./VolUi";
import { useVixAnalytics } from "./useVolatility";

const shortDate = (iso: string) => formatDateIST(iso).split(" ").slice(0, 2).join(" ");
const pctOrDash = (x: number, d = 0) => (Number.isFinite(x) ? formatPct(x * 100, { decimals: d }) : "—");
const signedPct = (x: number, d = 2) => (Number.isFinite(x) ? formatPct(x, { decimals: d, signed: true }) : "—");

export function VixPanel() {
  const d = useVixAnalytics();
  const bands = useMemo(() => vixBands(d.vix), [d.vix]);
  const chart = useMemo(() => d.vix.slice(-252).map((p) => ({ date: p.date, vix: p.iv })), [d.vix]);
  const vrpRows = useMemo(() => vixVrpSeries(d.vix, d.bars).slice(-252), [d.vix, d.bars]);
  const vrp = useMemo(() => vrpSummary(vrpRows), [vrpRows]);
  const spotRows = useMemo(() => vixSpotRows(d.vix, d.bars), [d.vix, d.bars]);
  const hits = useMemo(() => vixMoveHitStats(spotRows), [spotRows]);
  const regimes = useMemo(() => vixRegimeStats(spotRows, 5), [spotRows]);
  const wm = useMemo(() => weeklyVsMonthly("NIFTY", d.term), [d.term]);
  const zone = vixZone(d.current, bands);
  const spot = d.spot > 0 ? d.spot : d.bars[d.bars.length - 1]?.c ?? NaN;
  const day = vixImpliedMove(spot, d.current, 1);
  const week = vixImpliedMove(spot, d.current, 7);
  const currentBucket = regimes.find((r) => d.current >= r.lo && d.current < r.hi)?.key;
  const sampleBadge = d.isSample ? <SampleBadge /> : <DerivedBadge />;

  if (d.isLoading && d.vix.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <DataState status="loading" minHeight={320} lines={6} />
        </CardContent>
      </Card>
    );
  }
  if (d.vix.length < 2) {
    return (
      <Card>
        <EmptyState icon={Gauge} title="India VIX unavailable" body="India VIX history and NIFTY candles could not be loaded. Start the proxy (npm run proxy) and reload." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {d.isSample ? (
        <p role="note" className="rounded-tile border border-warning/40 bg-wash-warning px-3 py-2 text-body-sm text-warning">
          India VIX history{d.reason ? ` is unavailable (${d.reason})` : " is unavailable"}. Charts and statistics below use a seeded one-year sample anchored at{" "}
          {fmtVol(d.current)} for illustration only. They are not market data.
        </p>
      ) : null}

      <Card>
        <PanelHeader
          icon={Gauge}
          title="India VIX"
          subtitle={`NSE's 30-day implied volatility of NIFTY. ${d.isSample ? "Sample history" : `${bands.n} sessions of history${d.source ? ` (${d.source.toUpperCase()})` : ""}`}.`}
          right={sampleBadge}
        />
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <StatTile label="India VIX" value={fmtVol(d.current, 2)} sub={d.currentLabel} />
            <StatTile
              label="1-year percentile"
              value={Number.isFinite(bands.latestPct) ? formatNumberIN(bands.latestPct, 0) : "—"}
              sub={VIX_ZONE_LABEL[zone]}
              tone={zone === "very-high" || zone === "high" ? "bearish" : zone === "very-low" || zone === "low" ? "bullish" : "default"}
              help="Share of the last year's closes below the latest value. India VIX tends to mean-revert: very low readings rarely last, spikes fade."
            />
            <StatTile
              label="Daily move (1σ)"
              value={Number.isFinite(day.move) ? `±${formatNumberIN(day.move, 0)}` : "—"}
              sub={Number.isFinite(day.pct) ? `${formatPct(day.pct, { decimals: 2 })} · VIX ÷ √365` : "Needs NIFTY spot"}
              help="One standard deviation NIFTY move for one calendar day implied by India VIX. Roughly two days in three should close inside it."
            />
            <StatTile
              label="Weekly move (1σ)"
              value={Number.isFinite(week.move) ? `±${formatNumberIN(week.move, 0)}` : "—"}
              sub={Number.isFinite(week.pct) ? `${formatPct(week.pct, { decimals: 2 })} over 7 days` : "Needs NIFTY spot"}
            />
            <StatTile
              label="VRP now"
              value={fmtVolPts(vrp.latest?.vrp)}
              tone={vrp.latest?.vrp === null || vrp.latest?.vrp === undefined ? "muted" : vrp.latest.vrp > 0 ? "bullish" : "bearish"}
              sub="India VIX − NIFTY HV20"
              help="Volatility risk premium: implied minus recent realised volatility. Usually positive; negative readings follow sharp sell-offs."
            />
            <StatTile
              label="VIX above later RV"
              value={pctOrDash(vrp.overShare)}
              sub={Number.isFinite(vrp.meanFwdGap) ? `avg gap ${fmtVolPts(vrp.meanFwdGap)} · n=${vrp.n}` : "Needs a month of data"}
              help="How often India VIX exceeded the NIFTY realised volatility of the following 21 sessions. Above 50% means options were usually priced rich."
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <PanelHeader
            icon={Layers}
            title="India VIX with percentile bands"
            subtitle="Last year of closes. Shaded: 10th to 90th and 25th to 75th percentiles; dashed: median."
            right={sampleBadge}
          />
          <CardContent className="space-y-3 p-4 pt-0">
            <div className="relative h-[280px]" role="img" aria-label={`India VIX over the last year with percentile bands${d.isSample ? " (sample data)" : ""}`}>
              {d.isSample ? <SampleWatermark /> : null}
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={36} />
                  <YAxis {...axisProps} width={40} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} cursor={tooltipCursor} labelFormatter={(l: string) => formatDateIST(l)} formatter={(v: number) => [fmtVol(v, 2), "India VIX"]} />
                  {Number.isFinite(bands.p10) ? <ReferenceArea y1={bands.p10} y2={bands.p90} fill={tokenColor("chart-3", 0.08)} stroke="none" ifOverflow="extendDomain" /> : null}
                  {Number.isFinite(bands.p25) ? <ReferenceArea y1={bands.p25} y2={bands.p75} fill={tokenColor("chart-3", 0.16)} stroke="none" ifOverflow="extendDomain" /> : null}
                  {Number.isFinite(bands.p50) ? <ReferenceLine y={bands.p50} stroke={chartColors.muted} strokeDasharray="4 4" /> : null}
                  <Line dataKey="vix" name="India VIX" stroke={chartColors.vix} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-1.5 text-body-sm">
              <Badge variant="outline">P10 {fmtVol(bands.p10)}</Badge>
              <Badge variant="outline">P25 {fmtVol(bands.p25)}</Badge>
              <Badge variant="outline">Median {fmtVol(bands.p50)}</Badge>
              <Badge variant="outline">P75 {fmtVol(bands.p75)}</Badge>
              <Badge variant="outline">P90 {fmtVol(bands.p90)}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <PanelHeader
            icon={Activity}
            title="India VIX vs NIFTY realised volatility"
            subtitle="HV20: trailing 20 sessions. Next 21d: realised vol of the month that followed (blank for the latest month)."
            right={sampleBadge}
          />
          <CardContent className="space-y-3 p-4 pt-0">
            {vrpRows.length < 2 ? (
              <EmptyState icon={Activity} title="NIFTY candles unavailable" body="Realised volatility needs NIFTY daily candles from the proxy." />
            ) : (
              <>
                <div className="relative h-[280px]" role="img" aria-label={`India VIX against NIFTY realised volatility${d.isSample ? " (sample data)" : ""}`}>
                  {d.isSample ? <SampleWatermark /> : null}
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={vrpRows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={36} />
                      <YAxis {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} cursor={tooltipCursor} labelFormatter={(l: string) => formatDateIST(l)} formatter={(v: number, name: string) => [fmtVol(v, 2), name]} />
                      <Line dataKey="vix" name="India VIX" stroke={chartColors.vix} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                      <Line dataKey="hv20" name="NIFTY HV20" stroke={chartColors.spot} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                      <Line dataKey="fwd21" name="Realised next 21d" stroke={chartColors.muted} strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-4">
                  <LegendChip color={chartColors.vix} label="India VIX" />
                  <LegendChip color={chartColors.spot} label="NIFTY HV20" />
                  <LegendChip color={chartColors.muted} label="Realised next 21d" dashed />
                </div>
                <p className="text-body-sm text-muted-foreground">
                  Average VIX − HV20 over the year: {fmtVolPts(vrp.meanVrp)}. Option sellers earn this premium on average and give it back in sudden spikes.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <PanelHeader
          icon={Target}
          title="VIX-implied move vs what happened"
          subtitle="How often NIFTY closed inside the 1σ move implied by India VIX at the start. A fair 1σ band holds about 68% of the time."
          right={sampleBadge}
        />
        <CardContent className="grid gap-2 p-4 pt-0 sm:grid-cols-2">
          {(
            [
              ["Next session", hits.daily, day],
              ["Next 5 sessions", hits.weekly, week],
            ] as const
          ).map(([label, h, move]) => {
            const ok = h.n >= 20 && Number.isFinite(h.rate);
            const diff = ok ? h.rate * 100 - 68.3 : NaN;
            return (
              <div key={label} className="rounded-tile border border-border bg-surface/60 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-label uppercase text-muted-foreground">{label}</p>
                  <p className="text-body-sm text-muted-foreground">{Number.isFinite(move.move) ? `now ±${formatNumberIN(move.move, 0)}` : null}</p>
                </div>
                <p className="mt-1.5 font-num text-title tabular-nums">{ok ? formatPct(h.rate * 100, { decimals: 0 }) : "—"}</p>
                <div className="relative mt-2 h-2 rounded-full bg-muted" aria-hidden="true">
                  {ok ? <div className="absolute inset-y-0 left-0 rounded-full bg-info/70" style={{ width: `${Math.min(100, h.rate * 100)}%` }} /> : null}
                  <div className="absolute inset-y-[-3px] w-0.5 bg-foreground" style={{ left: "68.3%" }} />
                </div>
                <p className="mt-1.5 text-body-sm text-muted-foreground">
                  {ok
                    ? `${h.n} windows. ${Math.abs(diff) < 4 ? "In line with" : diff > 0 ? "Held more often than" : "Held less often than"} the 68% a fair 1σ band implies${Math.abs(diff) < 4 ? "" : ` (${formatPct(diff, { decimals: 0, signed: true }).replace("%", " pp")})`}.`
                    : `Needs at least 20 windows (${h.n} available).`}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <PanelHeader
          icon={Layers}
          title="NIFTY by India VIX regime"
          subtitle="Forward NIFTY returns and a model weekly short ATM straddle, grouped by the VIX close on the starting day."
          right={sampleBadge}
        />
        <CardContent className="space-y-3 p-4 pt-0">
          <ScrollRegion label="NIFTY statistics by India VIX bucket" className="rounded-tile border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>India VIX</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Avg 1-day move</TableHead>
                  <TableHead className="text-right">Avg 5-day return</TableHead>
                  <TableHead className="text-right">5 days higher</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Short straddle P&amp;L
                      <HelpTip text="Sell the ATM call and put at the VIX (Black-76, 5 sessions), hold to the fifth session and settle at intrinsic. Average P&L as % of spot, before costs. Ignores skew and the gap between weekly IV and VIX." />
                    </span>
                  </TableHead>
                  <TableHead className="text-right">Straddle win rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regimes.map((r) => (
                  <TableRow key={r.key} className={r.key === currentBucket ? "bg-wash-brand/60" : undefined} aria-current={r.key === currentBucket ? "true" : undefined}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {r.label}
                      {r.key === currentBucket ? (
                        <Badge variant="default" className="ml-1.5">
                          Now
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.n} <span className="text-muted-foreground">({pctOrDash(r.share)})</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number.isFinite(r.avgAbs1d) ? formatPct(r.avgAbs1d, { decimals: 2 }) : "—"}</TableCell>
                    <TableCell className={`text-right tabular-nums ${!Number.isFinite(r.avgRetH) ? "text-muted-foreground" : r.avgRetH >= 0 ? "text-bullish" : "text-bearish"}`}>{signedPct(r.avgRetH)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pctOrDash(r.upShare)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${!Number.isFinite(r.straddlePnl) ? "text-muted-foreground" : r.straddlePnl >= 0 ? "text-bullish" : "text-bearish"}`}>{signedPct(r.straddlePnl)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pctOrDash(r.straddleWin)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
          <p className="text-body-sm text-muted-foreground">Buckets with few days are noisy. Past regimes describe history, not the future.</p>
        </CardContent>
      </Card>

      <Card>
        <PanelHeader
          icon={CalendarRange}
          title="Weekly vs monthly ATM IV"
          subtitle="Front NIFTY expiry against the next monthly expiry. Weekly IV above monthly points to near-term event risk."
          right={d.termIsSample || d.wmHistoryIsSample ? <SampleBadge /> : <DerivedBadge />}
        />
        <CardContent className="space-y-3 p-4 pt-0">
          {wm ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Weekly ATM IV" value={fmtVol(wm.weekly.atmIv, 2)} sub={`${formatDateIST(wm.weekly.expiry)} · ${wm.weekly.dte}d`} />
              <StatTile label="Monthly ATM IV" value={fmtVol(wm.monthly.atmIv, 2)} sub={`${formatDateIST(wm.monthly.expiry)} · ${wm.monthly.dte}d`} />
              <StatTile label="Spread" value={fmtVolPts(wm.spread, 2)} tone={wm.spread > 0.5 ? "bearish" : wm.spread < -0.5 ? "bullish" : "default"} sub="weekly − monthly" />
              <StatTile label="Ratio" value={Number.isFinite(wm.ratio) ? wm.ratio.toFixed(2) : "—"} sub={wm.ratio > 1.05 ? "front richer" : wm.ratio < 0.95 ? "front cheaper" : "about level"} />
            </div>
          ) : (
            <DataState status="empty" emptyText="Weekly and monthly expiries not both available" emptyHint="Needs the NIFTY multi-expiry chain." minHeight={72} />
          )}
          {d.wmHistory.length >= 5 ? (
            <>
              <div className="relative h-[220px]" role="img" aria-label={`Weekly and monthly NIFTY ATM IV over time${d.wmHistoryIsSample ? " (sample data)" : ""}`}>
                {d.wmHistoryIsSample ? <SampleWatermark /> : null}
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.wmHistory} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={36} />
                    <YAxis {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} cursor={tooltipCursor} labelFormatter={(l: string) => formatDateIST(l)} formatter={(v: number, name: string) => [fmtVol(v, 2), name]} />
                    <Line dataKey="weekly" name="Weekly (front)" stroke={chartColors.spot} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                    <Line dataKey="monthly" name="Monthly" stroke={chartColors.iv} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-4">
                <LegendChip color={chartColors.spot} label="Weekly (front)" />
                <LegendChip color={chartColors.iv} label="Monthly" dashed />
                <span className="text-body-sm text-muted-foreground">{d.wmHistoryIsSample ? "Sample history." : "From NSE bhavcopy days cached in this browser."}</span>
              </div>
            </>
          ) : (
            <p className="text-body-sm text-muted-foreground">History appears here after NIFTY bhavcopy days are backfilled on the Overview tab.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
