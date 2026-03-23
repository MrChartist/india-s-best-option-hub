import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart, CartesianGrid } from "recharts";
import { Gauge, TrendingUp, TrendingDown, Activity } from "lucide-react";
import type { OptionData } from "@/lib/mockData";

interface Props {
  chain: OptionData[];
  spotPrice: number;
  symbol: string;
}

// Generate simulated historical IV data (in production this would come from a database)
function generateHistoricalIV(currentIV: number): Array<{ date: string; iv: number; pcr: number }> {
  const data: Array<{ date: string; iv: number; pcr: number }> = [];
  const now = new Date();
  for (let i = 252; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    // Simulate IV with mean-reverting noise
    const mean = currentIV * (0.8 + Math.random() * 0.4);
    const noise = (Math.random() - 0.5) * currentIV * 0.3;
    const dayIV = Math.max(5, mean + noise * Math.sin(i * 0.1));
    const dayPCR = 0.6 + Math.random() * 1.0;
    data.push({
      date: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      iv: Math.round(dayIV * 100) / 100,
      pcr: Math.round(dayPCR * 100) / 100,
    });
  }
  // Ensure last point is the actual current IV
  if (data.length > 0) data[data.length - 1].iv = currentIV;
  return data;
}

export function IVPercentileGauge({ chain, spotPrice, symbol }: Props) {
  // Calculate current ATM IV
  const atmData = useMemo(() => {
    if (chain.length === 0) return { atmIV: 0, atmStrike: 0 };
    const sorted = [...chain].sort((a, b) =>
      Math.abs(a.strikePrice - spotPrice) - Math.abs(b.strikePrice - spotPrice)
    );
    const atm = sorted[0];
    const atmIV = (atm.ce.iv + atm.pe.iv) / 2;
    return { atmIV, atmStrike: atm.strikePrice };
  }, [chain, spotPrice]);

  // Historical IV data
  const historicalIV = useMemo(() => generateHistoricalIV(atmData.atmIV), [atmData.atmIV]);

  // Calculate IV percentile and rank
  const ivMetrics = useMemo(() => {
    if (historicalIV.length === 0) return { percentile: 0, rank: 0, min: 0, max: 0, mean: 0 };
    const ivValues = historicalIV.map(d => d.iv);
    const current = atmData.atmIV;
    const sorted = [...ivValues].sort((a, b) => a - b);
    const below = sorted.filter(v => v < current).length;
    const percentile = Math.round((below / sorted.length) * 100);
    const min = Math.min(...ivValues);
    const max = Math.max(...ivValues);
    const mean = ivValues.reduce((s, v) => s + v, 0) / ivValues.length;
    const rank = max > min ? Math.round(((current - min) / (max - min)) * 100) : 50;
    return { percentile, rank, min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100, mean: Math.round(mean * 100) / 100 };
  }, [historicalIV, atmData.atmIV]);

  // PCR trend data (last 30 days from historical)
  const pcrTrend = useMemo(() => historicalIV.slice(-30), [historicalIV]);

  // Current PCR
  const currentPCR = useMemo(() => {
    const totalCE = chain.reduce((s, o) => s + o.ce.oi, 0);
    const totalPE = chain.reduce((s, o) => s + o.pe.oi, 0);
    return totalCE > 0 ? Math.round((totalPE / totalCE) * 100) / 100 : 0;
  }, [chain]);

  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

  const getIVZone = (percentile: number) => {
    if (percentile >= 80) return { label: "Very High", color: "text-bearish", bg: "bg-bearish/10", desc: "IV is elevated — options are expensive. Consider selling strategies." };
    if (percentile >= 60) return { label: "High", color: "text-warning", bg: "bg-warning/10", desc: "IV above average. Neutral-to-sell bias recommended." };
    if (percentile >= 40) return { label: "Normal", color: "text-foreground", bg: "bg-accent/50", desc: "IV in normal range. No directional IV edge." };
    if (percentile >= 20) return { label: "Low", color: "text-primary", bg: "bg-primary/10", desc: "IV below average. Options are cheap — consider buying." };
    return { label: "Very Low", color: "text-bullish", bg: "bg-bullish/10", desc: "IV near historical lows. Strong buying opportunity." };
  };

  const ivZone = getIVZone(ivMetrics.percentile);
  const pcrSignal = currentPCR > 1.2 ? "Bullish" : currentPCR < 0.7 ? "Bearish" : "Neutral";
  const pcrColor = currentPCR > 1.2 ? "text-bullish" : currentPCR < 0.7 ? "text-bearish" : "text-warning";

  return (
    <div className="space-y-4">
      {/* IV Percentile Gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" /> IV Percentile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Gauge visual */}
            <div className="relative">
              <div className="flex justify-between text-[9px] text-muted-foreground font-mono mb-1">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100%</span>
              </div>
              <div className="h-4 rounded-full bg-gradient-to-r from-bullish/30 via-warning/30 to-bearish/30 relative overflow-hidden">
                <div
                  className="absolute top-0 h-full w-1 bg-foreground rounded-full shadow-lg"
                  style={{ left: `${ivMetrics.percentile}%`, transform: "translateX(-50%)" }}
                />
              </div>
              <div className="flex justify-center mt-2">
                <span className={`text-3xl font-bold font-mono ${ivZone.color}`}>{ivMetrics.percentile}%</span>
              </div>
              <div className={`text-center mt-1 px-3 py-1 rounded-md ${ivZone.bg}`}>
                <span className={`text-xs font-semibold ${ivZone.color}`}>{ivZone.label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-2">{ivZone.desc}</p>
            </div>

            {/* IV Stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <p className="text-[9px] text-muted-foreground">Current IV</p>
                <p className="text-lg font-bold font-mono">{atmData.atmIV.toFixed(1)}%</p>
              </div>
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <p className="text-[9px] text-muted-foreground">IV Rank</p>
                <p className="text-lg font-bold font-mono">{ivMetrics.rank}%</p>
              </div>
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <p className="text-[9px] text-muted-foreground">1Y Low</p>
                <p className="text-sm font-bold font-mono text-bullish">{ivMetrics.min}%</p>
              </div>
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <p className="text-[9px] text-muted-foreground">1Y High</p>
                <p className="text-sm font-bold font-mono text-bearish">{ivMetrics.max}%</p>
              </div>
            </div>

            <div className="p-2 rounded-md bg-accent/30 text-center">
              <p className="text-[9px] text-muted-foreground">1Y Mean IV</p>
              <p className="text-sm font-bold font-mono">{ivMetrics.mean}%</p>
              <Progress value={ivMetrics.rank} className="mt-1 h-1.5" />
            </div>
          </CardContent>
        </Card>

        {/* Historical IV Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> {symbol} IV History (1 Year)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historicalIV}>
                  <defs>
                    <linearGradient id="ivGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                  <XAxis dataKey="date" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} interval={30} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={["dataMin - 2", "dataMax + 2"]} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}%`, "IV"]} />
                  <ReferenceLine y={ivMetrics.mean} stroke="hsl(var(--warning))" strokeDasharray="5 5" label={{ value: `Mean ${ivMetrics.mean}%`, fill: "hsl(var(--warning))", fontSize: 9 }} />
                  <ReferenceLine y={atmData.atmIV} stroke="hsl(var(--primary))" strokeDasharray="3 3" label={{ value: `Now ${atmData.atmIV.toFixed(1)}%`, fill: "hsl(var(--primary))", fontSize: 9, position: "right" }} />
                  <Area type="monotone" dataKey="iv" stroke="hsl(var(--primary))" fill="url(#ivGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PCR Trend */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> PCR Trend (30 Days)
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Current PCR:</span>
              <Badge variant="outline" className={`${pcrColor} text-xs font-mono`}>
                {currentPCR.toFixed(2)} ({pcrSignal})
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pcrTrend}>
                <defs>
                  <linearGradient id="pcrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--bullish))" stopOpacity={0.2} />
                    <stop offset="50%" stopColor="hsl(var(--warning))" stopOpacity={0.1} />
                    <stop offset="100%" stopColor="hsl(var(--bearish))" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={[0.4, 1.6]} />
                <Tooltip contentStyle={tooltipStyle} />
                <ReferenceLine y={1.0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ value: "PCR=1", fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <ReferenceLine y={0.7} stroke="hsl(var(--bearish))" strokeDasharray="3 3" opacity={0.5} />
                <ReferenceLine y={1.2} stroke="hsl(var(--bullish))" strokeDasharray="3 3" opacity={0.5} />
                <Area type="monotone" dataKey="pcr" stroke="hsl(var(--warning))" fill="url(#pcrGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
