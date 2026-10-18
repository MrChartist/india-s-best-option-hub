/**
 * Market dashboard. Every section renders on its own (no full-page skeleton), sits in its own
 * error boundary, and can be hidden or reordered. Named workspaces (with Scalper, Writer, Swing and
 * Expiry presets) and density persist in localStorage. Without the proxy, sections fall back to a
 * labelled sample snapshot; anything still unavailable is named once in the "Needs live data" strip
 * below the populated sections.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, BarChart3, CalendarClock, Crosshair, Gauge, LayoutDashboard, Layers, Newspaper, Target, TrendingUp, Zap } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { ExpectedMoveWidget } from "@/components/ExpectedMoveWidget";
import { IVRankDashboard } from "@/components/IVRankWidget";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatDateIST, nowIST } from "@/lib/options";
import { cn } from "@/lib/utils";

import { LayoutCustomizer } from "@/components/dashboard/LayoutCustomizer";
import { WelcomeBanner } from "@/components/dashboard/WelcomeBanner";
import { QuickTradeActions } from "@/components/dashboard/QuickTradeActions";
import { IndexCards, IndexCardsStatus } from "@/components/dashboard/IndexCards";
import { KeyMetrics } from "@/components/dashboard/KeyMetrics";
import { FeatureCards } from "@/components/dashboard/FeatureCards";
import { GiftNiftyExpiry } from "@/components/dashboard/GiftNiftyExpiry";
import { TopMovers } from "@/components/dashboard/TopMovers";
import { FuturesVIX } from "@/components/dashboard/FuturesVIX";
import { SectorHeatmap } from "@/components/dashboard/SectorHeatmap";
import { MostActiveFnO } from "@/components/dashboard/MostActiveFnO";
import { MarketBreadth } from "@/components/dashboard/MarketBreadth";
import { DailyBrief } from "@/components/dashboard/DailyBrief";
import { useMarketBrief } from "@/components/dashboard/useMarketBrief";
import { DataSourcesBar } from "@/components/dashboard/DataSourcesBar";
import { NeedsLiveStrip } from "@/components/dashboard/NeedsLiveStrip";
import { OnboardingTour } from "@/components/dashboard/OnboardingTour";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { WidgetBoundary } from "@/components/dashboard/WidgetBoundary";
import { DensityContext, useDensityClasses } from "@/components/dashboard/density";
import { useNow } from "@/components/dashboard/useNow";
import { useDashFno, useDashIndices } from "@/components/dashboard/useDashboardData";
import { collectLiveGaps, partitionSections } from "@/components/dashboard/liveGaps";
import { loadTour, saveTour, tourReducer } from "@/components/dashboard/onboarding";
import { activeWorkspace, loadWorkspaces, saveWorkspaces, updateActiveLayout, type WorkspaceState } from "@/components/dashboard/workspaces";
import { DEFAULT_LAYOUT, WELCOME_DISMISS_KEY, readFlag, sectionMeta, visibleSections, writeFlag, type SectionId } from "@/components/dashboard/dashboardModel";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const ICONS: Record<SectionId, ReactNode> = {
  indices: <TrendingUp className="h-4 w-4" />,
  brief: <Newspaper className="h-4 w-4" />,
  metrics: <BarChart3 className="h-4 w-4" />,
  positioning: <Crosshair className="h-4 w-4" />,
  volatility: <Target className="h-4 w-4" />,
  expiry: <CalendarClock className="h-4 w-4" />,
  movers: <Activity className="h-4 w-4" />,
  futures: <Gauge className="h-4 w-4" />,
  ivScanner: <Zap className="h-4 w-4" />,
  sectors: <Layers className="h-4 w-4" />,
  active: <Zap className="h-4 w-4" />,
  breadth: <BarChart3 className="h-4 w-4" />,
};

function ExpectedMoves() {
  const d = useDensityClasses();
  return (
    <div className={cn("grid md:grid-cols-2 xl:grid-cols-3", d.gap)}>
      {["NIFTY", "BANKNIFTY", "SENSEX"].map((s) => (
        <WidgetBoundary key={s} name={`${s} expected move`}>
          <ExpectedMoveWidget symbol={s} />
        </WidgetBoundary>
      ))}
    </div>
  );
}

function renderSection(id: SectionId): ReactNode {
  switch (id) {
    case "indices":
      return <IndexCards />;
    case "brief":
      return <DailyBrief />;
    case "metrics":
      return <KeyMetrics />;
    case "positioning":
      return <FeatureCards />;
    case "volatility":
      return <ExpectedMoves />;
    case "expiry":
      return <GiftNiftyExpiry />;
    case "movers":
      return <TopMovers />;
    case "futures":
      return <FuturesVIX />;
    case "ivScanner":
      return <IVRankDashboard />;
    case "sectors":
      return <SectorHeatmap />;
    case "active":
      return <MostActiveFnO />;
    case "breadth":
      return <MarketBreadth />;
  }
}

/** Sections whose data finished loading with nothing to show, even after the sample fallback. */
function useEmptySections(): Set<SectionId> {
  const idx = useDashIndices();
  const fno = useDashFno();
  const noIndices = !idx.isLoading && idx.data.data.length === 0;
  const noStocks = !fno.isLoading && (fno.data?.allStocks.length ?? 0) === 0;
  return useMemo(() => {
    const s = new Set<SectionId>();
    if (noIndices) s.add("indices").add("futures");
    if (noStocks) s.add("movers").add("active");
    return s;
  }, [noIndices, noStocks]);
}

