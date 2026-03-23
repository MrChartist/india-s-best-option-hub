import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { marketStats, futuresData, mostActiveFnO, sectorData, generateIntradayData, generateVIXHistory, topGainers, topLosers, getMarketBreadth } from "@/lib/mockData";
import { useLiveIndices, useMarketStatus, useExpiryList } from "@/hooks/useNSEData";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TrendingUp, TrendingDown, Activity, BarChart3, Users, Clock, Zap, Globe, Wifi, WifiOff, ArrowUpRight, ArrowDownRight, CalendarClock, Plane } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, AreaChart, Area, BarChart, Bar, CartesianGrid, Cell, ReferenceLine, ComposedChart } from "recharts";

// Nearest expiry contract data (NSE + MCX)
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
  const navigate = useNavigate();
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

  const niftyIntraday = useMemo(() => generateIntradayData(indices[0]?.prevClose || 24125.45, 0.5), [indices]);
  const bankNiftyIntraday = useMemo(() => generateIntradayData(indices[1]?.prevClose || 52031, 0.6), [indices]);
  const vixHistory = useMemo(() => generateVIXHistory(), []);
  const breadth = useMemo(() => getMarketBreadth(), []);

  const futuresPremiumChart = useMemo(() => {
    return futuresData.map(f => ({
      label: `${f.symbol} ${f.expiry}`,
      premium: f.premium,
      premiumPct: f.premiumPercent,
      spot: f.spotPrice,
      futures: f.futuresPrice,
    }));
  }, []);

  // Build expiry timeline
  const nearestExpiries = useMemo(() => {
    const nExpiry = niftyExpiry?.expiries?.[0]?.value || "";
    const bnExpiry = bnfExpiry?.expiries?.[0]?.value || "";
    return EXPIRY_CONTRACTS.map(c => {
      let expDate = "";
      if (c.symbol === "NIFTY") expDate = nExpiry;
      else if (c.symbol === "BANKNIFTY") expDate = bnExpiry;
      else if (c.symbol === "FINNIFTY") expDate = niftyExpiry?.expiries?.[1]?.value || nExpiry;
      else if (c.symbol === "MIDCPNIFTY") expDate = niftyExpiry?.expiries?.[1]?.value || nExpiry;
      // MCX contracts use approximate dates
      else {
        const now = new Date();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        expDate = lastDay.toISOString().split("T")[0];
      }
      return { ...c, expiry: expDate, timeLeft: expDate ? getTimeToExpiry(expDate) : "N/A" };
    });
  }, [niftyExpiry, bnfExpiry]);

  if (indicesLoading) return <DashboardSkeleton />;

  const now = new Date();
  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Market Dashboard</h1>
          <p className="text-sm text-muted-foreground">NSE F&O Market Overview · {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className={`gap-1.5 text-[10px] ${isLive ? "border-bullish text-bullish" : "border-muted-foreground text-muted-foreground"}`}>
            {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isLive ? "LIVE" : "MOCK"}
          </Badge>
          <Badge variant={isOpen ? "default" : "secondary"} className={`gap-1.5 ${isOpen ? "bg-bullish text-bullish-foreground" : ""}`}>
            <Clock className="h-3 w-3" />
            Market {marketStatus}
          </Badge>
          <span className="text-xs text-muted-foreground font-mono">{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} IST</span>
        </div>
      </div>

      {/* Ticker Tape + GIFT Nifty */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {indices.map((idx) => {
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
        {/* GIFT Nifty in ticker */}
        {giftNifty && giftNifty.lastPrice > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/5 border border-primary/20 shrink-0">
            <Plane className="h-3 w-3 text-primary" />
            <span className="text-xs font-medium text-primary">GIFT</span>
            <span className="text-sm font-bold font-mono">{giftNifty.lastPrice.toLocaleString("en-IN")}</span>
            <span className={`text-xs font-mono ${giftNifty.change >= 0 ? "text-bullish" : "text-bearish"}`}>
              {giftNifty.change >= 0 ? "+" : ""}{giftNifty.change.toFixed(0)} ({giftNifty.changePercent.toFixed(2)}%)
            </span>
          </div>
        )}
          </span>
        </div>
      </div>

      {/* Index Cards with Sparklines */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {indices.map((index, idx) => {
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

      {/* ── TOP GAINERS & LOSERS ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-bullish" /> Top Gainers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="text-[10px]">
                  <TableHead>Symbol</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Chg%</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topGainers.map(stock => (
                  <TableRow
                    key={stock.symbol}
                    className="text-xs font-mono cursor-pointer hover:bg-accent/50"
                    onClick={() => navigate(`/option-chain?symbol=${stock.symbol}`)}
                  >
                    <TableCell className="font-medium font-sans">{stock.symbol}</TableCell>
                    <TableCell className="text-muted-foreground font-sans text-[10px]">{stock.sector}</TableCell>
                    <TableCell className="text-right">{stock.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right text-bullish">+{stock.change.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <span className="bg-bullish/10 text-bullish px-1.5 py-0.5 rounded text-[10px]">
                        +{stock.changePercent.toFixed(2)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{(stock.volume / 100000).toFixed(1)}L</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ArrowDownRight className="h-4 w-4 text-bearish" /> Top Losers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="text-[10px]">
                  <TableHead>Symbol</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Chg%</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topLosers.map(stock => (
                  <TableRow
                    key={stock.symbol}
                    className="text-xs font-mono cursor-pointer hover:bg-accent/50"
                    onClick={() => navigate(`/option-chain?symbol=${stock.symbol}`)}
                  >
                    <TableCell className="font-medium font-sans">{stock.symbol}</TableCell>
                    <TableCell className="text-muted-foreground font-sans text-[10px]">{stock.sector}</TableCell>
                    <TableCell className="text-right">{stock.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right text-bearish">{stock.change.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <span className="bg-bearish/10 text-bearish px-1.5 py-0.5 rounded text-[10px]">
                        {stock.changePercent.toFixed(2)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{(stock.volume / 100000).toFixed(1)}L</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ── FUTURES PREMIUM/DISCOUNT (Enhanced) ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" /> Futures Premium / Discount vs Spot</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Visual bar chart */}
              <div className="h-[180px] mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={futuresPremiumChart} layout="vertical" barSize={20}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "hsl(215 15% 55%)" }} width={110} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number, name: string) => {
                        if (name === "Premium") return [`₹${value.toFixed(2)}`, "Premium"];
                        return [value.toFixed(2) + "%", "Premium %"];
                      }}
                    />
                    <ReferenceLine x={0} stroke="hsl(215 15% 40%)" />
                    <Bar dataKey="premium" name="Premium" radius={[0, 4, 4, 0]}>
                      {futuresPremiumChart.map((entry, i) => (
                        <Cell key={i} fill={entry.premium >= 0 ? "hsl(142 71% 45% / 0.7)" : "hsl(0 84% 60% / 0.7)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Detail table */}
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px]">
                    <TableHead>Symbol</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Spot</TableHead>
                    <TableHead className="text-right">Futures</TableHead>
                    <TableHead className="text-right">Premium</TableHead>
                    <TableHead className="text-right">Basis %</TableHead>
                    <TableHead className="text-right">OI Chg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {futuresData.map((f, i) => (
                    <TableRow key={i} className="text-xs font-mono">
                      <TableCell className="font-medium font-sans">{f.symbol}</TableCell>
                      <TableCell className="text-muted-foreground">{f.expiry}</TableCell>
                      <TableCell className="text-right">{f.spotPrice.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right">{f.futuresPrice.toLocaleString("en-IN")}</TableCell>
                      <TableCell className={`text-right font-medium ${f.premium >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {f.premium >= 0 ? "+" : ""}₹{f.premium.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${f.premium >= 0 ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                          {f.premium >= 0 ? "+" : ""}{f.premiumPercent.toFixed(2)}%
                        </span>
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
        </div>

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
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="vix" stroke="hsl(38 92% 50%)" fill="url(#vixGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {/* Futures Basis Summary */}
            <div className="mt-3 space-y-2">
              <p className="text-[10px] text-muted-foreground font-medium">Basis Summary</p>
              {futuresData.slice(0, 3).map((f, i) => (
                <div key={i} className="flex items-center justify-between p-1.5 rounded bg-accent/30">
                  <span className="text-[10px] font-medium">{f.symbol}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono font-bold ${f.premium >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {f.premium >= 0 ? "Premium" : "Discount"}
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${f.premium >= 0 ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                      {f.premium >= 0 ? "+" : ""}{f.premiumPercent.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
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

      {/* ── Market Breadth Indicators ── */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* A/D Line vs Nifty */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Advance/Decline Line vs Nifty (30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={breadth.advDecLine}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                  <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                  <YAxis yAxisId="ad" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                  <YAxis yAxisId="nifty" orientation="right" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line yAxisId="ad" type="monotone" dataKey="adLine" stroke="hsl(210 100% 52%)" strokeWidth={1.5} dot={false} name="A/D Line" />
                  <Line yAxisId="nifty" type="monotone" dataKey="nifty" stroke="hsl(38 92% 50%)" strokeWidth={1.5} dot={false} name="Nifty" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* New Highs vs Lows */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">New 52W Highs vs Lows (20 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={breadth.highsLows} barGap={0}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                  <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                  <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="newHighs" fill="hsl(142 71% 45% / 0.7)" name="New Highs" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="newLows" fill="hsl(0 84% 60% / 0.7)" name="New Lows" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* % Stocks Above EMA + Sector Rotation */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">% Stocks Above Key EMAs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="text-[10px]">
                  <TableHead>Index</TableHead>
                  <TableHead className="text-right">Above 20 EMA</TableHead>
                  <TableHead className="text-right">Above 50 EMA</TableHead>
                  <TableHead className="text-right">Above 200 EMA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breadth.emaCoverage.map(e => (
                  <TableRow key={e.label} className="text-xs font-mono">
                    <TableCell className="font-medium font-sans">{e.label}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Progress value={e.above20} className="h-1.5 w-16" />
                        <span className={e.above20 > 50 ? "text-bullish" : "text-bearish"}>{e.above20}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Progress value={e.above50} className="h-1.5 w-16" />
                        <span className={e.above50 > 50 ? "text-bullish" : "text-bearish"}>{e.above50}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Progress value={e.above200} className="h-1.5 w-16" />
                        <span className={e.above200 > 50 ? "text-bullish" : "text-bearish"}>{e.above200}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sector Rotation Map</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {breadth.sectorRotation.map(s => {
                const qColor = {
                  Leading: "bg-bullish/15 border-bullish/30 text-bullish",
                  Improving: "bg-primary/10 border-primary/30 text-primary",
                  Weakening: "bg-warning/10 border-warning/30 text-warning",
                  Lagging: "bg-bearish/15 border-bearish/30 text-bearish",
                }[s.quadrant] || "";
                return (
                  <div key={s.sector} className={`p-2 rounded-md border ${qColor}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{s.sector}</span>
                      <Badge variant="outline" className="text-[8px] h-4">{s.quadrant}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[9px] text-muted-foreground">Mom: <span className="font-mono">{s.momentum > 0 ? "+" : ""}{s.momentum}</span></span>
                      <span className="text-[9px] text-muted-foreground">Trend: <span className="font-mono">{s.trend > 0 ? "+" : ""}{s.trend}</span></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

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
            <p className="text-[10px] text-muted-foreground">Deep Dive →</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
