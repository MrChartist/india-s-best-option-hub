import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAllIndices, useLiveOptionChain, useFnOStocks } from "@/hooks/useMarketData";
import { useWebSocketVix, useWebSocketStatus } from "@/hooks/useWebSocket";
import { TrendingUp, Zap, Activity, BarChart3, Radio, Database, Moon, ArrowUp, ArrowDown, Minus } from "lucide-react";

export function KeyMetrics() {
  const { data } = useAllIndices();
  const { vix: wsVix } = useWebSocketVix();
  const wsConnected = useWebSocketStatus();
  const { data: fnoData } = useFnOStocks();

  const { data: niftyOC } = useLiveOptionChain("NIFTY");
  const { data: bnfOC } = useLiveOptionChain("BANKNIFTY");

  // VIX: WebSocket → Polled → null
  const vix = wsVix || data?.vix;
  const vixValue = vix?.value ?? null;
  const vixChange = vix?.changePercent ?? null;

  const advances = data?.advances ?? 0;
  const declines = data?.declines ?? 0;

  const isLiveData = data?.isLive || false;
  const isLiveStocks = fnoData?.isLive || false;

  // PCR from live option chain OI — works with both live AND afterHours cached data
  const hasNiftyOC = niftyOC && (niftyOC.isLive || niftyOC.afterHours);
  const hasBnfOC = bnfOC && (bnfOC.isLive || bnfOC.afterHours);

  const niftyPCRNum = hasNiftyOC && niftyOC.totalCEOI > 0
    ? (niftyOC.totalPEOI / niftyOC.totalCEOI) : null;
  const niftyPCR = niftyPCRNum !== null ? niftyPCRNum.toFixed(2) : null;
  const bnfPCR = hasBnfOC && bnfOC.totalCEOI > 0
    ? (bnfOC.totalPEOI / bnfOC.totalCEOI).toFixed(2)
    : null;
  const pcrIsLive = !!(niftyOC?.isLive);
  const pcrIsAfterHours = !pcrIsLive && !!(niftyOC?.afterHours);

  // Max Pain from live or cached option chain
  const niftyMaxPain = hasNiftyOC ? niftyOC.maxPain : null;
  const bnfMaxPain = hasBnfOC ? bnfOC.maxPain : null;

  // Volume from live stocks only
  const totalFnOVol = isLiveStocks && fnoData?.allStocks?.length
    ? fnoData.allStocks.reduce((sum: number, s: any) => sum + (s.volume || 0), 0) : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      <MetricCard
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        label="Nifty PCR"
        value={niftyPCR || "—"}
        valueColor={niftyPCR ? (Number(niftyPCR) > 1 ? "text-bullish" : "text-bearish") : "text-muted-foreground"}
        sub={bnfPCR ? `BNF: ${bnfPCR}` : undefined}
        isLive={pcrIsLive}
        badge={pcrIsAfterHours ? "CLOSED" : undefined}
        gauge={niftyPCRNum !== null ? { value: niftyPCRNum, min: 0.5, max: 1.5 } : undefined}
      />
      <MetricCard
        icon={<Activity className="h-3.5 w-3.5" />}
        label="India VIX"
        value={vixValue !== null ? vixValue.toFixed(2) : "—"}
        sub={vixChange !== null ? `${vixChange >= 0 ? "+" : ""}${vixChange.toFixed(2)}%` : undefined}
        subColor={vixChange !== null ? (vixChange < 0 ? "text-bullish" : "text-bearish") : undefined}
        isLive={wsConnected && wsVix !== null}
        trendDirection={vixChange !== null ? (vixChange > 0.5 ? "up" : vixChange < -0.5 ? "down" : "flat") : undefined}
      />
      <MetricCard
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        label="Adv / Dec"
        value={advances + declines > 0 ? `${advances} / ${declines}` : "—"}
        valueColor={advances > declines ? "text-bullish" : advances + declines > 0 ? "text-bearish" : "text-muted-foreground"}
        progress={advances + declines > 0 ? (advances / (advances + declines)) * 100 : undefined}
        isLive={isLiveData}
      />
      <MetricCard
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        label="Nifty Max Pain"
        value={niftyMaxPain ? niftyMaxPain.toLocaleString("en-IN") : "—"}
        valueColor="text-warning"
        sub={hasNiftyOC ? `Spot: ${niftyOC.spotPrice.toLocaleString("en-IN")}` : undefined}
        isLive={!!(niftyOC?.isLive && niftyMaxPain)}
        badge={niftyOC?.afterHours && niftyMaxPain ? "CLOSED" : undefined}
      />
      <MetricCard
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        label="BNF Max Pain"
        value={bnfMaxPain ? bnfMaxPain.toLocaleString("en-IN") : "—"}
        valueColor="text-warning"
        sub={hasBnfOC ? `Spot: ${bnfOC.spotPrice.toLocaleString("en-IN")}` : undefined}
        isLive={!!(bnfOC?.isLive && bnfMaxPain)}
        badge={bnfOC?.afterHours && bnfMaxPain ? "CLOSED" : undefined}
      />
      <MetricCard
        icon={<Zap className="h-3.5 w-3.5" />}
        label="F&O Volume"
        value={totalFnOVol !== null ? `${(totalFnOVol / 10000000).toFixed(1)}Cr` : "—"}
        isLive={isLiveStocks}
      />
    </div>
  );
}

