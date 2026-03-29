import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAllIndices, useFnOStocks } from "@/hooks/useMarketData";
import { BarChart3, Loader2 } from "lucide-react";

// Aggregate TradingView stock data into sectors
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

export function SectorHeatmap() {
  const { data: indexData, isLoading: indexLoading } = useAllIndices();
  const { data: fnoData } = useFnOStocks();
  
  // Primary: NSE sectoral indices
  const nseSectors = indexData?.sectors || [];
  const isLiveNSE = indexData?.isLive && nseSectors.length > 0;
  
  // Fallback: Aggregate sectors from TradingView stock data
  const tvSectors = useMemo(() => {
    if (nseSectors.length > 0) return []; // Don't compute if NSE data available
    const allStocks = fnoData?.allStocks || [];
    return aggregateStocksBySector(allStocks);
  }, [nseSectors, fnoData]);

  const sectors = isLiveNSE ? nseSectors : tvSectors;
  const source = isLiveNSE ? "NSE" : tvSectors.length > 0 ? "TradingView" : "";

  if (sectors.length === 0 && !indexLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <BarChart3 className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Sector data unavailable</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">Loads during market hours from NSE</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" /> Sector Performance
          {source && (
            <Badge variant="outline" className="text-[8px] h-4 px-1 border-bullish/30 text-bullish ml-auto">
              {source}
            </Badge>
          )}
          {indexLoading && <Loader2 className="h-3 w-3 animate-spin ml-auto text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {sectors.map((sector: any) => {
            const pos = sector.change >= 0;
            const intensity = Math.min(Math.abs(sector.change) / 3, 1);
            return (
              <div
                key={sector.name}
                className="rounded-lg p-2.5 text-center transition-all duration-200 hover:scale-105 cursor-default border border-transparent hover:border-border/30"
                style={{
                  backgroundColor: pos
                    ? `hsl(var(--bullish) / ${0.06 + intensity * 0.22})`
                    : `hsl(var(--bearish) / ${0.06 + intensity * 0.22})`,
                }}
              >
                <p className="text-[11px] font-medium truncate">{sector.name}</p>
                <p className={`text-sm font-bold font-mono ${pos ? "text-bullish" : "text-bearish"}`}>
                  {pos ? "+" : ""}{sector.change.toFixed(2)}%
                </p>
                {sector.count && (
                  <p className="text-[8px] text-muted-foreground mt-0.5">{sector.count} stocks</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
