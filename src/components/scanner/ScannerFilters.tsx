import { Search, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BUILDUP_COLOR, BUILDUP_SIGNALS, type BuildupSignal } from "@/lib/futuresUtils";
import { cn } from "@/lib/utils";

export interface ScannerFilterState {
  search: string;
  signals: Set<BuildupSignal>; // empty = show all signals
  minOiChangePercent: number;
  minVolume: number;
  minAbsPriceChangePercent: number;
}

export const DEFAULT_SCANNER_FILTERS: ScannerFilterState = {
  search: "",
  signals: new Set(),
  minOiChangePercent: 0,
  minVolume: 0,
  minAbsPriceChangePercent: 0,
};

interface Props {
  filters: ScannerFilterState;
  onChange: (filters: ScannerFilterState) => void;
}

export function ScannerFilters({ filters, onChange }: Props) {
  const toggleSignal = (signal: BuildupSignal) => {
    const next = new Set(filters.signals);
    if (next.has(signal)) next.delete(signal); else next.add(signal);
    onChange({ ...filters, signals: next });
  };

  const isDefault = filters.search === "" && filters.signals.size === 0
    && filters.minOiChangePercent === 0 && filters.minVolume === 0 && filters.minAbsPriceChangePercent === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Filter symbol..."
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="pl-8 h-8 w-[140px] text-xs"
        />
      </div>

      <div className="flex items-center gap-1">
        {BUILDUP_SIGNALS.filter((s) => s !== "Neutral").map((signal) => {
          const active = filters.signals.has(signal);
          return (
            <button
              key={signal}
              onClick={() => toggleSignal(signal)}
              className={cn(
                "h-8 px-2 rounded text-xs font-medium border transition-colors",
                active ? cn("border-current bg-current/10", BUILDUP_COLOR[signal]) : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {signal}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">Min |OI Chg%|</label>
        <Input
          type="number"
          value={filters.minOiChangePercent || ""}
          onChange={(e) => onChange({ ...filters, minOiChangePercent: Number(e.target.value) || 0 })}
          className="h-8 w-16 text-xs"
          placeholder="0"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <label className="text-xs text-muted-foreground">Min Vol (L)</label>
        <Input
          type="number"
          value={filters.minVolume ? filters.minVolume / 100000 : ""}
          onChange={(e) => onChange({ ...filters, minVolume: (Number(e.target.value) || 0) * 100000 })}
          className="h-8 w-16 text-xs"
          placeholder="0"
        />
      </div>

      {!isDefault && (
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => onChange(DEFAULT_SCANNER_FILTERS)}>
          <RotateCcw className="h-3 w-3" /> Reset
        </Button>
      )}
    </div>
  );
}
