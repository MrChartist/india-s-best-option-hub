import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { generateIVRankData, generateMultiSymbolIVRank, type IVRankData } from "@/lib/gexData";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip, Area, AreaChart, ReferenceLine, Legend } from "recharts";
import { Gauge, TrendingUp, TrendingDown, Info } from "lucide-react";

// Compact IV Rank badge for inline use
export function IVRankBadge({ ivRank, ivPercentile }: { ivRank: number; ivPercentile: number }) {
  const color = ivRank > 50 ? "text-bearish" : ivRank < 20 ? "text-bullish" : "text-warning";
  const bgColor = ivRank > 50 ? "bg-bearish/10 border-bearish/20" : ivRank < 20 ? "bg-bullish/10 border-bullish/20" : "bg-warning/10 border-warning/20";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-[9px] font-mono gap-1 ${bgColor} ${color} cursor-help`}>
          IVR {ivRank}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        <p>IV Rank: {ivRank}% | IV Percentile: {ivPercentile}%</p>
        <p className="text-muted-foreground">{ivRank > 50 ? "IV is elevated — good for selling" : "IV is low — good for buying"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// Compact card widget
export function IVRankCard({ symbol, currentIV }: { symbol: string; currentIV: number }) {
  const data = useMemo(() => generateIVRankData(symbol, currentIV), [symbol, currentIV]);
  const color = data.ivRank > 50 ? "text-bearish" : data.ivRank < 20 ? "text-bullish" : "text-warning";

  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[10px] text-muted-foreground">IV Rank</p>
        </div>
        <p className={`text-lg font-bold font-mono ${color}`}>{data.ivRank}%</p>
        <div className="mt-1.5">
          <div className="relative h-1.5 rounded-full bg-accent overflow-hidden">
            <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-bullish via-warning to-bearish" style={{ width: `${data.ivRank}%` }} />
          </div>
          <div className="flex justify-between text-[8px] text-muted-foreground font-mono mt-0.5">
            <span>{data.iv52Low.toFixed(1)}</span>
            <span>{data.iv52High.toFixed(1)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Full IV Rank dashboard widget
export function IVRankDashboard() {
  const allData = useMemo(() => generateMultiSymbolIVRank(), []);
  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          IV Rank & Percentile Scanner
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="text-xs max-w-[250px]">
              <p><strong>IV Rank</strong>: Where current IV sits in the 52-week range (0=low, 100=high).</p>
              <p className="mt-1"><strong>IV Percentile</strong>: % of trading days IV was below current level.</p>
              <p className="mt-1"><strong>VRP</strong>: Volatility Risk Premium (IV - HV). Positive = sellers have edge.</p>
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {allData.map(d => {
            const rankColor = d.ivRank > 50 ? "text-bearish" : d.ivRank < 20 ? "text-bullish" : "text-warning";
            const vrpColor = d.vrp > 0 ? "text-bullish" : "text-bearish";
            return (
              <div key={d.symbol} className="flex items-center gap-3 p-2 rounded-lg bg-accent/20 hover:bg-accent/40 transition-colors">
                <span className="text-xs font-medium w-20">{d.symbol}</span>

                {/* IV Rank bar */}
                <div className="flex-1 max-w-[120px]">
                  <div className="relative h-2 rounded-full bg-accent overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full ${d.ivRank > 50 ? "bg-bearish/70" : d.ivRank < 20 ? "bg-bullish/70" : "bg-warning/70"}`}
                      style={{ width: `${d.ivRank}%` }}
                    />
                    {/* Current IV marker */}
                    <div className="absolute top-1/2 -translate-y-1/2 w-1 h-3 bg-foreground rounded-full" style={{ left: `${d.ivRank}%` }} />
                  </div>
                </div>

                <span className={`text-xs font-mono font-bold w-12 text-right ${rankColor}`}>{d.ivRank}%</span>
                <span className="text-[10px] text-muted-foreground font-mono w-14 text-right">P:{d.ivPercentile}%</span>
                <span className="text-[10px] font-mono w-14 text-right">{d.currentIV.toFixed(1)}%</span>
                <span className="text-[10px] text-muted-foreground font-mono w-20 text-right">{d.iv52Low.toFixed(1)}-{d.iv52High.toFixed(1)}</span>
                <span className={`text-[10px] font-mono font-medium w-12 text-right ${vrpColor}`}>
                  {d.vrp > 0 ? "+" : ""}{d.vrp.toFixed(1)}
                </span>
                <Badge variant="outline" className={`text-[8px] w-14 justify-center ${d.vrp > 2 ? "border-bullish/30 text-bullish" : d.vrp < -2 ? "border-bearish/30 text-bearish" : "border-muted-foreground/30"}`}>
                  {d.vrp > 2 ? "SELL IV" : d.vrp < -2 ? "BUY IV" : "FAIR"}
                </Badge>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-bullish" />IVR &lt; 20 (Low)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" />IVR 20-50 (Moderate)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-bearish" />IVR &gt; 50 (High)</span>
          <span className="ml-auto">VRP = IV − HV (Positive = Seller's Edge)</span>
        </div>
      </CardContent>
    </Card>
  );
}