// PCR Gauge: a tiny horizontal bar showing PCR position (0.5 bearish → 1.0 neutral → 1.5+ bullish)
function PCRGauge({ value, min, max }: { value: number; min: number; max: number }) {
  const normalized = Math.min(Math.max((value - min) / (max - min), 0), 1) * 100;
  const isBullish = value > 1;
  return (
    <div className="relative h-[4px] bg-muted rounded-full overflow-hidden mt-1.5">
      {/* Neutral marker at center (PCR = 1.0) */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-full bg-muted-foreground/30" />
      <div
        className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ${isBullish ? "bg-bullish/60" : "bg-bearish/60"}`}
        style={{ width: `${normalized}%` }}
      />
      <div
        className={`absolute top-[-1px] h-[6px] w-[6px] rounded-full border border-background transition-all duration-500 ${isBullish ? "bg-bullish" : "bg-bearish"}`}
        style={{ left: `calc(${Math.min(normalized, 96)}% - 3px)` }}
      />
    </div>
  );
}

function MetricCard({ icon, label, value, valueColor, sub, subColor, progress, isLive, badge, gauge, trendDirection }: {
  icon: React.ReactNode; label: string; value: string; valueColor?: string;
  sub?: string; subColor?: string; progress?: number; isLive?: boolean; badge?: string | null;
  gauge?: { value: number; min: number; max: number };
  trendDirection?: "up" | "down" | "flat";
}) {
  return (
    <Card className="transition-all duration-300 hover:shadow-card-hover hover:border-primary/20 relative overflow-hidden group">
      {/* Subtle neon glow effect inside card on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-center gap-2 mb-2 text-muted-foreground">
          {icon}
          <p className="text-xs font-medium uppercase tracking-wider">{label}</p>
          {isLive && <Radio className="h-3 w-3 text-bullish animate-pulse ml-auto" />}
          {badge && (
            <span className={`text-[10px] font-bold tracking-wider uppercase ml-auto flex items-center gap-1 ${badge === "CLOSED" ? "text-amber-500/90" : "text-primary/80"}`}>
              {badge === "CLOSED" ? <Moon className="h-3 w-3" /> : <Database className="h-3 w-3" />}{badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <p className={`text-xl font-bold font-mono tracking-tight ${valueColor || "text-foreground"}`}>{value}</p>
          {/* VIX trend arrow */}
          {trendDirection && (
            <span className={`${trendDirection === "up" ? "text-bearish" : trendDirection === "down" ? "text-bullish" : "text-muted-foreground"}`}>
              {trendDirection === "up" && <ArrowUp className="h-4 w-4" />}
              {trendDirection === "down" && <ArrowDown className="h-4 w-4" />}
              {trendDirection === "flat" && <Minus className="h-4 w-4" />}
            </span>
          )}
        </div>
        {/* PCR Gauge */}
        {gauge && <PCRGauge value={gauge.value} min={gauge.min} max={gauge.max} />}
        {progress !== undefined && <Progress value={progress} className="h-1.5 mt-2.5" />}
        {sub && <p className={`text-xs font-mono mt-1 ${subColor || "text-muted-foreground"}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}
