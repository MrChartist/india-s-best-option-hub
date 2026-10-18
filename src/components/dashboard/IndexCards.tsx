/**
 * Index cards (the dashboard ticker): spot, change, intraday sparkline with a previous-close line,
 * day range, plus compact India VIX and GIFT Nifty tiles. Each card links to its option chain.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Plane } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/MiniChart";
import { useMarketStatus, useStoredCandles } from "@/hooks/useMarketData";
import { useChartData } from "@/hooks/useChartData";
import { formatDateIST, formatNumberIN, formatPct, formatSigned, istDateString } from "@/lib/options";
import type { IndexData } from "@/lib/mockData";
import { cn } from "@/lib/utils";
import { ARROW, rangePosition, signTone, statusFrom, sourceName, vixRegime, TONE_TEXT } from "./dashboardModel";
import { DataState, DataStatus } from "./DataState";
import { useDensityClasses } from "./density";
import { useDashAllIndices, useDashIndices } from "./useDashboardData";

const n2 = (v: number) => formatNumberIN(v, 2, { minDecimals: 2 });

/** Header chip for the indices section. */
export function IndexCardsStatus() {
  const r = useDashIndices();
  const status = statusFrom({ isLoading: r.isLoading, hasData: r.data.data.length > 0, source: r.source, stale: r.stale, isLive: r.data.isLive });
  return <DataStatus status={status} lastUpdated={r.asOf} source={sourceName(r.source)} reason={r.data.reason} pulse />;
}

