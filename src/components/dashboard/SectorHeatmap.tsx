import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAllIndices, useFnOStocks } from "@/hooks/useMarketData";
import { BarChart3, Loader2 } from "lucide-react";

// Aggregate NSE F&O stock data into sectors
function aggregateStocksBySector(stocks: any[]): { name: string; change: number; count: number }[] {
  const sectorMap = new Map<string, { total: number; count: number }>();
  
  for (const stock of stocks) {
    const sector = stock.sector || "";
    if (!sector || sector === "undefined") continue;
    const entry = sectorMap.get(sector) || { total: 0, count: 0 };
    entry.total += (stock.changePercent || 0);
    entry.count += 1;
    sectorMap.set(sector, entry);
  }

  return Array.from(sectorMap.entries())
    .filter(([, v]) => v.count >= 2) // Only show sectors with 2+ stocks
    .map(([name, v]) => ({
      name: name.length > 15 ? name.slice(0, 13) + "…" : name,
      change: Math.round((v.total / v.count) * 100) / 100,
      count: v.count,
    }))
    .sort((a, b) => b.change - a.change);
}

// Shimmer skeleton tiles
function ShimmerTiles() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg p-2.5 text-center skeleton-shimmer bg-muted/20"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="h-3 w-16 bg-muted/40 rounded mx-auto mb-1.5" />
          <div className="h-4 w-12 bg-muted/40 rounded mx-auto mb-1" />
          <div className="h-2 w-10 bg-muted/30 rounded mx-auto" />
        </div>
      ))}
    </div>
  );
}

export function SectorHeatmap() {
  const { data: indexData, isLoading: indexLoading } = useAllIndices();
  const { data: fnoData } = useFnOStocks();
  
  // Primary: NSE sectoral indices (memoized to keep stable reference)
  const nseSectors = useMemo(() => indexData?.sectors ?? [], [indexData]);
  const isLiveNSE = indexData?.isLive && nseSectors.length > 0;

  // Fallback: Aggregate sectors from NSE F&O stock data
  const aggregatedSectors = useMemo(() => {
    if (nseSectors.length > 0) return []; // Don't compute if NSE index sectors are available
    const allStocks = fnoData?.allStocks ?? [];
    return aggregateStocksBySector(allStocks);
  }, [nseSectors, fnoData]);

  const sectors = isLiveNSE ? nseSectors : aggregatedSectors;
  // Label the two data paths differently: nseSectors are the official NSE
  // sectoral index values, while aggregatedSectors is a client-side average
  // of individual F&O stock changes grouped by sector — a reasonable fallback,
  // but not the same figure, and badging both "NSE" misrepresented the source.
  const source = isLiveNSE ? "NSE" : aggregatedSectors.length > 0 ? "F&O Agg" : "";

  if (sectors.length === 0 && !indexLoading) {
    return (
      <Card className="hover:shadow-card-hover transition-all duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" /> Sector Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ShimmerTiles />
          <p className="text-center text-xs text-muted-foreground/60 mt-3">Sector data loads during market hours from NSE</p>
        </CardContent>
      </Card>
    );
  }

  // Calculate best and worst for highlighting
  const bestChange = sectors.length > 0 ? Math.max(...sectors.map((s: any) => s.change)) : 0;
  const worstChange = sectors.length > 0 ? Math.min(...sectors.map((s: any) => s.change)) : 0;

  return (
    <Card className="hover:shadow-card-hover transition-all duration-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" /> Sector Performance
          {source && (
            <Badge variant="outline" className="text-xs h-5 px-2 border-bullish/30 text-bullish ml-auto">
              {source}
            </Badge>
          )}
          {indexLoading && <Loader2 className="h-4 w-4 animate-spin ml-auto text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {sectors.map((sector: any) => {
            const pos = sector.change >= 0;
            const intensity = Math.min(Math.abs(sector.change) / 3, 1);
            const isBest = sector.change === bestChange && bestChange > 0;
            const isWorst = sector.change === worstChange && worstChange < 0;
            return (
              <div
                key={sector.name}
                className={`rounded-lg p-2.5 text-center transition-colors duration-200 cursor-default border ${
                  isBest ? "border-bullish/30" :
                  isWorst ? "border-bearish/30" :
                  "border-transparent hover:border-border/30"
                }`}
                style={{
                  backgroundColor: pos
                    ? `hsl(var(--bullish) / ${0.06 + intensity * 0.22})`
                    : `hsl(var(--bearish) / ${0.06 + intensity * 0.22})`,
                }}
                title={`${sector.name}: ${pos ? "+" : ""}${sector.change.toFixed(2)}% (${sector.count} stocks)`}
              >
                <p className="text-xs font-semibold truncate mb-1 text-foreground/90">{sector.name}</p>
                <p className={`text-base font-semibold font-mono tracking-tight ${pos ? "text-bullish" : "text-bearish"}`}>
                  {pos ? "+" : ""}{sector.change.toFixed(2)}%
                </p>
                {sector.count && (
                  <p className="text-xs font-medium text-muted-foreground mt-1">{sector.count} stocks</p>
                )}
                {/* Best/Worst label */}
                {(isBest || isWorst) && (
                  <span className={`text-xs font-semibold uppercase tracking-wider mt-1 inline-block ${isBest ? "text-bullish" : "text-bearish"}`}>
                    {isBest ? "★ BEST" : "★ WORST"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
