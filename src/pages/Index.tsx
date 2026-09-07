import { useMemo } from "react";
import { useLiveIndices, useMarketStatus, useExpiryList, useCommodityExpiry, useAllIndices, useLiveOptionChain } from "@/hooks/useMarketData";
import { getSpotPrice } from "@/lib/positionStore";
import { getATMIV } from "@/lib/oiUtils";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ExpectedMoveWidget } from "@/components/ExpectedMoveWidget";
import { TopBuildupSignals } from "@/components/dashboard/TopBuildupSignals";
import { useWebSocketVix } from "@/hooks/useWebSocket";
import { Target, BarChart3, Zap, TrendingUp, Activity, Landmark, Globe } from "lucide-react";

import { MarketHeader } from "@/components/dashboard/MarketHeader";
import { GlobalMarketCues } from "@/components/dashboard/GlobalMarketCues";
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
import { FIIDIIActivity } from "@/components/dashboard/FIIDIIActivity";
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
  const { data: finniftyExpiry } = useExpiryList("FINNIFTY");
  const { data: midcpniftyExpiry } = useExpiryList("MIDCPNIFTY");
  // Each MCX commodity has its own expiry cycle (crude ~19th-21st, gold/silver
  // ~4th-5th, natural gas ~23rd-28th) — fetched individually rather than
  // approximated, since they don't share a calendar the way NSE indices do.
  const { data: crudeoilExpiry } = useCommodityExpiry("CRUDEOIL");
  const { data: goldExpiry } = useCommodityExpiry("GOLD");
  const { data: silverExpiry } = useCommodityExpiry("SILVER");
  const { data: naturalgasExpiry } = useCommodityExpiry("NATURALGAS");
  const { data: allIndicesData } = useAllIndices();
  const { vix: wsVix } = useWebSocketVix();

  const indices = indicesResult?.data || [];
  const isLive = indicesResult?.isLive || false;
  const isOpen = marketStatusResult?.isOpen ?? false;
  const marketStatus = marketStatusResult?.status || "Closed";
  const giftNifty = marketStatusResult?.giftNifty;
  const indicativeNifty = marketStatusResult?.indicativeNifty;
  
  // Live VIX value for Expected Move calculations (NIFTY only — VIX tracks NIFTY
  // options specifically, it is not a valid IV proxy for other indices)
  const liveVix = wsVix?.value ?? allIndicesData?.vix?.value ?? 0;

  // Look up spot price by symbol, not array position. `indices` is populated
  // from WebSocket ticks as they arrive (see useWebSocketIndices) — right after
  // a reconnect, or if any single symbol's tick is delayed, the array can be
  // shorter or reordered (e.g. BANKNIFTY may tick before NIFTY), so `indices[0]`
  // is not reliably NIFTY. Indexing by position silently fed the wrong index's
  // spot price into the other index's Expected Move / IV Rank calculation.
  const getIndexBySymbol = (sym: string) => indices.find((i) => i.symbol === sym);

  // BankNifty's own ATM IV, for its Expected Move card below — previously this
  // was faked as `liveVix * 1.15`, an arbitrary constant with no basis in
  // reality (VIX tracks NIFTY options only). ExpectedMoveWidget already shows
  // a graceful "waiting for data" state when iv is 0, so no fallback needed.
  const { data: bankNiftyChain } = useLiveOptionChain("BANKNIFTY");
  const bankNiftyIV = useMemo(() => {
    if (!bankNiftyChain?.chain?.length) return 0;
    return getATMIV(bankNiftyChain.chain, bankNiftyChain.spotPrice || getIndexBySymbol("BANKNIFTY")?.ltp || 0).atmIV;
  }, [bankNiftyChain]); // eslint-disable-line react-hooks/exhaustive-deps -- getIndexBySymbol closes over `indices`, recomputed every render; depending on it would defeat the memo

  const nearestExpiries = useMemo(() => {
    const nExpiry = niftyExpiry?.expiries?.[0]?.value || "";
    const bnExpiry = bnfExpiry?.expiries?.[0]?.value || "";
    // FINNIFTY and MIDCPNIFTY each have their own expiry calendar — fetch them
    // directly instead of reusing NIFTY's second expiry entry (which frequently
    // lands on the wrong date since the two contracts don't share expiry days).
    const fnExpiry = finniftyExpiry?.expiries?.[0]?.value || "";
    const mcExpiry = midcpniftyExpiry?.expiries?.[0]?.value || "";
    const crudeExpiry = crudeoilExpiry?.expiries?.[0]?.value || "";
    const goldExp = goldExpiry?.expiries?.[0]?.value || "";
    const silverExp = silverExpiry?.expiries?.[0]?.value || "";
    const ngExpiry = naturalgasExpiry?.expiries?.[0]?.value || "";
    return EXPIRY_CONTRACTS.map((c) => {
      let expDate = "";
      if (c.symbol === "NIFTY") expDate = nExpiry;
      else if (c.symbol === "BANKNIFTY") expDate = bnExpiry;
      else if (c.symbol === "FINNIFTY") expDate = fnExpiry;
      else if (c.symbol === "MIDCPNIFTY") expDate = mcExpiry;
      else if (c.symbol === "CRUDEOIL") expDate = crudeExpiry;
      else if (c.symbol === "GOLD") expDate = goldExp;
      else if (c.symbol === "SILVER") expDate = silverExp;
      else if (c.symbol === "NATURALGAS") expDate = ngExpiry;
      return { ...c, expiry: expDate, timeLeft: expDate ? getTimeToExpiry(expDate) : "N/A" };
    });
  }, [niftyExpiry, bnfExpiry, finniftyExpiry, midcpniftyExpiry, crudeoilExpiry, goldExpiry, silverExpiry, naturalgasExpiry]);

  const getDTE = (sym: string) => {
    const timeLeft = nearestExpiries.find((c) => c.symbol === sym)?.timeLeft;
    if (!timeLeft || timeLeft === "N/A") return 4;
    if (timeLeft === "Expired") return 0;
    const dayMatch = timeLeft.match(/(\d+)d/);
    if (dayMatch) return parseInt(dayMatch[1]);
    // "Xh left" format means expiry is later today — 0 days to expiry, not the
    // previous hardcoded fallback of 4 (which badly skewed Expected Move / IV
    // Rank math on the most important day of the week for theta decay).
    if (timeLeft.includes("h left")) return 0;
    return 4;
  };

  if (indicesLoading) return <DashboardSkeleton />;

  return (
    <ErrorBoundary fallbackMessage="Dashboard failed to load">
      <div className="space-y-3 animate-fade-in">
        {/* ═══ WELCOME + HEADER ═══ */}
        <MarketHeader isLive={isLive} isOpen={isOpen} marketStatus={marketStatus} />
        <DataSourcesBar />
        <WelcomeBanner />

        {/* ═══ GLOBAL MARKET CUES ═══ */}
        <SectionHeader
          title="Global Market Cues"
          subtitle="US close, Asian session, crude & dollar index"
          icon={<Globe className="h-4 w-4" />}
          tooltip="What every F&O trader checks before the bell: overnight US markets, the Asian session already in progress, crude oil, and the dollar index — the standard pre-market read on global risk sentiment."
        />
        <GlobalMarketCues />

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
          subtitle="Real-time spot prices for major indices"
          icon={<TrendingUp className="h-4 w-4" />}
          tooltip="Real-time spot prices for major indices. The mini-chart shows today's intraday movement. Click to open option chain."
        />
        <IndexCards indices={indices} isMarketOpen={isOpen} />

        {/* ═══ KEY METRICS ═══ */}
        <SectionHeader
          title="Key Market Metrics"
          subtitle="PCR, VIX, Max Pain, Advance/Decline"
          icon={<BarChart3 className="h-4 w-4" />}
          tooltip="PCR > 1 = bullish, < 0.7 = bearish. VIX measures fear — rising VIX = more volatility ahead. Max Pain is the strike where option writers profit most."
        />
        <KeyMetrics />

        {/* ═══ EXPECTED MOVE ═══ */}
        <SectionHeader
          title="Expected Move"
          subtitle="IV-based range estimates for NIFTY & BANKNIFTY"
          icon={<Target className="h-4 w-4" />}
          tooltip="Expected Move shows the probable price range by expiry based on each index's own ATM IV — the range option sellers are pricing in."
        />
        <div className="grid lg:grid-cols-2 gap-3">
          <ExpectedMoveWidget
            symbol="NIFTY"
            spotPrice={getIndexBySymbol("NIFTY")?.ltp || getSpotPrice("NIFTY")}
            iv={liveVix}
            daysToExpiry={getDTE("NIFTY")}
          />
          <ExpectedMoveWidget
            symbol="BANKNIFTY"
            spotPrice={getIndexBySymbol("BANKNIFTY")?.ltp || getSpotPrice("BANKNIFTY")}
            iv={bankNiftyIV}
            daysToExpiry={getDTE("BANKNIFTY")}
          />
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

        {/* ═══ FUTURES BUILDUP SCANNER ═══ */}
        <SectionHeader
          title="Futures Buildup Scanner"
          subtitle="Real OI buildup signals across the F&O universe"
          icon={<Zap className="h-4 w-4" />}
          tooltip="Long/Short Buildup and Covering/Unwinding signals derived from real futures LTP + OI changes across NIFTY, BANKNIFTY and every F&O stock. Open the full Scanner page to filter and sort the whole universe."
        />
        <TopBuildupSignals />

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

        {/* ═══ FII/DII ACTIVITY ═══ */}
        <SectionHeader
          title="FII/DII Activity"
          subtitle="Institutional cash-market flows"
          icon={<Landmark className="h-4 w-4" />}
          tooltip="Net buying/selling by Foreign (FII/FPI) and Domestic (DII) institutional investors in the cash market. Published by NSE after each trading day's close."
        />
        <FIIDIIActivity />
      </div>
    </ErrorBoundary>
  );
}
