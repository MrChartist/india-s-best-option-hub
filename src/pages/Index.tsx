import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { indicesData, marketStats, futuresData, mostActiveFnO, sectorData, generateIntradayData, generateVIXHistory } from "@/lib/mockData";
import { TrendingUp, TrendingDown, Activity, BarChart3, Users, Clock, Zap, Globe } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, AreaChart, Area } from "recharts";

export default function Index() {
  const navigate = useNavigate();
  const niftyIntraday = useMemo(() => generateIntradayData(24125.45, 0.5), []);
  const bankNiftyIntraday = useMemo(() => generateIntradayData(52031, 0.6), []);
  const vixHistory = useMemo(() => generateVIXHistory(), []);

  const now = new Date();
  const hours = now.getHours();
  const marketStatus = hours >= 9 && hours < 15 ? "Market Open" : hours === 15 && now.getMinutes() <= 30 ? "Market Open" : "Market Closed";
  const isOpen = marketStatus === "Market Open";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Market Dashboard</h1>
          <p className="text-sm text-muted-foreground">NSE F&O Market Overview · {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={isOpen ? "default" : "secondary"} className={`gap-1.5 ${isOpen ? "bg-bullish text-bullish-foreground" : ""}`}>
            <Clock className="h-3 w-3" />
            {marketStatus}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} IST</span>
        </div>
      </div>

      {/* Ticker Tape */}
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
        {indicesData.map((idx) => {
          const pos = idx.change >= 0;
          return (
            <div key={idx.symbol} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border shrink-0">
              <span className="text-xs font-medium text-muted-foreground">{idx.symbol}</span>
              <span className="text-sm font-bold font-mono">{idx.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              <span className={`text-xs font-mono ${pos ? "text-bullish" : "text-bearish"}`}>
                {pos ? "▲" : "▼"} {Math.abs(idx.changePercent).toFixed(2)}%
              </span>
            </div>
          );
        })}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border shrink-0">
          <span className="text-xs font-medium text-muted-foreground">VIX</span>
          <span className="text-sm font-bold font-mono">{marketStats.indiaVix}</span>
          <span className={`text-xs font-mono ${marketStats.vixChange < 0 ? "text-bullish" : "text-bearish"}`}>
            {marketStats.vixChange < 0 ? "▼" : "▲"} {Math.abs(marketStats.vixChange).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Index Cards with Sparklines */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {indicesData.map((index, idx) => {
          const isPositive = index.change >= 0;
          const intraday = idx === 0 ? niftyIntraday : idx === 1 ? bankNiftyIntraday : generateIntradayData(index.prevClose, 0.4);
          return (
            <Card
              key={index.symbol}
              className="cursor-pointer hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5"
              onClick={() => navigate(`/option-chain?symbol=${index.symbol}`)}
            >
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">{index.name}</p>
                    <p className="text-xl font-bold font-mono">{index.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded ${isPositive ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                    {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {isPositive ? "+" : ""}{index.changePercent.toFixed(2)}%
                  </div>
                </div>
                <div className="h-[50px] -mx-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={intraday}>
                      <defs>
                        <linearGradient id={`grad-${index.symbol}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={isPositive ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)"} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={isPositive ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)"} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="price" stroke={isPositive ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)"} fill={`url(#grad-${index.symbol})`} strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
                  <span>O: {index.open.toLocaleString("en-IN")}</span>
                  <span>H: {index.high.toLocaleString("en-IN")}</span>
                  <span>L: {index.low.toLocaleString("en-IN")}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Market Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">India VIX</p>
            </div>
            <p className="text-lg font-bold font-mono">{marketStats.indiaVix}</p>
            <p className={`text-xs font-mono ${marketStats.vixChange < 0 ? "text-bullish" : "text-bearish"}`}>
              {marketStats.vixChange > 0 ? "+" : ""}{marketStats.vixChange.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1.5 mb-1">
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">Nifty PCR</p>
            </div>
            <p className={`text-lg font-bold font-mono ${marketStats.niftyPCR > 1 ? "text-bullish" : "text-bearish"}`}>{marketStats.niftyPCR}</p>
            <p className="text-[10px] text-muted-foreground">BNF: <span className="font-mono">{marketStats.bankNiftyPCR}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">Advance/Decline</p>
            </div>
            <div className="flex gap-2 text-sm font-mono font-bold">
              <span className="text-bullish">{marketStats.advanceDecline.advances}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-bearish">{marketStats.advanceDecline.declines}</span>
            </div>
            <Progress value={(marketStats.advanceDecline.advances / (marketStats.advanceDecline.advances + marketStats.advanceDecline.declines)) * 100} className="h-1.5 mt-1.5" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">FII Net (₹Cr)</p>
            </div>
            <p className={`text-lg font-bold font-mono ${marketStats.fiiData.net >= 0 ? "text-bullish" : "text-bearish"}`}>
              {marketStats.fiiData.net >= 0 ? "+" : ""}{marketStats.fiiData.net.toFixed(0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">DII Net (₹Cr)</p>
            </div>
            <p className={`text-lg font-bold font-mono ${marketStats.diiData.net >= 0 ? "text-bullish" : "text-bearish"}`}>
              {marketStats.diiData.net >= 0 ? "+" : ""}{marketStats.diiData.net.toFixed(0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">F&O Turnover</p>
            </div>
            <p className="text-lg font-bold font-mono">₹{(marketStats.totalFnOTurnover / 1000).toFixed(1)}K Cr</p>
          </CardContent>
        </Card>
      </div>

      {/* Futures Premium + VIX Chart */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" /> Futures Premium/Discount</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Symbol</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Spot</TableHead>
                  <TableHead className="text-right">Futures</TableHead>
                  <TableHead className="text-right">Premium</TableHead>
                  <TableHead className="text-right">OI Chg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {futuresData.map((f, i) => (
                  <TableRow key={i} className="text-xs font-mono">
                    <TableCell className="font-medium">{f.symbol}</TableCell>
                    <TableCell className="text-muted-foreground">{f.expiry}</TableCell>
                    <TableCell className="text-right">{f.spotPrice.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right">{f.futuresPrice.toLocaleString("en-IN")}</TableCell>
                    <TableCell className={`text-right ${f.premium >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {f.premium >= 0 ? "+" : ""}{f.premium.toFixed(2)} ({f.premiumPercent.toFixed(2)}%)
                    </TableCell>
                    <TableCell className={`text-right ${f.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {f.oiChange >= 0 ? "+" : ""}{(f.oiChange / 100000).toFixed(1)}L
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> India VIX (30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={vixHistory}>
                  <defs>
                    <linearGradient id="vixGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)", borderRadius: "8px", fontSize: "11px" }} />
                  <Area type="monotone" dataKey="vix" stroke="hsl(38 92% 50%)" fill="url(#vixGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sector Heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Sector Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {sectorData.map((sector) => {
              const pos = sector.change >= 0;
              const intensity = Math.min(Math.abs(sector.change) / 3, 1);
              return (
                <div
                  key={sector.name}
                  className="rounded-lg p-3 text-center transition-transform hover:scale-105 cursor-default"
                  style={{
                    backgroundColor: pos
                      ? `hsl(142 71% 45% / ${0.08 + intensity * 0.25})`
                      : `hsl(0 84% 60% / ${0.08 + intensity * 0.25})`,
                  }}
                >
                  <p className="text-xs font-medium">{sector.name}</p>
                  <p className={`text-sm font-bold font-mono ${pos ? "text-bullish" : "text-bearish"}`}>
                    {pos ? "+" : ""}{sector.change.toFixed(2)}%
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Most Active F&O */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4" /> Most Active F&O Stocks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">LTP</TableHead>
                <TableHead className="text-right">Chg%</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead className="text-right">OI</TableHead>
                <TableHead className="text-right">OI Chg</TableHead>
                <TableHead>Interpretation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mostActiveFnO.map((stock) => {
                const interpretationColor = {
                  "Long Buildup": "text-bullish",
                  "Short Buildup": "text-bearish",
                  "Long Unwinding": "text-bearish",
                  "Short Covering": "text-bullish",
                }[stock.oiInterpretation];
                return (
                  <TableRow key={stock.symbol} className="text-xs font-mono cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/option-chain?symbol=${stock.symbol}`)}>
                    <TableCell className="font-medium font-sans">{stock.symbol}</TableCell>
                    <TableCell className="text-right">{stock.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className={`text-right ${stock.changePercent >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {stock.changePercent >= 0 ? "+" : ""}{stock.changePercent.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right">{(stock.volume / 100000).toFixed(1)}L</TableCell>
                    <TableCell className="text-right">{(stock.oi / 100000).toFixed(1)}L</TableCell>
                    <TableCell className={`text-right ${stock.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {stock.oiChange >= 0 ? "+" : ""}{(stock.oiChange / 100000).toFixed(1)}L
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${interpretationColor}`}>
                        {stock.oiInterpretation}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Quick Access */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].map(symbol => (
          <Card
            key={symbol}
            className="cursor-pointer hover:border-primary/50 transition-all hover:shadow-md text-center py-3"
            onClick={() => navigate(`/option-chain?symbol=${symbol}`)}
          >
            <CardContent className="p-0">
              <p className="text-sm font-medium">{symbol}</p>
              <p className="text-[10px] text-muted-foreground">Option Chain →</p>
            </CardContent>
          </Card>
        ))}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-all hover:shadow-md text-center py-3"
          onClick={() => navigate("/oi-analysis")}
        >
          <CardContent className="p-0">
            <p className="text-sm font-medium">OI Analysis</p>
            <p className="text-[10px] text-muted-foreground">Open Interest →</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
