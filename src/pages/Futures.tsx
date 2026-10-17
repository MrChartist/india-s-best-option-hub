import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ChartCandlestick, Database, FlaskConical, Radio, RefreshCw, Repeat, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/PageHeader";
import { SymbolSearch } from "@/components/option-chain/SymbolSearch";
import { canonicalSymbol } from "@/components/option-chain/symbols";
import { DerivedBadge, EmptyState, PanelHeader } from "@/components/screener/ScreenerUi";
import { FuturesOverviewTable } from "@/components/futures/FuturesOverviewTable";
import { HistoryLoader } from "@/components/futures/HistoryLoader";
import { OiPriceChart } from "@/components/futures/OiPriceChart";
import { RollTracker } from "@/components/futures/RollTracker";
import { RolloverCompare } from "@/components/futures/RolloverCompare";
import { TermStructure } from "@/components/futures/TermStructure";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatDateIST, formatTimeIST } from "@/lib/options";
import { INDEX_FUTURES, STOCK_FUTURES, type FuturesMode } from "@/lib/futures/api";
import {
  comparableDates,
  compareRollover,
  oiPriceSeries,
  previousMonthlyExpiries,
  rollTracker,
} from "@/lib/futures/model";
import { useFuturesOverview, useSymbolFutures } from "@/lib/futures/useFutures";

const ALL = [...INDEX_FUTURES, ...STOCK_FUTURES];

const MODE_BADGE: Record<
  FuturesMode,
  { label: string; variant: "bullish" | "neutral" | "warning"; Icon: typeof Radio; note: string }
> = {
  live: {
    label: "NSE · end of day",
    variant: "bullish",
    Icon: Radio,
    note: "From the NSE F&O bhavcopy via your local proxy.",
  },
  cache: {
    label: "Saved copy",
    variant: "neutral",
    Icon: Database,
    note: "NSE is unreachable. Showing bhavcopy days saved earlier in this browser.",
  },
  sample: {
    label: "Sample data",
    variant: "warning",
    Icon: FlaskConical,
    note: "Generated for illustration. Not market data.",
  },
};

