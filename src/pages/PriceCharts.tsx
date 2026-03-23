import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateCandleData, generateCandleOIData, generateOptionOITimeSeries, generateIntradayCandles, indicesData, fnoStocks, getOptionChain, getIVRankData } from "@/lib/mockData";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart, LineChart } from "recharts";
import { Star, Plus, Trash2, TrendingUp, TrendingDown, Eye, BarChart3, LayoutGrid, Columns2, Maximize2, Minus } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface WatchlistItem {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
}

interface ChartPanel {
  id: number;
  symbol: string;
  timeframe: string;
}

interface DrawingLine {
  id: string;
  y: number;
  color: string;
  label: string;
}

export default function PriceCharts() {
  const navigate = useNavigate();
  const [selectedSymbol, setSelectedSymbol] = useState("NIFTY");
  const [timeframe, setTimeframe] = useState("daily");
  const [chartMode, setChartMode] = useState<"price" | "candle-oi" | "option-oi">("price");
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [addSymbol, setAddSymbol] = useState("");
  const [layout, setLayout] = useState<1 | 2 | 4>(1);
  const [panels, setPanels] = useState<ChartPanel[]>([
    { id: 1, symbol: "NIFTY", timeframe: "15m" },
    { id: 2, symbol: "BANKNIFTY", timeframe: "15m" },
    { id: 3, symbol: "NIFTY", timeframe: "1H" },
    { id: 4, symbol: "BANKNIFTY", timeframe: "1H" },
  ]);
  const [drawingLines, setDrawingLines] = useState<DrawingLine[]>([]);
  const [drawingMode, setDrawingMode] = useState(false);

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

  const availableStrikes = useMemo(() => {
    const { data, spotPrice, stepSize } = getOptionChain(selectedSymbol);
    const atm = Math.round(spotPrice / stepSize) * stepSize;
    if (!selectedStrike) setSelectedStrike(atm);
    return data.filter(o => Math.abs(o.strikePrice - spotPrice) < stepSize * 6).map(o => o.strikePrice);
  }, [selectedSymbol]);

  // IV Rank data
  const ivRankData = useMemo(() => getIVRankData(selectedSymbol), [selectedSymbol]);

  // Chart data based on timeframe
  const chartData = useMemo(() => {
    if (["1m", "5m", "15m", "1H"].includes(timeframe)) {
      return generateIntradayCandles(currentPrice, timeframe);
    }
    return generateCandleData(currentPrice, 60).map(c => ({ ...c, oi: 0, oiChange: 0 }));
  }, [currentPrice, timeframe]);

  const candleOIData = useMemo(() => {
    const baseOI = currentPrice > 10000 ? 15000000 : 5000000;
    return generateCandleOIData(currentPrice, baseOI, 60);
  }, [currentPrice]);

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
    setWatchlist([...watchlist, { symbol: sym, ltp: price, change: price * 0.01 * (Math.random() - 0.4), changePercent: (Math.random() - 0.4) * 3 }]);
    setAddSymbol("");
  };

  const removeFromWatchlist = (sym: string) => setWatchlist(watchlist.filter(w => w.symbol !== sym));

  const addHorizontalLine = () => {
    setDrawingLines([...drawingLines, {
      id: Date.now().toString(),
      y: currentPrice,
      color: "hsl(38 92% 50%)",
      label: `Level ${currentPrice.toFixed(0)}`,
    }]);
  };

  const removeDrawingLine = (id: string) => setDrawingLines(drawingLines.filter(l => l.id !== id));

  const tooltipStyle = { backgroundColor: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)", borderRadius: "8px", fontSize: "11px" };

  const timeframes = [
    { value: "1m", label: "1m" },
    { value: "5m", label: "5m" },
    { value: "15m", label: "15m" },
    { value: "1H", label: "1H" },
    { value: "daily", label: "D" },
  ];

  // Render a single chart panel (for multi-chart)
  const renderMiniChart = (panel: ChartPanel, height: number) => {
    const price = spotMap[panel.symbol] || 2500;
    const data = ["1m", "5m", "15m", "1H"].includes(panel.timeframe)
      ? generateIntradayCandles(price, panel.timeframe)
      : generateCandleData(price, 60).map(c => ({ ...c, oi: 0, oiChange: 0 }));
    const last = data[data.length - 1];
    const first = data[0];
    const isUp = last && first && last.close >= first.open;

    return (
      <Card key={panel.id} className="overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
          <div className="flex items-center gap-2">
            <Select value={panel.symbol} onValueChange={v => setPanels(panels.map(p => p.id === panel.id ? { ...p, symbol: v } : p))}>
              <SelectTrigger className="h-6 w-[100px] text-[10px] border-none p-0 font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>
                {indicesData.map(i => <SelectItem key={i.symbol} value={i.symbol}>{i.symbol}</SelectItem>)}
                {fnoStocks.slice(0, 6).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex bg-accent/50 rounded p-0.5">
              {timeframes.map(tf => (
                <button
                  key={tf.value}
                  className={`px-1.5 py-0.5 text-[8px] rounded ${panel.timeframe === tf.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setPanels(panels.map(p => p.id === panel.id ? { ...p, timeframe: tf.value } : p))}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>
          <span className={`text-[10px] font-mono font-bold ${isUp ? "text-bullish" : "text-bearish"}`}>
            {price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
              <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
              <YAxis domain={["auto", "auto"]} tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="close" stroke={isUp ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)"} strokeWidth={1.5} dot={false} />
              <ReferenceLine y={price} stroke="hsl(38 92% 50%)" strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Charts & Watchlist</h1>
          <p className="text-sm text-muted-foreground">Multi-chart · Drawing tools · Candle OI · IV Rank</p>
        </div>
        {/* Layout Switcher */}
        <div className="flex items-center gap-1 bg-accent/50 rounded-md p-0.5">
          {([1, 2, 4] as const).map(l => (
            <Button
              key={l}
              variant={layout === l ? "default" : "ghost"}
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setLayout(l)}
            >
              {l === 1 ? <Maximize2 className="h-3.5 w-3.5" /> : l === 2 ? <Columns2 className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
            </Button>
          ))}
        </div>
      </div>

      {/* Multi-Chart Layout */}
      {layout > 1 && (
        <div className={`grid gap-2 ${layout === 2 ? "grid-cols-2" : "grid-cols-2"}`}>
          {panels.slice(0, layout).map(p => renderMiniChart(p, layout === 4 ? 200 : 280))}
        </div>
      )}

      {/* Single Chart Mode */}
      {layout === 1 && (
        <div className="grid lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3 space-y-3">
            {/* Chart Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
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
                  <Button key={m.value} variant={chartMode === m.value ? "default" : "ghost"} size="sm" className="h-6 text-[10px] px-2" onClick={() => setChartMode(m.value as any)}>
                    {m.label}
                  </Button>
                ))}
              </div>

              {chartMode === "price" && (
                <div className="flex bg-accent/50 rounded-md p-0.5">
                  {timeframes.map(tf => (
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

              {/* Drawing tools */}
              {chartMode === "price" && (
                <div className="flex items-center gap-1">
                  <Button variant={drawingMode ? "default" : "outline"} size="sm" className="h-6 text-[10px] px-2" onClick={addHorizontalLine}>
                    <Minus className="h-3 w-3 mr-1" /> H-Line
                  </Button>
                  {drawingLines.length > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-bearish" onClick={() => setDrawingLines([])}>
                      Clear
                    </Button>
                  )}
                </div>
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

            {/* Standard Price Chart */}
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
                        <ReferenceLine yAxisId="price" y={currentPrice} stroke="hsl(38 92% 50%)" strokeDasharray="3 3" label={{ value: "Spot", fill: "hsl(38 92% 50%)", fontSize: 9 }} />
                        {/* Expected Move range */}
                        <ReferenceLine yAxisId="price" y={ivRankData.expectedMoveUp} stroke="hsl(210 100% 52% / 0.4)" strokeDasharray="5 5" label={{ value: `+1σ ${ivRankData.expectedMoveUp.toFixed(0)}`, fill: "hsl(210 100% 52%)", fontSize: 8 }} />
                        <ReferenceLine yAxisId="price" y={ivRankData.expectedMoveDown} stroke="hsl(210 100% 52% / 0.4)" strokeDasharray="5 5" label={{ value: `-1σ ${ivRankData.expectedMoveDown.toFixed(0)}`, fill: "hsl(210 100% 52%)", fontSize: 8 }} />
                        {/* Drawing lines */}
                        {drawingLines.map(line => (
                          <ReferenceLine key={line.id} yAxisId="price" y={line.y} stroke={line.color} strokeWidth={1.5} label={{ value: line.label, fill: line.color, fontSize: 9 }} />
                        ))}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Drawing lines list */}
                  {drawingLines.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {drawingLines.map(l => (
                        <Badge key={l.id} variant="outline" className="text-[9px] gap-1 cursor-pointer hover:bg-bearish/10" onClick={() => removeDrawingLine(l.id)}>
                          {l.label} ✕
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Candle-wise OI + Volume */}
            {chartMode === "candle-oi" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" /> Price with Open Interest & Volume
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[250px] mb-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={candleOIData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                        <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                        <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                        <YAxis yAxisId="oi" orientation="right" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line yAxisId="price" type="monotone" dataKey="close" stroke="hsl(210 100% 52%)" strokeWidth={2} dot={false} />
                        <Area yAxisId="oi" type="monotone" dataKey="oi" stroke="hsl(210 100% 52% / 0.5)" fill="hsl(210 100% 52% / 0.08)" strokeWidth={1} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="h-[120px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={candleOIData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                        <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                        <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="volume" fill="hsl(215 15% 55% / 0.12)" radius={[1, 1, 0, 0]} />
                        <ReferenceLine y={0} stroke="hsl(215 15% 40%)" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Option Price vs OI */}
            {chartMode === "option-oi" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{selectedSymbol} {selectedStrike} CE — Option Price vs OI (Intraday)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={optionOIData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                        <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                        <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                        <YAxis yAxisId="oi" orientation="right" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Area yAxisId="oi" type="monotone" dataKey="oi" stroke="hsl(210 100% 52% / 0.5)" fill="hsl(210 100% 52% / 0.08)" strokeWidth={1} name="OI" />
                        <Line yAxisId="price" type="monotone" dataKey="optionPrice" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} name="Option Price" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  {optionOIData.length > 2 && (() => {
                    const first = optionOIData[0];
                    const last = optionOIData[optionOIData.length - 1];
                    const priceUp = last.optionPrice > first.optionPrice;
                    const oiUp = last.oi > first.oi;
                    let signal = "", signalColor = "";
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

            {/* IV Rank & Expected Move Panel */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
              <Card className="border-primary/20">
                <CardContent className="pt-2.5 pb-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground">IV Rank</p>
                  <p className={`text-lg font-bold font-mono ${ivRankData.ivRank > 50 ? "text-bearish" : "text-bullish"}`}>{ivRankData.ivRank}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-2.5 pb-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground">IV Percentile</p>
                  <p className="text-lg font-bold font-mono">{ivRankData.ivPercentile}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-2.5 pb-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground">ATM IV</p>
                  <p className="text-lg font-bold font-mono">{ivRankData.currentIV}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-2.5 pb-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground">52W Range</p>
                  <p className="text-[10px] font-mono">{ivRankData.ivLow52w}% – {ivRankData.ivHigh52w}%</p>
                </CardContent>
              </Card>
              <Card className="border-primary/20">
                <CardContent className="pt-2.5 pb-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground">Expected Move</p>
                  <p className="text-lg font-bold font-mono text-primary">±{ivRankData.expectedMove.toFixed(0)}</p>
                  <p className="text-[9px] text-muted-foreground">±{ivRankData.expectedMovePercent}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-2.5 pb-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground">Upper Band</p>
                  <p className="text-sm font-bold font-mono text-bullish">{ivRankData.expectedMoveUp.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-2.5 pb-2.5 text-center">
                  <p className="text-[9px] text-muted-foreground">Lower Band</p>
                  <p className="text-sm font-bold font-mono text-bearish">{ivRankData.expectedMoveDown.toLocaleString("en-IN")}</p>
                </CardContent>
              </Card>
            </div>

            {/* IV vs HV Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Implied Volatility vs Historical Volatility (60 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[150px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ivRankData.ivHistory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                      <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="iv" stroke="hsl(38 92% 50%)" strokeWidth={1.5} dot={false} name="IV" />
                      <Line type="monotone" dataKey="hvol" stroke="hsl(210 100% 52%)" strokeWidth={1.5} dot={false} name="HV" />
                    </LineChart>
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
                        <p className={`text-xs font-mono ${pos ? "text-bullish" : "text-bearish"}`}>
                          {pos ? <TrendingUp className="h-3 w-3 inline" /> : <TrendingDown className="h-3 w-3 inline" />}
                          {" "}{pos ? "+" : ""}{w.changePercent.toFixed(2)}%
                        </p>
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
      )}
    </div>
  );
}
