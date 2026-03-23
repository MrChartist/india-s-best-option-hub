import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateCandleData, generateCandleOIData, generateOptionOITimeSeries, indicesData, fnoStocks, getOptionChain } from "@/lib/mockData";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from "recharts";
import { Star, Plus, Trash2, TrendingUp, TrendingDown, Eye, BarChart3 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface WatchlistItem {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
}

export default function PriceCharts() {
  const navigate = useNavigate();
  const [selectedSymbol, setSelectedSymbol] = useState("NIFTY");
  const [timeframe, setTimeframe] = useState("daily");
  const [chartMode, setChartMode] = useState<"price" | "candle-oi" | "option-oi">("price");
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [addSymbol, setAddSymbol] = useState("");
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([
    { symbol: "NIFTY", ltp: 24250.75, change: 125.30, changePercent: 0.52 },
    { symbol: "BANKNIFTY", ltp: 51850.40, change: -180.60, changePercent: -0.35 },
    { symbol: "RELIANCE", ltp: 2945.50, change: 38.20, changePercent: 1.31 },
    { symbol: "HDFCBANK", ltp: 1685.40, change: 22.60, changePercent: 1.36 },
    { symbol: "TATAMOTORS", ltp: 985.30, change: -18.45, changePercent: -1.84 },
  ]);

  const spotMap: Record<string, number> = {
    NIFTY: 24250.75, BANKNIFTY: 51850.40, FINNIFTY: 23180.55, MIDCPNIFTY: 12850.30,
    RELIANCE: 2945.50, TCS: 3850.70, HDFCBANK: 1685.40, INFY: 1520.85,
    ICICIBANK: 1245.60, SBIN: 825.75, TATAMOTORS: 985.30, BAJFINANCE: 7280.25,
    ITC: 468.35, MARUTI: 12450.60, HINDUNILVR: 2650, BHARTIARTL: 1580,
    KOTAKBANK: 1820, LT: 3450, AXISBANK: 1125, ASIANPAINT: 2890,
    SUNPHARMA: 1680, TITAN: 3250, WIPRO: 485, ULTRACEMCO: 10850,
  };

  const currentPrice = spotMap[selectedSymbol] || 2500;
  const idx = indicesData.find(i => i.symbol === selectedSymbol);

  // Get available strikes for this symbol
  const availableStrikes = useMemo(() => {
    const { data, spotPrice, stepSize } = getOptionChain(selectedSymbol);
    const atm = Math.round(spotPrice / stepSize) * stepSize;
    if (!selectedStrike) setSelectedStrike(atm);
    return data.filter(o => Math.abs(o.strikePrice - spotPrice) < stepSize * 6).map(o => o.strikePrice);
  }, [selectedSymbol]);

  // Standard price chart data
  const chartData = useMemo(() => {
    const candles = generateCandleData(currentPrice, timeframe === "daily" ? 60 : 78);
    return candles.map(c => ({
      ...c,
      color: c.close >= c.open ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)",
    }));
  }, [currentPrice, timeframe]);

  // ── NEW: Candle-wise OI + Volume data ──
  const candleOIData = useMemo(() => {
    const baseOI = currentPrice > 10000 ? 15000000 : 5000000;
    return generateCandleOIData(currentPrice, baseOI, 60);
  }, [currentPrice]);

  // ── NEW: Option Price vs OI time series ──
  const optionOIData = useMemo(() => {
    if (!selectedStrike) return [];
    const { data } = getOptionChain(selectedSymbol);
    const strikeData = data.find(o => o.strikePrice === selectedStrike);
    if (!strikeData) return [];
    return generateOptionOITimeSeries(strikeData.ce.ltp, strikeData.ce.oi);
  }, [selectedSymbol, selectedStrike]);

  const addToWatchlist = (sym: string) => {
    if (watchlist.some(w => w.symbol === sym)) return;
    const price = spotMap[sym] || 1000;
    setWatchlist([...watchlist, {
      symbol: sym, ltp: price,
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
          <p className="text-sm text-muted-foreground">Price action · Candle OI · Option Price vs OI · Volume</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-4">
        {/* Chart Panel */}
        <div className="lg:col-span-3 space-y-3">
          {/* Chart Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
              <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {indicesData.map(i => <SelectItem key={i.symbol} value={i.symbol}>{i.name}</SelectItem>)}
                {fnoStocks.slice(0, 10).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="flex bg-accent/50 rounded-md p-0.5">
              {[
                { value: "price", label: "Price" },
                { value: "candle-oi", label: "Candle OI" },
                { value: "option-oi", label: "Price vs OI" },
              ].map(m => (
                <Button
                  key={m.value}
                  variant={chartMode === m.value ? "default" : "ghost"}
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => setChartMode(m.value as any)}
                >
                  {m.label}
                </Button>
              ))}
            </div>

            {chartMode === "price" && (
              <div className="flex bg-accent/50 rounded-md p-0.5">
                {[{ value: "intraday", label: "1D" }, { value: "daily", label: "Daily" }].map(tf => (
                  <Button key={tf.value} variant={timeframe === tf.value ? "default" : "ghost"} size="sm" className="h-6 text-[10px] px-2" onClick={() => setTimeframe(tf.value)}>
                    {tf.label}
                  </Button>
                ))}
              </div>
            )}

            {chartMode === "option-oi" && (
              <Select value={String(selectedStrike || "")} onValueChange={v => setSelectedStrike(Number(v))}>
                <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue placeholder="Strike" /></SelectTrigger>
                <SelectContent>
                  {availableStrikes.map(s => <SelectItem key={s} value={String(s)}>{s} CE</SelectItem>)}
                </SelectContent>
              </Select>
            )}

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

          {/* ── Standard Price Chart ── */}
          {chartMode === "price" && (
            <Card>
              <CardContent className="pt-4">
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <YAxis yAxisId="vol" orientation="right" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => {
                        if (name === "volume") return [(value / 1000).toFixed(0) + "K", "Volume"];
                        return [value.toFixed(2), name.charAt(0).toUpperCase() + name.slice(1)];
                      }} />
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
          )}

          {/* ── NEW: Candle-wise OI + Volume Chart ── */}
          {chartMode === "candle-oi" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Price with Open Interest & Volume
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">Top: Price candles · Middle: OI (blue) & OI Change (green/red) · Bottom: Volume bars</p>
              </CardHeader>
              <CardContent>
                {/* Price + OI chart */}
                <div className="h-[250px] mb-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={candleOIData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <YAxis yAxisId="oi" orientation="right" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => {
                        if (name === "oi") return [(value / 100000).toFixed(1) + "L", "OI"];
                        if (name === "oiChange") return [(value / 1000).toFixed(1) + "K", "OI Chg"];
                        return [value.toFixed(2), name];
                      }} />
                      <Line yAxisId="price" type="monotone" dataKey="close" stroke="hsl(210 100% 52%)" strokeWidth={2} dot={false} name="close" />
                      <Line yAxisId="price" type="monotone" dataKey="high" stroke="hsl(142 71% 45% / 0.2)" strokeWidth={0.5} dot={false} name="high" />
                      <Line yAxisId="price" type="monotone" dataKey="low" stroke="hsl(0 84% 60% / 0.2)" strokeWidth={0.5} dot={false} name="low" />
                      <Area yAxisId="oi" type="monotone" dataKey="oi" stroke="hsl(210 100% 52% / 0.5)" fill="hsl(210 100% 52% / 0.08)" strokeWidth={1} name="oi" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {/* OI Change + Volume */}
                <div className="h-[120px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={candleOIData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                      <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                      <YAxis yAxisId="chg" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                      <YAxis yAxisId="vol" orientation="right" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar yAxisId="vol" dataKey="volume" fill="hsl(215 15% 55% / 0.12)" radius={[1, 1, 0, 0]} name="Volume" />
                      <Bar yAxisId="chg" dataKey="oiChange" name="OI Change" radius={[2, 2, 0, 0]}>
                        {candleOIData.map((entry, i) => (
                          <Bar key={i} dataKey="oiChange" fill={entry.oiChange >= 0 ? "hsl(142 71% 45% / 0.6)" : "hsl(0 84% 60% / 0.6)"} />
                        ))}
                      </Bar>
                      <ReferenceLine yAxisId="chg" y={0} stroke="hsl(215 15% 40%)" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── NEW: Option Price vs OI Time Series ── */}
          {chartMode === "option-oi" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {selectedSymbol} {selectedStrike} CE — Option Price vs OI (Intraday)
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">Tracks how option premium and open interest move together. Divergence = key signal.</p>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={optionOIData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                      <YAxis yAxisId="oi" orientation="right" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => {
                        if (name === "OI") return [(value / 100000).toFixed(2) + "L", "OI"];
                        if (name === "Option Price") return ["₹" + value.toFixed(2), "Premium"];
                        if (name === "Volume") return [(value / 1000).toFixed(0) + "K", "Cum Vol"];
                        return [value, name];
                      }} />
                      <Area yAxisId="oi" type="monotone" dataKey="oi" stroke="hsl(210 100% 52% / 0.5)" fill="hsl(210 100% 52% / 0.08)" strokeWidth={1} name="OI" />
                      <Line yAxisId="price" type="monotone" dataKey="optionPrice" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} name="Option Price" />
                      <Bar yAxisId="oi" dataKey="volume" fill="hsl(215 15% 55% / 0.1)" name="Volume" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {/* Signal interpretation */}
                {optionOIData.length > 2 && (() => {
                  const first = optionOIData[0];
                  const last = optionOIData[optionOIData.length - 1];
                  const priceUp = last.optionPrice > first.optionPrice;
                  const oiUp = last.oi > first.oi;
                  let signal = "";
                  let signalColor = "";
                  if (priceUp && oiUp) { signal = "Long Buildup"; signalColor = "text-bullish"; }
                  else if (!priceUp && oiUp) { signal = "Short Buildup"; signalColor = "text-bearish"; }
                  else if (!priceUp && !oiUp) { signal = "Long Unwinding"; signalColor = "text-bearish"; }
                  else { signal = "Short Covering"; signalColor = "text-bullish"; }
                  return (
                    <div className="flex items-center gap-4 mt-3 p-2 rounded bg-accent/30">
                      <Badge variant="outline" className={`${signalColor} text-xs`}>{signal}</Badge>
                      <span className="text-[10px] text-muted-foreground">
                        Price: {priceUp ? "↑" : "↓"} {Math.abs(((last.optionPrice - first.optionPrice) / first.optionPrice) * 100).toFixed(1)}% · OI: {oiUp ? "↑" : "↓"} {Math.abs(((last.oi - first.oi) / first.oi) * 100).toFixed(1)}%
                      </span>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}

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
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); removeFromWatchlist(w.symbol); }}>
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Quick Actions</CardTitle></CardHeader>
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
