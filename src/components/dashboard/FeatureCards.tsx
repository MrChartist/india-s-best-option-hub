/**
 * Positioning cards built by the feature streams. All cross-stream imports live in this one file,
 * so the integrator can adjust them in one place. Each card has its own error boundary.
 * One column on phones, two from 640 px, four on very wide screens; every card fills its cell.
 */
import GammaLevelsCard from "@/components/gex/GammaLevelsCard";
import PremiumTideCard from "@/components/flow/PremiumTideCard";
import FiiLongCard from "@/components/participants/FiiLongCard";
import { cn } from "@/lib/utils";
import { IVRankPairCard } from "./IVRankPairCard";
import { WidgetBoundary } from "./WidgetBoundary";
import { useDensityClasses } from "./density";

export function FeatureCards() {
  const d = useDensityClasses();
  return (
    <div className={cn("grid min-w-0 grid-cols-1 sm:grid-cols-2 min-[1600px]:grid-cols-4 [&>*]:min-w-0", d.gap)}>
      <WidgetBoundary name="Gamma levels">
        <GammaLevelsCard symbol="NIFTY" />
      </WidgetBoundary>
      <WidgetBoundary name="Premium tide">
        <PremiumTideCard symbol="NIFTY" className="h-full" />
      </WidgetBoundary>
      <WidgetBoundary name="FII index futures long %">
        <FiiLongCard />
      </WidgetBoundary>
      <WidgetBoundary name="IV rank">
        <IVRankPairCard />
      </WidgetBoundary>
    </div>
  );
}

export default FeatureCards;
