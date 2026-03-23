import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { indicesData, marketStats } from "@/lib/mockData";
import { TrendingUp, TrendingDown, Activity, BarChart3, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Index() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Market Dashboard</h1>
        <p className="text-sm text-muted-foreground">NSE F&O Market Overview</p>
      </div>

      {/* Index Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {indicesData.map((index) => {
          const isPositive = index.change >= 0;
          return (
            <Card
              key={index.symbol}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => navigate(`/option-chain?symbol=${index.symbol}`)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{index.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold font-mono">{index.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                    <div className={`flex items-center gap-1 text-sm font-mono ${isPositive ? "text-bullish" : "text-bearish"}`}>
                      {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      <span>{isPositive ? "+" : ""}{index.change.toFixed(2)}</span>
                      <span>({isPositive ? "+" : ""}{index.changePercent.toFixed(2)}%)</span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground font-mono space-y-0.5">
                    <p>H: {index.high.toLocaleString("en-IN")}</p>
                    <p>L: {index.low.toLocaleString("en-IN")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Market Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" /> India VIX
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold font-mono">{marketStats.indiaVix}</p>
            <p className={`text-sm font-mono ${marketStats.vixChange < 0 ? "text-bullish" : "text-bearish"}`}>
              {marketStats.vixChange > 0 ? "+" : ""}{marketStats.vixChange.toFixed(2)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Nifty PCR
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold font-mono">{marketStats.niftyPCR}</p>
            <p className="text-sm text-muted-foreground">
              BankNifty: <span className="font-mono">{marketStats.bankNiftyPCR}</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Market Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold text-bullish">{marketStats.marketSentiment}</p>
            <div className="flex gap-2 text-xs font-mono mt-1">
              <span className="text-bullish">▲ {marketStats.advanceDecline.advances}</span>
              <span className="text-bearish">▼ {marketStats.advanceDecline.declines}</span>
              <span className="text-muted-foreground">— {marketStats.advanceDecline.unchanged}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" /> FII/DII Flow (₹ Cr)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">FII Net:</span>
                <span className={`font-mono font-medium ${marketStats.fiiData.net >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {marketStats.fiiData.net >= 0 ? "+" : ""}{marketStats.fiiData.net.toFixed(1)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">DII Net:</span>
                <span className={`font-mono font-medium ${marketStats.diiData.net >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {marketStats.diiData.net >= 0 ? "+" : ""}{marketStats.diiData.net.toFixed(1)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Access */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {["NIFTY", "BANKNIFTY", "FINNIFTY"].map(symbol => (
          <Card
            key={symbol}
            className="cursor-pointer hover:border-primary/50 transition-colors text-center py-4"
            onClick={() => navigate(`/option-chain?symbol=${symbol}`)}
          >
            <CardContent className="p-0">
              <p className="text-sm font-medium">{symbol} Chain</p>
              <p className="text-xs text-muted-foreground">View Option Chain →</p>
            </CardContent>
          </Card>
        ))}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors text-center py-4"
          onClick={() => navigate("/oi-analysis")}
        >
          <CardContent className="p-0">
            <p className="text-sm font-medium">OI Analysis</p>
            <p className="text-xs text-muted-foreground">Open Interest →</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
