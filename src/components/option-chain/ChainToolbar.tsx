import type { ReactNode } from "react";
import { BarChart3, Crosshair, Download, FileDown, Keyboard, Loader2, RefreshCw, ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ExpiryDate } from "@/lib/mockData";
import { formatDateIST } from "@/lib/options";
import { STRIKE_RANGES, type StrikeRange } from "./chainModel";
import { ColumnPicker } from "./ColumnPicker";
import type { ColumnPrefs } from "./preferences";
import { SymbolSearch } from "./SymbolSearch";

export type ChainViewMode = "expiration" | "strike";

export interface ChainToolbarProps {
  symbol: string;
  onSymbol: (s: string) => void;
  viewMode: ChainViewMode;
  onViewMode: (v: ChainViewMode) => void;
  expiries: ExpiryDate[];
  expiry: string;
  onExpiry: (e: string) => void;
  range: StrikeRange;
  onRange: (r: StrikeRange) => void;
  deltaView: boolean;
  onDeltaView: (v: boolean) => void;
  columnPrefs: ColumnPrefs;
  onColumnPrefs: (p: ColumnPrefs) => void;
  basketCount: number;
  onOpenBasket: () => void;
  onRefresh: () => void;
  isFetching: boolean;
  onCentreATM: () => void;
  showChart: boolean;
  onToggleChart: () => void;
  onDownloadCSV: () => void;
  onDownloadSnapshot: (expiry: string) => void;
  snapshotBusy: string | null;
}

const SHORTCUTS: Array<[string, string]> = [
  ["R", "Refresh the chain"],
  ["J / K or ↓ / ↑", "Move between strikes"],
  ["← / →", "Switch CE / PE side"],
  ["A", "Add the focused CE (buy) to the basket"],
  ["Shift + A", "Add the focused PE (buy)"],
  ["B / S", "Buy / sell the focused side"],
  ["G", "Jump to ATM"],
  ["Esc", "Clear focus"],
];

