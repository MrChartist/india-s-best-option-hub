import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LineChart, Line, ComposedChart, Bar } from "recharts";
import { generateStraddleIntraday, generateStraddleHistory } from "@/lib/advancedMockData";
import { TrendingDown, Activity, Clock } from "lucide-react";

const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

const spotMap: Record<string, { spot: number; ce: number; pe: number; step: number }> = {
  NIFTY: { spot: 24250.75, ce: 150, pe: 140, step: 50 },
  BANKNIFTY: { spot: 51850.40, ce: 320, pe: 310, step: 100 },
  FINNIFTY: { spot: 23180.55, ce: 110, pe: 105, step: 50 },
};

export default function StraddleCharts() {
  const [symbol, setSymbol] = useState("NIFTY");
  const config = spotMap[symbol] || spotMap.NIFTY;

  const intraday = useMemo(() => generateStraddleIntraday(config.spot, config.ce, config.pe), [symbol]);
  const history = useMemo(() => generateStraddleHistory(config.spot), [symbol]);

  const current = intraday[intraday.length - 1];
  const opening = intraday[0];
  const straddleChange = current.straddlePremium - opening.straddlePremium;
  const strangleChange = current.stranglePremium - opening.stranglePremium;
  const maxStraddle = Math.max(...intraday.map(p => p.straddlePremium));
  const minStraddle = Math.min(...intraday.map(p => p.straddlePremium));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Straddle & Strangle Charts</h1>
          <p className="text-sm text-muted-foreground">ATM premium tracker · Decay visualization · Intraday + Historical</p>
        </div>
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="NIFTY">NIFTY</SelectItem>
            <SelectItem value="BANKNIFTY">BANKNIFTY</SelectItem>
            <SelectItem value="FINNIFTY">FINNIFTY</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">ATM Straddle</p>
          <p className="text-xl font-bold font-mono text-warning">₹{current.straddlePremium.toFixed(2)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Straddle Chg</p>
          <p className={`text-lg font-bold font-mono ${straddleChange <= 0 ? "text-bullish" : "text-bearish"}`}>
            {straddleChange >= 0 ? "+" : ""}{straddleChange.toFixed(2)}
          </p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">ATM Strangle</p>
          <p className="text-lg font-bold font-mono">₹{current.stranglePremium.toFixed(2)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Day High</p>
          <p className="text-sm font-bold font-mono text-bearish">₹{maxStraddle.toFixed(2)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Day Low</p>
          <p className="text-sm font-bold font-mono text-bullish">₹{minStraddle.toFixed(2)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">ATM IV</p>
          <p className="text-sm font-bold font-mono">{current.iv.toFixed(1)}%</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="intraday">
        <TabsList>
          <TabsTrigger value="intraday">Intraday Premium</TabsTrigger>
          <TabsTrigger value="components">CE vs PE</TabsTrigger>
          <TabsTrigger value="decay">Premium Decay (30D)</TabsTrigger>
          <TabsTrigger value="vs-spot">Premium vs Spot</TabsTrigger>
        </TabsList>

        <TabsContent value="intraday">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-warning" />
                ATM Straddle & Strangle Premium (Intraday)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={intraday}>
                    <defs>
                      <linearGradient id="straddleGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(38 92% 50%)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(38 92% 50%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="strangleGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(210 100% 52%)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="hsl(210 100% 52%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine y={opening.straddlePremium} stroke="hsl(215 15% 40%)" strokeDasharray="5 5" label={{ value: "Open", fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                    <Area type="monotone" dataKey="straddlePremium" stroke="hsl(38 92% 50%)" fill="url(#straddleGrad)" strokeWidth={2} name="Straddle" />
                    <Area type="monotone" dataKey="stranglePremium" stroke="hsl(210 100% 52%)" fill="url(#strangleGrad)" strokeWidth={1.5} name="Strangle" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="components">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">CE vs PE Premium Components</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={intraday}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="cePrice" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} name="CE Premium" />
                    <Line type="monotone" dataKey="pePrice" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} name="PE Premium" />
                    <Line type="monotone" dataKey="iv" stroke="hsl(280 80% 60%)" strokeWidth={1} strokeDasharray="3 3" dot={false} name="ATM IV" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="decay">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-bearish" />
                Premium Decay Over 30 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={history}>
                    <defs>
                      <linearGradient id="decayGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(0 84% 60%)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="prem" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="decay" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area yAxisId="prem" type="monotone" dataKey="premium" stroke="hsl(38 92% 50%)" fill="url(#straddleGrad)" strokeWidth={2} name="Premium" />
                    <Bar yAxisId="decay" dataKey="premiumDecay" fill="hsl(0 84% 60% / 0.4)" name="Decay (₹)" radius={[2, 2, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vs-spot">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Straddle Premium vs Spot Price</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={intraday}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="premium" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="spot" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={["dataMin - 50", "dataMax + 50"]} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line yAxisId="premium" type="monotone" dataKey="straddlePremium" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} name="Straddle ₹" />
                    <Line yAxisId="spot" type="monotone" dataKey="spotPrice" stroke="hsl(210 100% 52%)" strokeWidth={1.5} dot={false} name="Spot" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
