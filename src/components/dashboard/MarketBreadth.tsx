/**
 * Market breadth: a simple composite score, NSE advance/decline, the VIX regime and F&O stock breadth.
 * Educational summaries, never trade calls.
 */
import { useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, BarChart3, Gauge, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatNumberIN, formatPct } from "@/lib/options";
import { cn } from "@/lib/utils";
import { sentimentLabel, sentimentScore, sourceName, statusFrom, vixRegime, TONE_TEXT } from "./dashboardModel";
import { DataState, DataStatus } from "./DataState";
import { useDensityClasses } from "./density";
import { useDashAllIndices, useDashFno } from "./useDashboardData";

export function MarketBreadth() {
  const qc = useQueryClient();
  const d = useDensityClasses();
  const idx = useDashAllIndices();
  const fno = useDashFno();

  const { advances, declines, unchanged } = idx.data;
  const total = advances + declines + unchanged;
  const vix = idx.data.vix?.value ?? null;
  const vixChange = idx.data.vix?.changePercent ?? null;
  const regime = vixRegime(vix);

  const stocks = fno.data?.allStocks ?? [];
  const up = stocks.filter((s) => s.changePercent > 0).length;
  const down = stocks.filter((s) => s.changePercent < 0).length;
  const sectors = idx.data.sectors ?? [];
  const secUp = sectors.filter((s) => s.change > 0).length;
  const secDown = sectors.filter((s) => s.change < 0).length;

  const score = useMemo(
    () => sentimentScore({ advances, declines, unchanged, vix, stocksUp: up, stocksDown: down, totalStocks: stocks.length }),
    [advances, declines, unchanged, vix, up, down, stocks.length],
  );
  const sl = sentimentLabel(score);

  const hasAny = total > 0 || stocks.length > 0 || vix !== null;
  // Any sample input makes the composite a sample; it is never shown as live.
  const anySample = idx.isSample || fno.isSample;
  const status = statusFrom({ isLoading: idx.isLoading || fno.isLoading, hasData: hasAny, source: anySample ? "sample" : idx.data.isLive ? idx.source : fno.data?.source, stale: idx.stale && !!fno.data?.stale, isLive: idx.data.isLive || fno.data?.isLive });
  const idxStatus = statusFrom({ hasData: total > 0 || vix !== null, source: idx.source, stale: idx.stale, isLive: idx.data.isLive });
  const retry = () => {
    void qc.invalidateQueries({ queryKey: ["nse-all-indices"] });
    void fno.refetch();
  };

  if (status === "loading" || status === "empty" || status === "error") {
    return (
      <Card className={d.pad}>
        <DataState status={status} onRetry={retry} emptyText="Market breadth is unavailable" emptyHint="Advance/decline and F&O breadth load from NSE during market hours." />
      </Card>
    );
  }

  const head = (icon: ReactNode, title: string, extra?: ReactNode) => (
    <div className={cn("flex items-center gap-2", d.headPad)}>
      <span className="text-primary-ink" aria-hidden="true">{icon}</span>
      <h3 className="font-display text-headline">{title}</h3>
      {extra ? <div className="ml-auto">{extra}</div> : null}
    </div>
  );

  return (
    <div className={cn("grid sm:grid-cols-2 xl:grid-cols-4", d.gap)}>
      <Card>
        {head(<Gauge className="h-4 w-4" />, "Breadth score", <DataStatus status={status} lastUpdated={idx.asOf} source={sourceName(idx.source)} />)}
        <div className={cn("space-y-3 pt-0", d.pad)}>
          <div className="text-center">
            <p className={cn("font-num text-num-hero tabular-nums", TONE_TEXT[sl.tone])}>{score}</p>
            <p className={cn("mt-1 text-body font-semibold", TONE_TEXT[sl.tone])}>{sl.label}</p>
          </div>
          <div className="relative h-2.5 rounded-full bg-gradient-to-r from-bearish/40 via-warning/40 to-bullish/40" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Breadth score">
            <div className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-card bg-foreground" style={{ left: `${score}%` }} />
          </div>
          <div className="flex justify-between text-body-sm text-muted-foreground">
            <span>Weak</span>
            <span>Neutral</span>
            <span>Strong</span>
          </div>
          <p className="text-body-sm text-muted-foreground">Blend of advance/decline, VIX level and F&O breadth. Not a signal.</p>
        </div>
      </Card>

      <Card>
        {head(<BarChart3 className="h-4 w-4" />, "Advance / decline", idx.isSample ? <DataStatus status="sample" reason="Advances and declines across the sample F&O stock list, not the NSE market." /> : null)}
        <div className={cn("space-y-3 pt-0", d.pad)}>
          {total > 0 ? (
            <>
              <dl className="grid grid-cols-3 text-center">
                <div>
                  <dt className="text-label text-muted-foreground">Advances</dt>
                  <dd className="font-num text-title tabular-nums text-bullish">▲ {formatNumberIN(advances)}</dd>
                </div>
                <div>
                  <dt className="text-label text-muted-foreground">Unchanged</dt>
                  <dd className="font-num text-title tabular-nums text-muted-foreground">{formatNumberIN(unchanged)}</dd>
                </div>
                <div>
                  <dt className="text-label text-muted-foreground">Declines</dt>
                  <dd className="font-num text-title tabular-nums text-bearish">▼ {formatNumberIN(declines)}</dd>
                </div>
              </dl>
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                <div className="bg-bullish" style={{ width: `${(advances / total) * 100}%` }} />
                <div className="bg-muted-foreground/30" style={{ width: `${(unchanged / total) * 100}%` }} />
                <div className="bg-bearish" style={{ width: `${(declines / total) * 100}%` }} />
              </div>
              <p className="text-center text-body-sm text-muted-foreground">
                A/D ratio <span className={cn("font-num font-semibold tabular-nums", advances >= declines ? "text-bullish" : "text-bearish")}>{declines > 0 ? formatNumberIN(advances / declines, 2) : "—"}</span>
              </p>
            </>
          ) : (
            <p className="py-6 text-center text-body-sm text-muted-foreground">Advance/decline needs the NSE feed.</p>
          )}
        </div>
      </Card>

      <Card>
        {head(<Activity className="h-4 w-4" />, "VIX regime", idx.isSample ? <DataStatus status={idxStatus} reason={idx.data.reason} /> : null)}
        <div className={cn("space-y-3 pt-0", d.pad)}>
          <div className="text-center">
            <p className={cn("font-num text-num-hero tabular-nums", regime ? TONE_TEXT[regime.tone] : "text-muted-foreground")}>{vix !== null ? formatNumberIN(vix, 2, { minDecimals: 2 }) : "—"}</p>
            {vixChange !== null ? (
              <p className={cn("mt-1 font-num text-body-sm font-semibold tabular-nums", vixChange > 0 ? "text-bearish" : vixChange < 0 ? "text-bullish" : "text-muted-foreground")}>
                {vixChange > 0 ? "▲" : vixChange < 0 ? "▼" : "■"} {formatPct(vixChange, { signed: true })}
              </p>
            ) : null}
          </div>
          {regime ? (
            <div className="rounded-md bg-surface p-2.5">
              <p className={cn("text-body font-semibold", TONE_TEXT[regime.tone])}>{regime.label}</p>
              <p className="text-body-sm text-muted-foreground">{regime.note}</p>
            </div>
          ) : (
            <p className="text-center text-body-sm text-muted-foreground">VIX unavailable.</p>
          )}
          <p className="text-body-sm text-muted-foreground">Bands: under 12 very low, 12–15 low, 15–20 normal, 20–25 elevated, above 25 high.</p>
        </div>
      </Card>

      <Card>
        {head(<TrendingUp className="h-4 w-4" />, "F&O breadth", fno.data ? <DataStatus status={statusFrom({ hasData: stocks.length > 0, source: fno.data.source, stale: fno.data.stale, isLive: fno.data.isLive })} lastUpdated={fno.data.asOf} source={sourceName(fno.data.source)} /> : null)}
        <div className={cn("space-y-3 pt-0", d.pad)}>
          {stocks.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-wash-profit p-2.5 text-center">
                  <p className="font-num text-title tabular-nums text-bullish">{formatNumberIN(up)}</p>
                  <p className="text-label text-muted-foreground">Stocks up</p>
                </div>
                <div className="rounded-md bg-wash-loss p-2.5 text-center">
                  <p className="font-num text-title tabular-nums text-bearish">{formatNumberIN(down)}</p>
                  <p className="text-label text-muted-foreground">Stocks down</p>
                </div>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-bearish/30" aria-hidden="true">
                <div className="absolute inset-y-0 left-0 bg-bullish" style={{ width: `${(up / stocks.length) * 100}%` }} />
              </div>
              <dl className="space-y-1 text-body-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Sectors up / down</dt><dd className="font-num tabular-nums"><span className="text-bullish">{secUp}</span> / <span className="text-bearish">{secDown}</span></dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">F&O stocks tracked</dt><dd className="font-num tabular-nums">{formatNumberIN(stocks.length)}</dd></div>
              </dl>
            </>
          ) : (
            <p className="py-6 text-center text-body-sm text-muted-foreground">F&O stock prices are not loaded yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
