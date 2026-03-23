import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Cell, ComposedChart, Area, AreaChart, ReferenceLine, Legend } from "recharts";
import { generateIVSurface, getIVTermStructure } from "@/lib/advancedMockData";
import { getIVAnalytics, generateIVHistory } from "@/lib/mockData";
import { Activity, TrendingUp } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };
const spotMap: Record<string, { spot: number; step: number }> = {
  NIFTY: { spot: 24250.75, step: 50 },
  BANKNIFTY: { spot: 51850.40, step: 100 },
  FINNIFTY: { spot: 23180.55, step: 50 },
};

function getHeatColor(iv: number, min: number, max: number): string {
  const pct = (iv - min) / (max - min);
  if (pct < 0.25) return "bg-bullish/20 text-bullish";
  if (pct < 0.5) return "bg-bullish/10";
  if (pct < 0.75) return "bg-warning/15 text-warning";
  return "bg-bearish/20 text-bearish";
}

export default function VolatilitySurface() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [selectedExpiries, setSelectedExpiries] = useState<string[]>([]);
  const config = spotMap[symbol] || spotMap.NIFTY;

  const surface = useMemo(() => generateIVSurface(config.spot, config.step), [symbol]);
  const termStructure = useMemo(() => getIVTermStructure(config.spot, config.step), [symbol]);
  const ivAnalytics = useMemo(() => getIVAnalytics(symbol), [symbol]);
  const ivHistory = useMemo(() => generateIVHistory(symbol), [symbol]);

  // Build heatmap grid
  const strikes = [...new Set(surface.map(p => p.strike))].sort((a, b) => a - b);
  const expiries = [...new Set(surface.map(p => p.expiry))];
  const allIVs = surface.map(p => p.iv);
  const minIV = Math.min(...allIVs);
  const maxIV = Math.max(...allIVs);
  const atmStrike = Math.round(config.spot / config.step) * config.step;

  // IV skew for current expiry
  const nearTermSkew = surface.filter(p => p.expiry === expiries[0]);

  // Initialize selected expiries
  const activeExpiries = selectedExpiries.length > 0 ? selectedExpiries : expiries.slice(0, 2);

  // Multi-expiry IV smile data: one data point per strike with IV for each expiry
  const multiExpirySmile = useMemo(() => {
    return strikes.map(strike => {
      const point: Record<string, any> = { strike };
      activeExpiries.forEach(exp => {
        const match = surface.find(p => p.strike === strike && p.expiry === exp);
        point[exp] = match ? match.iv : null;
      });
      return point;
    });
  }, [strikes, activeExpiries, surface]);

  const smileColors = ["hsl(210 100% 52%)", "hsl(142 71% 45%)", "hsl(38 92% 50%)", "hsl(280 80% 60%)", "hsl(0 84% 60%)"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Volatility Surface & Skew</h1>
          <p className="text-sm text-muted-foreground">IV Surface · Term Structure · Skew Analysis · IV Cone</p>
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

      {/* IV Summary */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">ATM IV</p>
          <p className="text-xl font-bold font-mono">{ivAnalytics.currentIV}%</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">IV Rank</p>
          <p className={`text-xl font-bold font-mono ${ivAnalytics.ivRank > 70 ? "text-bearish" : ivAnalytics.ivRank < 30 ? "text-bullish" : ""}`}>{ivAnalytics.ivRank}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">IV %ile</p>
          <p className="text-lg font-bold font-mono">{ivAnalytics.ivPercentile}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">52W Range</p>
          <p className="text-sm font-bold font-mono">{ivAnalytics.iv52Low}% - {ivAnalytics.iv52High}%</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">HV (1M)</p>
          <p className="text-lg font-bold font-mono">{ivAnalytics.hvMonth}%</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">IV - HV Spread</p>
          <p className={`text-lg font-bold font-mono ${ivAnalytics.currentIV > ivAnalytics.hvMonth ? "text-bearish" : "text-bullish"}`}>
            {(ivAnalytics.currentIV - ivAnalytics.hvMonth).toFixed(1)}%
          </p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="smile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="smile">IV Smile</TabsTrigger>
          <TabsTrigger value="surface">IV Surface Heatmap</TabsTrigger>
          <TabsTrigger value="skew">IV Skew Bars</TabsTrigger>
          <TabsTrigger value="term">Term Structure</TabsTrigger>
          <TabsTrigger value="history">IV vs HV History</TabsTrigger>
        </TabsList>

        {/* Multi-Expiry IV Smile — like the reference image */}
        <TabsContent value="smile">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4" /> IV Smile / Skew by Expiry
                </CardTitle>
                <ToggleGroup
                  type="multiple"
                  value={activeExpiries}
                  onValueChange={(v) => setSelectedExpiries(v.length > 0 ? v : expiries.slice(0, 2))}
                  className="flex-wrap"
                >
                  {expiries.map((exp, i) => {
                    const parts = exp.split(" ");
                    return (
                      <ToggleGroupItem
                        key={exp}
                        value={exp}
                        className="text-[10px] h-7 px-2 data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
                      >
                        <div className="flex flex-col items-center leading-none">
                          <span className="text-[8px] text-muted-foreground">{parts[1] || ""}</span>
                          <span className="font-bold">{parts[0]}</span>
                        </div>
                      </ToggleGroupItem>
                    );
                  })}
                </ToggleGroup>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Classic volatility smile: IV plotted across strikes for each expiry. The U-shape shows how OTM options carry higher IV (crash/rally premium).
                Dashed line = spot price. Compare near vs far expiries to spot term structure changes.
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-[450px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={multiExpirySmile} margin={{ top: 10, right: 60, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis
                      dataKey="strike"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v) => v.toLocaleString("en-IN")}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      domain={["dataMin - 2", "dataMax + 5"]}
                      tickFormatter={(v) => `${v.toFixed(0)}%`}
                      orientation="right"
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: number, name: string) => [`${value?.toFixed(2)}%`, name]}
                      labelFormatter={(label) => `Strike: ${Number(label).toLocaleString("en-IN")}`}
                    />
                    <ReferenceLine
                      x={atmStrike}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      label={{ value: `Spot ${atmStrike.toLocaleString("en-IN")}`, position: "top", fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    />
                    {activeExpiries.map((exp, i) => (
                      <Line
                        key={exp}
                        type="monotone"
                        dataKey={exp}
                        stroke={smileColors[i % smileColors.length]}
                        strokeWidth={2.5}
                        dot={false}
                        name={exp}
                        connectNulls
                      />
                    ))}
                    <Legend
                      verticalAlign="top"
                      height={30}
                      wrapperStyle={{ fontSize: "11px" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="surface">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4" /> IV Surface (Strike × Expiry)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px]">
                    <TableHead className="sticky left-0 bg-card z-10">Strike</TableHead>
                    {expiries.map(e => <TableHead key={e} className="text-center">{e}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {strikes.map(strike => (
                    <TableRow key={strike} className={`text-[11px] font-mono ${strike === atmStrike ? "bg-primary/10 border-y border-primary/30" : ""}`}>
                      <TableCell className="sticky left-0 bg-card z-10 font-medium">
                        {strike.toLocaleString("en-IN")}
                        {strike === atmStrike && <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0 h-3.5 border-primary text-primary">ATM</Badge>}
                      </TableCell>
                      {expiries.map(exp => {
                        const point = surface.find(p => p.strike === strike && p.expiry === exp);
                        const iv = point?.iv || 0;
                        return (
                          <TableCell key={exp} className={`text-center py-1.5 ${getHeatColor(iv, minIV, maxIV)}`}>
                            {iv.toFixed(1)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skew">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">IV Skew (Near-Term Expiry)</CardTitle>
              <p className="text-[10px] text-muted-foreground">Compares call-side vs put-side IV. Steeper put skew = higher crash premium</p>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={nearTermSkew}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={["dataMin - 1", "dataMax + 1"]} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toFixed(2)}%`, ""]} />
                    <ReferenceLine x={atmStrike} stroke="hsl(210 100% 52%)" strokeDasharray="3 3" label={{ value: "ATM", fill: "hsl(210 100% 52%)", fontSize: 9 }} />
                    <Bar dataKey="iv" name="IV" radius={[2, 2, 0, 0]}>
                      {nearTermSkew.map((entry, i) => (
                        <Cell key={i} fill={entry.strike < atmStrike ? "hsl(0 84% 60% / 0.5)" : entry.strike > atmStrike ? "hsl(142 71% 45% / 0.5)" : "hsl(38 92% 50% / 0.7)"} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="iv" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={{ r: 3 }} name="IV Curve" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="term">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">ATM IV Term Structure</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={termStructure}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="expiry" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={["dataMin - 1", "dataMax + 2"]} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="atmIV" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={{ r: 4, fill: "hsl(38 92% 50%)" }} name="ATM IV %" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Skew by Expiry (OTM Put vs Call)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={termStructure}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="expiry" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toFixed(2)}%`, ""]} />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                      <Bar dataKey="putSkew" fill="hsl(0 84% 60% / 0.6)" name="Put Skew" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="callSkew" fill="hsl(142 71% 45% / 0.6)" name="Call Skew" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> IV vs Historical Volatility (90 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={ivHistory}>
                    <defs>
                      <linearGradient id="ivFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(210 100% 52%)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="hsl(210 100% 52%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="iv" stroke="hsl(210 100% 52%)" fill="url(#ivFill)" strokeWidth={2} name="Implied Vol" />
                    <Line type="monotone" dataKey="hv" stroke="hsl(38 92% 50%)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Historical Vol" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
