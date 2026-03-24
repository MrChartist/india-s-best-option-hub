import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateMockGEX, getGEXSummary, type GEXByStrike } from "@/lib/gexData";
import { useLiveOptionChain } from "@/hooks/useNSEData";
import { calculateGEX } from "@/lib/gexData";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, ComposedChart, Line, Legend, AreaChart, Area } from "recharts";
import { Shield, TrendingUp, TrendingDown, Target, AlertTriangle, Zap } from "lucide-react";

export default function GammaExposure() {
  const [symbol, setSymbol] = useState("NIFTY");
  const spotPrices: Record<string, number> = { NIFTY: 24250.75, BANKNIFTY: 51850.40, FINNIFTY: 23180.55 };
  const stepSizes: Record<string, number> = { NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50 };
  const spotPrice = spotPrices[symbol] || 24250.75;

  const { data: chainData } = useLiveOptionChain(symbol);

  const gexData = useMemo(() => {
    if (chainData?.isLive && chainData.chain.length > 0) {
      return calculateGEX(chainData.spotPrice, chainData.chain, chainData.lotSize);
    }
    return generateMockGEX(spotPrice, stepSizes[symbol]);
  }, [chainData, symbol, spotPrice]);

  const summary = useMemo(() => getGEXSummary(gexData, chainData?.spotPrice || spotPrice), [gexData, chainData, spotPrice]);

  const atmStrike = Math.round((chainData?.spotPrice || spotPrice) / (stepSizes[symbol] || 50)) * (stepSizes[symbol] || 50);

  // Filter to ±10 strikes around ATM for the chart
  const chartData = useMemo(() => {
    return gexData.filter(d => Math.abs(d.strike - atmStrike) <= 10 * (stepSizes[symbol] || 50));
  }, [gexData, atmStrike, symbol]);

  // Cumulative GEX for area chart
  const cumulativeData = useMemo(() => {
    let cumulative = 0;
    return chartData.map(d => {
      cumulative += d.netGEX;
      return { strike: d.strike, cumGEX: Math.round(cumulative * 100) / 100, netGEX: d.netGEX };
    });
  }, [chartData]);

  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

  const dealerBadge = {
    long_gamma: { label: "Long Gamma", color: "bg-bullish/15 text-bullish border-bullish/30", icon: Shield, desc: "Dealers will sell rallies & buy dips → Low volatility, mean-reverting" },
    short_gamma: { label: "Short Gamma", color: "bg-bearish/15 text-bearish border-bearish/30", icon: AlertTriangle, desc: "Dealers will buy rallies & sell dips → High volatility, trending" },
    neutral: { label: "Neutral Gamma", color: "bg-warning/15 text-warning border-warning/30", icon: Target, desc: "Balanced positioning → Watch for directional shift" },
  }[summary.dealerPosition];

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" /> Gamma Exposure (GEX)
          </h1>
          <p className="text-xs text-muted-foreground">Dealer gamma positioning & market maker hedging levels</p>
        </div>
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NIFTY">NIFTY 50</SelectItem>
            <SelectItem value="BANKNIFTY">BANK NIFTY</SelectItem>
            <SelectItem value="FINNIFTY">FIN NIFTY</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className={`col-span-2 border ${dealerBadge.color.split(" ").filter(c => c.startsWith("border")).join(" ")}`}>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <dealerBadge.icon className="h-4 w-4" />
              <Badge variant="outline" className={`text-[10px] ${dealerBadge.color}`}>{dealerBadge.label}</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{dealerBadge.desc}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-3 pb-3">
            <p className="text-[10px] text-muted-foreground">Net GEX</p>
            <p className={`text-lg font-bold font-mono ${summary.netGEX >= 0 ? "text-bullish" : "text-bearish"}`}>
              {summary.netGEX >= 0 ? "+" : ""}{summary.netGEX.toFixed(1)}
            </p>
            <p className="text-[9px] text-muted-foreground">₹ Cr notional</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-3 pb-3">
            <p className="text-[10px] text-muted-foreground">Call GEX</p>
            <p className="text-lg font-bold font-mono text-bullish">+{summary.totalCallGEX.toFixed(1)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-3 pb-3">
            <p className="text-[10px] text-muted-foreground">Put GEX</p>
            <p className="text-lg font-bold font-mono text-bearish">{summary.totalPutGEX.toFixed(1)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-3 pb-3">
            <p className="text-[10px] text-muted-foreground">GEX Flip</p>
            <p className="text-lg font-bold font-mono">{summary.flipPoint.toLocaleString("en-IN")}</p>
            <p className="text-[9px] text-muted-foreground">
              {summary.flipPoint > (chainData?.spotPrice || spotPrice) ? "Above spot ↑" : "Below spot ↓"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="gex-chart">
        <TabsList className="h-8">
          <TabsTrigger value="gex-chart" className="text-xs">GEX by Strike</TabsTrigger>
          <TabsTrigger value="net-gex" className="text-xs">Net GEX Profile</TabsTrigger>
          <TabsTrigger value="cumulative" className="text-xs">Cumulative GEX</TabsTrigger>
          <TabsTrigger value="levels" className="text-xs">Key Levels</TabsTrigger>
        </TabsList>

        {/* Call/Put GEX Bars */}
        <TabsContent value="gex-chart">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Call GEX vs Put GEX by Strike</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barGap={-1}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => v.toLocaleString("en-IN")} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toFixed(2)} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <ReferenceLine x={atmStrike} stroke="hsl(var(--primary))" strokeDasharray="5 5" label={{ value: "ATM", position: "top", fontSize: 9, fill: "hsl(var(--primary))" }} />
                    <Bar dataKey="callGEX" name="Call GEX" fill="hsl(142 71% 45% / 0.7)" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="putGEX" name="Put GEX" fill="hsl(0 84% 60% / 0.7)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Net GEX Profile */}
        <TabsContent value="net-gex">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Net Gamma Exposure Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => v.toLocaleString("en-IN")} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toFixed(2)} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <ReferenceLine x={atmStrike} stroke="hsl(var(--primary))" strokeDasharray="5 5" label={{ value: "SPOT", position: "top", fontSize: 9, fill: "hsl(var(--primary))" }} />
                    {summary.flipPoint !== atmStrike && (
                      <ReferenceLine x={summary.flipPoint} stroke="hsl(var(--warning))" strokeDasharray="3 3" label={{ value: "FLIP", position: "top", fontSize: 9, fill: "hsl(var(--warning))" }} />
                    )}
                    <Bar dataKey="netGEX" name="Net GEX" radius={[2, 2, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.netGEX >= 0 ? "hsl(142 71% 45% / 0.7)" : "hsl(0 84% 60% / 0.7)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 p-3 rounded-lg bg-accent/30 text-xs text-muted-foreground space-y-1">
                <p><strong>Positive Net GEX</strong>: Dealers are long gamma → they sell into rallies & buy dips → acts as <span className="text-bullish font-medium">resistance</span>.</p>
                <p><strong>Negative Net GEX</strong>: Dealers are short gamma → they amplify moves → acts as <span className="text-bearish font-medium">volatility accelerator</span>.</p>
                <p><strong>GEX Flip Point ({summary.flipPoint.toLocaleString("en-IN")})</strong>: Below this level, dealers shift from stabilizing to destabilizing.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cumulative GEX */}
        <TabsContent value="cumulative">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cumulative Gamma Exposure</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cumulativeData}>
                    <defs>
                      <linearGradient id="cumGexGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => v.toLocaleString("en-IN")} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine x={atmStrike} stroke="hsl(var(--primary))" strokeDasharray="5 5" />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <Area type="monotone" dataKey="cumGEX" stroke="hsl(var(--primary))" fill="url(#cumGexGrad)" strokeWidth={2} name="Cumulative GEX" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Key Levels Table */}
        <TabsContent value="levels">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">GEX-Derived Support & Resistance</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[10px]">
                      <TableHead>Strike</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">GEX Strength</TableHead>
                      <TableHead className="text-right">Distance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.keyLevels.sort((a, b) => b.strike - a.strike).map(level => {
                      const dist = level.strike - (chainData?.spotPrice || spotPrice);
                      const typeColor = { support: "text-bullish", resistance: "text-bearish", magnet: "text-primary" }[level.type];
                      return (
                        <TableRow key={level.strike} className="text-xs font-mono">
                          <TableCell className="font-bold">{level.strike.toLocaleString("en-IN")}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[9px] capitalize ${typeColor}`}>{level.type}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{level.strength.toFixed(2)}</TableCell>
                          <TableCell className={`text-right ${dist >= 0 ? "text-bullish" : "text-bearish"}`}>
                            {dist >= 0 ? "+" : ""}{dist.toFixed(0)} pts
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">GEX Data by Strike</CardTitle>
              </CardHeader>
              <CardContent className="p-0 max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[10px] sticky top-0 bg-card z-10">
                      <TableHead>Strike</TableHead>
                      <TableHead className="text-right">Call GEX</TableHead>
                      <TableHead className="text-right">Put GEX</TableHead>
                      <TableHead className="text-right">Net GEX</TableHead>
                      <TableHead className="text-right">Call OI</TableHead>
                      <TableHead className="text-right">Put OI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {chartData.map(row => (
                      <TableRow key={row.strike} className={`text-[11px] font-mono ${row.strike === atmStrike ? "bg-primary/5 font-bold" : ""}`}>
                        <TableCell>{row.strike.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right text-bullish">+{row.callGEX.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-bearish">{row.putGEX.toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-medium ${row.netGEX >= 0 ? "text-bullish" : "text-bearish"}`}>
                          {row.netGEX >= 0 ? "+" : ""}{row.netGEX.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{(row.callOI / 100000).toFixed(1)}L</TableCell>
                        <TableCell className="text-right text-muted-foreground">{(row.putOI / 100000).toFixed(1)}L</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
