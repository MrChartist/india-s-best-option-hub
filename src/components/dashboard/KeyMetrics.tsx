/**
 * Key market metrics row: NIFTY PCR (banded like the PCR suite, with an arrow only for the change
 * vs the last recorded close), India VIX, advance/decline, max pain for NIFTY and BANKNIFTY (with
 * the expiry it refers to) and F&O volume. Each tile has an inline explainer where one exists.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Scale, Target, TrendingUp, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import MetricHelp from "@/components/learn/MetricHelp";
import { useLiveOptionChain, type OptionChainHookData } from "@/hooks/useMarketData";
import { formatCompactIN, formatDateIST, formatNumberIN, formatPct } from "@/lib/options";
import { PCR_BANDS, pcrSignal } from "@/lib/oiUtils";
import { cn } from "@/lib/utils";
import { ARROW, direction, signTone, statusFrom, sourceName, vixRegime, TONE_TEXT, type Direction, type WidgetStatus } from "./dashboardModel";
import { DataStatus, RetryButton } from "./DataState";
import { useDashAllIndices, useDashFno } from "./useDashboardData";
import { usePrevDailyStat } from "./usePrevStat";
import { useDensityClasses } from "./density";

const shortDate = (iso: string) => (iso ? formatDateIST(iso).replace(/ \d{4}$/, "") : "");

function chainStatus(q: { isLoading: boolean; isError: boolean; data?: OptionChainHookData }): WidgetStatus {
  return statusFrom({ isLoading: q.isLoading, isError: q.isError, hasData: !!q.data && q.data.chain.length > 0, source: q.data?.source, stale: q.data?.stale, isLive: q.data?.isLive });
}

export function KeyMetrics() {
  const qc = useQueryClient();
  const d = useDensityClasses();
  const idx = useDashAllIndices();
  const fno = useDashFno();
  const nifty = useLiveOptionChain("NIFTY");
  const bnf = useLiveOptionChain("BANKNIFTY");
  const prevStat = usePrevDailyStat("NIFTY");
  const prev = prevStat.data?.pcr != null ? { pcr: prevStat.data.pcr, date: prevStat.data.date } : null;

  const vix = idx.data.vix;
  const regime = vixRegime(vix?.value);
  const adv = idx.data.advances;
  const dec = idx.data.declines;
  const adTotal = adv + dec;

  const nSt = chainStatus(nifty);
  const bSt = chainStatus(bnf);
  const pcr = nifty.data && nifty.data.totalCEOI > 0 ? nifty.data.totalPEOI / nifty.data.totalCEOI : null;
  const bnfPcr = bnf.data && bnf.data.totalCEOI > 0 ? bnf.data.totalPEOI / bnf.data.totalCEOI : null;
  // The arrow is only for the day-over-day change, and only real data is compared with a recorded close.
  const pcrDir = nSt === "sample" ? null : direction(pcr, prev?.pcr ?? null, 0.01);
  const sig = pcr !== null ? pcrSignal(pcr) : null;

  const fnoLive = !!fno.data && (fno.data.isLive || fno.data.source === "sample") && fno.data.allStocks.length > 0;
  const fnoVol = fnoLive && fno.data ? fno.data.allStocks.reduce((s, x) => s + (x.volume || 0), 0) : null;
  const vixDir: Direction | null = vix ? (vix.changePercent > 0 ? "up" : vix.changePercent < 0 ? "down" : "flat") : null;

  const retryChains = () => void qc.invalidateQueries({ queryKey: ["live-option-chain"] });

  return (
    <div className={cn("grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6", d.gap)}>
      <Metric
        to="/max-pain-pcr?symbol=NIFTY"
        icon={<Scale className="h-3.5 w-3.5" />}
        label="NIFTY PCR (OI)"
        metric="pcr"
        metricValue={pcr ?? undefined}
        status={nSt}
        lastUpdated={nifty.data?.asOf}
        source={sourceName(nifty.data?.source)}
        reason={nifty.data?.reason}
        onRetry={retryChains}
        value={pcr !== null ? formatNumberIN(pcr, 2, { minDecimals: 2 }) : "—"}
        valueClass={sig ? (sig.band === "balanced" ? "text-foreground" : sig.className) : "text-muted-foreground"}
        chip={sig ? <PcrChip band={sig.band} label={sig.label} /> : undefined}
        arrow={pcrDir}
        arrowTitle={pcrDir && prev ? `vs ${formatNumberIN(prev.pcr, 2)} on ${shortDate(prev.date)}` : undefined}
        sub={
          <>
            {pcrDir && prev ? <span>Prev {formatNumberIN(prev.pcr, 2)} · </span> : null}
            {bnfPcr !== null ? <span>BNF {formatNumberIN(bnfPcr, 2)}</span> : null}
          </>
        }
        gauge={pcr !== null ? { value: pcr, min: 0.4, max: 1.8 } : undefined}
      />
      <Metric
        to="/volatility"
        icon={<Activity className="h-3.5 w-3.5" />}
        label="India VIX"
        metric="iv"
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
        label="F&O volume"
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
  const label = symbol === "BANKNIFTY" ? "BNF max pain" : "NIFTY max pain";
  return (
    <Metric
      to={`/max-pain-pcr?symbol=${symbol}`}
      icon={<Target className="h-3.5 w-3.5" />}
      label={label}
      metric="maxPain"
      metricValue={mp ?? undefined}
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

const PCR_CHIP: Record<string, string> = {
  balanced: "bg-muted text-muted-foreground",
  "call-heavy": "bg-wash-loss text-bearish",
  "put-heavy": "bg-wash-profit text-bullish",
  "extreme-put": "bg-wash-warning text-warning",
};

/** Band chip: same banding and wording as the PCR suite (0.7 to 1.2 is "Balanced"). */
function PcrChip({ band, label }: { band: string; label: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-chip px-1.5 py-0.5 text-micro font-semibold uppercase", PCR_CHIP[band] ?? PCR_CHIP.balanced)}>{band === "balanced" ? "Balanced" : label.split(" · ")[0]}</span>;
}

/** PCR gauge with the balanced band shaded; the marker takes the band's colour (neutral inside it). */
function PcrGauge({ value, min, max }: { value: number; min: number; max: number }) {
  const at = (v: number) => Math.min(Math.max((v - min) / (max - min), 0), 1) * 100;
  const sig = pcrSignal(value);
  const dot = sig.band === "balanced" ? "bg-muted-foreground" : sig.band === "call-heavy" ? "bg-bearish" : sig.band === "put-heavy" ? "bg-bullish" : "bg-warning";
  return (
    <div className="relative mt-2 h-1 rounded-full bg-muted" aria-hidden="true">
      <div className="absolute inset-y-0 rounded-full bg-muted-foreground/25" style={{ left: `${at(PCR_BANDS.low)}%`, right: `${100 - at(PCR_BANDS.high)}%` }} />
      <div className={cn("absolute top-[-2px] h-2 w-2 -translate-x-1/2 rounded-full border border-card", dot)} style={{ left: `${at(value)}%` }} />
    </div>
  );
}

interface MetricProps {
  icon: ReactNode;
  label: string;
  /** Learn metric key for the inline explainer (MetricHelp). */
  metric?: string;
  metricValue?: number;
  /** Small chip next to the value (e.g. the PCR band). */
  chip?: ReactNode;
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

function Metric({ icon, label, metric, metricValue, chip, value, valueClass, sub, status, lastUpdated, source, reason, onRetry, to, arrow, arrowInvert, arrowTitle, progress, gauge }: MetricProps) {
  const d = useDensityClasses();
  const arrowClass = !arrow || arrow === "flat" ? "text-muted-foreground" : (arrow === "up") !== !!arrowInvert ? "text-bullish" : "text-bearish";
  const showChip = status === "sample" || status === "stale" || status === "derived";

  // The whole tile is clickable through a stretched link, so the explainer button and the status
  // chip can sit on top of it without nesting interactive elements inside a link.
  return (
    <Card className={cn("relative h-full min-h-[104px] transition-shadow duration-200", to && "hover:shadow-card-hover focus-within:shadow-card-hover", d.pad)}>
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
        <span aria-hidden="true">{icon}</span>
        <p className="min-w-0 truncate text-label uppercase" title={label}>
          {to ? (
            <Link to={to} aria-label={`${label}: ${value}. Open details`} className="rounded-sm after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:shadow-ember">
              {label}
            </Link>
          ) : (
            label
          )}
        </p>
        {metric ? <MetricHelp metric={metric} value={metricValue} className="relative z-10 shrink-0" /> : null}
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
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <p className={cn("font-num text-[21px] font-bold leading-none tabular-nums", valueClass ?? "text-foreground")}>{value}</p>
            {arrow ? (
              <span className={cn("text-body-sm", arrowClass)} title={arrowTitle} aria-label={arrowTitle ? `${arrow} ${arrowTitle}` : arrow}>
                {ARROW[arrow]}
              </span>
            ) : null}
            {chip}
          </div>
          {gauge ? <PcrGauge {...gauge} /> : null}
          {progress !== undefined ? (
            <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-bearish/30" aria-hidden="true">
              <div className="absolute inset-y-0 left-0 rounded-full bg-bullish" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
          {sub ? <p className="mt-1.5 line-clamp-2 font-num text-body-sm tabular-nums text-muted-foreground">{sub}</p> : null}
        </>
      )}
      {showChip ? (
        <div className="relative z-10 mt-1.5 w-fit">
          <DataStatus status={status} lastUpdated={lastUpdated} source={source} reason={reason} />
        </div>
      ) : null}
      {status === "error" && onRetry ? (
        <div className="absolute bottom-3 right-3 z-10">
          <RetryButton onRetry={onRetry} />
        </div>
      ) : null}
    </Card>
  );
}

export default KeyMetrics;
