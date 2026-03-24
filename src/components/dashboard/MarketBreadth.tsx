import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getMarketBreadth } from "@/lib/mockData";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  BarChart, Bar,
} from "recharts";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontSize: "11px",
};

export function MarketBreadth() {
  const breadth = useMemo(() => getMarketBreadth(), []);

  return (
    <>
      {/* A/D + Highs/Lows */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm">A/D Line vs Nifty (30D)</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={breadth.advDecLine}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis yAxisId="ad" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis yAxisId="nifty" orientation="right" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line yAxisId="ad" type="monotone" dataKey="adLine" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} name="A/D Line" />
                  <Line yAxisId="nifty" type="monotone" dataKey="nifty" stroke="hsl(var(--warning))" strokeWidth={1.5} dot={false} name="Nifty" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm">New 52W Highs vs Lows (20D)</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={breadth.highsLows} barGap={0}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="newHighs" fill="hsl(var(--bullish) / 0.7)" name="Highs" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="newLows" fill="hsl(var(--bearish) / 0.7)" name="Lows" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* EMA + Sector Rotation */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm">% Stocks Above Key EMAs</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <Table>
              <TableHeader>
                <TableRow className="text-[10px]">
                  <TableHead className="h-7">Index</TableHead>
                  <TableHead className="h-7 text-right">Above 20 EMA</TableHead>
                  <TableHead className="h-7 text-right">Above 50 EMA</TableHead>
                  <TableHead className="h-7 text-right">Above 200 EMA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breadth.emaCoverage.map((e) => (
                  <TableRow key={e.label} className="text-xs font-mono">
                    <TableCell className="font-medium font-sans py-1.5">{e.label}</TableCell>
                    {[e.above20, e.above50, e.above200].map((val, i) => (
                      <TableCell key={i} className="text-right py-1.5">
                        <div className="flex items-center justify-end gap-2">
                          <Progress value={val} className="h-1 w-14" />
                          <span className={`text-[10px] ${val > 50 ? "text-bullish" : "text-bearish"}`}>{val}%</span>
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm">Sector Rotation Map</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="grid grid-cols-2 gap-2">
              {breadth.sectorRotation.map((s) => {
                const qColor: Record<string, string> = {
                  Leading: "bg-bullish/15 border-bullish/30 text-bullish",
                  Improving: "bg-primary/10 border-primary/30 text-primary",
                  Weakening: "bg-warning/10 border-warning/30 text-warning",
                  Lagging: "bg-bearish/15 border-bearish/30 text-bearish",
                };
                return (
                  <div key={s.sector} className={`p-2 rounded-md border ${qColor[s.quadrant] || ""}`}>
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
    </>
  );
}
