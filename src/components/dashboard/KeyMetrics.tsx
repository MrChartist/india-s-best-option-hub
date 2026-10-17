/**
 * Key market metrics row: NIFTY PCR (with direction vs the last recorded close), India VIX,
 * advance/decline, max pain for NIFTY and BANKNIFTY (with the expiry it refers to) and F&O volume.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Scale, Target, TrendingUp, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllIndices, useFnOStocks, useLiveOptionChain, type OptionChainHookData } from "@/hooks/useMarketData";
import { formatCompactIN, formatDateIST, formatNumberIN, formatPct, istDateString } from "@/lib/options";
import { getDailyStats } from "@/lib/snapshotStore";
import { cn } from "@/lib/utils";
import { ARROW, direction, signTone, statusFrom, sourceName, vixRegime, TONE_TEXT, type Direction, type WidgetStatus } from "./dashboardModel";
import { DataStatus, RetryButton } from "./DataState";
import { useDensityClasses } from "./density";

const shortDate = (iso: string) => (iso ? formatDateIST(iso).replace(/ \d{4}$/, "") : "");

function chainStatus(q: { isLoading: boolean; isError: boolean; data?: OptionChainHookData }): WidgetStatus {
  return statusFrom({ isLoading: q.isLoading, isError: q.isError, hasData: !!q.data && q.data.chain.length > 0, source: q.data?.source, stale: q.data?.stale, isLive: q.data?.isLive });
}

/** Previous recorded NIFTY PCR (from the local snapshot recorder), excluding today. */
function usePrevPcr(symbol: string) {
  return useQuery({
    queryKey: ["dash-prev-pcr", symbol],
    queryFn: async (): Promise<{ pcr: number; date: string } | null> => {
      try {
        const stats = await getDailyStats(symbol, 5);
        const today = istDateString();
        const prev = stats.filter((s) => s.date < today && Number.isFinite(s.pcrOi) && s.pcrOi > 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        return prev ? { pcr: prev.pcrOi, date: prev.date } : null;
      } catch {
        return null;
      }
    },
    staleTime: 10 * 60_000,
    retry: 0,
  });
}

export function KeyMetrics() {
  const qc = useQueryClient();
  const d = useDensityClasses();
  const idx = useAllIndices();
  const fno = useFnOStocks();
  const nifty = useLiveOptionChain("NIFTY");
  const bnf = useLiveOptionChain("BANKNIFTY");
  const prev = usePrevPcr("NIFTY");

  const vix = idx.data.vix;
  const regime = vixRegime(vix?.value);
  const adv = idx.data.advances;
  const dec = idx.data.declines;
  const adTotal = adv + dec;

  const nSt = chainStatus(nifty);
  const bSt = chainStatus(bnf);
  const pcr = nifty.data && nifty.data.totalCEOI > 0 ? nifty.data.totalPEOI / nifty.data.totalCEOI : null;
  const bnfPcr = bnf.data && bnf.data.totalCEOI > 0 ? bnf.data.totalPEOI / bnf.data.totalCEOI : null;
  // Only compare real data with the previous recorded close.
  const pcrDir = nSt === "sample" ? null : direction(pcr, prev.data?.pcr ?? null, 0.01);
  const pcrDirFallback: Direction | null = pcr === null ? null : pcr > 1 ? "up" : pcr < 1 ? "down" : "flat";

  const fnoVol = fno.data?.isLive && fno.data.allStocks.length ? fno.data.allStocks.reduce((s, x) => s + (x.volume || 0), 0) : null;
  const vixDir: Direction | null = vix ? (vix.changePercent > 0 ? "up" : vix.changePercent < 0 ? "down" : "flat") : null;

  const retryChains = () => void qc.invalidateQueries({ queryKey: ["live-option-chain"] });

  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6", d.gap)}>
      <Metric
        to="/max-pain-pcr?symbol=NIFTY"
        icon={<Scale className="h-3.5 w-3.5" />}
        label="NIFTY PCR (OI)"
        status={nSt}
        lastUpdated={nifty.data?.asOf}
        source={sourceName(nifty.data?.source)}
        reason={nifty.data?.reason}
        onRetry={retryChains}
        value={pcr !== null ? formatNumberIN(pcr, 2, { minDecimals: 2 }) : "—"}
        valueClass={pcr === null ? "text-muted-foreground" : pcr >= 1 ? "text-bullish" : "text-bearish"}
        arrow={pcrDir ?? pcrDirFallback}
        arrowTitle={pcrDir && prev.data ? `vs ${formatNumberIN(prev.data.pcr, 2)} on ${shortDate(prev.data.date)}` : "vs 1.00 (neutral)"}
        sub={
          <>
            {pcrDir && prev.data ? <span>Prev {formatNumberIN(prev.data.pcr, 2)} · </span> : <span>{pcr !== null ? (pcr >= 1 ? "Above 1 · " : "Below 1 · ") : ""}</span>}
            {bnfPcr !== null ? <span>BNF {formatNumberIN(bnfPcr, 2)}</span> : null}
          </>
        }
        gauge={pcr !== null ? { value: pcr, min: 0.5, max: 1.5 } : undefined}
      />
      <Metric
        to="/volatility"
        icon={<Activity className="h-3.5 w-3.5" />}
        label="India VIX"
        status={statusFrom({ isLoading: idx.isLoading, hasData: !!vix, source: idx.source, stale: idx.stale, isLive: idx.data.isLive })}
        lastUpdated={idx.asOf}
        source={sourceName(idx.source)}
        onRetry={() => void qc.invalidateQueries({ queryKey: ["nse-all-indices"] })}
        value={vix ? formatNumberIN(vix.value, 2, { minDecimals: 2 }) : "—"}
        arrow={vixDir}
        arrowInvert
        arrowTitle={vix ? `${formatPct(vix.changePercent, { signed: true })} today` : undefined}
        sub={
          vix ? (
            <>
              <span className={vix.changePercent > 0 ? "text-bearish" : vix.changePercent < 0 ? "text-bullish" : undefined}>{formatPct(vix.changePercent, { signed: true })}</span>
              {regime ? <span className={TONE_TEXT[regime.tone]}> · {regime.label}</span> : null}
            </>
          ) : undefined
        }
      />
      <Metric
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        label="Advance / decline"
        status={statusFrom({ isLoading: idx.isLoading, hasData: adTotal > 0, source: idx.source, stale: idx.stale, isLive: idx.data.isLive })}
        lastUpdated={idx.asOf}
        source={sourceName(idx.source)}
        onRetry={() => void qc.invalidateQueries({ queryKey: ["nse-all-indices"] })}
        value={adTotal > 0 ? `${formatNumberIN(adv)} / ${formatNumberIN(dec)}` : "—"}
        valueClass={adTotal === 0 ? "text-muted-foreground" : adv >= dec ? "text-bullish" : "text-bearish"}
        progress={adTotal > 0 ? (adv / adTotal) * 100 : undefined}
        sub={adTotal > 0 ? <span>Ratio {dec > 0 ? formatNumberIN(adv / dec, 2) : "—"}</span> : undefined}
      />
      <MaxPainMetric symbol="NIFTY" q={nifty} status={nSt} onRetry={retryChains} />
      <MaxPainMetric symbol="BANKNIFTY" q={bnf} status={bSt} onRetry={retryChains} />
      <Metric
        icon={<Zap className="h-3.5 w-3.5" />}
        label="F&O stocks volume"
        status={statusFrom({ isLoading: fno.isLoading, isError: fno.isError, hasData: fnoVol !== null, source: fno.data?.source, stale: fno.data?.stale, isLive: fno.data?.isLive })}
        lastUpdated={fno.data?.asOf}
        source={sourceName(fno.data?.source)}
        onRetry={() => void fno.refetch()}
        value={fnoVol !== null ? formatCompactIN(fnoVol) : "—"}
        sub={fnoVol !== null ? <span>Shares, {formatNumberIN(fno.data?.allStocks.length ?? 0)} stocks</span> : <span>Needs a live feed</span>}
      />
    </div>
  );
}

