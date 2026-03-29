import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAllIndices, useLiveOptionChain, useFnOStocks } from "@/hooks/useMarketData";
import { useWebSocketVix, useWebSocketStatus } from "@/hooks/useWebSocket";
import { TrendingUp, Zap, Activity, BarChart3, Radio, Database } from "lucide-react";

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

  // PCR from live option chain OI only
  const niftyPCR = niftyOC?.isLive && niftyOC.totalCEOI > 0
    ? (niftyOC.totalPEOI / niftyOC.totalCEOI).toFixed(2)
    : null;
  const bnfPCR = bnfOC?.isLive && bnfOC.totalCEOI > 0
    ? (bnfOC.totalPEOI / bnfOC.totalCEOI).toFixed(2)
    : null;
  const pcrIsLive = !!(niftyOC?.isLive);

  // Max Pain from live option chain
  const niftyMaxPain = niftyOC?.isLive ? niftyOC.maxPain : null;
  const bnfMaxPain = bnfOC?.isLive ? bnfOC.maxPain : null;

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
      />
      <MetricCard
        icon={<Activity className="h-3.5 w-3.5" />}
        label="India VIX"
        value={vixValue !== null ? vixValue.toFixed(2) : "—"}
        sub={vixChange !== null ? `${vixChange >= 0 ? "+" : ""}${vixChange.toFixed(2)}%` : undefined}
        subColor={vixChange !== null ? (vixChange < 0 ? "text-bullish" : "text-bearish") : undefined}
        isLive={wsConnected && wsVix !== null}
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
        sub={niftyOC?.isLive ? `Spot: ${niftyOC.spotPrice.toLocaleString("en-IN")}` : undefined}
        isLive={!!niftyMaxPain}
      />
      <MetricCard
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        label="BNF Max Pain"
        value={bnfMaxPain ? bnfMaxPain.toLocaleString("en-IN") : "—"}
        valueColor="text-warning"
        sub={bnfOC?.isLive ? `Spot: ${bnfOC.spotPrice.toLocaleString("en-IN")}` : undefined}
        isLive={!!bnfMaxPain}
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

function MetricCard({ icon, label, value, valueColor, sub, subColor, progress, isLive, badge }: {
  icon: React.ReactNode; label: string; value: string; valueColor?: string;
  sub?: string; subColor?: string; progress?: number; isLive?: boolean; badge?: string | null;
}) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3 px-3">
        <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
          {icon}
          <p className="text-[10px] font-medium">{label}</p>
          {isLive && <Radio className="h-2 w-2 text-bullish animate-pulse ml-auto" />}
          {badge && (
            <span className="text-[7px] font-medium text-primary/50 uppercase ml-auto flex items-center gap-0.5">
              <Database className="h-2 w-2" />{badge}
            </span>
          )}
        </div>
        <p className={`text-base font-bold font-mono ${valueColor || "text-foreground"}`}>{value}</p>
        {progress !== undefined && <Progress value={progress} className="h-1 mt-1.5" />}
        {sub && <p className={`text-[10px] font-mono mt-0.5 ${subColor || "text-muted-foreground"}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}
