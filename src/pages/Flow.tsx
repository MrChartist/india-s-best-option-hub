import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FlowFeeder } from "@/components/flow/FlowFeeder";
import { FlowFilters } from "@/components/flow/FlowFilters";
import { FlowTape } from "@/components/flow/FlowTape";
import { FlowExplainer } from "@/components/flow/FlowExplainer";
import { HedgePressureCard } from "@/components/flow/HedgePressureCard";
import { HotChains, OiSpurts, TopContracts } from "@/components/flow/HotChains";
import { PremiumTideChart } from "@/components/flow/PremiumTideChart";
import { UnusualScanner } from "@/components/flow/UnusualScanner";
import { DerivedBadge, HelpTip, ModeBadge, Panel, PanelSkeleton, Stat } from "@/components/flow/FlowUi";
import { fmtRs, signClass } from "@/components/flow/format";
import { FLOW_UNIVERSE, useFlowState, useSampleFeeds } from "@/components/flow/useFlow";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatNumberIN, formatPct } from "@/lib/options";
import {
  DEFAULT_TAPE_FILTERS,
  allPrints,
  filterPrints,
  premiumSummary,
  premiumTide,
  type FeedEntry,
  type FeedMode,
  type TapeFilters,
} from "@/lib/flow";

const TABS = [
  { value: "tape", label: "Tape" },
  { value: "tide", label: "Premium Tide" },
  { value: "unusual", label: "Unusual" },
  { value: "leaders", label: "Leaderboards" },
  { value: "learn", label: "How it works" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

export default function Flow() {
  useDocumentTitle("Options Flow");
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: TabValue = TABS.some((t) => t.value === tabParam) ? (tabParam as TabValue) : "tape";
  const setTab = useCallback(
    (t: string) => {
      const next = new URLSearchParams(params);
      if (t === "tape") next.delete("tab");
      else next.set("tab", t);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const [extraSymbols, setExtraSymbols] = useState<string[]>([]);
  const [demo, setDemo] = useState(false);
  const [filters, setFilters] = useState<TapeFilters>(DEFAULT_TAPE_FILTERS);
  const [hedgeSymbol, setHedgeSymbol] = useState<string>("NIFTY");

  const followed = useMemo(() => [...FLOW_UNIVERSE, ...extraSymbols], [extraSymbols]);
  const { feeds: storeFeeds } = useFlowState();
  const realFeeds = useMemo(() => {
    const out: Record<string, FeedEntry> = {};
    for (const s of followed) if (storeFeeds[s]) out[s] = storeFeeds[s];
    return out;
  }, [storeFeeds, followed]);
  const spots = useMemo(() => Object.fromEntries(Object.values(realFeeds).map((f) => [f.symbol, f.spot])), [realFeeds]);
  const sampleFeeds = useSampleFeeds(followed, demo, spots);
  const feeds = demo ? sampleFeeds : realFeeds;
  const feedList = Object.values(feeds);

  const prints = useMemo(() => allPrints(feeds), [feeds]);
  const loading = !demo && feedList.length === 0;
  const anySample = feedList.some((f) => f.mode === "sample");
  const anyLive = feedList.some((f) => f.mode === "live");
  const modes = new Set(feedList.map((f) => f.mode));
  const mixedModes = modes.size > 1;
  // One source label for the page: sample wins (never present simulated numbers as live).
  const pageMode: FeedMode | null = feedList.length === 0 ? null : anySample ? "sample" : anyLive ? "live" : "recorded";
  const sampleSymbols = feedList.filter((f) => f.mode === "sample").map((f) => f.symbol);
  const hedgeSymbols = feedList.map((f) => f.symbol);
  const hedgeSym = hedgeSymbols.includes(hedgeSymbol) ? hedgeSymbol : (hedgeSymbols[0] ?? "NIFTY");
  const noRealFlow = !demo && !loading && !anySample && prints.length === 0;

  const filtered = useMemo(() => filterPrints(prints, filters), [prints, filters]);
  const scoped = useMemo(
    () => (filters.symbol === "ALL" ? prints : prints.filter((p) => p.symbol === filters.symbol)),
    [prints, filters.symbol],
  );
  const summary = useMemo(() => premiumSummary(scoped), [scoped]);
  const expiries = useMemo(() => [...new Set(prints.map((p) => p.expiry))].sort(), [prints]);
  const symbolsWithFlow = useMemo(
    () => [...new Set([...Object.keys(feeds), ...prints.map((p) => p.symbol)])],
    [feeds, prints],
  );

  const marketTide = useMemo(() => premiumTide(prints), [prints]);
  const tides = useMemo(() => Object.fromEntries(feedList.map((f) => [f.symbol, premiumTide(f.prints)])), [feedList]);

  const addSymbol = useCallback(
    (s: string) =>
      setExtraSymbols((xs) =>
        xs.includes(s) || (FLOW_UNIVERSE as readonly string[]).includes(s) ? xs : [...xs, s].slice(-4),
      ),
    [],
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      {followed.map((s) => (
        <FlowFeeder key={s} symbol={s} />
      ))}

      <PageHeader
        icon={Activity}
        eyebrow="Positioning"
        title="Options Flow"
        description="Where premium is moving in NSE and BSE options: an interval tape, Premium Tide, writers' hedging pressure, unusual activity and the hottest chains, built from successive option-chain snapshots."
        source={
          <>
            {pageMode ? (
              <ModeBadge
                mode={pageMode}
                reason={
                  demo
                    ? "Sample session switched on"
                    : mixedModes && sampleSymbols.length
                      ? `Simulated: ${sampleSymbols.join(", ")}`
                      : undefined
                }
              />
            ) : null}
            <DerivedBadge title="Interval flow" />
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              Derived from snapshots; NSE does not publish trade-level data.
              <HelpTip
                text="Each print is the change in volume and OI between two chain polls, priced at LTP × lot size. It is an interval aggregate, not a single trade."
                label="How prints are built"
              />
            </span>
          </>
        }
        actions={
          <div className="flex items-center gap-2 rounded-capsule border border-border bg-card px-3 py-1">
            <Switch id="flow-demo" checked={demo} onCheckedChange={setDemo} />
            <Label htmlFor="flow-demo" className="inline-flex items-center gap-1 text-body-sm">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Sample session
            </Label>
          </div>
        }
      />

      {noRealFlow ? (
        <div className="flex flex-col gap-2 rounded-tile border border-border bg-surface px-3 py-3 text-body-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            {anyLive
              ? "Watching the chains. The first prints appear after the next poll with trading (about 10 to 20 seconds)."
              : "Market is closed or the feed is delayed, and no snapshots were recorded in this browser for the last session. The tape fills while this page is open during market hours."}
          </p>
          <Button size="sm" variant="outline" onClick={() => setDemo(true)} className="shrink-0">
            <FlaskConical aria-hidden="true" /> Show a sample session
          </Button>
        </div>
      ) : null}

      <section aria-label="Premium summary" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Premium traded"
          value={loading ? "—" : fmtRs(summary.total)}
          hint={`${formatNumberIN(summary.prints)} prints${filters.symbol !== "ALL" ? ` · ${filters.symbol}` : ""}`}
        />
        <Stat
          label="Calls net"
          value={loading ? "—" : fmtRs(summary.netCe, true)}
          tone={signClass(summary.netCe)}
          hint={`Bought ${fmtRs(summary.ceBought)} · sold ${fmtRs(summary.ceSold)}`}
        />
        <Stat
          label="Puts net"
          value={loading ? "—" : fmtRs(summary.netPe, true)}
          tone={signClass(-summary.netPe)}
          hint={`Bought ${fmtRs(summary.peBought)} · sold ${fmtRs(summary.peSold)}`}
        />
        <Stat
          label="Net premium"
          value={loading ? "—" : fmtRs(summary.net, true)}
          tone={signClass(summary.net)}
          hint="Calls net − puts net"
        />
        <Stat
          label="At the ask"
          value={Number.isFinite(summary.askShare) ? formatPct(summary.askShare * 100, { decimals: 0 }) : "—"}
          hint="Share of premium bought"
        />
        <Stat label="Mid / unclear" value={loading ? "—" : fmtRs(summary.mid)} hint="Left out of the tide" />
      </section>

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

        <TabsContent value="tape" className="mt-4 space-y-3">
          {loading ? (
            <PanelSkeleton height={360} />
          ) : (
            <Panel
              title="Flow tape"
              subtitle="Every interval print, newest first. Click a contract for its page, or open it in the chain."
            >
              <div className="space-y-3">
                <FlowFilters value={filters} onChange={setFilters} symbols={symbolsWithFlow} expiries={expiries} />
                <FlowTape
                  prints={filtered}
                  totalCount={prints.length}
                  isSample={anySample}
                  onResetFilters={() => setFilters(DEFAULT_TAPE_FILTERS)}
                />
              </div>
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="tide" className="mt-4">
          {loading ? (
            <PanelSkeleton height={320} />
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Panel
                title="Market aggregate"
                subtitle={`All followed underlyings (${feedList.map((f) => f.symbol).join(", ")})`}
                className="xl:col-span-2"
              >
                <PremiumTideChart
                  points={marketTide}
                  height={320}
                  showSpot={false}
                  ariaLabel="Market aggregate Premium Tide"
                />
              </Panel>
              <HedgePressureCard
                symbol={hedgeSym}
                feed={feeds[hedgeSym]}
                symbols={hedgeSymbols}
                onSymbolChange={setHedgeSymbol}
                className="xl:col-span-2"
              />
              {feedList.map((f) => (
                <Panel
                  key={f.symbol}
                  title={`${f.symbol} Premium Tide`}
                  subtitle="Call and put premium (ask − bid), spot on the right axis"
                  actions={mixedModes ? <ModeBadge mode={f.mode} asOf={f.asOf} reason={f.reason} /> : undefined}
                >
                  <PremiumTideChart
                    points={tides[f.symbol] ?? []}
                    height={260}
                    ariaLabel={`${f.symbol} Premium Tide`}
                  />
                </Panel>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="unusual" className="mt-4">
          {loading ? (
            <PanelSkeleton height={360} />
          ) : (
            <UnusualScanner feeds={feeds} onAddSymbol={demo ? undefined : addSymbol} extraSymbols={extraSymbols} />
          )}
        </TabsContent>

        <TabsContent value="leaders" className="mt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <HotChains prints={prints} isSample={anySample} />
            <TopContracts prints={prints} isSample={anySample} />
            <div className="lg:col-span-2">
              <OiSpurts />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="learn" className="mt-4">
          <FlowExplainer />
        </TabsContent>
      </Tabs>

      <p className="border-t border-border pt-3 text-body-sm text-muted-foreground">
        Data for education and research. Not investment advice. Flow is derived in your browser from NSE/Dhan
        option-chain snapshots via your local proxy; snapshots stay on this device.
      </p>
    </div>
  );
}
