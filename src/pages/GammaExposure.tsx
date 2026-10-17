import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Layers, Magnet, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { FlowFeeder } from "@/components/flow/FlowFeeder";
import { HedgePressureCard } from "@/components/flow/HedgePressureCard";
import { useFlowState } from "@/components/flow/useFlow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConventionToggle } from "@/components/gex/ConventionToggle";
import { ExposureBars } from "@/components/gex/ExposureBars";
import { ExposureHeatmap } from "@/components/gex/ExposureHeatmap";
import { GammaLevelsPanel } from "@/components/gex/GammaLevelsCard";
import { GexExplainer } from "@/components/gex/GexExplainer";
import { GexProfileChart } from "@/components/gex/GexProfileChart";
import { LevelsHistoryCard } from "@/components/gex/LevelsHistoryCard";
import { EDU_NOTE, fmtLevel } from "@/components/gex/format";
import { GexSourceTag, type SourceInfo } from "@/components/gex/SourceTag";
import { useGexConvention } from "@/components/gex/useGexConvention";
import { useAllIndices, useChainMulti, useLiveOptionChain } from "@/hooks/useMarketData";
import { buildGexView, GEX_CONVENTION_LABEL, inferOiUnit, type GexChainInput } from "@/lib/gexData";
import { dteLabel, formatDateIST, getContractSpec, getLotSize, isIndexSymbol, maxPain as maxPainOf, normalizeSymbol } from "@/lib/options";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"] as const;
type ViewMode = "nearest" | "all";