function IconAction({ label, onClick, children, active, disabled }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("h-8 w-8", active && "bg-accent text-primary-ink")} onClick={onClick} aria-label={label} aria-pressed={active} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ChainToolbar(p: ChainToolbarProps) {
  const pills = p.expiries.slice(0, 6);
  const more = p.expiries.slice(6);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SymbolSearch value={p.symbol} onSelect={p.onSymbol} />
          <ToggleGroup type="single" value={p.viewMode} onValueChange={(v) => v && p.onViewMode(v as ChainViewMode)} className="rounded-tab bg-muted p-0.5" aria-label="View">
            <ToggleGroupItem value="expiration" className="h-7 rounded-[6px] px-3 text-xs data-[state=on]:bg-card data-[state=on]:shadow-card">
              By expiry
            </ToggleGroupItem>
            <ToggleGroupItem value="strike" className="h-7 rounded-[6px] px-3 text-xs data-[state=on]:bg-card data-[state=on]:shadow-card">
              By strike
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex flex-wrap items-center gap-0.5">
          <Button variant={p.basketCount > 0 ? "default" : "outline"} size="pill" onClick={p.onOpenBasket} className="mr-1">
            <ShoppingBasket aria-hidden="true" />
            Basket
            <span className={cn("rounded-capsule px-1.5 text-[10px] font-bold tabular-nums", p.basketCount > 0 ? "bg-primary-foreground/15" : "bg-muted")}>{p.basketCount}</span>
            <span className="sr-only">legs, open basket</span>
          </Button>
          <IconAction label="Refresh (R)" onClick={p.onRefresh}>
            <RefreshCw className={cn(p.isFetching && "animate-spin")} />
          </IconAction>
          <IconAction label="Centre on ATM (G)" onClick={p.onCentreATM}>
            <Crosshair />
          </IconAction>
          <IconAction label="Price chart" onClick={p.onToggleChart} active={p.showChart}>
            <BarChart3 />
          </IconAction>
          <IconAction label="Download this chain (CSV)" onClick={p.onDownloadCSV}>
            <Download />
          </IconAction>
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Download expiry snapshot (CSV)">
                    <FileDown />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent className="text-xs">Download expiry snapshot (CSV)</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-64 p-3" align="end">
              <p className="mb-1 text-label uppercase text-muted-foreground">Download expiry snapshot (CSV)</p>
              <p className="mb-2 text-[11px] text-muted-foreground">Fetches the full chain for one expiry with derived IV, Greeks and probabilities.</p>
              <div className="max-h-64 space-y-0.5 overflow-y-auto">
                {p.expiries.length === 0 && <p className="text-xs text-muted-foreground">No expiries loaded yet.</p>}
                {p.expiries.map((e) => (
                  <button
                    key={e.value}
                    type="button"
                    onClick={() => p.onDownloadSnapshot(e.value)}
                    disabled={p.snapshotBusy !== null}
                    className="flex w-full items-center justify-between rounded-chip px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none disabled:opacity-50"
                  >
                    <span>
                      {formatDateIST(e.value)} <span className="text-muted-foreground">({e.daysToExpiry}d)</span>
                    </span>
                    {p.snapshotBusy === e.value ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <ColumnPicker prefs={p.columnPrefs} onChange={p.onColumnPrefs} />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Keyboard shortcuts">
                <Keyboard />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="end">
              <p className="mb-3 text-label uppercase text-muted-foreground">Keyboard shortcuts</p>
              <dl className="space-y-1.5 text-xs">
                {SHORTCUTS.map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{d}</dt>
                    <dd>
                      <kbd className="rounded-chip border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">{k}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[11px] text-muted-foreground">Click a row to focus it. Arrow keys only move while a row is focused.</p>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {p.viewMode === "expiration" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5" role="radiogroup" aria-label="Expiry">
            {pills.map((e) => {
              const sel = p.expiry === e.value;
              const label = formatDateIST(e.value).replace(/ \d{4}$/, "");
              return (
                <button
                  key={e.value}
                  type="button"
                  role="radio"
                  aria-checked={sel}
                  onClick={() => p.onExpiry(e.value)}
                  className={cn(
                    "flex shrink-0 items-baseline gap-1 rounded-capsule border px-3 py-1 text-xs transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
                    sel ? "border-primary bg-primary font-bold text-primary-foreground shadow-card" : "border-border bg-card hover:border-primary/40 hover:bg-accent",
                  )}
                >
                  <span className="font-semibold">{label}</span>
                  <span className={cn("text-[10px]", sel ? undefined : "text-muted-foreground")}>{e.daysToExpiry}d</span>
                </button>
              );
            })}
            {more.length > 0 && (
              <Select value={more.some((e) => e.value === p.expiry) ? p.expiry : ""} onValueChange={p.onExpiry}>
                <SelectTrigger className="h-7 w-[118px] shrink-0 rounded-capsule text-xs" aria-label="More expiries">
                  <SelectValue placeholder="More…" />
                </SelectTrigger>
                <SelectContent>
                  {more.map((e) => (
                    <SelectItem key={e.value} value={e.value} className="text-xs">
                      {formatDateIST(e.value)} ({e.daysToExpiry}d)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-label uppercase text-muted-foreground">Strikes</span>
              <ToggleGroup type="single" value={String(p.range)} onValueChange={(v) => v && p.onRange(v === "all" ? "all" : (Number(v) as StrikeRange))} className="rounded-tab bg-muted p-0.5" aria-label="Strike range around ATM">
                {STRIKE_RANGES.map((r) => (
                  <ToggleGroupItem key={String(r)} value={String(r)} className="h-6 rounded-[6px] px-2 text-[11px] tabular-nums data-[state=on]:bg-card data-[state=on]:shadow-card">
                    {r === "all" ? "All" : `±${r}`}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch id="delta-view" checked={p.deltaView} onCheckedChange={p.onDeltaView} aria-describedby="delta-view-hint" />
              <Label htmlFor="delta-view" className="cursor-pointer text-xs">Delta view</Label>
              <span id="delta-view-hint" className="sr-only">Highlights the strikes nearest 16 and 30 delta on each side</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
