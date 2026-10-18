/**
 * IV rank widgets for the dashboard, backed by real history:
 * India VIX for NIFTY (falling back to the chain's ATM IV30, marked derived, when VIX is missing),
 * bhavcopy IV30 plus recorded end-of-day ATM IV for other symbols. When the proxy is offline the
 * ranks use a seeded one-year sample history and carry a sample label. With a live chain but fewer
 * than 20 days of history the widgets say "No history" instead of inventing a number.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumberIN } from "@/lib/options";
import { hvSnapshot } from "@/lib/volatility/history";
import { DerivedBadge, HelpTip, HintChip, SampleBadge } from "@/components/volatility/VolUi";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";
import { useDailyBars, useIvRank } from "@/components/volatility/useVolatility";

const rankTone = (v: number | null) => (v === null ? "text-muted-foreground" : v > 50 ? "text-bearish" : v < 20 ? "text-bullish" : "text-warning");
const barTone = (v: number) => (v > 50 ? "bg-bearish/70" : v < 20 ? "bg-bullish/70" : "bg-warning/70");
const noHistoryHint = (n: number) =>
  `IV rank needs at least 20 days of IV history; ${n} ${n === 1 ? "day is" : "days are"} available. Open the Volatility page to build it from the NSE bhavcopy.`;

export interface IVRankCardProps {
  symbol: string;
  /** Ignored. Kept so older callers still compile; the card reads real IV history itself. */
  currentIV?: number;
}

/** Compact card: IV rank as the headline number, the current 30-day IV beside it, and the one-year range. */
export function IVRankCard({ symbol }: IVRankCardProps) {
  const r = useIvRank(symbol);
  const { stats } = r;
  const rank = stats.ivRank;
  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-1 flex items-center justify-between gap-1">
          <p className="flex min-w-0 items-center gap-1.5 truncate text-label uppercase text-muted-foreground">
            <Gauge className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {symbol}
          </p>
          <Link
            to={`/volatility?symbol=${encodeURIComponent(symbol)}`}
            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
            aria-label={`Open ${symbol} volatility`}
          >
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        {r.isLoading ? (
          <p className="text-body-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <p className={`font-num text-title tabular-nums ${rankTone(rank)}`} aria-label={`IV rank ${rank === null ? "unavailable" : Math.round(rank)}`}>
                {rank === null ? "—" : formatNumberIN(rank, 0)}
              </p>
              <p className="text-body-sm tabular-nums text-muted-foreground">IV {fmtVol(r.current)}</p>
            </div>
            {stats.insufficient ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <HintChip hint={noHistoryHint(stats.n)}>No history</HintChip>
                {r.currentIsSample ? <SampleBadge /> : r.currentIsDerived ? <DerivedBadge /> : null}
              </div>
            ) : (
              <div className="mt-1.5">
                <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rank ?? 0)} aria-label={`${symbol} IV rank`}>
                  <div className={`absolute inset-y-0 left-0 rounded-full ${barTone(rank ?? 0)}`} style={{ width: `${rank ?? 0}%` }} />
                </div>
                <div className="mt-0.5 flex justify-between text-body-sm tabular-nums text-muted-foreground">
                  <span>{fmtVol(stats.low)}</span>
                  <span>{fmtVol(stats.high)}</span>
                </div>
                {r.currentIsSample || r.historyIsSample || r.currentIsDerived ? (
                  <div className="mt-1 flex flex-wrap gap-1">{r.currentIsSample || r.historyIsSample ? <SampleBadge /> : <DerivedBadge />}</div>
                ) : null}
              </div>
            )}
            <p className="mt-1 text-micro uppercase text-muted-foreground">IV rank · {r.basisLabel}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const DASHBOARD_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"];