export default function GammaExposure() {
  const [params, setParams] = useSearchParams();
  const paramSymbol = normalizeSymbol(params.get("symbol") || "");
  // Indices and F&O stocks both work (dealer gamma is computed from any option chain). An unknown
  // symbol keeps its ?symbol= in the URL and the page says it is showing NIFTY instead.
  const known = !!paramSymbol && ((SYMBOLS as readonly string[]).includes(paramSymbol) || !!getContractSpec(paramSymbol));
  const symbol = known ? paramSymbol : "NIFTY";
  const unknownParam = !!paramSymbol && !known ? paramSymbol : null;
  const isStock = !isIndexSymbol(symbol);
  const pickerSymbols = (SYMBOLS as readonly string[]).includes(symbol) ? SYMBOLS : [...SYMBOLS, symbol];
  const [mode, setMode] = useState<ViewMode>("nearest");
  const [convention, setConvention] = useGexConvention();
  const { feeds } = useFlowState();
  const flowFeed = feeds[symbol] ?? null;

  useEffect(() => {
    document.title = `Gamma Exposure · ${symbol} · Mr. Chartist`;
  }, [symbol]);

  const setSymbol = useCallback(
    (s: string) => {
      const next = new URLSearchParams(params);
      next.set("symbol", s);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const near = useLiveOptionChain(symbol);
  const multi = useChainMulti(symbol, "all");
  const { data: indices } = useAllIndices();
  const vix = indices?.vix ?? null;

  const nearData = near.data;
  const multiData = multi.data;

  const nearChains = useMemo<GexChainInput[]>(
    () =>
      nearData && nearData.chain.length > 0
        ? [{ expiry: nearData.expiry, chain: nearData.chain, lotSize: nearData.lotSize }]
        : [],
    [nearData],
  );

  const fallbackLot = nearData?.lotSize ?? getLotSize(symbol) ?? 1;
  const multiChains = useMemo<GexChainInput[]>(
    () =>
      (multiData?.expiries ?? [])
        .filter((e) => e.chain.length > 0)
        .map((e) => ({ expiry: e.expiry, chain: e.chain, lotSize: getLotSize(symbol, e.expiry) ?? fallbackLot })),
    [multiData, symbol, fallbackLot],
  );

  const activeChains = mode === "nearest" ? nearChains : multiChains.length > 0 ? multiChains : nearChains;
  const spot =
    mode === "nearest"
      ? (nearData?.spotPrice ?? 0)
      : multiData?.spot && multiData.spot > 0
        ? multiData.spot
        : (nearData?.spotPrice ?? 0);
  const lotSize = activeChains[0]?.lotSize ?? fallbackLot;

  const oiUnit = useMemo<"contracts" | "qty">(() => {
    const first = activeChains[0];
    return first ? inferOiUnit(first.chain, first.lotSize) : "contracts";
  }, [activeChains]);

  const view = useMemo(
    () => (activeChains.length > 0 && spot > 0 ? buildGexView(activeChains, spot, { convention, oiUnit }) : null),
    [activeChains, spot, convention, oiUnit],
  );

  const maxPain = useMemo(() => {
    if (mode === "nearest") {
      if (!nearData || nearData.chain.length === 0) return NaN;
      return Number.isFinite(nearData.maxPain) && nearData.maxPain > 0 ? nearData.maxPain : maxPainOf(nearData.chain);
    }
    const first = activeChains[0];
    return first ? maxPainOf(first.chain) : NaN;
  }, [mode, nearData, activeChains]);

  const multiSource: SourceInfo | null = multiData
    ? {
        source: multiData.source,
        isLive: multiData.isLive,
        stale: multiData.stale,
        asOf: multiData.asOf,
        reason: multiData.reason,
      }
    : null;
  const nearSource: SourceInfo | null = nearData
    ? {
        source: nearData.source,
        isLive: nearData.isLive,
        stale: nearData.stale,
        afterHours: nearData.afterHours,
        asOf: nearData.asOf,
        reason: nearData.reason,
      }
    : null;
  const sourceInfo = mode === "all" && multiChains.length > 0 ? multiSource : nearSource;

  const loading = mode === "nearest" ? near.isLoading : multi.isLoading && near.isLoading;
  const heatLoading = multi.isLoading;
  const isError = mode === "nearest" ? near.isError && !nearData : multi.isError && near.isError;
  const refetch = () => {
    void near.refetch();
    void multi.refetch();
  };
  const fetching = near.isFetching || multi.isFetching;

  const nearestExpiry = nearData?.expiry;
  const scopeText =
    mode === "nearest"
      ? nearestExpiry
        ? `${formatDateIST(nearestExpiry)} · ${dteLabel(nearestExpiry)}`
        : "Nearest expiry"
      : view && view.expiries.length > 0
        ? `${view.expiries.length} expiries · ${formatDateIST(view.expiries[0])} to ${formatDateIST(view.expiries[view.expiries.length - 1])}`
        : "All expiries";

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4">
      <FlowFeeder symbol={symbol} />
      <PageHeader
        icon={Magnet}
        eyebrow="Positioning"
        title="Gamma Exposure"
        description={
          <>
            Where option hedging is likely to damp or amplify moves in {symbol}: gamma profile, walls, flip, levels
            through the session, writers' hedging pressure and DEX / VEX / CEX by strike.
          </>
        }
        source={<GexSourceTag info={sourceInfo} />}
        actions={
          <>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="h-9 w-[150px]" aria-label="Underlying">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pickerSymbols.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={refetch}
              disabled={fetching}
              aria-label="Refresh data"
            >
              <RefreshCw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} aria-hidden />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </>
        }
      />

      <Card className="rounded-card">
        <CardContent className="flex flex-col gap-3 p-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as ViewMode)}
              aria-label="Expiry scope"
              className="rounded-tab bg-muted p-0.5"
            >
              <ToggleGroupItem
                value="nearest"
                className="h-8 rounded-[7px] px-2.5 text-body-sm data-[state=on]:bg-card data-[state=on]:shadow-card"
              >
                {isStock ? "Nearest expiry" : "Nearest expiry (0DTE)"}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="all"
                className="h-8 rounded-[7px] px-2.5 text-body-sm data-[state=on]:bg-card data-[state=on]:shadow-card"
              >
                <Layers className="mr-1 h-3.5 w-3.5" aria-hidden />
                All expiries
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="text-body-sm text-muted-foreground">{scopeText}</span>
          </div>
          <ConventionToggle value={convention} onChange={setConvention} />
        </CardContent>
      </Card>

      {unknownParam && (
        <p className="flex items-center gap-2 rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          &ldquo;{unknownParam}&rdquo; is not an F&amp;O underlying, so this page is showing NIFTY.
        </p>
      )}
      {isStock && (
        <p className="flex items-center gap-2 rounded-tile bg-muted px-3 py-2 text-body-sm text-muted-foreground" role="note">
          Single-stock GEX: stock options are monthly, less liquid and physically settled, so dealer positioning is a weaker guide than for indices.
        </p>
      )}

      {mode === "all" && !multi.isLoading && multiChains.length === 0 && nearChains.length > 0 && (
        <p
          className="flex items-center gap-2 rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning"
          role="status"
        >
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Multi-expiry data is unavailable, so this view shows the nearest expiry only.
        </p>
      )}

      {isError ? (
        <Card className="rounded-card">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-6 w-6 text-warning" aria-hidden />
            <p className="text-body text-muted-foreground">Could not load the option chain for {symbol}.</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]" aria-label="Gamma profile and levels">
            <GexProfileChart
              profile={view?.profile ?? []}
              spot={spot}
              levels={view?.levels ?? null}
              dealerFlip={view?.dealerFlip ?? null}
              convention={convention}
              loading={loading}
              symbol={symbol}
              title={`GEX profile · ${GEX_CONVENTION_LABEL[convention]}`}
            />
            <Card className="rounded-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-lead">Key levels</CardTitle>
                <p className="text-body-sm text-muted-foreground">
                  Spot <span className="font-num font-semibold text-foreground">{fmtLevel(spot)}</span>
                  {lotSize > 0 && <> · Lot {lotSize}</>}
                  {view?.gammaPeak && (
                    <>
                      {" "}
                      · Peak gamma near <span className="font-num">{fmtLevel(view.gammaPeak)}</span>
                    </>
                  )}
                </p>
              </CardHeader>
              <CardContent className="pt-0">
                <GammaLevelsPanel
                  levels={view?.levels ?? null}
                  dealerFlip={view?.dealerFlip ?? null}
                  spot={spot}
                  maxPain={maxPain}
                  regime={view?.regime ?? "neutral"}
                  totals={view?.totals ?? null}
                  convention={convention}
                  loading={loading}
                />
              </CardContent>
            </Card>
          </section>

          <ExposureBars
            rows={view?.byStrike ?? []}
            spot={spot}
            levels={view?.levels ?? null}
            totals={view?.totals ?? null}
            vix={vix}
            loading={loading}
            symbol={symbol}
          />

          <LevelsHistoryCard symbol={symbol} feed={flowFeed} convention={convention} />

          <HedgePressureCard symbol={symbol} feed={flowFeed} />

          <ExposureHeatmap
            chains={multiChains.length > 0 ? multiChains : nearChains}
            spot={spot}
            convention={convention}
            oiUnit={oiUnit}
            loading={heatLoading && nearChains.length === 0}
            source={multiChains.length > 0 ? multiSource : nearSource}
          />
        </>
      )}

      <GexExplainer convention={convention} lotSize={lotSize} oiUnit={oiUnit} />

      <p className="pb-2 text-center text-body-sm text-muted-foreground">{EDU_NOTE}</p>
    </div>
  );
}
