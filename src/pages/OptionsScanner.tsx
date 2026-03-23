import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { getScannerResults, getIVAnalytics, generateIVHistory } from "@/lib/mockData";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { Search, Filter, TrendingUp, TrendingDown, Zap, AlertTriangle, BarChart3 } from "lucide-react";

const tooltipStyle = { backgroundColor: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)", borderRadius: "8px", fontSize: "11px" };

const signalColors: Record<string, string> = {
  "High IV Rank": "text-bearish",
  "Low IV Rank": "text-bullish",
  "OI Surge": "text-warning",
  "Volume Spike": "text-primary",
  "Price Breakout": "text-warning",
  "High PCR": "text-bullish",
  "Low PCR": "text-bearish",
};

export default function OptionsScanner() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string>("ivRank");
  const [filterSignal, setFilterSignal] = useState<string>("all");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const results = useMemo(() => getScannerResults(), []);

  const filtered = useMemo(() => {
    let data = [...results];
    if (search) data = data.filter(r => r.symbol.includes(search.toUpperCase()));
    if (filterSignal !== "all") data = data.filter(r => r.signals.includes(filterSignal));
    
    data.sort((a, b) => {
      const key = sortBy as keyof typeof a;
      const av = typeof a[key] === "number" ? (a[key] as number) : 0;
      const bv = typeof b[key] === "number" ? (b[key] as number) : 0;
      return bv - av;
    });
    return data;
  }, [results, search, sortBy, filterSignal]);

  const selectedIV = useMemo(() => {
    if (!selectedSymbol) return null;
    return {
      analytics: getIVAnalytics(selectedSymbol),
      history: generateIVHistory(selectedSymbol),
    };
  }, [selectedSymbol]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Options Scanner</h1>
        <p className="text-sm text-muted-foreground">Screen F&O stocks by IV, OI, Volume, PCR · Click any row for IV deep-dive</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search symbol..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 w-[160px] text-xs" />
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Sort by..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ivRank">IV Rank ↓</SelectItem>
            <SelectItem value="oiChangePercent">OI Change % ↓</SelectItem>
            <SelectItem value="volumeAvgRatio">Vol/Avg Ratio ↓</SelectItem>
            <SelectItem value="changePercent">Price Change ↓</SelectItem>
            <SelectItem value="pcr">PCR ↓</SelectItem>
            <SelectItem value="expectedMovePercent">Exp. Move % ↓</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSignal} onValueChange={setFilterSignal}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><Filter className="h-3 w-3 mr-1" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Signals</SelectItem>
            <SelectItem value="High IV Rank">High IV Rank</SelectItem>
            <SelectItem value="Low IV Rank">Low IV Rank</SelectItem>
            <SelectItem value="OI Surge">OI Surge</SelectItem>
            <SelectItem value="Volume Spike">Volume Spike</SelectItem>
            <SelectItem value="Price Breakout">Price Breakout</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="h-8 px-3 text-xs">{filtered.length} results</Badge>
      </div>

      <div className={`grid gap-4 ${selectedSymbol ? "lg:grid-cols-3" : ""}`}>
        {/* Scanner Table */}
        <Card className={selectedSymbol ? "lg:col-span-2" : ""}>
          <CardContent className="p-0 overflow-auto max-h-[68vh]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="text-[10px]">
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right">Chg%</TableHead>
                  <TableHead className="text-right">IV</TableHead>
                  <TableHead className="text-right">IV Rank</TableHead>
                  <TableHead className="text-right">IV %ile</TableHead>
                  <TableHead className="text-right">OI Chg%</TableHead>
                  <TableHead className="text-right">Vol/Avg</TableHead>
                  <TableHead className="text-right">PCR</TableHead>
                  <TableHead className="text-right">Exp Move</TableHead>
                  <TableHead>Signals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow
                    key={r.symbol}
                    className={`text-[11px] font-mono cursor-pointer hover:bg-accent/50 ${selectedSymbol === r.symbol ? "bg-accent" : ""}`}
                    onClick={() => setSelectedSymbol(selectedSymbol === r.symbol ? null : r.symbol)}
                  >
                    <TableCell className="font-sans font-medium">{r.symbol}</TableCell>
                    <TableCell className="text-right">{r.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className={`text-right ${r.changePercent >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {r.changePercent >= 0 ? "+" : ""}{r.changePercent.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right">{r.iv.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Progress value={r.ivRank} className={`h-1.5 w-8 ${r.ivRank > 70 ? "[&>div]:bg-bearish" : r.ivRank < 30 ? "[&>div]:bg-bullish" : ""}`} />
                        <span className={r.ivRank > 70 ? "text-bearish" : r.ivRank < 30 ? "text-bullish" : ""}>{r.ivRank}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{r.ivPercentile}</TableCell>
                    <TableCell className={`text-right ${r.oiChangePercent >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {r.oiChangePercent >= 0 ? "+" : ""}{r.oiChangePercent.toFixed(1)}%
                    </TableCell>
                    <TableCell className={`text-right ${r.volumeAvgRatio > 2 ? "text-warning font-bold" : ""}`}>
                      {r.volumeAvgRatio.toFixed(1)}x
                    </TableCell>
                    <TableCell className={`text-right ${r.pcr > 1 ? "text-bullish" : "text-bearish"}`}>{r.pcr.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      ±{r.expectedMovePercent.toFixed(1)}%
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-0.5">
                        {r.signals.map(s => (
                          <Badge key={s} variant="outline" className={`text-[8px] h-3.5 px-1 ${signalColors[s] || ""}`}>{s}</Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* IV Detail Panel */}
        {selectedSymbol && selectedIV && (
          <div className="space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> {selectedSymbol} IV Analytics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded bg-accent/30 text-center">
                    <p className="text-[9px] text-muted-foreground">Current IV</p>
                    <p className="text-lg font-bold font-mono">{selectedIV.analytics.currentIV}%</p>
                  </div>
                  <div className="p-2 rounded bg-accent/30 text-center">
                    <p className="text-[9px] text-muted-foreground">IV Rank</p>
                    <p className={`text-lg font-bold font-mono ${selectedIV.analytics.ivRank > 70 ? "text-bearish" : selectedIV.analytics.ivRank < 30 ? "text-bullish" : ""}`}>
                      {selectedIV.analytics.ivRank}
                    </p>
                  </div>
                  <div className="p-2 rounded bg-accent/30 text-center">
                    <p className="text-[9px] text-muted-foreground">52W High</p>
                    <p className="text-sm font-bold font-mono text-bearish">{selectedIV.analytics.iv52High}%</p>
                  </div>
                  <div className="p-2 rounded bg-accent/30 text-center">
                    <p className="text-[9px] text-muted-foreground">52W Low</p>
                    <p className="text-sm font-bold font-mono text-bullish">{selectedIV.analytics.iv52Low}%</p>
                  </div>
                  <div className="p-2 rounded bg-accent/30 text-center">
                    <p className="text-[9px] text-muted-foreground">HV (1M)</p>
                    <p className="text-sm font-bold font-mono">{selectedIV.analytics.hvMonth}%</p>
                  </div>
                  <div className="p-2 rounded bg-accent/30 text-center">
                    <p className="text-[9px] text-muted-foreground">HV (1W)</p>
                    <p className="text-sm font-bold font-mono">{selectedIV.analytics.hvWeek}%</p>
                  </div>
                </div>

                {/* IV Gauge */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>{selectedIV.analytics.iv52Low}%</span>
                    <span>IV Percentile: {selectedIV.analytics.ivPercentile}</span>
                    <span>{selectedIV.analytics.iv52High}%</span>
                  </div>
                  <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="absolute h-full rounded-full bg-gradient-to-r from-bullish via-warning to-bearish"
                      style={{ width: `${selectedIV.analytics.ivPercentile}%` }}
                    />
                    <div
                      className="absolute top-0 w-0.5 h-full bg-foreground"
                      style={{ left: `${selectedIV.analytics.ivPercentile}%` }}
                    />
                  </div>
                </div>

                {/* Expected Move */}
                <div className="p-2.5 rounded-lg border bg-warning/5 border-warning/20">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="h-3.5 w-3.5 text-warning" />
                    <span className="text-xs font-medium">Expected Move (Weekly)</span>
                  </div>
                  <p className="text-xl font-bold font-mono text-warning">
                    ±{selectedIV.analytics.expectedMove.toFixed(0)} pts
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    ({selectedIV.analytics.expectedMovePercent}% from spot)
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* IV vs HV Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">IV vs HV (90 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={selectedIV.history}>
                      <defs>
                        <linearGradient id="ivGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(210 100% 52%)" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="hsl(210 100% 52%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                      <XAxis dataKey="date" tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(215 15% 55%)" }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Area type="monotone" dataKey="iv" stroke="hsl(210 100% 52%)" fill="url(#ivGrad)" strokeWidth={1.5} name="IV" />
                      <Line type="monotone" dataKey="hv" stroke="hsl(38 92% 50%)" strokeWidth={1} strokeDasharray="3 3" dot={false} name="HV" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
