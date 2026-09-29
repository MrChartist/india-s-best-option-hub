import { useMemo } from "react";
import { Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useChartData } from "@/hooks/useChartData";
import { useAllIndices } from "@/hooks/useMarketData";
import { useWebSocketVix } from "@/hooks/useWebSocket";
import { computeVolRank, volRankLabel } from "@/lib/volatility";
import { cn } from "@/lib/utils";

const TONE = { bullish: "text-bullish", warning: "text-warning", bearish: "text-bearish" } as const;

/**
 * India VIX Rank & Percentile against the last year of actual VIX closes.
 * VIX is the market's 30-day implied vol for NIFTY, so this is the standard IV-rank read for the index.
 * Per-symbol IV history isn't available from free sources, so no per-symbol rank is shown.
 */
export function VixRankCard() {
  const { data: candles, isLoading } = useChartData("INDIAVIX", "1Y");
  const { data: allIndices } = useAllIndices();
  const { vix: wsVix } = useWebSocketVix();
  const current = wsVix?.value ?? allIndices?.vix?.value ?? 0;

  const rank = useMemo(
    () => (candles ? computeVolRank(current, candles.map((c) => c.close)) : null),
    [candles, current],
  );
  const band = rank ? volRankLabel(rank.rank) : null;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Gauge className="h-4 w-4 text-primary" />
          India VIX rank
          {rank && <Badge variant="outline" className="ml-auto text-[11px]">{rank.samples} sessions</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!rank || !band ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {isLoading ? "Loading a year of VIX history…" : "Needs live VIX and 1-year history (start the proxy: npm run dev)"}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted-foreground">IV Rank</p>
                <p className={cn("num font-mono text-4xl font-semibold leading-none", TONE[band.tone])}>{rank.rank}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Percentile</p>
                <p className="num font-mono text-2xl font-semibold leading-none">{rank.percentile}</p>
              </div>
            </div>

            <div>
              <div className="relative h-2 rounded-full bg-gradient-to-r from-bullish via-warning to-bearish opacity-90">
                <span
                  className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow"
                  style={{ left: `${rank.rank}%` }}
                />
              </div>
              <div className="num mt-1.5 flex justify-between font-mono text-xs text-muted-foreground">
                <span>1Y low {rank.low.toFixed(2)}</span>
                <span className="text-foreground">VIX {rank.current.toFixed(2)}</span>
                <span>1Y high {rank.high.toFixed(2)}</span>
              </div>
            </div>

            <p className={cn("text-xs font-medium", TONE[band.tone])}>{band.label}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
