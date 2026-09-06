import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAllIndices, useFnOStocks } from "@/hooks/useMarketData";
import { useWebSocketVix } from "@/hooks/useWebSocket";
import {
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  BarChart3, Activity, Gauge, Loader2
} from "lucide-react";

export function MarketBreadth() {
  const { data: indexData } = useAllIndices();
  const { vix: wsVix } = useWebSocketVix();
  const { data: fnoData } = useFnOStocks();

  const advances = indexData?.advances ?? 0;
  const declines = indexData?.declines ?? 0;
  const unchanged = indexData?.unchanged ?? 0;
  const total = advances + declines + unchanged;
  const isLive = indexData?.isLive || false;
  
  const vix = wsVix?.value ?? indexData?.vix?.value ?? null;
  const vixChange = wsVix?.changePercent ?? indexData?.vix?.changePercent ?? null;

  // Sector strength from available data
  const sectors = indexData?.sectors || [];
  const bullishSectors = sectors.filter((s: any) => s.change > 0).length;
  const bearishSectors = sectors.filter((s: any) => s.change < 0).length;

  // F&O stock analysis from NSE
  const allStocks = fnoData?.allStocks || [];
  const stocksUp = allStocks.filter(s => s.changePercent > 0).length;
  const stocksDown = allStocks.filter(s => s.changePercent < 0).length;
  const totalStocks = allStocks.length;

  // Market sentiment score (0-100)
  const sentimentScore = useMemo(() => {
    let score = 50;
    if (total > 0) score += ((advances - declines) / total) * 25;
    if (vix) {
      if (vix < 12) score += 10;
      else if (vix < 15) score += 5;
      else if (vix > 20) score -= 10;
      else if (vix > 25) score -= 15;
    }
    if (totalStocks > 0) score += ((stocksUp - stocksDown) / totalStocks) * 15;
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [advances, declines, total, vix, stocksUp, stocksDown, totalStocks]);

  const sentimentLabel = sentimentScore >= 70 ? "Strong Bullish" : sentimentScore >= 55 ? "Bullish" : sentimentScore >= 45 ? "Neutral" : sentimentScore >= 30 ? "Bearish" : "Strong Bearish";
  const sentimentColor = sentimentScore >= 55 ? "text-bullish" : sentimentScore >= 45 ? "text-warning" : "text-bearish";

    if (!isLive && totalStocks === 0) {
      return (
        <Card className="hover:shadow-card-hover transition-all duration-200">
          <CardContent className="py-8 text-center">
            <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-base font-semibold text-muted-foreground">Market breadth data unavailable</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Loads during market hours</p>
          </CardContent>
        </Card>
      );
    }

  return (
    <div className="grid lg:grid-cols-4 gap-3">
      {/* Market Sentiment Gauge */}
      <Card className="hover:shadow-card-hover transition-all duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" /> Market Sentiment
            {isLive && <Badge variant="outline" className="text-xs h-5 px-2 border-bullish/30 text-bullish ml-auto">LIVE</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <p className={`text-4xl font-semibold font-mono ${sentimentColor}`}>{sentimentScore}</p>
            <p className={`text-sm font-semibold tracking-wide uppercase mt-1 ${sentimentColor}`}>{sentimentLabel}</p>
          </div>
          <div className="relative h-4 rounded-full bg-gradient-to-r from-bearish/40 via-warning/40 to-bullish/40 overflow-hidden">
            <div
              className="absolute top-0 h-full w-2 bg-foreground rounded-full transition-all duration-500"
              style={{ left: `${sentimentScore}%`, transform: "translateX(-50%)" }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground font-mono font-medium">
            <span>Bearish</span>
            <span>Neutral</span>
            <span>Bullish</span>
          </div>
        </CardContent>
      </Card>

      {/* Advance/Decline */}
      <Card className="hover:shadow-card-hover transition-all duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" /> Advance / Decline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-bullish">
                <ArrowUpRight className="h-5 w-5" />
                <span className="text-3xl font-semibold font-mono">{advances}</span>
              </div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Advances</p>
            </div>
            <div className="text-center pb-1">
              <span className="text-base font-semibold font-mono text-muted-foreground">{unchanged}</span>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Unchanged</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 text-bearish justify-end">
                <span className="text-3xl font-semibold font-mono">{declines}</span>
                <ArrowDownRight className="h-5 w-5" />
              </div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Declines</p>
            </div>
          </div>
          {total > 0 && (
            <>
              <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                <div className="bg-bullish/90 transition-all" style={{ width: `${(advances / total) * 100}%` }} />
                <div className="bg-muted-foreground/30" style={{ width: `${(unchanged / total) * 100}%` }} />
                <div className="bg-bearish/90 transition-all" style={{ width: `${(declines / total) * 100}%` }} />
              </div>
              <p className="text-xs text-muted-foreground text-center font-medium">
                A/D Ratio: <span className={`font-mono font-semibold text-sm ml-1 ${advances > declines ? "text-bullish" : "text-bearish"}`}>
                  {declines > 0 ? (advances / declines).toFixed(2) : "∞"}
                </span>
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* VIX Status */}
      <Card className="hover:shadow-card-hover transition-all duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-warning" /> VIX Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <p className={`text-4xl font-semibold font-mono ${vix && vix > 20 ? "text-bearish" : vix && vix < 13 ? "text-bullish" : "text-warning"}`}>
              {vix !== null ? vix.toFixed(2) : "—"}
            </p>
            {vixChange !== null && (
              <p className={`text-sm font-semibold font-mono mt-1 ${vixChange < 0 ? "text-bullish" : "text-bearish"}`}>
                {vixChange >= 0 ? "+" : ""}{vixChange.toFixed(2)}%
              </p>
            )}
          </div>
          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between items-center p-2 rounded bg-accent/30 border border-border/70">
              <span className="text-muted-foreground font-medium uppercase tracking-wider">Regime</span>
              <span className={`font-semibold text-sm ${vix && vix > 20 ? "text-bearish" : vix && vix < 13 ? "text-bullish" : "text-warning"}`}>
                {vix ? (vix > 25 ? "Extreme Fear" : vix > 20 ? "High Vol" : vix > 15 ? "Normal" : vix > 12 ? "Low Vol" : "Complacency") : "—"}
              </span>
            </div>
            <div className="flex justify-between items-center p-2 rounded bg-accent/30 border border-border/70">
              <span className="text-muted-foreground font-medium uppercase tracking-wider">Option Strategy</span>
              <span className="font-semibold text-sm text-foreground/90">
                {vix ? (vix > 20 ? "Iron Condors" : vix < 13 ? "Buy Straddles" : "Neutral") : "—"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* F&O Breadth (from NSE stocks) */}
      <Card className="hover:shadow-card-hover transition-all duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" /> F&O Breadth
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {totalStocks > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-bullish/5 border border-bullish/10 text-center">
                  <p className="text-3xl font-semibold font-mono text-bullish">{stocksUp}</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Stocks Up</p>
                </div>
                <div className="p-3 rounded-lg bg-bearish/5 border border-bearish/10 text-center">
                  <p className="text-3xl font-semibold font-mono text-bearish">{stocksDown}</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mt-1">Stocks Down</p>
                </div>
              </div>
              <Progress
                value={(stocksUp / totalStocks) * 100}
                className="h-3"
              />
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center p-1.5">
                  <span className="text-muted-foreground font-medium">Sectors Bullish</span>
                  <span className="text-bullish font-semibold text-sm">{bullishSectors}</span>
                </div>
                <div className="flex justify-between items-center p-1.5 bg-accent/20 rounded">
                  <span className="text-muted-foreground font-medium">Sectors Bearish</span>
                  <span className="text-bearish font-semibold text-sm">{bearishSectors}</span>
                </div>
                <div className="flex justify-between items-center p-1.5">
                  <span className="text-muted-foreground font-medium">F&O Stocks Tracked</span>
                  <span className="font-semibold text-sm">{totalStocks}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="py-4 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground font-medium">Loading F&O data...</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
