import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, ReferenceLine, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, BarChart3, Activity, Target, ArrowUpDown } from "lucide-react";
import {
  generateSkewSmile,
  generateTermStructure,
  generateSkewPercentiles,
  generateSkewHistory,
} from "@/lib/skewData";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN"];

export default function SkewDashboard() {
  const [symbol, setSymbol] = useState("NIFTY");

  const smileData = useMemo(() => generateSkewSmile(symbol), [symbol]);
  const termData = useMemo(() => generateTermStructure(symbol), [symbol]);
  const percentiles = useMemo(() => generateSkewPercentiles(), []);
  const history = useMemo(() => generateSkewHistory(symbol), [symbol]);

  const currentPerc = percentiles.find((p) => p.symbol === symbol);

  // Contango/backwardation detection
  const termDirection = useMemo(() => {
    if (termData.length < 2) return "flat";
    const near = termData[0].atmIV;
    const far = termData[termData.length - 1].atmIV;
    if (near > far * 1.03) return "backwardation";
    if (far > near * 1.03) return "contango";
    return "flat";
  }, [termData]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Skew Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Volatility skew analysis, term structure & percentile rankings
          </p>
        </div>
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger className="w-[160px] h-8 text-xs bg-card border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYMBOLS.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Quick Stats */}
      {currentPerc && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatCard label="25Δ Skew" value={`${currentPerc.currentSkew.toFixed(2)}%`} />
          <StatCard label="30D Avg" value={`${currentPerc.skew30dAvg.toFixed(2)}%`} />
          <StatCard label="Percentile" value={`${currentPerc.percentile}th`} color={
            currentPerc.percentile > 70 ? "text-destructive" : currentPerc.percentile < 30 ? "hsl(var(--bullish))" : undefined
          } />
          <StatCard label="Z-Score" value={currentPerc.zScore.toFixed(2)} />
          <StatCard label="Term Struct." value={termDirection === "backwardation" ? "Backwardation" : termDirection === "contango" ? "Contango" : "Flat"} color={
            termDirection === "backwardation" ? "text-destructive" : termDirection === "contango" ? "hsl(var(--bullish))" : undefined
          } />
        </div>
      )}

      <Tabs defaultValue="smile" className="space-y-3">
        <TabsList className="bg-muted/50 h-8 p-0.5">
          <TabsTrigger value="smile" className="text-xs h-7 gap-1.5 px-3"><Activity className="h-3 w-3" />IV Smile & Skew</TabsTrigger>
          <TabsTrigger value="term" className="text-xs h-7 gap-1.5 px-3"><BarChart3 className="h-3 w-3" />Term Structure</TabsTrigger>
          <TabsTrigger value="history" className="text-xs h-7 gap-1.5 px-3"><Target className="h-3 w-3" />Skew History</TabsTrigger>
          <TabsTrigger value="rankings" className="text-xs h-7 gap-1.5 px-3"><ArrowUpDown className="h-3 w-3" />Percentile Rankings</TabsTrigger>
        </TabsList>

        {/* ── IV Smile & Skew ── */}
        <TabsContent value="smile">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card className="lg:col-span-2 bg-card border-border">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm font-semibold text-foreground">Volatility Smile — {symbol}</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-3">
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={smileData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="strike" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v.toLocaleString()} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} domain={["auto", "auto"]} label={{ value: "IV %", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                      <Line type="monotone" dataKey="putIV" name="Put IV" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="callIV" name="Call IV" stroke="hsl(var(--bullish))" strokeWidth={2} dot={false} />
                      <ReferenceLine x={smileData[Math.floor(smileData.length / 2)]?.strike} stroke="hsl(var(--primary))" strokeDasharray="5 5" label={{ value: "ATM", fill: "hsl(var(--primary))", fontSize: 10 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm font-semibold text-foreground">Put-Call Skew by Strike</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-3">
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={smileData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v.toLocaleString()} interval={2} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="skew" name="Skew (Put-Call)" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Term Structure ── */}
        <TabsContent value="term">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card className="lg:col-span-2 bg-card border-border">
              <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-foreground">IV Term Structure — {symbol}</CardTitle>
                  <Badge variant="outline" className={`text-2xs ${termDirection === "backwardation" ? "border-destructive/40 text-destructive" : termDirection === "contango" ? "border-green-500/40 text-green-500" : "border-muted-foreground/40"}`}>
                    {termDirection === "backwardation" ? "⚠ Backwardation" : termDirection === "contango" ? "Contango" : "Flat"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-2 pb-3">
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={termData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="expiry" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="p25IV" name="25Δ Put IV" fill="hsl(var(--destructive))" fillOpacity={0.1} stroke="hsl(var(--destructive))" strokeWidth={1.5} dot={false} />
                      <Line type="monotone" dataKey="atmIV" name="ATM IV" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                      <Area type="monotone" dataKey="c25IV" name="25Δ Call IV" fill="hsl(var(--bullish))" fillOpacity={0.1} stroke="hsl(var(--bullish))" strokeWidth={1.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm font-semibold text-foreground">25Δ Skew & Butterfly by Expiry</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-3">
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={termData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="expiry" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="skew25d" name="25Δ Skew" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="butterfly" name="Butterfly" fill="hsl(var(--accent-foreground))" opacity={0.5} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Skew History ── */}
        <TabsContent value="history">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-semibold text-foreground">90-Day Skew History — {symbol}</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              <div className="h-[380px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={history} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={6} />
                    <YAxis yAxisId="skew" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} label={{ value: "Skew %", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }} />
                    <YAxis yAxisId="iv" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} label={{ value: "ATM IV %", angle: 90, position: "insideRight", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area yAxisId="iv" type="monotone" dataKey="atmIV" name="ATM IV" fill="hsl(var(--primary))" fillOpacity={0.08} stroke="hsl(var(--primary))" strokeWidth={1} dot={false} />
                    <Line yAxisId="skew" type="monotone" dataKey="skew25d" name="25Δ Skew" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                    <Line yAxisId="skew" type="monotone" dataKey="skew10d" name="10Δ Skew" stroke="hsl(var(--bullish))" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Percentile Rankings ── */}
        <TabsContent value="rankings">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm font-semibold text-foreground">Skew Percentile Rankings — All Symbols</CardTitle>
            </CardHeader>
            <CardContent className="px-1 pb-3">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-2xs text-muted-foreground h-8">Symbol</TableHead>
                    <TableHead className="text-2xs text-muted-foreground h-8 text-right">Current Skew</TableHead>
                    <TableHead className="text-2xs text-muted-foreground h-8 text-right">30D Avg</TableHead>
                    <TableHead className="text-2xs text-muted-foreground h-8 text-right">90D Avg</TableHead>
                    <TableHead className="text-2xs text-muted-foreground h-8 text-center">Percentile</TableHead>
                    <TableHead className="text-2xs text-muted-foreground h-8 text-right">Z-Score</TableHead>
                    <TableHead className="text-2xs text-muted-foreground h-8 text-center">Signal</TableHead>
                    <TableHead className="text-2xs text-muted-foreground h-8 text-center">Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {percentiles
                    .sort((a, b) => b.percentile - a.percentile)
                    .map((row) => (
                      <TableRow
                        key={row.symbol}
                        className={`border-border/50 cursor-pointer transition-colors ${row.symbol === symbol ? "bg-primary/5" : "hover:bg-muted/30"}`}
                        onClick={() => setSymbol(row.symbol)}
                      >
                        <TableCell className="text-xs font-semibold text-foreground py-2">{row.symbol}</TableCell>
                        <TableCell className="text-xs text-right font-mono py-2">{row.currentSkew.toFixed(2)}%</TableCell>
                        <TableCell className="text-xs text-right font-mono text-muted-foreground py-2">{row.skew30dAvg.toFixed(2)}%</TableCell>
                        <TableCell className="text-xs text-right font-mono text-muted-foreground py-2">{row.skew90dAvg.toFixed(2)}%</TableCell>
                        <TableCell className="text-center py-2">
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${row.percentile}%`,
                                  backgroundColor: row.percentile > 70 ? "hsl(var(--destructive))" : row.percentile < 30 ? "hsl(var(--bullish))" : "hsl(var(--primary))",
                                }}
                              />
                            </div>
                            <span className="text-2xs font-mono text-muted-foreground w-7">{row.percentile}%</span>
                          </div>
                        </TableCell>
                        <TableCell className={`text-xs text-right font-mono py-2 ${row.zScore > 1 ? "text-destructive" : row.zScore < -1 ? "text-green-500" : "text-muted-foreground"}`}>
                          {row.zScore > 0 ? "+" : ""}{row.zScore.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center py-2">
                          <Badge
                            variant="outline"
                            className={`text-2xs px-1.5 py-0 ${
                              row.signal === "rich" ? "border-destructive/40 text-destructive bg-destructive/5" :
                              row.signal === "cheap" ? "border-green-500/40 text-green-500 bg-green-500/5" :
                              "border-muted-foreground/30 text-muted-foreground"
                            }`}
                          >
                            {row.signal === "rich" ? "RICH" : row.signal === "cheap" ? "CHEAP" : "FAIR"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center py-2">
                          <div className="flex items-center justify-center gap-1">
                            {row.trend === "steepening" ? (
                              <TrendingUp className="h-3 w-3 text-destructive" />
                            ) : row.trend === "flattening" ? (
                              <TrendingDown className="h-3 w-3 text-green-500" />
                            ) : (
                              <Minus className="h-3 w-3 text-muted-foreground" />
                            )}
                            <span className="text-2xs text-muted-foreground capitalize">{row.trend}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3">
        <p className="text-2xs text-muted-foreground">{label}</p>
        <p className={`text-sm font-bold font-mono mt-0.5 ${color || "text-foreground"}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
