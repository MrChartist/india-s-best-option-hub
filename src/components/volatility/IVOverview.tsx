import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, DatabaseZap, Gauge, History, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, chartColors, gridProps, tooltipCursor, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatDateIST, formatNumberIN, type OHLC } from "@/lib/options";
import { REGIME_LABEL, countBySource, hvSnapshot, ivHvSeries, ivRegime } from "@/lib/volatility/history";
import type { BackfillProgress } from "@/lib/volatility/api";
import { DerivedBadge, EmptyState, HelpTip, LegendChip, PanelHeader, SampleBadge, StatTile } from "./VolUi";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";
import type { IvBasis, IvRankResult } from "./useVolatility";

export interface IVOverviewProps {
  symbol: string;
  rank: IvRankResult;
  /** Live IV30 from the multi-expiry chain (percent). */
  iv30: number;
  iv30IsSample: boolean;
  bars: OHLC[] | undefined;
  barsLoading: boolean;
  barsError: boolean;
  basis: IvBasis;
  onBasisChange?: (b: IvBasis) => void;
  canUseVix: boolean;
  backfill: { run: (days: number) => void; cancel: () => void; progress: BackfillProgress | null; running: boolean };
}

const shortDate = (iso: string) => {
  const s = formatDateIST(iso);
  return s.split(" ").slice(0, 2).join(" ");
};

