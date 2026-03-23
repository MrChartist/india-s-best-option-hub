import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { Clock, Percent } from "lucide-react";
import type { StrategyLeg } from "@/lib/mockData";

interface Props {
  legs: StrategyLeg[];
  spotPrice: number;
  lotSize: number;
  stepSize: number;
  daysToExpiry?: number;
}

// Black-Scholes option pricing for T+X curves
function bs_d1(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return S >= K ? 10 : -10;
  return (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
}

function normCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function bsPrice(S: number, K: number, T: number, r: number, sigma: number, type: "CE" | "PE"): number {
  if (T <= 0) return type === "CE" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const d1 = bs_d1(S, K, T, r, sigma);
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === "CE") return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

export function PayoffMultiDTE({ legs, spotPrice, lotSize, stepSize, daysToExpiry = 7 }: Props) {
  const [ivOverride, setIvOverride] = useState(0); // IV change in %
  const [showT0, setShowT0] = useState(true);
  const [showT3, setShowT3] = useState(true);
  const [showExpiry, setShowExpiry] = useState(true);

  const dteOptions = useMemo(() => {
    const opts = [
      { label: "T+0 (Today)", days: daysToExpiry, key: "t0", color: "hsl(var(--primary))" },
      { label: `T+${Math.min(3, daysToExpiry - 1)} Days`, days: Math.max(1, daysToExpiry - 3), key: "t3", color: "hsl(var(--warning))" },
      { label: "At Expiry", days: 0, key: "expiry", color: "hsl(var(--bearish))" },
    ];
    return opts;
  }, [daysToExpiry]);

  const payoffData = useMemo(() => {
    const center = Math.round(spotPrice / stepSize) * stepSize;
    const range: number[] = [];
    for (let s = center - stepSize * 20; s <= center + stepSize * 20; s += stepSize / 2) {
      range.push(s);
    }

    const r = 0.065; // risk-free rate
    const baseIV = 0.14 + ivOverride / 100; // ~14% base + user override

    return range.map(spot => {
      const row: any = { spot };

      dteOptions.forEach(dte => {
        const T = dte.days / 365;
        let totalPnl = 0;

        for (const leg of legs) {
          const mult = (leg.action === "BUY" ? 1 : -1) * leg.lots * lotSize;
          const currentPrice = bsPrice(spot, leg.strike, T, r, baseIV, leg.type);
          const entryPaid = leg.premium;
          totalPnl += (currentPrice - entryPaid) * mult;
        }

        row[dte.key] = Math.round(totalPnl);
      });

      return row;
    });
  }, [legs, spotPrice, lotSize, stepSize, ivOverride, dteOptions]);

  // Find key stats
  const stats = useMemo(() => {
    const expiryData = payoffData.map(d => d.expiry);
    const maxProfit = Math.max(...expiryData);
    const maxLoss = Math.min(...expiryData);
    const breakevens = payoffData.filter((d, i) => {
      if (i === 0) return false;
      const prev = payoffData[i - 1].expiry;
      return (prev < 0 && d.expiry >= 0) || (prev >= 0 && d.expiry < 0);
    }).map(d => d.spot);

    const t0Data = payoffData.map(d => d.t0);
    const currentPnl = t0Data[Math.floor(t0Data.length / 2)] || 0;

    return { maxProfit, maxLoss, breakevens, currentPnl };
  }, [payoffData]);

  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> Multi-DTE Payoff Curve
          </CardTitle>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-primary rounded" />
              <Label className="text-[10px]">
                <Switch checked={showT0} onCheckedChange={setShowT0} className="mr-1 scale-75" />
                T+0
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-warning rounded" />
              <Label className="text-[10px]">
                <Switch checked={showT3} onCheckedChange={setShowT3} className="mr-1 scale-75" />
                T+3
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-bearish rounded" />
              <Label className="text-[10px]">
                <Switch checked={showExpiry} onCheckedChange={setShowExpiry} className="mr-1 scale-75" />
                Expiry
              </Label>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* IV Override Slider */}
        <div className="flex items-center gap-4 px-2">
          <div className="flex items-center gap-2 shrink-0">
            <Percent className="h-3.5 w-3.5 text-muted-foreground" />
            <Label className="text-[10px] text-muted-foreground whitespace-nowrap">IV Change:</Label>
          </div>
          <Slider
            value={[ivOverride]}
            onValueChange={([v]) => setIvOverride(v)}
            min={-10}
            max={10}
            step={0.5}
            className="flex-1"
          />
          <Badge variant="outline" className={`text-xs font-mono shrink-0 ${ivOverride > 0 ? "text-bearish" : ivOverride < 0 ? "text-bullish" : ""}`}>
            {ivOverride >= 0 ? "+" : ""}{ivOverride}%
          </Badge>
        </div>

        {/* Chart */}
        <div className="h-[380px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={payoffData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
              <XAxis dataKey="spot" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = { t0: "T+0", t3: "T+3", expiry: "Expiry" };
                  return [`₹${value.toLocaleString("en-IN")}`, labels[name] || name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: "10px" }} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
              <ReferenceLine x={spotPrice} stroke="hsl(var(--primary))" strokeDasharray="5 5" label={{ value: "Spot", fill: "hsl(var(--primary))", fontSize: 9 }} />
              {stats.breakevens.map((be, i) => (
                <ReferenceLine key={i} x={be} stroke="hsl(var(--warning))" strokeDasharray="3 3" label={{ value: `BE ${be}`, fill: "hsl(var(--warning))", fontSize: 8 }} />
              ))}
              {showT0 && <Line type="monotone" dataKey="t0" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} name="T+0" />}
              {showT3 && <Line type="monotone" dataKey="t3" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} name="T+3" strokeDasharray="5 5" />}
              {showExpiry && <Line type="monotone" dataKey="expiry" stroke="hsl(var(--bearish))" strokeWidth={1.5} dot={false} name="Expiry" />}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Key Stats */}
        <div className="grid grid-cols-4 gap-2">
          <div className="p-2 rounded-md bg-accent/30 text-center">
            <p className="text-[9px] text-muted-foreground">Current P&L (T+0)</p>
            <p className={`text-sm font-bold font-mono ${stats.currentPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
              ₹{stats.currentPnl.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="p-2 rounded-md bg-bullish/5 text-center">
            <p className="text-[9px] text-muted-foreground">Max Profit</p>
            <p className="text-sm font-bold font-mono text-bullish">₹{stats.maxProfit.toLocaleString("en-IN")}</p>
          </div>
          <div className="p-2 rounded-md bg-bearish/5 text-center">
            <p className="text-[9px] text-muted-foreground">Max Loss</p>
            <p className="text-sm font-bold font-mono text-bearish">₹{stats.maxLoss.toLocaleString("en-IN")}</p>
          </div>
          <div className="p-2 rounded-md bg-accent/30 text-center">
            <p className="text-[9px] text-muted-foreground">Breakevens</p>
            <p className="text-xs font-mono">{stats.breakevens.length > 0 ? stats.breakevens.join(", ") : "—"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
