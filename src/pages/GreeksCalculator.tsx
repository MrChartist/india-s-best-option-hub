import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { calculateGreeks, generateGreeksSensitivity } from "@/lib/mockData";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

export default function GreeksCalculator() {
  const [spot, setSpot] = useState(24250);
  const [strike, setStrike] = useState(24300);
  const [daysToExpiry, setDaysToExpiry] = useState(7);
  const [iv, setIv] = useState(14);
  const [riskFreeRate, setRiskFreeRate] = useState(6.5);
  const [activeChart, setActiveChart] = useState("delta");

  const greeks = useMemo(() => calculateGreeks(spot, strike, daysToExpiry, iv, riskFreeRate), [spot, strike, daysToExpiry, iv, riskFreeRate]);

  // Sensitivity data
  const sensitivityData = useMemo(() => generateGreeksSensitivity(strike, daysToExpiry, iv, riskFreeRate, spot, 800, 20), [strike, daysToExpiry, iv, riskFreeRate, spot]);

  // Multi-DTE comparison
  const multiDTEData = useMemo(() => {
    const dtes = [1, 3, 7, 14, 30];
    return Array.from({ length: 81 }, (_, i) => {
      const s = spot - 800 + i * 20;
      const row: any = { spot: s };
      for (const dte of dtes) {
        const g = calculateGreeks(s, strike, dte, iv, riskFreeRate);
        row[`call_${dte}`] = g.callPrice;
        row[`put_${dte}`] = g.putPrice;
      }
      return row;
    });
  }, [spot, strike, iv, riskFreeRate]);

  const greekCards = [
    { label: "Delta (Δ)", call: greeks.delta.call, put: greeks.delta.put, desc: "Price change per ₹1 move in underlying", emoji: "📐" },
    { label: "Gamma (Γ)", call: greeks.gamma, put: greeks.gamma, desc: "Delta change per ₹1 move in underlying", emoji: "📊" },
    { label: "Theta (Θ)", call: greeks.theta.call, put: greeks.theta.put, desc: "Daily time decay in ₹", emoji: "⏰" },
    { label: "Vega (ν)", call: greeks.vega, put: greeks.vega, desc: "Price change per 1% IV change", emoji: "📈" },
    { label: "Rho (ρ)", call: greeks.rho.call, put: greeks.rho.put, desc: "Price change per 1% rate change", emoji: "🏦" },
  ];

  const moneyness = spot > strike ? "ITM" : spot < strike ? "OTM" : "ATM";
  const intrinsicCE = Math.max(0, spot - strike);
  const intrinsicPE = Math.max(0, strike - spot);
  const timeValueCE = greeks.callPrice - intrinsicCE;
  const timeValuePE = greeks.putPrice - intrinsicPE;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Greeks Calculator</h1>
        <p className="text-sm text-muted-foreground">Black-Scholes Pricing · Sensitivity Analysis · Multi-DTE Comparison</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Input Panel */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Parameters</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label className="text-xs">Spot Price</Label>
                <span className="text-xs font-mono text-muted-foreground">₹{spot.toLocaleString("en-IN")}</span>
              </div>
              <Input type="number" value={spot} onChange={e => setSpot(Number(e.target.value))} className="font-mono h-8 text-xs" />
              <Slider value={[spot]} onValueChange={v => setSpot(v[0])} min={20000} max={28000} step={50} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label className="text-xs">Strike Price</Label>
                <span className="text-xs font-mono text-muted-foreground">₹{strike.toLocaleString("en-IN")}</span>
              </div>
              <Input type="number" value={strike} onChange={e => setStrike(Number(e.target.value))} className="font-mono h-8 text-xs" />
              <Slider value={[strike]} onValueChange={v => setStrike(v[0])} min={20000} max={28000} step={50} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label className="text-xs">Days to Expiry</Label>
                <span className="text-xs font-mono text-foreground font-bold">{daysToExpiry}d</span>
              </div>
              <Slider value={[daysToExpiry]} onValueChange={v => setDaysToExpiry(v[0])} min={1} max={90} step={1} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label className="text-xs">Implied Volatility</Label>
                <span className="text-xs font-mono text-foreground font-bold">{iv}%</span>
              </div>
              <Slider value={[iv]} onValueChange={v => setIv(v[0])} min={5} max={80} step={0.5} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label className="text-xs">Risk-Free Rate</Label>
                <span className="text-xs font-mono text-foreground font-bold">{riskFreeRate}%</span>
              </div>
              <Slider value={[riskFreeRate]} onValueChange={v => setRiskFreeRate(v[0])} min={1} max={15} step={0.1} />
            </div>

            <div className="mt-3 p-3 rounded-md bg-accent/50 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Moneyness (CE)</span>
                <span className="font-mono font-medium">{moneyness}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">CE Intrinsic</span>
                <span className="font-mono">₹{intrinsicCE.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">CE Time Value</span>
                <span className="font-mono">₹{timeValueCE.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">PE Intrinsic</span>
                <span className="font-mono">₹{intrinsicPE.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">PE Time Value</span>
                <span className="font-mono">₹{timeValuePE.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Output Panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Option Prices */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="border-bullish/20 bg-bullish/5">
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">Call Price (CE)</p>
                <p className="text-3xl font-bold font-mono text-bullish">₹{greeks.callPrice.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">Lot value: ₹{(greeks.callPrice * 25).toLocaleString("en-IN")}</p>
              </CardContent>
            </Card>
            <Card className="border-bearish/20 bg-bearish/5">
              <CardContent className="pt-3 pb-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">Put Price (PE)</p>
                <p className="text-3xl font-bold font-mono text-bearish">₹{greeks.putPrice.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">Lot value: ₹{(greeks.putPrice * 25).toLocaleString("en-IN")}</p>
              </CardContent>
            </Card>
          </div>

          {/* Greeks Grid */}
          <div className="grid grid-cols-5 gap-2">
            {greekCards.map(g => (
              <Card key={g.label}>
                <CardContent className="pt-3 pb-3">
                  <p className="text-[10px] text-muted-foreground mb-1">{g.emoji} {g.label}</p>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">CE</span>
                      <span className="font-mono font-bold text-bullish">{typeof g.call === "number" ? g.call.toFixed(4) : g.call}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">PE</span>
                      <span className="font-mono font-bold text-bearish">{typeof g.put === "number" ? g.put.toFixed(4) : g.put}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Sensitivity Charts */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Sensitivity Analysis (vs Spot Price)</CardTitle>
                <Select value={activeChart} onValueChange={setActiveChart}>
                  <SelectTrigger className="w-[120px] h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delta">Delta</SelectItem>
                    <SelectItem value="gamma">Gamma</SelectItem>
                    <SelectItem value="theta">Theta</SelectItem>
                    <SelectItem value="vega">Vega</SelectItem>
                    <SelectItem value="price">Option Price</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activeChart === "price" ? multiDTEData : sensitivityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="spot" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine x={spot} stroke="hsl(210 100% 52%)" strokeDasharray="5 5" />
                    <ReferenceLine x={strike} stroke="hsl(38 92% 50%)" strokeDasharray="3 3" />
                    {activeChart === "delta" && (
                      <>
                        <Line type="monotone" dataKey="callDelta" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} name="CE Delta" />
                        <Line type="monotone" dataKey="putDelta" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} name="PE Delta" />
                      </>
                    )}
                    {activeChart === "gamma" && (
                      <Line type="monotone" dataKey="gamma" stroke="hsl(280 80% 60%)" strokeWidth={2} dot={false} name="Gamma" />
                    )}
                    {activeChart === "theta" && (
                      <>
                        <Line type="monotone" dataKey="callTheta" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} name="CE Theta" />
                        <Line type="monotone" dataKey="putTheta" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} name="PE Theta" />
                      </>
                    )}
                    {activeChart === "vega" && (
                      <Line type="monotone" dataKey="vega" stroke="hsl(200 80% 60%)" strokeWidth={2} dot={false} name="Vega" />
                    )}
                    {activeChart === "price" && (
                      <>
                        <Line type="monotone" dataKey="call_1" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} name="1 DTE" />
                        <Line type="monotone" dataKey="call_7" stroke="hsl(142 71% 45% / 0.7)" strokeWidth={1.5} dot={false} name="7 DTE" strokeDasharray="5 5" />
                        <Line type="monotone" dataKey="call_30" stroke="hsl(142 71% 45% / 0.4)" strokeWidth={1} dot={false} name="30 DTE" strokeDasharray="3 3" />
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