function DashboardDate() {
  const ist = nowIST(useNow(60_000));
  return (
    <>
      <time dateTime={ist.date}>
        {WEEKDAY[ist.weekday]}, {formatDateIST(ist.date)}
      </time>{" "}
      · IST. Indices, positioning and volatility at a glance; select any card to open its page.
    </>
  );
}

export default function Index() {
  useDocumentTitle("Dashboard");
  const qc = useQueryClient();

  const [ws, setWs] = useState<WorkspaceState>(() => loadWorkspaces());
  const [saved, setSaved] = useState(true);
  const [showContext, setShowContext] = useState(() => !readFlag(WELCOME_DISMISS_KEY));
  const [tour, dispatchTour] = useReducer(tourReducer, undefined, () => loadTour());

  useEffect(() => setSaved(saveWorkspaces(ws)), [ws]);
  useEffect(() => saveTour(tour), [tour]);

  const layout = activeWorkspace(ws).layout;
  const onChange = useCallback((fn: (s: WorkspaceState) => WorkspaceState) => setWs(fn), []);
  const onShowContext = useCallback((v: boolean) => {
    setShowContext(v);
    writeFlag(WELCOME_DISMISS_KEY, !v);
  }, []);
  const onReset = useCallback(() => setWs((s) => updateActiveLayout(s, (l) => ({ ...DEFAULT_LAYOUT, order: [...DEFAULT_LAYOUT.order], density: l.density }))), []);

  const visible = visibleSections(layout);
  const emptySet = useEmptySections();
  const { populated, empty } = partitionSections(visible, emptySet);

  const brief = useMarketBrief();
  const idx = useDashIndices();
  const fno = useDashFno();
  const offline = idx.isSample || fno.isSample || brief.chainIsSample;
  const gaps = useMemo(() => {
    const emptySections = empty.map((id) => ({ id, title: sectionMeta(id).title }));
    if (!offline) return collectLiveGaps({ gift: true, pcrPrev: true, maxPainPrev: true, emptySections });
    const list = collectLiveGaps({ gift: brief.giftAvailable, pcrPrev: brief.hasPrevPcr, maxPainPrev: brief.hasPrevMaxPain, emptySections });
    for (const item of brief.items) {
      if (!item.available && !list.some((g) => g.label === item.label)) list.push({ key: `brief:${item.key}`, label: item.label, to: item.to });
    }
    return list;
  }, [empty, offline, brief.giftAvailable, brief.hasPrevPcr, brief.hasPrevMaxPain, brief.items]);

  const onRecovered = useCallback(() => void qc.invalidateQueries(), [qc]);

  return (
    <DensityContext.Provider value={layout.density}>
      <div className={layout.density === "compact" ? "space-y-2" : "space-y-3"} data-density={layout.density}>
        <PageHeader
          icon={LayoutDashboard}
          title="Market dashboard"
          description={<DashboardDate />}
          actions={
            <>
              <DataSourcesBar />
              <LayoutCustomizer
                state={ws}
                onChange={onChange}
                showContext={showContext}
                onShowContext={onShowContext}
                onRestartTour={() => dispatchTour({ type: "restart" })}
                saved={saved}
              />
            </>
          }
        />

        {!tour.done ? (
          <WidgetBoundary name="Getting started tour">
            <OnboardingTour state={tour} dispatch={dispatchTour} />
          </WidgetBoundary>
        ) : null}

        {showContext ? (
          <WidgetBoundary name="Market context">
            <WelcomeBanner onDismiss={() => onShowContext(false)} />
          </WidgetBoundary>
        ) : null}

        <QuickTradeActions />

        {visible.length === 0 ? (
          <div className="rounded-card border border-dashed border-separator-strong bg-card p-6 text-center">
            <p className="text-body font-medium">All sections are hidden in this workspace.</p>
            <Button type="button" onClick={onReset} className="mt-2">
              Restore default layout
            </Button>
          </div>
        ) : null}

        {populated.map((id) => {
          const meta = sectionMeta(id);
          const headingId = `dash-${id}-title`;
          return (
            <section key={id} aria-labelledby={headingId}>
              <SectionHeader
                id={headingId}
                title={meta.title}
                subtitle={meta.subtitle}
                tooltip={meta.tooltip}
                icon={ICONS[id]}
                actions={id === "indices" ? <IndexCardsStatus /> : undefined}
              />
              <WidgetBoundary name={meta.title}>{renderSection(id)}</WidgetBoundary>
            </section>
          );
        })}

        <NeedsLiveStrip gaps={gaps} onRecovered={onRecovered} />

        <p className="pt-3 text-center text-body-sm text-muted-foreground">
          Data for education and research. Not investment advice. Lot sizes and MCX dates should be verified with the exchange.
        </p>
      </div>
    </DensityContext.Provider>
  );
}
