import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Radio, Loader2, Radar } from "lucide-react";
import { useFuturesScanner, useRolloverData } from "@/hooks/useMarketData";
import { ScannerFilters, DEFAULT_SCANNER_FILTERS, type ScannerFilterState } from "@/components/scanner/ScannerFilters";
import { ScannerTable } from "@/components/scanner/ScannerTable";
import { RolloverTable } from "@/components/scanner/RolloverTable";
import { BUILDUP_COLOR, type BuildupSignal, type FuturesQuoteRow, type RolloverRow } from "@/lib/futuresUtils";

// Stable references so these don't change identity every render while loading
// (a fresh `[]` literal would, defeating the useMemo hooks below).
const EMPTY_ROWS: FuturesQuoteRow[] = [];
const EMPTY_ROLLOVER_ROWS: RolloverRow[] = [];

export default function Scanner() {
  const { data, isLoading } = useFuturesScanner();
  const { data: rolloverData, isLoading: rolloverLoading } = useRolloverData();
  const [filters, setFilters] = useState<ScannerFilterState>(DEFAULT_SCANNER_FILTERS);
  const rolloverRows = rolloverData?.rows ?? EMPTY_ROLLOVER_ROWS;

  const rows = data?.rows ?? EMPTY_ROWS;
  const isLive = data?.isLive ?? false;

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (filters.search && !row.symbol.includes(filters.search.toUpperCase())) return false;
      if (filters.signals.size > 0 && !filters.signals.has(row.buildupSignal)) return false;
      if (filters.minOiChangePercent > 0 && Math.abs(row.oiChangePercent ?? 0) < filters.minOiChangePercent) return false;
      if (filters.minVolume > 0 && (row.volume ?? 0) < filters.minVolume) return false;
      if (filters.minAbsPriceChangePercent > 0 && Math.abs(row.priceChangePercent ?? 0) < filters.minAbsPriceChangePercent) return false;
      return true;
    });
  }, [rows, filters]);

  const signalCounts = useMemo(() => {
    const counts: Record<BuildupSignal, number> = {
      "Long Buildup": 0, "Short Buildup": 0, "Short Covering": 0, "Long Unwinding": 0, "Neutral": 0,
    };
    for (const row of rows) counts[row.buildupSignal]++;
    return counts;
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            Futures <span className="font-serif italic font-medium">Scanner</span>
            {isLive && (
              <Badge variant="outline" className="text-xs h-5 px-1.5 border-bullish/30 text-bullish">
                <Radio className="h-2 w-2 mr-1 animate-pulse" />
                LIVE
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {rows.length > 0 ? `${rows.length} contracts` : "Index & stock futures"} · OI buildup, volume &amp; basis signals · real Dhan data, no simulated values
          </p>
        </div>
      </div>

      <Tabs defaultValue="buildup">
        <TabsList>
          <TabsTrigger value="buildup" className="text-xs">Buildup Scanner</TabsTrigger>
          <TabsTrigger value="rollover" className="text-xs">Rollover Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="buildup" className="space-y-3">
          {/* Signal summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(["Long Buildup", "Short Buildup", "Short Covering", "Long Unwinding"] as BuildupSignal[]).map((signal) => (
              <Card key={signal} className="p-2.5">
                <div className={`text-xs font-medium ${BUILDUP_COLOR[signal]}`}>{signal}</div>
                <div className="text-lg font-mono font-semibold mt-0.5">{signalCounts[signal]}</div>
              </Card>
            ))}
          </div>

          <ScannerFilters filters={filters} onChange={setFilters} />

          <Card>
            <CardContent className="p-0 overflow-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading live futures data...</span>
                </div>
              ) : rows.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No live futures data available — check your Dhan connection in Broker Settings.
                </div>
              ) : (
                <ScannerTable rows={filteredRows} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rollover" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Rollover% = next-month OI ÷ (near-month + next-month OI). Rises through expiry week as positions shift forward — a standard read on how much conviction there is on continuation past expiry.
          </p>
          <Card>
            <CardContent className="p-0 overflow-auto">
              {rolloverLoading ? (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading rollover data...</span>
                </div>
              ) : rolloverRows.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No rollover data available — check your Dhan connection in Broker Settings.
                </div>
              ) : (
                <RolloverTable rows={rolloverRows} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