function MaxPainMetric({ symbol, q, status, onRetry }: { symbol: string; q: { data?: OptionChainHookData }; status: WidgetStatus; onRetry: () => void }) {
  const data = q.data;
  const mp = data && data.maxPain > 0 ? data.maxPain : null;
  const dist = mp !== null && data && data.spotPrice > 0 ? data.spotPrice - mp : null;
  const label = symbol === "BANKNIFTY" ? "BANKNIFTY max pain" : "NIFTY max pain";
  return (
    <Metric
      to={`/max-pain-pcr?symbol=${symbol}`}
      icon={<Target className="h-3.5 w-3.5" />}
      label={label}
      status={status}
      lastUpdated={data?.asOf}
      source={sourceName(data?.source)}
      reason={data?.reason}
      onRetry={onRetry}
      value={mp !== null ? formatNumberIN(mp) : "—"}
      sub={
        mp !== null && data ? (
          <>
            {data.expiry ? <span>Exp {shortDate(data.expiry)}</span> : null}
            {dist !== null ? (
              <span>
                {" "}·{" "}
                {Math.round(dist) === 0 ? (
                  "Spot at max pain"
                ) : (
                  // "Spot 0" read as "spot price is 0" and "Spot −50" was ambiguous: say it in words.
                  <>
                    Spot <span className={signTone(dist)}>{formatNumberIN(Math.abs(dist), 0)} pts</span> {dist > 0 ? "above" : "below"}
                  </>
                )}
              </span>
            ) : null}
          </>
        ) : undefined
      }
    />
  );
}

