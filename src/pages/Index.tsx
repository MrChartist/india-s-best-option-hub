/**
 * Market dashboard. Every section renders on its own (no full-page skeleton), sits in its own
 * error boundary, and can be hidden or reordered. Layout and density persist in localStorage.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Activity, BarChart3, CalendarClock, Crosshair, Gauge, Layers, Target, TrendingUp, Zap } from "lucide-react";
import { ExpectedMoveWidget } from "@/components/ExpectedMoveWidget";
import { IVRankDashboard } from "@/components/IVRankWidget";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { cn } from "@/lib/utils";

import { MarketHeader } from "@/components/dashboard/MarketHeader";
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
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { WidgetBoundary } from "@/components/dashboard/WidgetBoundary";
import { DensityContext, useDensityClasses } from "@/components/dashboard/density";
import {
  DEFAULT_LAYOUT,
  WELCOME_DISMISS_KEY,
  loadLayout,
  moveSection,
  readFlag,
  saveLayout,
  sectionMeta,
  setSectionVisible,
  visibleSections,
  writeFlag,
  type DashLayout,
  type Density,
  type SectionId,
} from "@/components/dashboard/dashboardModel";


const ICONS: Record<SectionId, ReactNode> = {
  indices: <TrendingUp className="h-4 w-4" />,
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

export default function Index() {
  useDocumentTitle("Dashboard");

  const [layout, setLayout] = useState<DashLayout>(() => loadLayout());
  const [showContext, setShowContext] = useState(() => !readFlag(WELCOME_DISMISS_KEY));

  useEffect(() => saveLayout(layout), [layout]);

  const setDensity = useCallback((density: Density) => setLayout((l) => ({ ...l, density })), []);
  const onMove = useCallback((id: SectionId, dir: -1 | 1) => setLayout((l) => moveSection(l, id, dir)), []);
  const onToggle = useCallback((id: SectionId, visible: boolean) => setLayout((l) => setSectionVisible(l, id, visible)), []);
  const onReset = useCallback(() => setLayout((l) => ({ ...DEFAULT_LAYOUT, order: [...DEFAULT_LAYOUT.order], density: l.density })), []);
  const onShowContext = useCallback((v: boolean) => {
    setShowContext(v);
    writeFlag(WELCOME_DISMISS_KEY, !v);
  }, []);

  const sections = visibleSections(layout);

  return (
    <DensityContext.Provider value={layout.density}>
      <div className={cn("animate-fade-in", layout.density === "compact" ? "space-y-2" : "space-y-3")} data-density={layout.density}>
        <MarketHeader density={layout.density} onDensity={setDensity}>
          <LayoutCustomizer layout={layout} onMove={onMove} onToggle={onToggle} onReset={onReset} showContext={showContext} onShowContext={onShowContext} />
        </MarketHeader>

        {showContext ? (
          <WidgetBoundary name="Market context">
            <WelcomeBanner onDismiss={() => onShowContext(false)} />
          </WidgetBoundary>
        ) : null}

        <QuickTradeActions />

        {sections.length === 0 ? (
          <div className="rounded-card border border-dashed border-border bg-card p-6 text-center">
            <p className="text-body font-medium">All sections are hidden.</p>
            <button
              type="button"
              onClick={onReset}
              className="mt-2 inline-flex h-8 items-center rounded-md bg-primary px-3 text-body-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:shadow-ember focus-visible:outline-none"
            >
              Restore default layout
            </button>
          </div>
        ) : null}

        {sections.map((id) => {
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

        <p className="pt-4 text-center text-body-sm text-muted-foreground">
          Data for education and research. Not investment advice. Lot sizes and MCX dates should be verified with the exchange.
        </p>
      </div>
    </DensityContext.Provider>
  );
}