function ScannerRow({ symbol }: { symbol: string }) {
  const r = useIvRank(symbol);
  const bars = useDailyBars(symbol);
  // Sample IV is only ever compared with the sample bars generated alongside it.
  const barData = r.historyIsSample ? r.sampleBars : r.currentIsSample ? null : bars.data;
  const hv = useMemo(() => (barData && barData.length ? hvSnapshot(barData) : null), [barData]);
  const { stats } = r;
  const vrp = hv ? r.current - hv.hv20 : NaN;
  const sample = r.currentIsSample || r.historyIsSample;
  const rank = stats.ivRank;
  return (
    <li className="grid grid-cols-[minmax(84px,1fr)_minmax(80px,2fr)_repeat(2,minmax(52px,auto))] items-center gap-x-3 gap-y-1 rounded-tile px-2 py-2 hover:bg-accent/50 sm:grid-cols-[minmax(96px,1fr)_minmax(110px,2fr)_repeat(5,minmax(56px,auto))]">
      <div className="min-w-0">
        <Link to={`/volatility?symbol=${encodeURIComponent(symbol)}`} className="block truncate text-body font-semibold hover:underline focus-visible:shadow-ember focus-visible:outline-none">
          {symbol}
        </Link>
        {sample ? <span className="text-micro uppercase text-warning">Sample</span> : r.currentIsDerived ? <span className="text-micro uppercase text-info">Derived</span> : null}
      </div>
      <div className="min-w-0">
        {stats.insufficient ? (
          <HintChip hint={noHistoryHint(stats.n)}>No history</HintChip>
        ) : (
          <div className="relative h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className={`absolute inset-y-0 left-0 rounded-full ${barTone(rank ?? 0)}`} style={{ width: `${rank ?? 0}%` }} />
          </div>
        )}
      </div>
      <span className={`text-right text-body font-semibold tabular-nums ${rankTone(rank)}`}>{rank === null ? "—" : formatNumberIN(rank, 0)}</span>
      <span className="text-right text-body tabular-nums">{fmtVol(r.current)}</span>
      <span className="hidden text-right text-body tabular-nums text-muted-foreground sm:block">{stats.ivPercentile === null ? "—" : formatNumberIN(stats.ivPercentile, 0)}</span>
      <span className="hidden text-right text-body tabular-nums text-muted-foreground sm:block">{hv ? fmtVol(hv.hv20) : "—"}</span>
      <span className={`hidden text-right text-body tabular-nums sm:block ${!Number.isFinite(vrp) ? "text-muted-foreground" : vrp > 0 ? "text-bullish" : "text-bearish"}`}>{fmtVolPts(vrp)}</span>
    </li>
  );
}

/** IV rank scanner for the main indices, from real history. */
export function IVRankDashboard() {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-lead">
          <Gauge className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          IV rank scanner
          <HelpTip
            text={
              <>
                <strong>IV rank</strong>: where 30-day IV sits in its one-year range (0 low, 100 high). <strong>IVP</strong>: share of days IV was lower.{" "}
                <strong>VRP</strong>: IV minus 20-day realised vol. NIFTY uses India VIX; others use NSE bhavcopy IV30 built on the Volatility page.
              </>
            }
          />
          <Link to="/volatility" className="ml-auto text-body-sm font-medium text-primary-ink hover:underline focus-visible:shadow-ember focus-visible:outline-none">
            Open Volatility
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="grid grid-cols-[minmax(84px,1fr)_minmax(80px,2fr)_repeat(2,minmax(52px,auto))] gap-x-3 px-2 pb-1 text-label uppercase text-muted-foreground sm:grid-cols-[minmax(96px,1fr)_minmax(110px,2fr)_repeat(5,minmax(56px,auto))]">
          <span>Symbol</span>
          <span>Range</span>
          <span className="text-right">IVR</span>
          <span className="text-right">IV</span>
          <span className="hidden text-right sm:block">IVP</span>
          <span className="hidden text-right sm:block">HV20</span>
          <span className="hidden text-right sm:block">VRP</span>
        </div>
        <ul className="space-y-0.5">
          {DASHBOARD_SYMBOLS.map((s) => (
            <ScannerRow key={s} symbol={s} />
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-bullish" aria-hidden="true" />IVR below 20</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />20 to 50</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-bearish" aria-hidden="true" />Above 50</span>
          <span className="sm:ml-auto">Educational labels, not trade signals.</span>
        </div>
      </CardContent>
    </Card>
  );
}
