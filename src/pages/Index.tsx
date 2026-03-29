import { useMemo } from "react";
import { useLiveIndices, useMarketStatus, useExpiryList, useAllIndices } from "@/hooks/useMarketData";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ExpectedMoveWidget } from "@/components/ExpectedMoveWidget";
import { IVRankCard, IVRankDashboard } from "@/components/IVRankWidget";
import { useWebSocketVix } from "@/hooks/useWebSocket";
import { Target, BarChart3, Zap, TrendingUp, Activity } from "lucide-react";

import { MarketHeader } from "@/components/dashboard/MarketHeader";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { IndexCards } from "@/components/dashboard/IndexCards";
import { WelcomeBanner } from "@/components/dashboard/WelcomeBanner";
import { QuickTradeActions } from "@/components/dashboard/QuickTradeActions";
import { KeyMetrics } from "@/components/dashboard/KeyMetrics";
import { GiftNiftyExpiry } from "@/components/dashboard/GiftNiftyExpiry";
import { TopMovers } from "@/components/dashboard/TopMovers";
import { FuturesVIX } from "@/components/dashboard/FuturesVIX";
import { SectorHeatmap } from "@/components/dashboard/SectorHeatmap";
import { MostActiveFnO } from "@/components/dashboard/MostActiveFnO";
import { MarketBreadth } from "@/components/dashboard/MarketBreadth";
import { SectionHeader } from "@/components/dashboard/SectionHeader";
import { DataSourcesBar } from "@/components/dashboard/DataSourcesBar";

const EXPIRY_CONTRACTS = [
  { symbol: "NIFTY", exchange: "NSE", lotSize: 25, type: "Weekly" },
  { symbol: "BANKNIFTY", exchange: "NSE", lotSize: 15, type: "Weekly" },
  { symbol: "FINNIFTY", exchange: "NSE", lotSize: 25, type: "Monthly" },
  { symbol: "MIDCPNIFTY", exchange: "NSE", lotSize: 50, type: "Monthly" },
  { symbol: "CRUDEOIL", exchange: "MCX", lotSize: 100, type: "Monthly" },
  { symbol: "GOLD", exchange: "MCX", lotSize: 100, type: "Monthly" },
  { symbol: "SILVER", exchange: "MCX", lotSize: 30, type: "Monthly" },
  { symbol: "NATURALGAS", exchange: "MCX", lotSize: 1250, type: "Monthly" },
];

function getTimeToExpiry(expiryDate: string): string {
  const expiry = new Date(expiryDate + "T15:30:00+05:30");
  const now = new Date();
  const diff = expiry.getTime() - now.getTime();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days === 0) return `${hours}h left`;
  return `${days}d ${hours}h`;
}

