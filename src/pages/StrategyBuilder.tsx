import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Plus, Trash2, TrendingUp, TrendingDown, Minus, Zap, Shield, Target } from "lucide-react";
import { getPresetStrategies, calculatePayoff, calculateGreeks, estimateMargin, estimateProbOfProfit, type StrategyLeg } from "@/lib/mockData";

const outlookIcons = {
  Bullish: <TrendingUp className="h-3 w-3 text-bullish" />,
  Bearish: <TrendingDown className="h-3 w-3 text-bearish" />,
  Neutral: <Minus className="h-3 w-3 text-warning" />,
  Volatile: <Zap className="h-3 w-3 text-primary" />,
};

const riskColors = {
  Low: "text-bullish",
  Medium: "text-warning",
  High: "text-bearish",
  Unlimited: "text-bearish",
};

export default function StrategyBuilder() {
  const [searchParams] = useSearchParams();
  const spotPrice = 24250.75;
  const lotSize = 25;
  const stepSize = 50;

  const presets = useMemo(() => getPresetStrategies(spotPrice, stepSize), []);
  const [legs, setLegs] = useState<StrategyLeg[]>(presets[0].legs);
  const [selectedPreset, setSelectedPreset] = useState(presets[0].name);
  const selectedStrategy = presets.find(p => p.name === selectedPreset);

  // Quick trade from option chain
  useEffect(() => {
    const strike = searchParams.get("strike");
    const type = searchParams.get("type") as "CE" | "PE" | null;
    const action = searchParams.get("action") as "BUY" | "SELL" | null;
    if (strike && type && action) {
      const s = Number(strike);
      const atm = Math.round(spotPrice / stepSize) * stepSize;
      const distFromATM = Math.abs(s - atm) / stepSize;
      const premium = Math.max(5, 150 * Math.exp(-distFromATM * 0.2));
      setLegs([{ type, action, strike: s, lots: 1, premium: Math.round(premium * 100) / 100 }]);
      setSelectedPreset("");
    }
  }, [searchParams]);

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

  const payoffData = useMemo(() => {
    const range: number[] = [];
    const center = Math.round(spotPrice / stepSize) * stepSize;
    for (let s = center - stepSize * 25; s <= center + stepSize * 25; s += stepSize / 2) range.push(s);
    return calculatePayoff(legs, lotSize, range);
  }, [legs]);

  const stats = useMemo(() => {
    const maxProfit = Math.max(...payoffData.map(d => d.pnl));
    const maxLoss = Math.min(...payoffData.map(d => d.pnl));
    const breakevens = payoffData.filter((d, i) => {
      if (i === 0) return false;
      return (payoffData[i - 1].pnl < 0 && d.pnl >= 0) || (payoffData[i - 1].pnl >= 0 && d.pnl < 0);
    }).map(d => d.spot);

    const netPremium = legs.reduce((s, l) => s + (l.action === "BUY" ? -1 : 1) * l.premium * l.lots * lotSize, 0);
    const margin = estimateMargin(legs, lotSize, spotPrice);
    const probOfProfit = estimateProbOfProfit(legs, lotSize, spotPrice, 14, 7);

    let totalDelta = 0, totalGamma = 0, totalTheta = 0, totalVega = 0;
    for (const leg of legs) {
      const g = calculateGreeks(spotPrice, leg.strike, 7, 14, 6.5);
      const mult = (leg.action === "BUY" ? 1 : -1) * leg.lots * lotSize;
      totalDelta += (leg.type === "CE" ? g.delta.call : g.delta.put) * mult;
      totalTheta += (leg.type === "CE" ? g.theta.call : g.theta.put) * mult;
      totalGamma += g.gamma * Math.abs(mult);
      totalVega += g.vega * Math.abs(mult);
    }

    const riskReward = maxLoss !== 0 ? Math.abs(maxProfit / maxLoss) : Infinity;

    return {
      maxProfit, maxLoss, breakevens, netPremium, margin, probOfProfit,
      riskReward: riskReward === Infinity ? "∞" : riskReward.toFixed(2),
      totalDelta: Math.round(totalDelta * 100) / 100,
      totalGamma: Math.round(totalGamma * 100) / 100,
      totalTheta: Math.round(totalTheta * 100) / 100,
      totalVega: Math.round(totalVega * 100) / 100,
    };
  }, [legs, payoffData]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Strategy Builder</h1>
        <p className="text-sm text-muted-foreground">Build multi-leg strategies · Payoff analysis · Risk metrics</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Legs Config */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Strategy</CardTitle>
              <Select value={selectedPreset} onValueChange={handlePreset}>
                <SelectTrigger className="w-[140px] h-7 text-[10px]"><SelectValue placeholder="Preset..." /></SelectTrigger>
                <SelectContent>
                  {presets.map(p => (
                    <SelectItem key={p.name} value={p.name}>
                      <div className="flex items-center gap-1.5">
                        {outlookIcons[p.outlook]}
                        <span>{p.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedStrategy && (
              <CardDescription className="text-[10px] mt-1.5 leading-relaxed">
                <div className="flex gap-1.5 mb-1">
                  <Badge variant="outline" className="text-[9px] gap-1 h-4">
                    {outlookIcons[selectedStrategy.outlook]} {selectedStrategy.outlook}
                  </Badge>
                  <Badge variant="outline" className={`text-[9px] h-4 ${riskColors[selectedStrategy.riskLevel]}`}>
                    <Shield className="h-2.5 w-2.5" /> {selectedStrategy.riskLevel} Risk
                  </Badge>
                </div>
                {selectedStrategy.description}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-2.5">
            {legs.map((leg, i) => (
              <div key={i} className="p-2.5 rounded-md bg-accent/50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    <Badge variant={leg.action === "BUY" ? "default" : "destructive"} className="text-[9px] h-4 px-1.5">{leg.action}</Badge>
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5">{leg.type}</Badge>
                    <span className="text-[9px] text-muted-foreground">×{leg.lots}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeLeg(i)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Select value={leg.action} onValueChange={v => updateLeg(i, "action", v)}>
                    <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="BUY">BUY</SelectItem><SelectItem value="SELL">SELL</SelectItem></SelectContent>
                  </Select>
                  <Select value={leg.type} onValueChange={v => updateLeg(i, "type", v)}>
                    <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="CE">CE</SelectItem><SelectItem value="PE">PE</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div><Label className="text-[9px]">Strike</Label><Input type="number" value={leg.strike} onChange={e => updateLeg(i, "strike", Number(e.target.value))} className="h-6 text-[10px] font-mono" /></div>
                  <div><Label className="text-[9px]">Lots</Label><Input type="number" value={leg.lots} onChange={e => updateLeg(i, "lots", Number(e.target.value))} className="h-6 text-[10px] font-mono" min={1} /></div>
                  <div><Label className="text-[9px]">₹ Prem</Label><Input type="number" value={leg.premium} onChange={e => updateLeg(i, "premium", Number(e.target.value))} className="h-6 text-[10px] font-mono" /></div>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addLeg} className="w-full h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" /> Add Leg
            </Button>
          </CardContent>
        </Card>

        {/* Payoff Chart & Stats */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Payoff at Expiry</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={payoffData}>
                    <defs>
                      <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="lossGrad" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stopColor="hsl(0 84% 60%)" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="spot" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)", borderRadius: "8px", fontSize: "11px" }}
                      formatter={(value: number) => [`₹${value.toLocaleString("en-IN")}`, "P&L"]}
                    />
                    <ReferenceLine y={0} stroke="hsl(215 15% 40%)" strokeWidth={1} />
                    <ReferenceLine x={spotPrice} stroke="hsl(210 100% 52%)" strokeDasharray="5 5" label={{ value: "Spot", fill: "hsl(210 100% 52%)", fontSize: 9 }} />
                    {stats.breakevens.map((be, i) => (
                      <ReferenceLine key={i} x={be} stroke="hsl(38 92% 50%)" strokeDasharray="3 3" label={{ value: `BE: ${be}`, fill: "hsl(38 92% 50%)", fontSize: 8 }} />
                    ))}
                    <Area type="monotone" dataKey="pnl" stroke="hsl(210 100% 52%)" fill="url(#profitGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Key Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Card className="bg-bullish/5 border-bullish/20"><CardContent className="pt-2.5 pb-2.5">
              <p className="text-[9px] text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Max Profit</p>
              <p className="text-base font-bold font-mono text-bullish">₹{stats.maxProfit.toLocaleString("en-IN")}</p>
            </CardContent></Card>
            <Card className="bg-bearish/5 border-bearish/20"><CardContent className="pt-2.5 pb-2.5">
              <p className="text-[9px] text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Max Loss</p>
              <p className="text-base font-bold font-mono text-bearish">₹{stats.maxLoss.toLocaleString("en-IN")}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-2.5 pb-2.5">
              <p className="text-[9px] text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" /> Risk:Reward</p>
              <p className="text-base font-bold font-mono">{stats.riskReward}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-2.5 pb-2.5">
              <p className="text-[9px] text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" /> Prob. of Profit</p>
              <p className={`text-base font-bold font-mono ${stats.probOfProfit > 50 ? "text-bullish" : "text-bearish"}`}>{stats.probOfProfit}%</p>
            </CardContent></Card>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Card><CardContent className="pt-2.5 pb-2.5">
              <p className="text-[9px] text-muted-foreground">Net Premium</p>
              <p className={`text-sm font-bold font-mono ${stats.netPremium >= 0 ? "text-bullish" : "text-bearish"}`}>
                {stats.netPremium >= 0 ? "Credit" : "Debit"} ₹{Math.abs(stats.netPremium).toLocaleString("en-IN")}
              </p>
            </CardContent></Card>
            <Card><CardContent className="pt-2.5 pb-2.5">
              <p className="text-[9px] text-muted-foreground">Est. Margin</p>
              <p className="text-sm font-bold font-mono">₹{stats.margin.toLocaleString("en-IN")}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-2.5 pb-2.5">
              <p className="text-[9px] text-muted-foreground">Breakevens</p>
              <p className="text-xs font-mono">{stats.breakevens.length > 0 ? stats.breakevens.map(b => b.toLocaleString("en-IN")).join(", ") : "None"}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-2.5 pb-2.5">
              <p className="text-[9px] text-muted-foreground">Lot Size</p>
              <p className="text-sm font-bold font-mono">{lotSize} × {legs.reduce((s, l) => s + l.lots, 0)} lots</p>
            </CardContent></Card>
          </div>

          {/* Combined Greeks */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Combined Position Greeks</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center p-2 rounded-md bg-accent/30">
                  <p className="text-[10px] text-muted-foreground">Delta (Δ)</p>
                  <p className={`text-lg font-bold font-mono ${stats.totalDelta >= 0 ? "text-bullish" : "text-bearish"}`}>{stats.totalDelta}</p>
                  <p className="text-[9px] text-muted-foreground">{stats.totalDelta >= 0 ? "Net Long" : "Net Short"}</p>
                </div>
                <div className="text-center p-2 rounded-md bg-accent/30">
                  <p className="text-[10px] text-muted-foreground">Gamma (Γ)</p>
                  <p className="text-lg font-bold font-mono">{stats.totalGamma}</p>
                  <p className="text-[9px] text-muted-foreground">{stats.totalGamma > 0 ? "Long Gamma" : "Short Gamma"}</p>
                </div>
                <div className="text-center p-2 rounded-md bg-accent/30">
                  <p className="text-[10px] text-muted-foreground">Theta (Θ)</p>
                  <p className={`text-lg font-bold font-mono ${stats.totalTheta >= 0 ? "text-bullish" : "text-bearish"}`}>{stats.totalTheta}</p>
                  <p className="text-[9px] text-muted-foreground">₹/day</p>
                </div>
                <div className="text-center p-2 rounded-md bg-accent/30">
                  <p className="text-[10px] text-muted-foreground">Vega (ν)</p>
                  <p className="text-lg font-bold font-mono">{stats.totalVega}</p>
                  <p className="text-[9px] text-muted-foreground">per 1% IV</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