export function IndexCards() {
  const qc = useQueryClient();
  const r = useDashIndices();
  const { data: status } = useMarketStatus();
  const { data: all, isSample: vixSample } = useDashAllIndices();
  const d = useDensityClasses();
  const indices = r.data.data;
  const st = statusFrom({ isLoading: r.isLoading, hasData: indices.length > 0, source: r.source, stale: r.stale, isLive: r.data.isLive });

  if (st === "loading") {
    return (
      <div className={cn("grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4", d.gap)} aria-busy="true">
        <span className="sr-only">Loading indices</span>
        {["sk-a", "sk-b", "sk-c", "sk-d"].map((id) => (
          <Card key={id} className={cn("space-y-3", d.pad)}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-2 w-full" />
          </Card>
        ))}
      </div>
    );
  }

  if (st === "empty" || st === "error") {
    return (
      <Card className={d.pad}>
        <DataState
          status={st}
          emptyText="Index prices are unavailable"
          emptyHint="The proxy is offline and no prices are saved in the local database yet."
          onRetry={() => void qc.invalidateQueries({ queryKey: ["nse-indices"] })}
        />
      </Card>
    );
  }

  const vix = all?.vix ?? null;
  const gift = status?.giftNifty ?? null;
  const hasGift = !!gift && gift.lastPrice > 0;

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4", d.gap)}>
      {indices.map((index) => (
        <IndexCard key={index.symbol} index={index} samplePath={r.spark[index.symbol]} />
      ))}
      {/* GIFT Nifty has no sample: when it is unavailable it is listed in the "Needs live data" strip instead. */}
      <div className={cn("grid sm:col-span-2 xl:col-span-4", hasGift ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1", d.gap)}>
        <VixTile value={vix?.value ?? null} changePct={vix?.changePercent ?? null} high={vix?.high} low={vix?.low} sample={vixSample} />
        {hasGift && gift ? <GiftTile lastPrice={gift.lastPrice} change={gift.change} changePct={gift.changePercent} niftyClose={status?.indicativeNifty?.value} /> : null}
      </div>
    </div>
  );
}

function useIndexSpark(symbol: string, samplePath?: number[]): { values: number[]; label: string } {
  const { data: stored, isFetched } = useStoredCandles(symbol, "5");
  const intraday = useMemo(() => {
    const candles = stored?.candles ?? [];
    if (candles.length < 3) return null;
    const lastDay = istDateString(new Date(candles[candles.length - 1].time));
    const values = candles.filter((c) => istDateString(new Date(c.time)) === lastDay).map((c) => c.close);
    if (values.length < 3) return null;
    const today = istDateString(new Date());
    return { values, label: lastDay === today ? "Today, 5 min" : `${formatDateIST(lastDay).replace(/ \d{4}$/, "")}, 5 min` };
  }, [stored]);
  const { data: week } = useChartData(symbol, "1W", isFetched && !intraday && !samplePath);
  return useMemo(() => {
    // Sample quotes only ever pair with the sample path generated alongside them.
    if (samplePath && samplePath.length > 2) return { values: samplePath, label: "Sample, 5 min" };
    if (intraday) return intraday;
    if (week && week.length > 2) return { values: week.map((c) => c.close), label: "1W" };
    return { values: [], label: "" };
  }, [samplePath, intraday, week]);
}

function IndexCard({ index, samplePath }: { index: IndexData; samplePath?: number[] }) {
  const d = useDensityClasses();
  const up = index.change >= 0;
  const spark = useIndexSpark(index.symbol, samplePath);
  const hasRange = index.high > index.low && index.low > 0;
  const pos = rangePosition(index.ltp, index.low, index.high);
  const pcPos = index.prevClose > 0 && hasRange ? rangePosition(index.prevClose, index.low, index.high) : null;
  const dir = index.change > 0 ? "up" : index.change < 0 ? "down" : "flat";

  return (
    // Stretched link: the index name is the link (so its accessible name matches what is shown)
    // and its ::after covers the whole card, keeping the full card clickable.
    <div className="group relative block rounded-card focus-within:shadow-ember">
      <Card className={cn("h-full transition-shadow duration-200 group-hover:shadow-card-hover", d.pad)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-label text-muted-foreground">
              <Link
                to={`/option-chain?symbol=${encodeURIComponent(index.symbol)}`}
                className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none"
              >
                {index.name}
                <span className="sr-only">: open option chain</span>
              </Link>
            </p>
            <p className="mt-1 font-num text-num-hero leading-none tabular-nums text-foreground">{n2(index.ltp)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={cn("inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 font-num text-body-sm font-semibold tabular-nums", up ? "bg-wash-profit text-bullish" : "bg-wash-loss text-bearish")}>
              <span aria-hidden="true">{ARROW[dir]}</span>
              {formatPct(index.changePercent, { signed: true })}
            </span>
            <span className={cn("font-num text-body-sm tabular-nums", signTone(index.change))}>{formatSigned(index.change, 2)}</span>
          </div>
        </div>

        <div className="relative mt-2 h-[44px]">
          {spark.values.length > 2 ? (
            <>
              <Sparkline values={spark.values} baseline={index.prevClose > 0 ? index.prevClose : undefined} width="100%" height={44} label={`${index.symbol} ${spark.label} price line with previous close`} />
              <span className="absolute right-0 top-0 rounded-chip bg-card/80 px-1 text-micro text-muted-foreground">{spark.label}</span>
            </>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-separator-strong text-body-sm text-muted-foreground">No chart data yet</div>
          )}
        </div>

        <div className="mt-2 space-y-1.5">
          {hasRange ? (
            <div className="relative h-1.5 rounded-full bg-muted" role="meter" aria-valuemin={Math.round(index.low)} aria-valuemax={Math.round(index.high)} aria-valuenow={Math.round(index.ltp)} aria-label="Position in day range">
              <div className={cn("absolute inset-y-0 left-0 rounded-full", up ? "bg-bullish/40" : "bg-bearish/40")} style={{ width: `${pos}%` }} />
              {pcPos !== null ? <div className="absolute -top-0.5 h-2.5 w-px bg-muted-foreground" style={{ left: `${pcPos}%` }} title="Previous close" /> : null}
              <div className={cn("absolute -top-px h-2 w-2 -translate-x-1/2 rounded-full border border-card", up ? "bg-bullish" : "bg-bearish")} style={{ left: `${pos}%` }} />
            </div>
          ) : null}
          <dl className="grid grid-cols-4 gap-1 font-num text-body-sm tabular-nums text-muted-foreground">
            <div><dt className="text-micro">Open</dt><dd className="text-foreground">{formatNumberIN(index.open, 0)}</dd></div>
            <div><dt className="text-micro">High</dt><dd className="text-foreground">{formatNumberIN(index.high, 0)}</dd></div>
            <div><dt className="text-micro">Low</dt><dd className="text-foreground">{formatNumberIN(index.low, 0)}</dd></div>
            <div className="text-right"><dt className="text-micro">Prev cl.</dt><dd className="text-foreground">{formatNumberIN(index.prevClose, 0)}</dd></div>
          </dl>
        </div>
      </Card>
    </div>
  );
}

function VixTile({ value, changePct, high, low, sample }: { value: number | null; changePct: number | null; high?: number; low?: number; sample?: boolean }) {
  const d = useDensityClasses();
  const regime = vixRegime(value);
  const dir = changePct === null ? null : changePct > 0 ? "up" : changePct < 0 ? "down" : "flat";
  return (
    <div className="group relative block rounded-card focus-within:shadow-ember">
      <Card className={cn("flex h-full items-center gap-3 transition-shadow group-hover:shadow-card-hover", d.padX, "py-2.5")}>
        <Activity className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-label text-muted-foreground">
            <Link to="/volatility" className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none">
              India VIX
              <span className="sr-only">: open volatility</span>
            </Link>
            {sample ? <span className="rounded-chip bg-wash-warning px-1 text-micro font-semibold text-warning">Sample</span> : null}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-num text-lead font-semibold tabular-nums">{value !== null ? n2(value) : "—"}</span>
            {/* VIX up = more fear, so rising VIX is shown in the bearish colour */}
            {dir && changePct !== null ? (
              <span className={cn("font-num text-body-sm tabular-nums", dir === "up" ? "text-bearish" : dir === "down" ? "text-bullish" : "text-muted-foreground")}>
                <span aria-hidden="true">{ARROW[dir]}</span> {formatPct(changePct, { signed: true })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          {regime ? <p className={cn("text-body-sm font-semibold", TONE_TEXT[regime.tone])}>{regime.label}</p> : null}
          {high && low ? <p className="font-num text-body-sm tabular-nums text-muted-foreground">{n2(low)} – {n2(high)}</p> : null}
        </div>
      </Card>
    </div>
  );
}

function GiftTile({ lastPrice, change, changePct, niftyClose }: { lastPrice: number; change: number; changePct: number; niftyClose?: number }) {
  const d = useDensityClasses();
  const has = lastPrice > 0;
  // Implied NIFTY gap from GIFT's own move (vs its previous close). Comparing the
  // GIFT futures level with NIFTY spot would include the carry premium every day.
  const gap = has && niftyClose && niftyClose > 0 && Number.isFinite(changePct) ? (niftyClose * changePct) / 100 : null;
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return (
    <Card className={cn("flex h-full items-center gap-3", d.padX, "py-2.5")}>
      <Plane className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-label text-muted-foreground">GIFT Nifty</p>
        {has ? (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-num text-lead font-semibold tabular-nums">{formatNumberIN(lastPrice, 1)}</span>
            <span className={cn("font-num text-body-sm tabular-nums", signTone(change))}>
              <span aria-hidden="true">{ARROW[dir]}</span> {formatSigned(change, 1)} ({formatPct(changePct, { signed: true })})
            </span>
          </div>
        ) : (
          <p className="text-body-sm text-muted-foreground">Unavailable</p>
        )}
      </div>
      {gap !== null ? (
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-micro text-muted-foreground" title="GIFT Nifty's % change applied to the NIFTY close">Implied gap</p>
          <p className={cn("font-num text-body-sm font-semibold tabular-nums", signTone(gap))}>{formatSigned(gap, 0)} pts</p>
        </div>
      ) : null}
    </Card>
  );
}
