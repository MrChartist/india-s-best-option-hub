import { Activity, BarChart3, CalendarClock, Target, TrendingUp, Zap } from "lucide-react";
import { useLiveIndices, useMarketStatus } from "@/hooks/useMarketData";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ExpectedMoveWidget } from "@/components/ExpectedMoveWidget";
import { VixRankCard } from "@/components/VixRankCard";

import { MarketHeader } from "@/components/dashboard/MarketHeader";
import { IndexCards } from "@/components/dashboard/IndexCards";
import { KeyMetrics } from "@/components/dashboard/KeyMetrics";
import { GiftNiftyExpiry } from "@/components/dashboard/GiftNiftyExpiry";
import { TopMovers } from "@/components/dashboard/TopMovers";
import { FuturesVIX } from "@/components/dashboard/FuturesVIX";
import { SectorHeatmap } from "@/components/dashboard/SectorHeatmap";
import { MostActiveFnO } from "@/components/dashboard/MostActiveFnO";
import { MarketBreadth } from "@/components/dashboard/MarketBreadth";
import { SectionHeader } from "@/components/dashboard/SectionHeader";

export default function Index() {
  const { data: indicesResult, isLoading: indicesLoading } = useLiveIndices();
  const { data: marketStatusResult } = useMarketStatus();

  const indices = indicesResult?.data || [];
  const marketStatus = marketStatusResult?.status || "Closed";
  const giftNifty = marketStatusResult?.giftNifty;
  const indicativeNifty = marketStatusResult?.indicativeNifty;

  if (indicesLoading) return <DashboardSkeleton />;

  return (
    <ErrorBoundary fallbackMessage="Dashboard failed to load">
      <div className="animate-fade-in space-y-3 pb-4">
        <MarketHeader marketStatus={marketStatus} />

        <SectionHeader
          title="Live Indices"
          subtitle="Tap a card to open its option chain"
          icon={<TrendingUp className="h-4 w-4" />}
          tooltip="Real-time spot prices for major indices. The mini-chart shows today's intraday movement."
        />
        <IndexCards indices={indices} />

        <SectionHeader
          title="Key Market Metrics"
          subtitle="PCR, VIX, Max Pain, Advance/Decline"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="PCR > 1 is read as bullish, < 0.7 as bearish. Rising VIX means more expected volatility. Max Pain is the strike where option writers profit most."
        />
        <KeyMetrics />

        <SectionHeader
          title="Volatility & Expected Move"
          subtitle="Built from the live option chain and India VIX history"
          icon={<Target className="h-4 w-4" />}
          tooltip="Expected move uses each index's own ATM IV and days to expiry. VIX rank compares today's India VIX with the last year of closes: high rank means options are expensive relative to the past year."
        />
        <div className="grid gap-3 lg:grid-cols-3">
          <ExpectedMoveWidget symbol="NIFTY" />
          <ExpectedMoveWidget symbol="BANKNIFTY" />
          <VixRankCard />
        </div>

        <SectionHeader
          title="GIFT Nifty & Expiries"
          subtitle="Pre-market cue and the exchange's expiry calendar"
          icon={<CalendarClock className="h-4 w-4" />}
          tooltip="GIFT Nifty hints at the opening gap. Theta decay accelerates in the last 2–3 days before expiry."
        />
        <GiftNiftyExpiry giftNifty={giftNifty} indicativeNifty={indicativeNifty} />

        <SectionHeader
          title="Top Movers"
          subtitle="Biggest gainers & losers in F&O"
          icon={<TrendingUp className="h-4 w-4" />}
          tooltip="Click any row to open that stock's option chain."
        />
        <TopMovers />

        <SectionHeader
          title="Futures & VIX"
          subtitle="Premium / discount and volatility trend"
          icon={<Activity className="h-4 w-4" />}
          tooltip="Futures at a premium reads bullish, at a discount reads bearish. The VIX chart helps time straddles and strangles."
        />
        <FuturesVIX />

        <SectionHeader
          title="Sector Performance"
          subtitle="Where money is rotating"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Green = sector up, red = sector down; intensity shows magnitude."
        />
        <SectorHeatmap />

        <SectionHeader
          title="Most Active F&O"
          subtitle="Volume and OI-change signals"
          icon={<Zap className="h-4 w-4" />}
          tooltip="Long buildup: price ↑ + OI ↑. Short buildup: price ↓ + OI ↑. Short covering: price ↑ + OI ↓. Long unwinding: price ↓ + OI ↓."
        />
        <MostActiveFnO />

        <SectionHeader
          title="Market Breadth"
          subtitle="Advance/Decline, VIX regime and F&O breadth"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="A composite of advance/decline ratio, VIX level and F&O breadth — do market internals support the trend?"
        />
        <MarketBreadth />
      </div>
    </ErrorBoundary>
  );
}
