/**
 * Positioning cards built by the feature streams. All cross-stream imports live in this one file,
 * so the integrator can adjust them in one place. Each card has its own error boundary.
 */
import GammaLevelsCard from "@/components/gex/GammaLevelsCard";
import PremiumTideCard from "@/components/flow/PremiumTideCard";
import FiiLongCard from "@/components/participants/FiiLongCard";
import { IVRankCard } from "@/components/IVRankWidget";
import { cn } from "@/lib/utils";
import { WidgetBoundary } from "./WidgetBoundary";
import { useDensityClasses } from "./density";

export function FeatureCards() {
  const d = useDensityClasses();
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 min-[1600px]:grid-cols-4", d.gap)}>
      <WidgetBoundary name="Gamma levels">
        <GammaLevelsCard symbol="NIFTY" />
      </WidgetBoundary>
      <WidgetBoundary name="Premium tide">
        <PremiumTideCard symbol="NIFTY" />
      </WidgetBoundary>
      <WidgetBoundary name="FII index futures long %">
        <FiiLongCard />
      </WidgetBoundary>
      <div className={cn("grid grid-cols-2 content-start min-[1600px]:grid-cols-1", d.gap)}>
        <WidgetBoundary name="NIFTY IV rank">
          <IVRankCard symbol="NIFTY" />
        </WidgetBoundary>
        <WidgetBoundary name="BANKNIFTY IV rank">
          <IVRankCard symbol="BANKNIFTY" />
        </WidgetBoundary>
      </div>
    </div>
  );
}

export default FeatureCards;
