/**
 * Sector heatmap: NSE sectoral indices when available, otherwise an average of F&O stocks per
 * sector (labelled "Derived"). Shading strength follows the size of the move.
 */
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { useAllIndices, useFnOStocks } from "@/hooks/useMarketData";
import type { FnOStockData } from "@/lib/marketApi";
import { formatNumberIN, formatPct } from "@/lib/options";
import { cn } from "@/lib/utils";
import { ARROW, sourceName, statusFrom } from "./dashboardModel";
import { DataState, DataStatus } from "./DataState";
import { useDensityClasses } from "./density";

interface SectorCell {
  name: string;
  change: number;
  count?: number;
}

function aggregateStocksBySector(stocks: readonly FnOStockData[]): SectorCell[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const s of stocks) {
    const sector = s.sector?.trim();
    if (!sector || sector === "undefined" || !Number.isFinite(s.changePercent)) continue;
    const e = map.get(sector) ?? { total: 0, count: 0 };
    e.total += s.changePercent;
    e.count += 1;
    map.set(sector, e);
  }
  return Array.from(map.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([name, v]) => ({ name, change: Math.round((v.total / v.count) * 100) / 100, count: v.count }))
    .sort((a, b) => b.change - a.change);
}

export function SectorHeatmap() {
  const qc = useQueryClient();
  const d = useDensityClasses();
  const idx = useAllIndices();
  const fno = useFnOStocks();

  const nse = useMemo<SectorCell[]>(() => (idx.data.sectors ?? []).map((s) => ({ name: s.name, change: s.change })).sort((a, b) => b.change - a.change), [idx.data.sectors]);
  const derived = useMemo(() => (nse.length > 0 ? [] : aggregateStocksBySector(fno.data?.allStocks ?? [])), [nse.length, fno.data]);
  const useNse = nse.length > 0;
  const sectors = useNse ? nse : derived;

  const status = useNse
    ? statusFrom({ isLoading: idx.isLoading, hasData: true, source: idx.source, stale: idx.stale, isLive: idx.data.isLive })
    : derived.length > 0
      ? "derived"
      : idx.isLoading || fno.isLoading
        ? "loading"
        : "empty";

  const best = sectors.length ? sectors[0] : null;
  const worst = sectors.length ? sectors[sectors.length - 1] : null;

  return (
    <Card>
      <div className={cn("flex flex-wrap items-center gap-2", d.headPad)}>
        <h3 className="font-display text-lead font-bold">Sectors</h3>
        {best && worst && best.change > 0 && worst.change < 0 ? (
          <p className="text-body-sm text-muted-foreground">
            Best <span className="font-medium text-bullish">{best.name}</span> · Worst <span className="font-medium text-bearish">{worst.name}</span>
          </p>
        ) : null}
        <div className="ml-auto">
          <DataStatus
            status={status}
            lastUpdated={useNse ? idx.asOf : fno.data?.asOf}
            source={useNse ? sourceName(idx.source) : sourceName(fno.data?.source)}
            reason={useNse ? undefined : "Average change of F&O stocks in each sector, not the official sectoral index."}
          />
        </div>
      </div>
      <div className={cn("pt-0", d.pad)}>
        <DataState
          status={status}
          lines={2}
          emptyText="Sector data is not available"
          emptyHint="Sectoral indices load from NSE during market hours."
          onRetry={() => {
            void qc.invalidateQueries({ queryKey: ["nse-all-indices"] });
            void fno.refetch();
          }}
        >
          <ul className={cn("grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6", d.gap === "gap-2" ? "gap-1.5" : "gap-2")} aria-label="Sector change today">
            {sectors.map((s) => {
              const up = s.change >= 0;
              const alpha = 0.06 + Math.min(Math.abs(s.change) / 3, 1) * 0.24;
              return (
                <li
                  key={s.name}
                  className="rounded-tile border border-border/60 p-2 text-center"
                  style={{ backgroundColor: `hsl(var(--${up ? "bullish" : "bearish"}) / ${alpha.toFixed(3)})` }}
                  title={`${s.name}: ${formatPct(s.change, { signed: true })}${s.count ? ` (${s.count} stocks)` : ""}`}
                >
                  <p className="truncate text-body-sm font-medium text-foreground">{s.name}</p>
                  <p className={cn("font-num text-body font-bold tabular-nums", up ? "text-bullish" : "text-bearish")}>
                    <span aria-hidden="true">{ARROW[s.change > 0 ? "up" : s.change < 0 ? "down" : "flat"]} </span>
                    {formatPct(s.change, { signed: true })}
                  </p>
                  {s.count ? <p className="text-micro uppercase text-muted-foreground">{formatNumberIN(s.count)} stocks</p> : null}
                </li>
              );
            })}
          </ul>
        </DataState>
      </div>
    </Card>
  );
}

export default SectorHeatmap;
