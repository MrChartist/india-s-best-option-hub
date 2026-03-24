import { useMemo } from "react";
import { useLiveIndices, useMarketStatus, useExpiryList } from "@/hooks/useNSEData";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ExpectedMoveWidget } from "@/components/ExpectedMoveWidget";
import { IVRankCard, IVRankDashboard } from "@/components/IVRankWidget";
import { marketStats } from "@/lib/mockData";
import { Target, BarChart3, Zap, TrendingUp, Activity } from "lucide-react";

// Dashboard section components
import { MarketHeader } from "@/components/dashboard/MarketHeader";
import { TickerTape } from "@/components/dashboard/TickerTape";
import { IndexCards } from "@/components/dashboard/IndexCards";
import { QuickTradeActions } from "@/components/dashboard/QuickTradeActions";
import { KeyMetrics } from "@/components/dashboard/KeyMetrics";
import { GiftNiftyExpiry } from "@/components/dashboard/GiftNiftyExpiry";
import { TopMovers } from "@/components/dashboard/TopMovers";
import { FuturesVIX } from "@/components/dashboard/FuturesVIX";
import { SectorHeatmap } from "@/components/dashboard/SectorHeatmap";
import { MostActiveFnO } from "@/components/dashboard/MostActiveFnO";
import { MarketBreadth } from "@/components/dashboard/MarketBreadth";
import { SectionHeader } from "@/components/dashboard/SectionHeader";

// Nearest expiry contract config
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

  const indices = indicesResult?.data || [];
  const isLive = indicesResult?.isLive || false;
  const isOpen = marketStatusResult?.isOpen ?? false;
  const marketStatus = marketStatusResult?.status || "Closed";
  const giftNifty = marketStatusResult?.giftNifty;
  const indicativeNifty = marketStatusResult?.indicativeNifty;

  // Build expiry timeline
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
      <div className="space-y-4 animate-fade-in">
        {/* ═══ HEADER ═══ */}
        <MarketHeader isLive={isLive} isOpen={isOpen} marketStatus={marketStatus} />

        {/* ═══ TICKER TAPE ═══ */}
        <TickerTape indices={indices} giftNifty={giftNifty} />

        {/* ═══ QUICK TRADE ACTIONS ═══ */}
        <QuickTradeActions />

        {/* ═══ INDEX CARDS ═══ */}
        <IndexCards indices={indices} />

        {/* ═══ KEY METRICS ═══ */}
        <KeyMetrics />

        {/* ═══ EXPECTED MOVE + IV RANK ═══ */}
        <SectionHeader title="Volatility & Expected Move" subtitle="IV-based range estimates and rank" icon={<Target className="h-4 w-4" />} />
        <div className="grid lg:grid-cols-3 gap-3">
          <ExpectedMoveWidget
            symbol="NIFTY"
            spotPrice={indices[0]?.ltp || 24250.75}
            daysToExpiry={getDTE("NIFTY")}
          />
          <ExpectedMoveWidget
            symbol="BANKNIFTY"
            spotPrice={indices[1]?.ltp || 51850.40}
            iv={15.2}
            daysToExpiry={getDTE("BANKNIFTY")}
          />
          <div className="grid grid-cols-2 gap-2">
            <IVRankCard symbol="NIFTY" currentIV={marketStats.indiaVix} />
            <IVRankCard symbol="BANKNIFTY" currentIV={15.2} />
            <IVRankCard symbol="FINNIFTY" currentIV={12.8} />
            <IVRankCard symbol="MIDCPNIFTY" currentIV={15.1} />
          </div>
        </div>

        {/* ═══ GIFT NIFTY + EXPIRY CONTRACTS ═══ */}
        <SectionHeader title="Expiry & Derivatives" subtitle="GIFT Nifty, NSE & MCX contract expiries" icon={<Activity className="h-4 w-4" />} />
        <GiftNiftyExpiry giftNifty={giftNifty} indicativeNifty={indicativeNifty} nearestExpiries={nearestExpiries} />

        {/* ═══ TOP MOVERS ═══ */}
        <SectionHeader title="Top Movers" subtitle="Today's biggest gainers & losers" icon={<TrendingUp className="h-4 w-4" />} />
        <TopMovers />

        {/* ═══ FUTURES + VIX ═══ */}
        <SectionHeader title="Futures & VIX" subtitle="Premium/discount analysis and volatility trends" icon={<BarChart3 className="h-4 w-4" />} />
        <FuturesVIX />

        {/* ═══ IV RANK SCANNER ═══ */}
        <SectionHeader title="IV Rank Scanner" subtitle="Multi-symbol IV analysis with buy/sell signals" icon={<Zap className="h-4 w-4" />} />
        <IVRankDashboard />

        {/* ═══ SECTOR HEATMAP ═══ */}
        <SectorHeatmap />

        {/* ═══ MOST ACTIVE F&O ═══ */}
        <MostActiveFnO />

        {/* ═══ MARKET BREADTH ═══ */}
        <SectionHeader title="Market Breadth" subtitle="Advance/decline, 52W highs/lows, EMA coverage & sector rotation" icon={<BarChart3 className="h-4 w-4" />} />
        <MarketBreadth />
      </div>
    </ErrorBoundary>
  );
}
