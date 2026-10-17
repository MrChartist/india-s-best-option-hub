import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourceBadge } from "@/components/option-chain/SourceBadge";
import { IVOverview } from "@/components/volatility/IVOverview";
import { SmileChart } from "@/components/volatility/SmileChart";
import { TermStructure } from "@/components/volatility/TermStructure";
import { VolCone } from "@/components/volatility/VolCone";
import { SurfaceHeatmap } from "@/components/volatility/SurfaceHeatmap";
import { ExpectedMoveTable } from "@/components/volatility/ExpectedMoveTable";
import { VolScreener } from "@/components/volatility/VolScreener";
import { SymbolSwitcher } from "@/components/volatility/SymbolSwitcher";
import { PanelSkeleton } from "@/components/volatility/VolUi";
import { fmtVol, sanitizeSymbol } from "@/lib/volatility/format";
import {
  VIX_SYMBOLS,
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
import { dailyStatsSpotIv, joinSpotIv, type SpotIvRow } from "@/lib/volatility/history";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "smile", label: "Smile" },
  { value: "term", label: "Term structure" },
  { value: "cone", label: "Vol cone" },
  { value: "surface", label: "Surface" },
  { value: "move", label: "Expected move" },
  { value: "screener", label: "Screener" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

export default function Volatility() {
  const [params, setParams] = useSearchParams();
  const symbol = sanitizeSymbol(params.get("symbol")) || "NIFTY";
  const tabParam = params.get("tab");
  const tab: TabValue = TABS.some((t) => t.value === tabParam) ? (tabParam as TabValue) : "overview";
  const canUseVix = VIX_SYMBOLS.has(symbol);
  const [basisPref, setBasisPref] = useState<IvBasis>("vix");
  const basis: IvBasis = canUseVix ? basisPref : "iv30";

  useDocumentTitle(`Volatility · ${symbol}`);

  const setSymbol = useCallback(
    (s: string) => {
      const next = new URLSearchParams(params);
      next.set("symbol", s);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  const setTab = useCallback(
    (t: string) => {
      const next = new URLSearchParams(params);
      if (t === "overview") next.delete("tab");
      else next.set("tab", t);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const vol = useVolChains(symbol, "all");
  const bars = useDailyBars(symbol);
  const hist = useIvHistory(symbol);
  const rank = useIvRank(symbol, { basis, expiries: "all" });
  const backfill = useIvBackfill(symbol);
  const prev = usePrevSessionBhav(symbol, !vol.isSample && !vol.isLoading);

  const hit = useMemo((): { rows: SpotIvRow[]; label: string } => {
    const b = bars.data ?? [];
    if (canUseVix && (hist.data?.vix.length ?? 0) > 0 && b.length > 0) return { rows: joinSpotIv(hist.data?.vix ?? [], b), label: "India VIX and NIFTY closes" };
    const fromIv30 = b.length > 0 ? joinSpotIv(hist.data?.iv30 ?? [], b) : [];
    const fromStats = dailyStatsSpotIv(hist.data?.dailyStats);
    return fromIv30.length >= fromStats.length
      ? { rows: fromIv30, label: "bhavcopy IV30 and daily closes" }
      : { rows: fromStats, label: "recorded end-of-day ATM IV and spot" };
  }, [bars.data, hist.data, canUseVix]);

  const loading = vol.isLoading;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-display">
            <Waves className="h-6 w-6 text-primary-ink" aria-hidden="true" />
            Volatility
          </h1>
          <p className="mt-1 max-w-2xl text-body text-muted-foreground">
            IV rank, smile, term structure, volatility cone, surface and expected move for NSE options. IVs are solved with Black-76 on the put-call parity forward.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={vol.source} asOf={vol.asOf || undefined} stale={vol.stale} isLive={vol.isLive} reason={vol.reason} />
          {vol.spot > 0 ? (
            <Badge variant="outline" className="tabular-nums">
              {symbol} {formatNumberIN(vol.spot, 2)}
            </Badge>
          ) : null}
          {Number.isFinite(vol.iv30) ? <Badge variant="info">IV30 {fmtVol(vol.iv30)}</Badge> : null}
        </div>
      </header>

      <SymbolSwitcher value={symbol} onChange={setSymbol} />

      {vol.isSample ? (
        <div role="alert" className="flex items-start gap-2 rounded-tile border border-warning/40 bg-wash-warning px-3 py-2 text-body-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Live chains are unavailable{vol.reason ? ` (${vol.reason})` : ""}. Smile, term structure, surface and expected move below use a labelled sample chain for illustration. IV rank is not computed from sample data.
          </p>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1.5 overflow-x-auto px-1.5 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
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
            bars={bars.data}
            barsLoading={bars.isLoading}
            barsError={bars.isError}
            basis={basis}
            onBasisChange={setBasisPref}
            canUseVix={canUseVix}
            backfill={backfill}
          />
        </TabsContent>
        <TabsContent value="smile" className="mt-4">
          {loading ? <PanelSkeleton height={340} /> : <SmileChart symbol={symbol} smiles={vol.smiles} chains={vol.chains} isSample={vol.isSample} prev={prev.data} />}
        </TabsContent>
        <TabsContent value="term" className="mt-4">
          {loading ? <PanelSkeleton /> : <TermStructure symbol={symbol} term={vol.term} shape={vol.shape} iv30={vol.iv30} isSample={vol.isSample} prev={prev.data} />}
        </TabsContent>
        <TabsContent value="cone" className="mt-4">
          {loading && bars.isLoading ? <PanelSkeleton /> : <VolCone symbol={symbol} bars={bars.data} barsLoading={bars.isLoading} term={vol.term} isSample={vol.isSample} />}
        </TabsContent>
        <TabsContent value="surface" className="mt-4">
          {loading ? <PanelSkeleton /> : <SurfaceHeatmap symbol={symbol} rows={vol.surface} isSample={vol.isSample} />}
        </TabsContent>
        <TabsContent value="move" className="mt-4">
          {loading ? <PanelSkeleton /> : <ExpectedMoveTable symbol={symbol} spot={vol.spot} rows={vol.moves} isSample={vol.isSample} hitRows={hit.rows} hitLabel={hit.label} />}
        </TabsContent>
        <TabsContent value="screener" className="mt-4">
          <VolScreener
            onSelectSymbol={(s) => {
              const next = new URLSearchParams(params);
              next.set("symbol", s);
              next.delete("tab");
              setParams(next, { replace: true });
            }}
          />
        </TabsContent>
      </Tabs>

      <p className="border-t border-border pt-3 text-body-sm text-muted-foreground">
        Data for education and research. Not investment advice. IV, Greeks, HV and history are computed in your browser from NSE/Dhan quotes, NSE bhavcopy and Yahoo Finance candles via your local proxy.
      </p>
    </div>
  );
}
