import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, ComposedChart, Area, ReferenceLine, Cell } from "recharts";
import { generateFIIDIIHistory, getRolloverData, generateFIIFuturesOI } from "@/lib/advancedMockData";
import { TrendingUp, TrendingDown, Activity, Users } from "lucide-react";

const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

export default function FIIDIIActivity() {
  const fiiDii = useMemo(() => generateFIIDIIHistory(), []);
  const rollover = useMemo(() => getRolloverData(), []);
  const fiiFuturesOI = useMemo(() => generateFIIFuturesOI(), []);

  const latest = fiiDii[fiiDii.length - 1];
  const totalFIINet30d = fiiDii.reduce((s, d) => s + d.fiiNet, 0);
  const totalDIINet30d = fiiDii.reduce((s, d) => s + d.diiNet, 0);
  const latestOI = fiiFuturesOI[fiiFuturesOI.length - 1];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">FII/DII Activity & Rollover</h1>
        <p className="text-sm text-muted-foreground">Institutional flow · Futures OI · Rollover analysis · Cost of carry</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">FII Today Net</p>
          <p className={`text-lg font-bold font-mono ${latest.fiiNet >= 0 ? "text-bullish" : "text-bearish"}`}>
            {latest.fiiNet >= 0 ? "+" : ""}₹{latest.fiiNet}Cr
          </p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">DII Today Net</p>
          <p className={`text-lg font-bold font-mono ${latest.diiNet >= 0 ? "text-bullish" : "text-bearish"}`}>
            {latest.diiNet >= 0 ? "+" : ""}₹{latest.diiNet}Cr
          </p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">FII 30D Net</p>
          <p className={`text-lg font-bold font-mono ${totalFIINet30d >= 0 ? "text-bullish" : "text-bearish"}`}>
            ₹{Math.round(totalFIINet30d).toLocaleString("en-IN")}Cr
          </p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">DII 30D Net</p>
          <p className={`text-lg font-bold font-mono ${totalDIINet30d >= 0 ? "text-bullish" : "text-bearish"}`}>
            ₹{Math.round(totalDIINet30d).toLocaleString("en-IN")}Cr
          </p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">FII L/S Ratio</p>
          <p className={`text-lg font-bold font-mono ${latestOI.longShortRatio >= 1 ? "text-bullish" : "text-bearish"}`}>
            {latestOI.longShortRatio}
          </p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">FII Net OI</p>
          <p className={`text-lg font-bold font-mono ${latestOI.netOI >= 0 ? "text-bullish" : "text-bearish"}`}>
            {(latestOI.netOI / 1000).toFixed(0)}K
          </p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="flow">
        <TabsList className="flex-wrap">
          <TabsTrigger value="flow">Cash Flow</TabsTrigger>
          <TabsTrigger value="futures-oi">Futures OI</TabsTrigger>
          <TabsTrigger value="rollover">Rollover Analysis</TabsTrigger>
          <TabsTrigger value="cumulative">Cumulative Flow</TabsTrigger>
        </TabsList>

        <TabsContent value="flow">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4" /> FII vs DII Daily Net Flow (₹ Cr)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={fiiDii}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="flow" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="nifty" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine yAxisId="flow" y={0} stroke="hsl(var(--muted-foreground))" />
                    <Bar yAxisId="flow" dataKey="fiiNet" name="FII Net" radius={[2, 2, 0, 0]}>
                      {fiiDii.map((d, i) => <Cell key={i} fill={d.fiiNet >= 0 ? "hsl(142 71% 45% / 0.7)" : "hsl(0 84% 60% / 0.7)"} />)}
                    </Bar>
                    <Bar yAxisId="flow" dataKey="diiNet" name="DII Net" radius={[2, 2, 0, 0]}>
                      {fiiDii.map((d, i) => <Cell key={i} fill={d.diiNet >= 0 ? "hsl(210 100% 52% / 0.5)" : "hsl(38 92% 50% / 0.5)"} />)}
                    </Bar>
                    <Line yAxisId="nifty" type="monotone" dataKey="niftyClose" stroke="hsl(280 80% 60%)" strokeWidth={1.5} dot={false} name="Nifty" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="futures-oi">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">FII Index Futures OI (Long vs Short)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={fiiFuturesOI}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="oi" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="ratio" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={[0.8, 1.3]} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area yAxisId="oi" type="monotone" dataKey="longOI" stroke="hsl(142 71% 45%)" fill="hsl(142 71% 45% / 0.1)" strokeWidth={1.5} name="Long OI" />
                    <Area yAxisId="oi" type="monotone" dataKey="shortOI" stroke="hsl(0 84% 60%)" fill="hsl(0 84% 60% / 0.1)" strokeWidth={1.5} name="Short OI" />
                    <Line yAxisId="ratio" type="monotone" dataKey="longShortRatio" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} name="L/S Ratio" />
                    <ReferenceLine yAxisId="ratio" y={1} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rollover">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Rollover Analysis & Cost of Carry</CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px]">
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Current OI</TableHead>
                    <TableHead className="text-right">Next Month OI</TableHead>
                    <TableHead className="text-right">Rollover %</TableHead>
                    <TableHead className="text-right">Prev Rollover</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Cost of Carry</TableHead>
                    <TableHead>Signal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rollover.map(r => {
                    const rollDiff = r.rolloverPercent - r.prevRollover;
                    return (
                      <TableRow key={r.symbol} className="text-[11px] font-mono">
                        <TableCell className="font-sans font-medium">{r.symbol}</TableCell>
                        <TableCell className="text-right">{(r.currentMonthOI / 1000000).toFixed(1)}M</TableCell>
                        <TableCell className="text-right">{(r.nextMonthOI / 1000000).toFixed(1)}M</TableCell>
                        <TableCell className="text-right font-medium">{r.rolloverPercent}%</TableCell>
                        <TableCell className="text-right text-muted-foreground">{r.prevRollover}%</TableCell>
                        <TableCell className={`text-right ${rollDiff >= 0 ? "text-bullish" : "text-bearish"}`}>
                          {rollDiff >= 0 ? "+" : ""}{rollDiff.toFixed(2)}%
                        </TableCell>
                        <TableCell className={`text-right ${r.costOfCarry >= 0 ? "text-bullish" : "text-bearish"}`}>
                          {r.costOfCarry >= 0 ? "+" : ""}{r.costOfCarry}%
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[8px] h-4 px-1.5 ${r.interpretation === "Bullish Carry" ? "text-bullish" : r.interpretation === "Bearish Carry" ? "text-bearish" : "text-muted-foreground"}`}>
                            {r.interpretation}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cumulative">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cumulative FII + DII Flow vs Nifty</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  {(() => {
                    let cumFII = 0, cumDII = 0;
                    const cumData = fiiDii.map(d => {
                      cumFII += d.fiiNet; cumDII += d.diiNet;
                      return { date: d.date, cumFII: Math.round(cumFII), cumDII: Math.round(cumDII), nifty: d.niftyClose };
                    });
                    return (
                      <ComposedChart data={cumData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis yAxisId="flow" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis yAxisId="nifty" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <ReferenceLine yAxisId="flow" y={0} stroke="hsl(var(--muted-foreground))" />
                        <Area yAxisId="flow" type="monotone" dataKey="cumFII" stroke="hsl(142 71% 45%)" fill="hsl(142 71% 45% / 0.1)" strokeWidth={2} name="Cum. FII (₹Cr)" />
                        <Area yAxisId="flow" type="monotone" dataKey="cumDII" stroke="hsl(210 100% 52%)" fill="hsl(210 100% 52% / 0.1)" strokeWidth={2} name="Cum. DII (₹Cr)" />
                        <Line yAxisId="nifty" type="monotone" dataKey="nifty" stroke="hsl(38 92% 50%)" strokeWidth={1.5} dot={false} name="Nifty" />
                      </ComposedChart>
                    );
                  })()}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