export default function Index() {
  const { data: indicesResult, isLoading: indicesLoading } = useLiveIndices();
  const { data: marketStatusResult } = useMarketStatus();
  const { data: niftyExpiry } = useExpiryList("NIFTY");
  const { data: bnfExpiry } = useExpiryList("BANKNIFTY");
  const { data: allIndicesData } = useAllIndices();
  const { vix: wsVix } = useWebSocketVix();

  const indices = indicesResult?.data || [];
  const isLive = indicesResult?.isLive || false;
  const isOpen = marketStatusResult?.isOpen ?? false;
  const marketStatus = marketStatusResult?.status || "Closed";
  const giftNifty = marketStatusResult?.giftNifty;
  const indicativeNifty = marketStatusResult?.indicativeNifty;
  
  // Live VIX value for Expected Move calculations
  const liveVix = wsVix?.value ?? allIndicesData?.vix?.value ?? 13.5;

  const nearestExpiries = useMemo(() => {
    const nExpiry = niftyExpiry?.expiries?.[0]?.value || "";
    const bnExpiry = bnfExpiry?.expiries?.[0]?.value || "";
    return EXPIRY_CONTRACTS.map((c) => {
      let expDate = "";
      if (c.symbol === "NIFTY") expDate = nExpiry;
      else if (c.symbol === "BANKNIFTY") expDate = bnExpiry;
      else if (c.symbol === "FINNIFTY") expDate = niftyExpiry?.expiries?.[1]?.value || nExpiry;
      else if (c.symbol === "MIDCPNIFTY") expDate = niftyExpiry?.expiries?.[1]?.value || nExpiry;
      else {
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        expDate = lastDay.toISOString().split("T")[0];
      }
      return { ...c, expiry: expDate, timeLeft: expDate ? getTimeToExpiry(expDate) : "N/A" };
    });
  }, [niftyExpiry, bnfExpiry]);

  const getDTE = (sym: string) => {
    const match = nearestExpiries.find((c) => c.symbol === sym)?.timeLeft?.match(/(\d+)d/);
    return match ? parseInt(match[1]) : 4;
  };

  if (indicesLoading) return <DashboardSkeleton />;

  return (
    <ErrorBoundary fallbackMessage="Dashboard failed to load">
      <div className="space-y-3 animate-fade-in">
        {/* ═══ WELCOME + HEADER ═══ */}
        <MarketHeader isLive={isLive} isOpen={isOpen} marketStatus={marketStatus} />
        <DataSourcesBar />
        <WelcomeBanner />

        {/* ═══ TICKER TAPE ═══ */}
        <TickerTape indices={indices} giftNifty={giftNifty} />

        {/* ═══ QUICK TRADE ACTIONS ═══ */}
        <SectionHeader
          title="Quick Actions"
          subtitle="Jump to any tool instantly"
          icon={<Zap className="h-4 w-4" />}
          tooltip="One-click shortcuts to the most used tools. Click any card to navigate directly."
        />
        <QuickTradeActions />

        {/* ═══ INDEX CARDS ═══ */}
        <SectionHeader
          title="Live Indices"
          subtitle="Click any card to view its option chain"
          icon={<TrendingUp className="h-4 w-4" />}
          tooltip="Real-time spot prices for major indices. The mini-chart shows today's intraday movement. Click to open option chain."
        />
        <IndexCards indices={indices} />

        {/* ═══ KEY METRICS ═══ */}
        <SectionHeader
          title="Key Market Metrics"
          subtitle="PCR, VIX, Max Pain, Advance/Decline"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="PCR > 1 = bullish, < 0.7 = bearish. VIX measures fear — rising VIX = more volatility ahead. Max Pain is the strike where option writers profit most."
        />
        <KeyMetrics />

        {/* ═══ EXPECTED MOVE + IV RANK ═══ */}
        <SectionHeader
          title="Volatility & Expected Move"
          subtitle="IV-based range estimates and rank"
          icon={<Target className="h-4 w-4" />}
          tooltip="Expected Move shows the probable price range by expiry based on IV. IV Rank tells you if current IV is high or low compared to the past year — helps decide whether to buy or sell options."
        />
        <div className="grid lg:grid-cols-3 gap-3">
          <ExpectedMoveWidget
            symbol="NIFTY"
            spotPrice={indices[0]?.ltp || 24250.75}
            iv={liveVix}
            daysToExpiry={getDTE("NIFTY")}
          />
          <ExpectedMoveWidget
            symbol="BANKNIFTY"
            spotPrice={indices[1]?.ltp || 51850.40}
            iv={liveVix * 1.15}
            daysToExpiry={getDTE("BANKNIFTY")}
          />
          <div className="grid grid-cols-2 gap-2">
            <IVRankCard symbol="NIFTY" currentIV={liveVix} />
            <IVRankCard symbol="BANKNIFTY" currentIV={liveVix * 1.15} />
            <IVRankCard symbol="FINNIFTY" currentIV={liveVix * 0.95} />
            <IVRankCard symbol="MIDCPNIFTY" currentIV={liveVix * 1.1} />
          </div>
        </div>

        {/* ═══ GIFT NIFTY + EXPIRY CONTRACTS ═══ */}
        <SectionHeader
          title="Expiry & Derivatives"
          subtitle="GIFT Nifty, NSE & MCX contract expiries"
          icon={<Activity className="h-4 w-4" />}
          tooltip="GIFT Nifty indicates pre-market direction. Track time-to-expiry for all contracts — theta decay accelerates in the last 2–3 days."
        />
        <GiftNiftyExpiry giftNifty={giftNifty} indicativeNifty={indicativeNifty} nearestExpiries={nearestExpiries} />

        {/* ═══ TOP MOVERS ═══ */}
        <SectionHeader
          title="Top Movers"
          subtitle="Today's biggest gainers & losers"
          icon={<TrendingUp className="h-4 w-4" />}
          tooltip="Stocks with the largest % change today. Click any row to view its option chain for trading opportunities."
        />
        <TopMovers />

        {/* ═══ FUTURES + VIX ═══ */}
        <SectionHeader
          title="Futures & VIX"
          subtitle="Premium/discount analysis and volatility trends"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Futures premium = bullish sentiment, discount = bearish. VIX chart shows 30-day volatility trend — useful for straddle/strangle timing."
        />
        <FuturesVIX />

        {/* ═══ IV RANK SCANNER ═══ */}
        <SectionHeader
          title="IV Rank Scanner"
          subtitle="Multi-symbol IV analysis with buy/sell signals"
          icon={<Zap className="h-4 w-4" />}
          tooltip="Scans multiple F&O stocks for IV rank. High IV Rank (>70) = sell premium strategies. Low IV Rank (<30) = buy premium strategies."
        />
        <IVRankDashboard />

        {/* ═══ SECTOR HEATMAP ═══ */}
        <SectionHeader
          title="Sector Performance"
          subtitle="Color-coded sector returns"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Green = sector up, Red = sector down. Intensity shows magnitude. Helps identify sector rotation and where money is flowing."
        />
        <SectorHeatmap />

        {/* ═══ MOST ACTIVE F&O ═══ */}
        <SectionHeader
          title="Most Active F&O"
          subtitle="High volume + OI change signals"
          icon={<Zap className="h-4 w-4" />}
          tooltip="Shows stocks with highest F&O activity. Signals: Long Buildup (price ↑ + OI ↑), Short Buildup (price ↓ + OI ↑), Short Covering (price ↑ + OI ↓), Long Unwinding (price ↓ + OI ↓)."
        />
        <MostActiveFnO />

        {/* ═══ MARKET BREADTH ═══ */}
        <SectionHeader
          title="Market Breadth"
          subtitle="Sentiment, Advance/Decline, VIX regime & F&O breadth"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="Composite market health score combining Advance/Decline ratio, VIX levels, and F&O stock breadth. Helps identify whether market internals support the trend."
        />
        <MarketBreadth />
      </div>
    </ErrorBoundary>
  );
}
