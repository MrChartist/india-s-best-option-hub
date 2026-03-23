import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Plus, Trash2 } from "lucide-react";
import { getPresetStrategies, calculatePayoff, calculateGreeks, type StrategyLeg } from "@/lib/mockData";

export default function StrategyBuilder() {
  const [symbol] = useState("NIFTY");
  const spotPrice = 24250.75;
  const lotSize = 25;
  const stepSize = 50;

  const presets = useMemo(() => getPresetStrategies(spotPrice, stepSize), [spotPrice]);
  const [legs, setLegs] = useState<StrategyLeg[]>(presets[0].legs);
  const [selectedPreset, setSelectedPreset] = useState(presets[0].name);

  const handlePreset = (name: string) => {
    const p = presets.find(s => s.name === name);
    if (p) { setLegs(p.legs); setSelectedPreset(name); }
  };

  const addLeg = () => {
    const atm = Math.round(spotPrice / stepSize) * stepSize;
    setLegs([...legs, { type: "CE", action: "BUY", strike: atm, lots: 1, premium: 100 }]);
    setSelectedPreset("");
  };

  const removeLeg = (i: number) => {
    setLegs(legs.filter((_, idx) => idx !== i));
    setSelectedPreset("");
  };

  const updateLeg = (i: number, field: keyof StrategyLeg, value: any) => {
    const updated = [...legs];
    (updated[i] as any)[field] = value;
    setLegs(updated);
    setSelectedPreset("");
  };

  // Calculate payoff
  const payoffData = useMemo(() => {
    const range: number[] = [];
    const center = Math.round(spotPrice / stepSize) * stepSize;
    for (let s = center - stepSize * 20; s <= center + stepSize * 20; s += stepSize) range.push(s);
    return calculatePayoff(legs, lotSize, range);
  }, [legs, spotPrice]);

  // Strategy stats
  const stats = useMemo(() => {
    const maxProfit = Math.max(...payoffData.map(d => d.pnl));
    const maxLoss = Math.min(...payoffData.map(d => d.pnl));
    const breakevens = payoffData.filter((d, i) => {
      if (i === 0) return false;
      return (payoffData[i - 1].pnl < 0 && d.pnl >= 0) || (payoffData[i - 1].pnl >= 0 && d.pnl < 0);
    }).map(d => d.spot);

    const netPremium = legs.reduce((s, l) => s + (l.action === "BUY" ? -1 : 1) * l.premium * l.lots * lotSize, 0);

    // Combined greeks
    let totalDelta = 0, totalGamma = 0, totalTheta = 0, totalVega = 0;
    for (const leg of legs) {
      const g = calculateGreeks(spotPrice, leg.strike, 7, 14, 6.5);
      const mult = (leg.action === "BUY" ? 1 : -1) * leg.lots * lotSize;
      if (leg.type === "CE") {
        totalDelta += g.delta.call * mult;
        totalTheta += g.theta.call * mult;
      } else {
        totalDelta += g.delta.put * mult;
        totalTheta += g.theta.put * mult;
      }
      totalGamma += g.gamma * Math.abs(mult);
      totalVega += g.vega * Math.abs(mult);
    }

    return { maxProfit, maxLoss, breakevens, netPremium, totalDelta: Math.round(totalDelta * 100) / 100, totalGamma: Math.round(totalGamma * 100) / 100, totalTheta: Math.round(totalTheta * 100) / 100, totalVega: Math.round(totalVega * 100) / 100 };
  }, [legs, payoffData, spotPrice]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Strategy Builder</h1>
        <p className="text-sm text-muted-foreground">Build & analyze multi-leg option strategies</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Legs Config */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Strategy Legs</CardTitle>
              <Select value={selectedPreset} onValueChange={handlePreset}>
                <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Preset..." /></SelectTrigger>
                <SelectContent>
                  {presets.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {legs.map((leg, i) => (
              <div key={i} className="p-3 rounded-md bg-accent/50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    <Badge variant={leg.action === "BUY" ? "default" : "destructive"} className="text-[10px]">{leg.action}</Badge>
                    <Badge variant="outline" className="text-[10px]">{leg.type}</Badge>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeLeg(i)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={leg.action} onValueChange={v => updateLeg(i, "action", v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="BUY">BUY</SelectItem><SelectItem value="SELL">SELL</SelectItem></SelectContent>
                  </Select>
                  <Select value={leg.type} onValueChange={v => updateLeg(i, "type", v)}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="CE">CE</SelectItem><SelectItem value="PE">PE</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><Label className="text-[10px]">Strike</Label><Input type="number" value={leg.strike} onChange={e => updateLeg(i, "strike", Number(e.target.value))} className="h-7 text-xs font-mono" /></div>
                  <div><Label className="text-[10px]">Lots</Label><Input type="number" value={leg.lots} onChange={e => updateLeg(i, "lots", Number(e.target.value))} className="h-7 text-xs font-mono" min={1} /></div>
                  <div><Label className="text-[10px]">Premium</Label><Input type="number" value={leg.premium} onChange={e => updateLeg(i, "premium", Number(e.target.value))} className="h-7 text-xs font-mono" /></div>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addLeg} className="w-full">
              <Plus className="h-3 w-3 mr-1" /> Add Leg
            </Button>
          </CardContent>
        </Card>

        {/* Payoff Chart & Stats */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Payoff at Expiry</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={payoffData}>
                    <defs>
                      <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="spot" tick={{ fontSize: 10, fill: "hsl(215 15% 55%)" }} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(215 15% 55%)" }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)", borderRadius: "8px", fontSize: "12px" }}
                      formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, "P&L"]}
                    />
                    <ReferenceLine y={0} stroke="hsl(215 15% 55%)" strokeDasharray="3 3" />
                    <ReferenceLine x={spotPrice} stroke="hsl(210 100% 52%)" strokeDasharray="5 5" label={{ value: "Spot", fill: "hsl(210 100% 52%)", fontSize: 10 }} />
                    <Area
                      type="monotone"
                      dataKey="pnl"
                      stroke="hsl(142 71% 45%)"
                      fill="url(#profitGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-3">
              <p className="text-[10px] text-muted-foreground">Max Profit</p>
              <p className="text-lg font-bold font-mono text-bullish">₹{stats.maxProfit.toLocaleString("en-IN")}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-3">
              <p className="text-[10px] text-muted-foreground">Max Loss</p>
              <p className="text-lg font-bold font-mono text-bearish">₹{stats.maxLoss.toLocaleString("en-IN")}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-3">
              <p className="text-[10px] text-muted-foreground">Net Premium</p>
              <p className={`text-lg font-bold font-mono ${stats.netPremium >= 0 ? "text-bullish" : "text-bearish"}`}>₹{stats.netPremium.toLocaleString("en-IN")}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-3">
              <p className="text-[10px] text-muted-foreground">Breakevens</p>
              <p className="text-sm font-mono">{stats.breakevens.length > 0 ? stats.breakevens.map(b => b.toLocaleString("en-IN")).join(", ") : "None"}</p>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Combined Greeks</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4 text-center">
                <div><p className="text-xs text-muted-foreground">Delta</p><p className="text-lg font-bold font-mono">{stats.totalDelta}</p></div>
                <div><p className="text-xs text-muted-foreground">Gamma</p><p className="text-lg font-bold font-mono">{stats.totalGamma}</p></div>
                <div><p className="text-xs text-muted-foreground">Theta</p><p className="text-lg font-bold font-mono">{stats.totalTheta}</p></div>
                <div><p className="text-xs text-muted-foreground">Vega</p><p className="text-lg font-bold font-mono">{stats.totalVega}</p></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
