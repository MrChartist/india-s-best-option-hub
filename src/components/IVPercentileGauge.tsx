import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart, CartesianGrid } from "recharts";
import { Gauge, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { getATMIV, getIVPercentileFromChain, getIVSkew, calculatePCR } from "@/lib/oiUtils";
import type { OptionData } from "@/lib/mockData";

interface Props {
  chain: OptionData[];
  spotPrice: number;
  symbol: string;
}

export function IVPercentileGauge({ chain, spotPrice, symbol }: Props) {
  // Calculate current ATM IV from live chain
  const atmData = useMemo(() => getATMIV(chain, spotPrice), [chain, spotPrice]);

  // IV percentile from cross-strike IV distribution (live data)
  const ivMetrics = useMemo(() => getIVPercentileFromChain(chain, spotPrice), [chain, spotPrice]);

  // IV Skew data for smile chart
  const ivSkewData = useMemo(() => {
    const skew = getIVSkew(chain);
    // Filter to reasonable range around ATM (±20 strikes)
    const stepSize = chain.length > 1 ? Math.abs(chain[1].strikePrice - chain[0].strikePrice) : 50;
    return skew.filter(d => Math.abs(d.strike - spotPrice) <= stepSize * 20);
  }, [chain, spotPrice]);

  // Current PCR from live chain
  const { pcrOI: currentPCR } = useMemo(() => calculatePCR(chain), [chain]);

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

  if (chain.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Gauge className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">IV & PCR data requires live option chain</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* IV Percentile Gauge + IV Smile Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" /> IV Percentile
              <Badge variant="outline" className="text-[8px] h-4 ml-auto">Cross-Strike</Badge>
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
                <p className="text-[9px] text-muted-foreground">ATM IV</p>
                <p className="text-lg font-bold font-mono">{ivMetrics.atmIV.toFixed(1)}%</p>
              </div>
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <p className="text-[9px] text-muted-foreground">IV Rank</p>
                <p className="text-lg font-bold font-mono">{ivMetrics.rank}%</p>
              </div>
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <p className="text-[9px] text-muted-foreground">Min IV</p>
                <p className="text-sm font-bold font-mono text-bullish">{ivMetrics.min}%</p>
              </div>
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <p className="text-[9px] text-muted-foreground">Max IV</p>
                <p className="text-sm font-bold font-mono text-bearish">{ivMetrics.max}%</p>
              </div>
            </div>

            <div className="p-2 rounded-md bg-accent/30 text-center">
              <p className="text-[9px] text-muted-foreground">Mean IV (All Strikes)</p>
              <p className="text-sm font-bold font-mono">{ivMetrics.mean}%</p>
              <Progress value={ivMetrics.rank} className="mt-1 h-1.5" />
            </div>
          </CardContent>
        </Card>

        {/* IV Smile/Skew Chart (from live chain data) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> {symbol} IV Smile / Skew
              <Badge variant="outline" className="text-[8px] h-4 ml-auto text-bullish border-bullish/30">LIVE</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              {ivSkewData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={ivSkewData}>
                    <defs>
                      <linearGradient id="ivSmileGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={["dataMin - 2", "dataMax + 2"]} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toFixed(1)}%`, ""]} />
                    <ReferenceLine x={Math.round(spotPrice / (chain.length > 1 ? Math.abs(chain[1].strikePrice - chain[0].strikePrice) : 50)) * (chain.length > 1 ? Math.abs(chain[1].strikePrice - chain[0].strikePrice) : 50)} stroke="hsl(var(--primary))" strokeDasharray="3 3" label={{ value: "ATM", fill: "hsl(var(--primary))", fontSize: 9 }} />
                    <Line type="monotone" dataKey="callIV" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} name="Call IV" />
                    <Line type="monotone" dataKey="putIV" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} name="Put IV" />
                    <Area type="monotone" dataKey="avgIV" stroke="hsl(var(--primary))" fill="url(#ivSmileGrad)" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Avg IV" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">No IV data available</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PCR Gauge */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Put-Call Ratio
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
          <div className="relative h-4 rounded-full bg-gradient-to-r from-bearish/30 via-warning/30 to-bullish/30 overflow-hidden">
            <div
              className="absolute top-0 h-full w-1.5 bg-foreground rounded-full shadow-lg transition-all"
              style={{ left: `${Math.min(Math.max((currentPCR / 2) * 100, 2), 98)}%`, transform: "translateX(-50%)" }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground font-mono mt-1">
            <span>0.0 (Strong Bearish)</span>
            <span>0.7</span>
            <span>1.0 (Neutral)</span>
            <span>1.3</span>
            <span>2.0 (Strong Bullish)</span>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-3">
            {currentPCR > 1.2 ? "Put OI dominates — writers expect limited downside. Bullish signal." :
             currentPCR < 0.7 ? "Call OI heavy — writers expect capped upside. Bearish signal." :
             "PCR in neutral zone. No strong directional conviction from OI flows."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
