import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getMockPositions, simulatePnL, simulateGreeksDecay, type Position } from "@/lib/mockData";
import { Plus, Trash2, TrendingUp, TrendingDown, DollarSign, PieChart, Shield, Clock, Activity, BarChart3 } from "lucide-react";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart, Bar } from "recharts";
import { WhatIfSimulator } from "@/components/WhatIfSimulator";

export default function PositionTracker() {
  const [positions, setPositions] = useState<Position[]>(getMockPositions());
  const [showAddForm, setShowAddForm] = useState(false);
  const [simSpotOverride, setSimSpotOverride] = useState<string>("");

  const stats = useMemo(() => {
    const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
    const totalDelta = positions.reduce((s, p) => {
      const mult = p.action === "BUY" ? 1 : -1;
      return s + p.delta * mult * p.lots * p.lotSize;
    }, 0);
    const totalTheta = positions.reduce((s, p) => {
      const mult = p.action === "BUY" ? 1 : -1;
      return s + p.theta * mult * p.lots * p.lotSize;
    }, 0);
    const totalGamma = positions.reduce((s, p) => s + 0.001 * p.lots * p.lotSize, 0);
    const totalVega = positions.reduce((s, p) => s + 8 * p.lots * p.lotSize * (p.action === "BUY" ? 1 : -1), 0);
    const totalInvestment = positions.reduce((s, p) => s + p.entryPrice * p.lots * p.lotSize, 0);
    const totalMargin = positions.filter(p => p.action === "SELL").reduce((s, p) => s + p.entryPrice * p.lots * p.lotSize * 3, 0);
    const winners = positions.filter(p => p.pnl > 0).length;
    const losers = positions.filter(p => p.pnl < 0).length;
    return {
      totalPnl, totalDelta: Math.round(totalDelta),
      totalTheta: Math.round(totalTheta * 100) / 100,
      totalGamma: Math.round(totalGamma * 100) / 100,
      totalVega: Math.round(totalVega),
      totalInvestment: Math.round(totalInvestment),
      totalMargin: Math.round(totalMargin),
      pnlPercent: totalInvestment > 0 ? Math.round((totalPnl / totalInvestment) * 10000) / 100 : 0,
      winners, losers,
      winRate: positions.length > 0 ? Math.round((winners / positions.length) * 100) : 0,
    };
  }, [positions]);

  // P&L Simulator
  const niftyPositions = positions.filter(p => p.symbol === "NIFTY");
  const simSpot = Number(simSpotOverride) || 24250;
  const pnlSimData = useMemo(() => {
    if (niftyPositions.length === 0) return [];
    const range: [number, number] = [simSpot * 0.95, simSpot * 1.05];
    return simulatePnL(niftyPositions, range, 60);
  }, [niftyPositions, simSpot]);

  // Greeks Decay
  const greeksDecay = useMemo(() => simulateGreeksDecay(positions, 7), [positions]);

  const removePosition = (id: string) => setPositions(positions.filter(p => p.id !== id));

  const grouped = useMemo(() => {
    const groups: Record<string, Position[]> = {};
    for (const p of positions) (groups[p.symbol] ||= []).push(p);
    return groups;
  }, [positions]);

  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Position Tracker</h1>
          <p className="text-sm text-muted-foreground">Live P&L · P&L Simulator · Greeks Decay · Portfolio Risk</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="h-3 w-3" /> Add Position
        </Button>
      </div>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <Card className={stats.totalPnl >= 0 ? "border-bullish/20" : "border-bearish/20"}>
          <CardContent className="pt-3 pb-3 text-center">
            <p className="text-[9px] text-muted-foreground flex items-center justify-center gap-1"><DollarSign className="h-3 w-3" /> Total P&L</p>
            <p className={`text-xl font-bold font-mono ${stats.totalPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
              {stats.totalPnl >= 0 ? "+" : ""}₹{stats.totalPnl.toLocaleString("en-IN")}
            </p>
            <p className={`text-[10px] font-mono ${stats.totalPnl >= 0 ? "text-bullish" : "text-bearish"}`}>{stats.pnlPercent >= 0 ? "+" : ""}{stats.pnlPercent}%</p>
          </CardContent>
        </Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Net Delta</p>
          <p className={`text-lg font-bold font-mono ${stats.totalDelta >= 0 ? "text-bullish" : "text-bearish"}`}>{stats.totalDelta}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Net Theta</p>
          <p className={`text-lg font-bold font-mono ${stats.totalTheta >= 0 ? "text-bullish" : "text-bearish"}`}>₹{stats.totalTheta}/d</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Net Vega</p>
          <p className={`text-lg font-bold font-mono ${stats.totalVega >= 0 ? "text-bullish" : "text-bearish"}`}>₹{stats.totalVega}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Investment</p>
          <p className="text-lg font-bold font-mono">₹{(stats.totalInvestment / 1000).toFixed(1)}K</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Margin</p>
          <p className="text-lg font-bold font-mono">₹{(stats.totalMargin / 1000).toFixed(0)}K</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Win Rate</p>
          <p className={`text-lg font-bold font-mono ${stats.winRate >= 50 ? "text-bullish" : "text-bearish"}`}>{stats.winRate}%</p>
          <p className="text-[9px] text-muted-foreground">{stats.winners}W/{stats.losers}L</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground flex items-center justify-center gap-1"><Shield className="h-3 w-3" /> Risk</p>
          <p className={`text-lg font-bold font-mono ${Math.abs(stats.totalDelta) > 500 ? "text-bearish" : "text-bullish"}`}>
            {Math.abs(stats.totalDelta) > 500 ? "High" : Math.abs(stats.totalDelta) > 200 ? "Med" : "Low"}
          </p>
        </CardContent></Card>
      </div>

      {/* P&L Simulator & Greeks Decay */}
      <Tabs defaultValue="pnl-sim">
        <TabsList>
          <TabsTrigger value="pnl-sim">P&L Simulator</TabsTrigger>
          <TabsTrigger value="greeks-decay">Greeks Decay</TabsTrigger>
        </TabsList>

        <TabsContent value="pnl-sim">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> P&L at Expiry — NIFTY Positions</CardTitle>
                  <p className="text-[10px] text-muted-foreground">Shows combined P&L across all NIFTY legs as spot moves ±5%</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-[9px]">Spot:</Label>
                  <Input
                    type="number"
                    value={simSpotOverride || "24250"}
                    onChange={e => setSimSpotOverride(e.target.value)}
                    className="w-[100px] h-7 text-xs font-mono"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {pnlSimData.length > 0 ? (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pnlSimData}>
                      <defs>
                        <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                          <stop offset="50%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                          <stop offset="50%" stopColor="hsl(0 84% 60%)" stopOpacity={0} />
                          <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0.3} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                      <XAxis dataKey="spotPrice" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "P&L"]} />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                      <ReferenceLine x={simSpot} stroke="hsl(38 92% 50%)" strokeDasharray="3 3" label={{ value: "Spot", fill: "hsl(38 92% 50%)", fontSize: 9 }} />
                      <Area type="monotone" dataKey="totalPnl" stroke="hsl(210 100% 52%)" fill="url(#pnlGrad)" strokeWidth={2} name="Total P&L" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No NIFTY positions to simulate. Add NIFTY positions above.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="greeks-decay">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Greeks Decay Over Time (T to T+7)</CardTitle>
              <p className="text-[10px] text-muted-foreground">How your portfolio P&L and Greeks change as time passes (theta decay effect)</p>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={greeksDecay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="pnl" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="delta" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => {
                      if (name === "P&L") return [`₹${v.toLocaleString("en-IN")}`, "P&L"];
                      if (name === "Cum Theta") return [`₹${v.toLocaleString("en-IN")}`, "Cum Theta"];
                      return [v, name];
                    }} />
                    <ReferenceLine yAxisId="pnl" y={0} stroke="hsl(var(--muted-foreground))" />
                    <Line yAxisId="pnl" type="monotone" dataKey="totalPnl" stroke="hsl(210 100% 52%)" strokeWidth={2} dot={{ fill: "hsl(210 100% 52%)", r: 3 }} name="P&L" />
                    <Line yAxisId="pnl" type="monotone" dataKey="totalTheta" stroke="hsl(38 92% 50%)" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Cum Theta" />
                    <Bar yAxisId="delta" dataKey="totalDelta" fill="hsl(142 71% 45% / 0.3)" radius={[2, 2, 0, 0]} name="Delta" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* What-If Scenario Simulator */}
      <WhatIfSimulator positions={positions} />

      {/* Add Position Form */}
      {showAddForm && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Add New Position</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const newPos: Position = {
                id: Date.now().toString(),
                symbol: fd.get("symbol") as string || "NIFTY",
                type: fd.get("type") as "CE" | "PE" || "CE",
                action: fd.get("action") as "BUY" | "SELL" || "BUY",
                strike: Number(fd.get("strike")) || 24300,
                lots: Number(fd.get("lots")) || 1,
                entryPrice: Number(fd.get("entryPrice")) || 100,
                currentPrice: Number(fd.get("entryPrice")) || 100,
                lotSize: 25,
                entryDate: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
                expiry: "27 Mar",
                pnl: 0, pnlPercent: 0, delta: 0.5, theta: -10, iv: 14,
              };
              setPositions([...positions, newPos]);
              setShowAddForm(false);
            }} className="grid grid-cols-3 md:grid-cols-7 gap-2">
              <div><Label className="text-[9px]">Symbol</Label>
                <Select name="symbol" defaultValue="NIFTY">
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["NIFTY", "BANKNIFTY", "FINNIFTY", "RELIANCE", "HDFCBANK", "TCS"].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-[9px]">Type</Label>
                <Select name="type" defaultValue="CE">
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="CE">CE</SelectItem><SelectItem value="PE">PE</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-[9px]">Action</Label>
                <Select name="action" defaultValue="BUY">
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="BUY">BUY</SelectItem><SelectItem value="SELL">SELL</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label className="text-[9px]">Strike</Label><Input name="strike" type="number" defaultValue={24300} className="h-7 text-[10px] font-mono" /></div>
              <div><Label className="text-[9px]">Lots</Label><Input name="lots" type="number" defaultValue={1} className="h-7 text-[10px] font-mono" min={1} /></div>
              <div><Label className="text-[9px]">Entry ₹</Label><Input name="entryPrice" type="number" defaultValue={100} className="h-7 text-[10px] font-mono" /></div>
              <div className="flex items-end"><Button type="submit" size="sm" className="h-7 text-xs w-full">Add</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Positions by Symbol */}
      {Object.entries(grouped).map(([sym, symPositions]) => {
        const symPnl = symPositions.reduce((s, p) => s + p.pnl, 0);
        return (
          <Card key={sym}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  {sym}
                  <Badge variant="outline" className="text-[9px]">{symPositions.length} legs</Badge>
                </CardTitle>
                <span className={`text-sm font-bold font-mono ${symPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {symPnl >= 0 ? "+" : ""}₹{symPnl.toLocaleString("en-IN")}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px]">
                    <TableHead>Action</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Strike</TableHead>
                    <TableHead className="text-right">Lots</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">CMP</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead className="text-right">P&L%</TableHead>
                    <TableHead className="text-right">Delta</TableHead>
                    <TableHead className="text-right">Theta</TableHead>
                    <TableHead className="text-right">IV</TableHead>
                    <TableHead className="text-center">Expiry</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {symPositions.map(p => (
                    <TableRow key={p.id} className="text-[11px] font-mono">
                      <TableCell><Badge variant={p.action === "BUY" ? "default" : "destructive"} className="text-[9px] h-4 px-1.5">{p.action}</Badge></TableCell>
                      <TableCell><Badge variant="outline" className="text-[9px] h-4 px-1.5">{p.type}</Badge></TableCell>
                      <TableCell className="text-right font-bold">{p.strike.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right">{p.lots}</TableCell>
                      <TableCell className="text-right">{p.entryPrice.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{p.currentPrice.toFixed(2)}</TableCell>
                      <TableCell className={`text-right font-bold ${p.pnl >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {p.pnl >= 0 ? "+" : ""}₹{p.pnl.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className={`text-right ${p.pnlPercent >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {p.pnlPercent >= 0 ? "+" : ""}{p.pnlPercent.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">{p.delta.toFixed(2)}</TableCell>
                      <TableCell className={`text-right ${p.theta >= 0 ? "text-bullish" : "text-bearish"}`}>{p.theta.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{p.iv.toFixed(1)}%</TableCell>
                      <TableCell className="text-center text-muted-foreground flex items-center gap-1 justify-center">
                        <Clock className="h-2.5 w-2.5" /> {p.expiry}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removePosition(p.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