export function IVOverview({ symbol, rank, iv30, iv30IsSample, bars, barsLoading, barsError, basis, onBasisChange, canUseVix, backfill }: IVOverviewProps) {
  const hv = useMemo(() => (bars && bars.length ? hvSnapshot(bars) : null), [bars]);
  const series = useMemo(() => ivHvSeries(rank.history, bars ?? []), [rank.history, bars]);
  const counts = useMemo(() => countBySource(rank.history), [rank.history]);
  const { stats } = rank;
  const regime = ivRegime(stats.ivRank);

  // VRP compares 30-day implied with 20-day realised.
  const vrpIv = !iv30IsSample && Number.isFinite(iv30) ? iv30 : basis === "vix" ? rank.current : NaN;
  const vrp = hv && Number.isFinite(vrpIv) && Number.isFinite(hv.hv20) ? vrpIv - hv.hv20 : NaN;
  const insufficientText = `Insufficient history (${stats.n} day${stats.n === 1 ? "" : "s"})`;
  const p = backfill.progress;

  return (
    <div className="space-y-4">
      <Card>
        <PanelHeader
          icon={Gauge}
          title={`${symbol} implied vs realised volatility`}
          subtitle={`IV rank basis: ${rank.basisLabel}. ${rank.historySummary}.`}
          right={
            <>
              {canUseVix && onBasisChange ? (
                <ToggleGroup
                  type="single"
                  value={basis}
                  onValueChange={(v) => v && onBasisChange(v as IvBasis)}
                  className="rounded-tab bg-muted p-0.5"
                  aria-label="IV rank basis"
                >
                  <ToggleGroupItem value="vix" className="h-7 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-card">
                    India VIX
                  </ToggleGroupItem>
                  <ToggleGroupItem value="iv30" className="h-7 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-card">
                    ATM IV30
                  </ToggleGroupItem>
                </ToggleGroup>
              ) : null}
              {rank.currentIsSample ? <SampleBadge /> : <DerivedBadge />}
            </>
          }
        />
        <CardContent className="space-y-4 p-4 pt-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <StatTile
              label={basis === "vix" ? "India VIX" : "IV30"}
              value={fmtVol(rank.current)}
              sub={rank.currentLabel}
              help="The current 30-day implied volatility. India VIX is NSE's 30-day NIFTY volatility index; IV30 is ATM IV interpolated to 30 days from the live chain."
            />
            <StatTile
              label="IV rank"
              value={stats.ivRank === null ? "—" : formatNumberIN(stats.ivRank, 0)}
              tone={stats.ivRank === null ? "muted" : stats.ivRank > 50 ? "bearish" : stats.ivRank < 20 ? "bullish" : "warning"}
              sub={stats.insufficient ? insufficientText : `${fmtVol(stats.low)} to ${fmtVol(stats.high)} range`}
              help="Where today's IV sits between the lowest (0) and highest (100) IV of the last year of history."
            />
            <StatTile
              label="IV percentile"
              value={stats.ivPercentile === null ? "—" : formatNumberIN(stats.ivPercentile, 0)}
              tone={stats.ivPercentile === null ? "muted" : "default"}
              sub={stats.insufficient ? insufficientText : `of ${stats.n} days were lower`}
              help="The share of days in the history window when IV was below today's level."
            />
            <StatTile
              label="HV20"
              value={hv ? fmtVol(hv.hv20) : barsLoading ? "…" : "—"}
              sub="20-day close-to-close"
              help="Realised volatility of daily closes over the last 20 sessions, annualised with 252 trading days."
            />
            <StatTile
              label="VRP"
              value={fmtVolPts(vrp)}
              tone={!Number.isFinite(vrp) ? "muted" : vrp > 0 ? "bullish" : "bearish"}
              sub="IV30 − HV20"
              help="Volatility risk premium. Positive means options price more movement than the market has recently delivered."
            />
            <StatTile
              label="HV60"
              value={hv ? fmtVol(hv.hv60) : barsLoading ? "…" : "—"}
              sub="60-day close-to-close"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            {regime === "unknown" ? (
              <Badge variant="neutral">{stats.insufficient ? insufficientText : "Regime unknown"}</Badge>
            ) : (
              <Badge variant={regime === "premium-selling" ? "bearish" : regime === "premium-buying" ? "bullish" : "neutral"}>{REGIME_LABEL[regime]}</Badge>
            )}
            <p className="text-body-sm text-muted-foreground">
              Educational label only: IV rank above 50 has historically favoured selling premium, below 20 buying it. It is not a trade signal.
            </p>
          </div>

          {basis === "iv30" && (stats.insufficient || counts.bhavcopy < 60) ? (
            <div className="flex flex-col gap-2 rounded-tile border border-dashed border-border bg-surface/50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-body font-semibold">
                  <DatabaseZap className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Build IV history from NSE bhavcopy
                </p>
                <p className="text-body-sm text-muted-foreground">
                  Downloads end-of-day F&amp;O prices through your proxy and solves IV30 for each day with Black-76. Results are saved in this browser.
                </p>
                {p ? (
                  <div className="mt-2 max-w-sm">
                    <Progress value={p.total ? (p.done / p.total) * 100 : 100} className="h-1.5" aria-label="Backfill progress" />
                    <p className="mt-1 text-body-sm text-muted-foreground">
                      {p.done} of {p.total} days · {p.added} added{p.failed ? ` · ${p.failed} failed` : ""}
                      {!backfill.running && p.failed >= 3 && p.added === 0 ? " · proxy or NSE archive unreachable" : ""}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {backfill.running ? (
                  <Button size="sm" variant="outline" onClick={backfill.cancel}>
                    <X aria-hidden="true" /> Stop
                  </Button>
                ) : (
                  [30, 90, 250].map((d) => (
                    <Button key={d} size="sm" variant={d === 30 ? "default" : "outline"} onClick={() => backfill.run(d)}>
                      {d === 30 ? <History aria-hidden="true" /> : null}
                      {d} days
                    </Button>
                  ))
                )}
                {backfill.running ? <Loader2 className="h-4 w-4 animate-spin self-center text-muted-foreground" aria-label="Running" /> : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <PanelHeader
          icon={Activity}
          title="IV history vs realised volatility"
          subtitle="Daily. HV is computed from index or stock closes (Yahoo Finance via the proxy)."
          right={
            <div className="flex flex-wrap gap-3">
              <LegendChip color={chartColors.iv} label={rank.basisLabel} />
              <LegendChip color={chartColors.spot} label="HV20" />
              <LegendChip color={chartColors.muted} label="HV60" dashed />
            </div>
          }
        />
        <CardContent className="p-4 pt-0">
          {series.length < 2 ? (
            <EmptyState
              icon={History}
              title={barsLoading ? "Loading history…" : "Not enough history to chart yet"}
              body={
                barsError
                  ? "Daily candles are unavailable. Start the proxy (npm run proxy) to load realised volatility."
                  : basis === "iv30"
                    ? "Use the bhavcopy backfill above, or keep the Option Chain open during market hours so end-of-day IV is recorded."
                    : "India VIX history could not be loaded from the proxy."
              }
            />
          ) : (
            <div className="h-[300px]" role="img" aria-label={`${rank.basisLabel} and realised volatility over time`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={36} />
                  <YAxis {...axisProps} width={44} tickFormatter={(v: number) => `${v}%`} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    cursor={tooltipCursor}
                    labelFormatter={(l: string) => formatDateIST(l)}
                    formatter={(v: number, name: string) => [fmtVol(v), name]}
                  />
                  <Line type="monotone" dataKey="iv" name={rank.basisLabel} stroke={chartColors.iv} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="hv20" name="HV20" stroke={chartColors.spot} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="hv60" name="HV60" stroke={chartColors.muted} strokeWidth={1.25} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <PanelHeader icon={Activity} title="Realised volatility estimators" subtitle="Annualised with 252 trading days. Different estimators use different parts of the daily bar." />
        <CardContent className="p-4 pt-0">
          {hv ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <StatTile label="C2C 10d" value={fmtVol(hv.hv10)} />
              <StatTile label="C2C 20d" value={fmtVol(hv.hv20)} />
              <StatTile label="C2C 60d" value={fmtVol(hv.hv60)} />
              <StatTile label="Parkinson 20d" value={fmtVol(hv.parkinson20)} help="Uses the daily high-low range. More efficient than close-to-close but ignores overnight gaps." />
              <StatTile label="Yang-Zhang 20d" value={fmtVol(hv.yangZhang20)} help="Combines overnight gaps, open-to-close and the intraday range. Robust to drift and gaps." />
            </div>
          ) : (
            <p className="py-4 text-center text-body-sm text-muted-foreground">
              {barsLoading ? "Loading daily candles…" : "Daily candles unavailable. Realised volatility needs the proxy."}
            </p>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-body-sm text-muted-foreground">
            <HelpTip text="IV rank needs at least 20 days of history. India VIX history comes from NSE (or Yahoo when NSE is down). Bhavcopy IV30 is solved in your browser from NSE end-of-day prices." />
            Sources: {counts.vix ? `${counts.vix} VIX days` : null}
            {counts.bhavcopy ? ` ${counts.bhavcopy} bhavcopy days` : null}
            {counts.snapshot ? ` ${counts.snapshot} recorded days` : null}
            {!counts.vix && !counts.bhavcopy && !counts.snapshot ? "no IV history yet" : null}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
