import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sectorData } from "@/lib/mockData";

export function SectorHeatmap() {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm">Sector Performance</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {sectorData.map((sector) => {
            const pos = sector.change >= 0;
            const intensity = Math.min(Math.abs(sector.change) / 3, 1);
            return (
              <div
                key={sector.name}
                className="rounded-lg p-2.5 text-center transition-transform hover:scale-105 cursor-default"
                style={{
                  backgroundColor: pos
                    ? `hsl(var(--bullish) / ${0.08 + intensity * 0.25})`
                    : `hsl(var(--bearish) / ${0.08 + intensity * 0.25})`,
                }}
              >
                <p className="text-xs font-medium">{sector.name}</p>
                <p className={`text-sm font-bold font-mono ${pos ? "text-bullish" : "text-bearish"}`}>
                  {pos ? "+" : ""}{sector.change.toFixed(2)}%
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
