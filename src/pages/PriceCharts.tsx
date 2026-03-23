import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateCandleData, generateIntradayData, indicesData, fnoStocks, type CandleData } from "@/lib/mockData";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Star, StarOff, Plus, Trash2, TrendingUp, TrendingDown, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface WatchlistItem {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
}

// Custom candlestick shape
const CandlestickShape = (props: any) => {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  const { open, close, high, low } = payload;
  const isUp = close >= open;
  const color = isUp ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)";
  
  // Scale values - we need y-axis range
  const yScale = props.yAxis;
  if (!yScale) return null;
  
  const bodyTop = Math.min(open, close);
  const bodyBottom = Math.max(open, close);
  
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={Math.max(height, 1)}
        fill={color}
        opacity={0.9}
        rx={1}
      />
    </g>
  );
};

export default function PriceCharts() {
  const navigate = useNavigate();
  const [selectedSymbol, setSelectedSymbol] = useState("NIFTY");
  const [timeframe, setTimeframe] = useState("daily");
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([
    { symbol: "NIFTY", ltp: 24250.75, change: 125.30, changePercent: 0.52 },
    { symbol: "BANKNIFTY", ltp: 51850.40, change: -180.60, changePercent: -0.35 },
    { symbol: "RELIANCE", ltp: 2945.50, change: 38.20, changePercent: 1.31 },
    { symbol: "HDFCBANK", ltp: 1685.40, change: 22.60, changePercent: 1.36 },
    { symbol: "TATAMOTORS", ltp: 985.30, change: -18.45, changePercent: -1.84 },
  ]);
  const [addSymbol, setAddSymbol] = useState("");

  const spotMap: Record<string, number> = {
    NIFTY: 24250.75, BANKNIFTY: 51850.40, FINNIFTY: 23180.55, MIDCPNIFTY: 12850.30,
    RELIANCE: 2945.50, TCS: 3850.70, HDFCBANK: 1685.40, INFY: 1520.85,
    ICICIBANK: 1245.60, SBIN: 825.75, TATAMOTORS: 985.30, BAJFINANCE: 7280.25,
    ITC: 468.35, MARUTI: 12450.60, HINDUNILVR: 2650, BHARTIARTL: 1580,
    KOTAKBANK: 1820, LT: 3450, AXISBANK: 1125, ASIANPAINT: 2890,
    SUNPHARMA: 1680, TITAN: 3250, WIPRO: 485, ULTRACEMCO: 10850,
  };

  const candleData = useMemo(() => {
    const basePrice = spotMap[selectedSymbol] || 2500;
    return generateCandleData(basePrice, timeframe === "daily" ? 60 : 78);
  }, [selectedSymbol, timeframe]);

  // For the bar chart, we'll show OHLC as a line chart with volume bars
  const chartData = useMemo(() => {
    return candleData.map(c => ({
      ...c,
      color: c.close >= c.open ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)",
      range: [c.low, c.high],
      body: [Math.min(c.open, c.close), Math.max(c.open, c.close)],
    }));
  }, [candleData]);

  const currentPrice = spotMap[selectedSymbol] || 2500;
  const idx = indicesData.find(i => i.symbol === selectedSymbol);

  const addToWatchlist = (sym: string) => {
    if (watchlist.some(w => w.symbol === sym)) return;
    const price = spotMap[sym] || 1000;
    setWatchlist([...watchlist, {
      symbol: sym,
      ltp: price,
      change: price * 0.01 * (Math.random() - 0.4),
      changePercent: (Math.random() - 0.4) * 3,
    }]);
    setAddSymbol("");
  };

  const removeFromWatchlist = (sym: string) => setWatchlist(watchlist.filter(w => w.symbol !== sym));

  const tooltipStyle = { backgroundColor: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)", borderRadius: "8px", fontSize: "11px" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Charts & Watchlist</h1>
          <p className="text-sm text-muted-foreground">Price action · Volume · Saved watchlist</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-4">
        {/* Chart Panel */}
        <div className="lg:col-span-3 space-y-3">
          {/* Chart Controls */}
          <div className="flex items-center gap-2">
            <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
              <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {indicesData.map(i => <SelectItem key={i.symbol} value={i.symbol}>{i.name}</SelectItem>)}
                {fnoStocks.slice(0, 10).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            
            <div className="flex bg-accent/50 rounded-md p-0.5">
              {[
                { value: "intraday", label: "1D" },
                { value: "daily", label: "Daily" },
              ].map(tf => (
                <Button
                  key={tf.value}
                  variant={timeframe === tf.value ? "default" : "ghost"}
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => setTimeframe(tf.value)}
                >
                  {tf.label}
                </Button>
              ))}
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              <span className="text-xl font-bold font-mono">{currentPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              {idx && (
                <span className={`text-sm font-mono ${idx.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {idx.change >= 0 ? "+" : ""}{idx.change.toFixed(2)} ({idx.changePercent >= 0 ? "+" : ""}{idx.changePercent.toFixed(2)}%)
                </span>
              )}
            </div>

            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => navigate(`/option-chain?symbol=${selectedSymbol}`)}>
              <Eye className="h-3 w-3" /> Chain
            </Button>
          </div>

          {/* Price Chart */}
          <Card>
            <CardContent className="pt-4">
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis yAxisId="vol" orientation="right" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number, name: string) => {
                        if (name === "volume") return [(value / 1000).toFixed(0) + "K", "Volume"];
                        return [value.toFixed(2), name.charAt(0).toUpperCase() + name.slice(1)];
                      }}
                    />
                    <Bar yAxisId="vol" dataKey="volume" fill="hsl(215 15% 55% / 0.15)" radius={[1, 1, 0, 0]} />
                    <Line yAxisId="price" type="monotone" dataKey="close" stroke="hsl(210 100% 52%)" strokeWidth={1.5} dot={false} name="close" />
                    <Line yAxisId="price" type="monotone" dataKey="high" stroke="hsl(142 71% 45% / 0.3)" strokeWidth={0.5} dot={false} name="high" />
                    <Line yAxisId="price" type="monotone" dataKey="low" stroke="hsl(0 84% 60% / 0.3)" strokeWidth={0.5} dot={false} name="low" />
                    <ReferenceLine yAxisId="price" y={currentPrice} stroke="hsl(38 92% 50%)" strokeDasharray="3 3" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* OHLCV Summary */}
          {idx && (
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: "Open", value: idx.open },
                { label: "High", value: idx.high },
                { label: "Low", value: idx.low },
                { label: "Close", value: idx.ltp },
                { label: "Prev Close", value: idx.prevClose },
              ].map(item => (
                <Card key={item.label}>
                  <CardContent className="pt-2.5 pb-2.5 text-center">
                    <p className="text-[9px] text-muted-foreground">{item.label}</p>
                    <p className="text-sm font-bold font-mono">{item.value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Watchlist Panel */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Star className="h-4 w-4 text-warning" /> Watchlist
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {/* Add to watchlist */}
              <div className="flex gap-1 mb-2">
                <Select value={addSymbol} onValueChange={setAddSymbol}>
                  <SelectTrigger className="h-7 text-[10px] flex-1"><SelectValue placeholder="Add symbol..." /></SelectTrigger>
                  <SelectContent>
                    {[...indicesData.map(i => i.symbol), ...fnoStocks]
                      .filter(s => !watchlist.some(w => w.symbol === s))
                      .map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => addSymbol && addToWatchlist(addSymbol)} disabled={!addSymbol}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              {watchlist.map(w => {
                const pos = w.changePercent >= 0;
                return (
                  <div
                    key={w.symbol}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-accent/50 transition-colors ${selectedSymbol === w.symbol ? "bg-accent" : ""}`}
                    onClick={() => setSelectedSymbol(w.symbol)}
                  >
                    <div>
                      <p className="text-xs font-medium">{w.symbol}</p>
                      <p className="text-sm font-bold font-mono">{w.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="text-right flex items-center gap-1">
                      <div>
                        <p className={`text-xs font-mono ${pos ? "text-bullish" : "text-bearish"}`}>
                          {pos ? <TrendingUp className="h-3 w-3 inline" /> : <TrendingDown className="h-3 w-3 inline" />}
                          {" "}{pos ? "+" : ""}{w.changePercent.toFixed(2)}%
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); removeFromWatchlist(w.symbol); }}
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Quick actions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Button variant="outline" size="sm" className="w-full h-7 text-xs justify-start gap-2" onClick={() => navigate(`/option-chain?symbol=${selectedSymbol}`)}>
                <Eye className="h-3 w-3" /> Option Chain
              </Button>
              <Button variant="outline" size="sm" className="w-full h-7 text-xs justify-start gap-2" onClick={() => navigate("/oi-analysis")}>
                <TrendingUp className="h-3 w-3" /> OI Analysis
              </Button>
              <Button variant="outline" size="sm" className="w-full h-7 text-xs justify-start gap-2" onClick={() => navigate("/scanner")}>
                <Star className="h-3 w-3" /> Scanner
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
