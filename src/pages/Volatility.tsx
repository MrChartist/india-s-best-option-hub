import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FlaskConical, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { resolveFnoSymbol } from "@/components/option-chain/symbols";
import { UnknownSymbolNotice } from "@/components/option-chain/UnknownSymbolNotice";
import { SourceBadge } from "@/components/option-chain/SourceBadge";
import { IVOverview } from "@/components/volatility/IVOverview";
import { SmileChart } from "@/components/volatility/SmileChart";
import { TermStructure } from "@/components/volatility/TermStructure";
import { AtmIvHistory } from "@/components/volatility/AtmIvHistory";
import { VolCone } from "@/components/volatility/VolCone";
import { SurfaceHeatmap } from "@/components/volatility/SurfaceHeatmap";
import { ExpectedMoveTable } from "@/components/volatility/ExpectedMoveTable";
import { VixPanel } from "@/components/volatility/VixPanel";
import { ComparePanel } from "@/components/volatility/ComparePanel";
import { VolScreener } from "@/components/volatility/VolScreener";
import { SymbolSwitcher } from "@/components/volatility/SymbolSwitcher";
import { PanelSkeleton } from "@/components/volatility/VolUi";
import { fmtVol, sanitizeSymbol } from "@/lib/volatility/format";
import { parseCompareStocks } from "@/lib/volatility/compare";
import {
  VIX_SYMBOLS,
  sampleHitRows,
  useDailyBars,
  useIvBackfill,
  useIvHistory,
  useIvRank,
  usePrevSessionBhav,
  useVolChains,
  type IvBasis,
} from "@/components/volatility/useVolatility";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatNumberIN } from "@/lib/options";
import { MIN_HISTORY_DAYS, dailyStatsSpotIv, joinSpotIv, type SpotIvRow } from "@/lib/volatility/history";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "smile", label: "Smile" },
  { value: "term", label: "Term structure" },
  { value: "cone", label: "Vol cone" },
  { value: "surface", label: "Surface" },
  { value: "move", label: "Expected move" },
  { value: "vix", label: "India VIX" },
  { value: "compare", label: "Compare" },
  { value: "screener", label: "Screener" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

export default function Volatility() {
  const [params, setParams] = useSearchParams();
  // A symbol with no F&O contracts falls back to NIFTY (with a notice) instead of a fake chain.
  const { symbol, unknown: unknownSymbol } = resolveFnoSymbol(sanitizeSymbol(params.get("symbol")) || params.get("symbol"));
  const tabParam = params.get("tab");
  const canUseVix = VIX_SYMBOLS.has(symbol);
  const [basisPref, setBasisPref] = useState<IvBasis>("vix");
  const basis: IvBasis = canUseVix ? basisPref : "iv30";
  const compareStocks = useMemo(() => parseCompareStocks(params.get("cmp")), [params]);

  useDocumentTitle(`Volatility · ${symbol}`);

  const vol = useVolChains(symbol, "all");
  const bars = useDailyBars(symbol);
  const hist = useIvHistory(symbol);
  const rank = useIvRank(symbol, { basis, expiries: "all" });
  const backfill = useIvBackfill(symbol);
  const prev = usePrevSessionBhav(symbol, !vol.isSample && !vol.isLoading);

  // Overview leads when real IV history exists; otherwise the Smile (which needs only the chain).
  const hasRealHistory = !rank.historyIsSample && rank.stats.n >= MIN_HISTORY_DAYS;
  const defaultTab: TabValue = hist.isLoading || hasRealHistory ? "overview" : "smile";
  const tab: TabValue = TABS.some((t) => t.value === tabParam) ? (tabParam as TabValue) : defaultTab;

  const update = useCallback(
    (fn: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params);
      fn(next);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  const setSymbol = useCallback((s: string) => update((n) => n.set("symbol", s)), [update]);
  const setTab = useCallback((t: string) => update((n) => (t === defaultTab ? n.delete("tab") : n.set("tab", t))), [update, defaultTab]);
  const openSymbol = useCallback(
    (s: string) =>
      update((n) => {
        n.set("symbol", s);
        n.delete("tab");
      }),
    [update],
  );
  const setCompareStocks = useCallback((list: string[]) => update((n) => (list.length ? n.set("cmp", list.join(",")) : n.delete("cmp"))), [update]);

  // Daily bars: the sample bars travel with the sample IV history so HV, VRP and the cone stay consistent.
  const barsIsSample = rank.historyIsSample && !!rank.sampleBars;
  const barsData = barsIsSample ? rank.sampleBars ?? undefined : bars.data;

  const hit = useMemo((): { rows: SpotIvRow[]; label: string; sample: boolean } => {
    if (barsIsSample) return { rows: sampleHitRows(rank), label: "one year of sample IV and closes", sample: true };
    const b = bars.data ?? [];
    if (canUseVix && (hist.data?.vix.length ?? 0) > 0 && b.length > 0) return { rows: joinSpotIv(hist.data?.vix ?? [], b), label: "India VIX and NIFTY closes", sample: false };
    const fromIv30 = b.length > 0 ? joinSpotIv(hist.data?.iv30 ?? [], b) : [];
    const fromStats = dailyStatsSpotIv(hist.data?.dailyStats);
    return fromIv30.length >= fromStats.length
      ? { rows: fromIv30, label: "bhavcopy IV30 and daily closes", sample: false }
      : { rows: fromStats, label: "recorded end-of-day ATM IV and spot", sample: false };
  }, [barsIsSample, rank, bars.data, hist.data, canUseVix]);

  const loading = vol.isLoading;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      <PageHeader
        icon={Waves}
        title="Volatility"
        description="IV rank, smile, term structure, cone, surface, expected move, India VIX and cross-symbol comparison for NSE options. IVs are solved with Black-76 on the put-call parity forward."
        source={
          <>
            <SourceBadge source={vol.source} asOf={vol.asOf || undefined} stale={vol.stale} isLive={vol.isLive} reason={vol.reason} />
            {vol.spot > 0 ? (
              <Badge variant="outline" className="tabular-nums">
                {symbol} {formatNumberIN(vol.spot, 2)}
              </Badge>
            ) : null}
            {Number.isFinite(vol.iv30) ? <Badge variant="info">IV30 {fmtVol(vol.iv30)}</Badge> : null}
          </>
        }
      />

      <SymbolSwitcher value={symbol} onChange={setSymbol} />

      {unknownSymbol ? <UnknownSymbolNotice symbol={unknownSymbol} /> : null}

      {vol.isSample ? (
        <div role="note" className="flex items-start gap-2 rounded-tile border border-warning/40 bg-wash-warning px-3 py-2 text-body-sm text-warning">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Live chains are unavailable{vol.reason ? ` (${vol.reason})` : ""}. Smile, term structure, surface and expected move use a labelled sample chain.
            {rank.historyIsSample ? " IV rank, IV percentile, the cone and VRP use a seeded one-year sample history." : ""} Sample numbers are for illustration, not trading.
          </p>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1.5 overflow-x-auto px-1.5 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <IVOverview
            symbol={symbol}
            rank={rank}
            iv30={vol.iv30}
            iv30IsSample={vol.isSample}
            bars={barsData}
            barsIsSample={barsIsSample}
            barsLoading={!barsIsSample && bars.isLoading}
            barsError={!barsIsSample && bars.isError}
            basis={basis}
            onBasisChange={setBasisPref}
            canUseVix={canUseVix}
            backfill={backfill}
          />
        </TabsContent>
        <TabsContent value="smile" className="mt-4">
          {loading ? <PanelSkeleton height={340} /> : <SmileChart symbol={symbol} smiles={vol.smiles} chains={vol.chains} isSample={vol.isSample} prev={prev.data} />}
        </TabsContent>
        <TabsContent value="term" className="mt-4 space-y-4">
          {loading ? (
            <PanelSkeleton />
          ) : (
            <>
              <TermStructure symbol={symbol} term={vol.term} shape={vol.shape} iv30={vol.iv30} isSample={vol.isSample} prev={prev.data} />
              <AtmIvHistory symbol={symbol} term={vol.term} isSample={vol.isSample} rankHistory={rank.history} rankLabel={rank.basisLabel} rankIsSample={rank.historyIsSample} />
            </>
          )}
        </TabsContent>
        <TabsContent value="cone" className="mt-4">
          {loading && bars.isLoading ? (
            <PanelSkeleton />
          ) : (
            <VolCone symbol={symbol} bars={barsData} barsLoading={!barsIsSample && bars.isLoading} term={vol.term} isSample={vol.isSample} barsIsSample={barsIsSample} />
          )}
        </TabsContent>
        <TabsContent value="surface" className="mt-4">
          {loading ? <PanelSkeleton /> : <SurfaceHeatmap symbol={symbol} smiles={vol.smiles} isSample={vol.isSample} prev={prev.data} />}
        </TabsContent>
        <TabsContent value="move" className="mt-4">
          {loading ? (
            <PanelSkeleton />
          ) : (
            <ExpectedMoveTable symbol={symbol} spot={vol.spot} rows={vol.moves} isSample={vol.isSample} hitRows={hit.rows} hitLabel={hit.label} hitIsSample={hit.sample} />
          )}
        </TabsContent>
        <TabsContent value="vix" className="mt-4">
          <VixPanel />
        </TabsContent>
        <TabsContent value="compare" className="mt-4">
          <ComparePanel stocks={compareStocks} onStocksChange={setCompareStocks} onSelectSymbol={openSymbol} />
        </TabsContent>
        <TabsContent value="screener" className="mt-4">
          <VolScreener onSelectSymbol={openSymbol} />
        </TabsContent>
      </Tabs>

      <p className="pt-3 text-body-sm text-muted-foreground hairline-t">
        Data for education and research. Not investment advice. IV, Greeks, HV and history are computed in your browser from NSE/Dhan quotes, NSE bhavcopy and Yahoo Finance candles via your local proxy.
      </p>
    </div>
  );
}
