import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { calculateGreeks } from "@/lib/mockData";

export default function GreeksCalculator() {
  const [spot, setSpot] = useState(24250);
  const [strike, setStrike] = useState(24300);
  const [daysToExpiry, setDaysToExpiry] = useState(7);
  const [iv, setIv] = useState(14);
  const [riskFreeRate, setRiskFreeRate] = useState(6.5);

  const greeks = useMemo(() => calculateGreeks(spot, strike, daysToExpiry, iv, riskFreeRate), [spot, strike, daysToExpiry, iv, riskFreeRate]);

  const greekCards = [
    { label: "Delta", call: greeks.delta.call, put: greeks.delta.put, desc: "Rate of change of option price w.r.t. underlying price" },
    { label: "Gamma", call: greeks.gamma, put: greeks.gamma, desc: "Rate of change of delta w.r.t. underlying price" },
    { label: "Theta", call: greeks.theta.call, put: greeks.theta.put, desc: "Time decay per day" },
    { label: "Vega", call: greeks.vega, put: greeks.vega, desc: "Sensitivity to 1% change in IV" },
    { label: "Rho", call: greeks.rho.call, put: greeks.rho.put, desc: "Sensitivity to 1% change in interest rate" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Greeks Calculator</h1>
        <p className="text-sm text-muted-foreground">Black-Scholes Option Pricing Model</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Input Panel */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-sm">Parameters</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs">Spot Price</Label>
              <Input type="number" value={spot} onChange={e => setSpot(Number(e.target.value))} className="font-mono" />
              <Slider value={[spot]} onValueChange={v => setSpot(v[0])} min={20000} max={28000} step={50} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Strike Price</Label>
              <Input type="number" value={strike} onChange={e => setStrike(Number(e.target.value))} className="font-mono" />
              <Slider value={[strike]} onValueChange={v => setStrike(v[0])} min={20000} max={28000} step={50} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Days to Expiry: <span className="font-mono text-foreground">{daysToExpiry}</span></Label>
              <Slider value={[daysToExpiry]} onValueChange={v => setDaysToExpiry(v[0])} min={1} max={90} step={1} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Implied Volatility (%): <span className="font-mono text-foreground">{iv}</span></Label>
              <Slider value={[iv]} onValueChange={v => setIv(v[0])} min={5} max={80} step={0.5} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Risk-Free Rate (%): <span className="font-mono text-foreground">{riskFreeRate}</span></Label>
              <Slider value={[riskFreeRate]} onValueChange={v => setRiskFreeRate(v[0])} min={1} max={15} step={0.1} />
            </div>
          </CardContent>
        </Card>

        {/* Output Panel */}
        <div className="lg:col-span-2 space-y-4">
          {/* Option Prices */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-bullish/30">
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Call Price (CE)</p>
                <p className="text-3xl font-bold font-mono text-bullish">₹{greeks.callPrice.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="border-bearish/30">
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Put Price (PE)</p>
                <p className="text-3xl font-bold font-mono text-bearish">₹{greeks.putPrice.toFixed(2)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Greeks Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {greekCards.map(g => (
              <Card key={g.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground mb-2">{g.label}</p>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-muted-foreground">CE</p>
                      <p className="text-lg font-bold font-mono text-bullish">{typeof g.call === "number" ? g.call.toFixed(4) : g.call}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">PE</p>
                      <p className="text-lg font-bold font-mono text-bearish">{typeof g.put === "number" ? g.put.toFixed(4) : g.put}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">{g.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