function ModeBadge({ mode, detail }: { mode: FuturesMode; detail?: string }) {
  const m = MODE_BADGE[mode];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-chip focus-visible:shadow-ember focus-visible:outline-none">
          <Badge variant={m.variant}>
            <m.Icon aria-hidden="true" />
            {m.label}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-xs">
        <p>{m.note}</p>
        {detail ? <p className="mt-1 text-muted-foreground">{detail}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export default function Futures() {
  useDocumentTitle("Futures and Rollover");
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") === "stock" ? "stock" : "index";
  const rawSymbol = params.get("symbol");
  const symbolParam = rawSymbol ? canonicalSymbol(rawSymbol) : "";
  const symbol = symbolParam || (kind === "stock" ? STOCK_FUTURES[0] : INDEX_FUTURES[0]);

  const patch = useCallback(
    (p: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(p)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const overview = useFuturesOverview(ALL);
  const ov = overview.data;
  const mode: FuturesMode | null = ov?.mode ?? null;
  const detail = useSymbolFutures(symbol, mode);
  const latest = detail.latest;
  const nearExpiry = latest?.series[0]?.expiry ?? null;

  const snapshots = useMemo(() => {
    const list = ov?.snapshots ?? [];
    const set = new Set(kind === "index" ? INDEX_FUTURES : STOCK_FUTURES);
    return list.filter((s) => set.has(s.symbol));
  }, [ov, kind]);

  const byDate = useMemo(() => new Map(detail.views.map((v) => [v.date, v])), [detail.views]);
  const comparables = useMemo(
    () => (latest && nearExpiry ? comparableDates(symbol, latest.date, nearExpiry) : []),
    [symbol, latest, nearExpiry],
  );
  const cmp = useMemo(
    () =>
      compareRollover(
        latest,
        comparables.map((c) => byDate.get(c.date)),
      ),
    [latest, comparables, byDate],
  );
  const priorExpiries = useMemo(
    () => (nearExpiry ? previousMonthlyExpiries(symbol, nearExpiry, 3) : []),
    [symbol, nearExpiry],
  );
  const tracker = useMemo(
    () => (nearExpiry ? rollTracker(symbol, nearExpiry, detail.views) : []),
    [symbol, nearExpiry, detail.views],
  );
  const chart = useMemo(() => oiPriceSeries(detail.views, 20), [detail.views]);
  const derived =
    mode === "sample" ? null : (
      <DerivedBadge title="EOD · derived" hint="Computed in your browser from NSE bhavcopy rows" />
    );

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-1 sm:px-0">
      <PageHeader
        icon={ChartCandlestick}
        eyebrow="Positioning"
        title="Futures and Rollover"
        description="Index and stock futures across the near, next and far months: basis, annualised cost of carry, rollover and roll cost against the last three expiries, OI buildup per series and an expiry-week roll tracker."
        source={
          mode ? (
            <>
              <ModeBadge mode={mode} detail={ov?.reason} />
              <span className="text-muted-foreground">
                {mode === "sample"
                  ? "NSE bhavcopy unavailable: every number on this page is generated for illustration."
                  : ov?.asOfDate
                    ? `Trade date ${formatDateIST(ov.asOfDate)}. Files publish after the close, about 19:00 IST.`
                    : null}
              </span>
            </>
          ) : (
            <Skeleton className="h-5 w-40" />
          )
        }
        actions={
          <>
            <SymbolSearch value={symbol} onSelect={(s) => patch({ symbol: s })} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void overview.refetch()}
              disabled={overview.isFetching}
              aria-label="Refresh futures data"
            >
              <RefreshCw
                className={overview.isFetching ? "animate-spin motion-reduce:animate-none" : undefined}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <PanelHeader
          title={kind === "index" ? "Index futures" : "Stock futures"}
          icon={<TrendingUp className="h-4 w-4 text-primary-ink" aria-hidden="true" />}
          help="End-of-day prices from the NSE F&O bhavcopy. Basis = near future − spot. Carry p.a. = (F ÷ S − 1) × 365 ÷ days to expiry. Roll cost = next − near, annualised over the gap between the two expiries. Rollover = share of futures OI in the next and far months."
        >
          {derived}
          <ToggleGroup
            type="single"
            value={kind}
            onValueChange={(v) => v && patch({ kind: v === "stock" ? "stock" : null, symbol: null })}
            aria-label="Futures type"
            size="sm"
          >
            <ToggleGroupItem value="index" className="h-8 px-3 text-xs">
              Index
            </ToggleGroupItem>
            <ToggleGroupItem value="stock" className="h-8 px-3 text-xs">
              Stocks
            </ToggleGroupItem>
          </ToggleGroup>
        </PanelHeader>
        {overview.isLoading ? (
          <div className="space-y-2 p-4" role="status" aria-busy="true" aria-label="Loading futures">
            {[0, 1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-9 w-full" />
            ))}
          </div>
        ) : overview.isError ? (
          <EmptyState
            title="Futures could not be loaded"
            body="Something went wrong while building the table."
            action={
              <Button size="sm" onClick={() => void overview.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <FuturesOverviewTable
            snapshots={snapshots}
            selected={symbol}
            onSelect={(s) => patch({ symbol: s })}
            caption={kind === "index" ? "Index futures" : "Stock futures"}
          />
        )}
      </Card>

      <section aria-labelledby="fut-detail-h" className="space-y-4">
        <h2 id="fut-detail-h" className="font-display text-title">
          {symbol} futures
          {latest ? (
            <span className="ml-2 text-body font-normal text-muted-foreground">{formatDateIST(latest.date)}</span>
          ) : null}
        </h2>

        {detail.unsupported ? (
          <Card>
            <EmptyState
              title={`${symbol} trades on BSE`}
              body="This page reads the NSE F&O bhavcopy, which does not include BSE contracts such as SENSEX and BANKEX. Pick an NSE index or stock."
            />
          </Card>
        ) : detail.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !latest ? (
          <Card>
            <EmptyState
              title={`No futures data for ${symbol}`}
              body={
                mode === "live"
                  ? "The latest NSE bhavcopy has no futures rows for this symbol. Check that it is in the F&O segment."
                  : "Nothing is saved in this browser for this symbol yet, and NSE is not reachable. Start the local proxy and refresh."
              }
            />
          </Card>
        ) : (
          <>
            {mode !== "sample" ? (
              <HistoryLoader
                symbol={symbol}
                missing={detail.missingDates.length}
                storedDays={detail.days.length}
                state={detail.backfill}
                onRun={detail.runBackfill}
                onCancel={detail.cancelBackfill}
              />
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Card className="min-w-0">
                <PanelHeader
                  title="Term structure"
                  help="Near, next and far monthly futures with basis, annualised carry, OI and the buildup on the day (price and OI direction)."
                >
                  {derived}
                </PanelHeader>
                <div className="p-4">
                  <TermStructure view={latest} />
                </div>
              </Card>
              <Card className="min-w-0">
                <PanelHeader
                  title="Rollover vs last 3 expiries"
                  icon={<Repeat className="h-4 w-4 text-primary-ink" aria-hidden="true" />}
                  help="Rollover and roll cost now, against the average of the previous three monthly cycles on the day with the same number of trading days left to expiry."
                >
                  {derived}
                </PanelHeader>
                <div className="p-4">
                  <RolloverCompare cmp={cmp} comparables={comparables} tradingDte={latest.tradingDte} />
                </div>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="min-w-0">
                <PanelHeader
                  title="Futures OI vs price"
                  help="Total futures OI split by series, with the near-month price below on the same dates. Read the two together: OI up with price up is long buildup."
                >
                  {derived}
                </PanelHeader>
                <div className="p-4">
                  {chart.length < 2 ? (
                    <EmptyState
                      title="Not enough sessions yet"
                      body="Load NSE history above to chart the last 20 sessions."
                    />
                  ) : (
                    <OiPriceChart points={chart} />
                  )}
                </div>
              </Card>
              <Card className="min-w-0">
                <PanelHeader
                  title="Expiry-week roll tracker"
                  help="Rollover % on each of the last sessions before expiry, this cycle against the previous three cycles (average and range)."
                >
                  {derived}
                </PanelHeader>
                <div className="p-4">
                  {nearExpiry ? (
                    <RollTracker points={tracker} currentExpiry={nearExpiry} priorExpiries={priorExpiries} />
                  ) : null}
                </div>
              </Card>
            </div>
          </>
        )}
      </section>

      <footer className="space-y-1 border-t border-border pt-3 text-body-sm text-muted-foreground">
        <p>
          Source: NSE F&amp;O bhavcopy (UDiFF, end of day) through your local proxy; history you load is saved in this
          browser. Fair value = spot × e^((r − q)t), with the rate from your market settings. Page checked at{" "}
          {formatTimeIST(new Date())}.
        </p>
        <p className="font-medium">Data for education and research. Not investment advice.</p>
      </footer>
    </div>
  );
}