function PcrGauge({ value, min, max }: { value: number; min: number; max: number }) {
  const pct = Math.min(Math.max((value - min) / (max - min), 0), 1) * 100;
  return (
    <div className="relative mt-2 h-1 rounded-full bg-muted" aria-hidden="true">
      <div className="absolute left-1/2 top-[-2px] h-2 w-px bg-muted-foreground/50" />
      <div className={cn("absolute top-[-2px] h-2 w-2 -translate-x-1/2 rounded-full border border-card", value >= 1 ? "bg-bullish" : "bg-bearish")} style={{ left: `${pct}%` }} />
    </div>
  );
}

interface MetricProps {
  icon: ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  sub?: ReactNode;
  status: WidgetStatus;
  lastUpdated?: number;
  source?: string;
  reason?: string;
  onRetry?: () => void;
  to?: string;
  arrow?: Direction | null;
  /** For VIX: up is bad, so up is shown in the bearish colour. */
  arrowInvert?: boolean;
  arrowTitle?: string;
  progress?: number;
  gauge?: { value: number; min: number; max: number };
}

function Metric({ icon, label, value, valueClass, sub, status, lastUpdated, source, reason, onRetry, to, arrow, arrowInvert, arrowTitle, progress, gauge }: MetricProps) {
  const d = useDensityClasses();
  const arrowClass = !arrow || arrow === "flat" ? "text-muted-foreground" : (arrow === "up") !== !!arrowInvert ? "text-bullish" : "text-bearish";
  const showChip = status === "sample" || status === "stale" || status === "derived";

  const body = (
    <Card className={cn("h-full min-h-[104px] transition-shadow duration-200", to && "group-hover:shadow-card-hover", d.pad)}>
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
        <span aria-hidden="true">{icon}</span>
        <p className="min-w-0 truncate text-label uppercase">{label}</p>
      </div>
      {status === "loading" ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      ) : status === "error" || status === "empty" ? (
        <div className="space-y-1.5">
          <p className="font-num text-[21px] font-bold leading-none text-muted-foreground">—</p>
          <p className="text-body-sm text-muted-foreground">{status === "error" ? "Could not load" : "No data yet"}</p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-1.5">
            <p className={cn("font-num text-[21px] font-bold leading-none tabular-nums", valueClass ?? "text-foreground")}>{value}</p>
            {arrow ? (
              <span className={cn("text-body-sm", arrowClass)} title={arrowTitle} aria-label={arrowTitle ? `${arrow} ${arrowTitle}` : arrow}>
                {ARROW[arrow]}
              </span>
            ) : null}
          </div>
          {gauge ? <PcrGauge {...gauge} /> : null}
          {progress !== undefined ? (
            <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-bearish/30" aria-hidden="true">
              <div className="absolute inset-y-0 left-0 rounded-full bg-bullish" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
          {sub ? <p className="mt-1.5 truncate font-num text-body-sm tabular-nums text-muted-foreground">{sub}</p> : null}
        </>
      )}
      {showChip ? (
        <div className="mt-1.5">
          <DataStatus status={status} lastUpdated={lastUpdated} source={source} reason={reason} plain={!!to} />
        </div>
      ) : null}
    </Card>
  );

  if (status === "error" && onRetry) {
    return (
      <div className="relative">
        {body}
        <div className="absolute bottom-3 right-3">
          <RetryButton onRetry={onRetry} />
        </div>
      </div>
    );
  }
  if (!to) return body;
  return (
    <Link to={to} aria-label={`${label}: ${value}. Open details`} className="group block rounded-card focus-visible:shadow-ember focus-visible:outline-none">
      {body}
    </Link>
  );
}

export default KeyMetrics;
