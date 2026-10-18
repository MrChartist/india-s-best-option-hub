import type { ReactNode } from "react";
import { BarChart3, Crosshair, Download, FileDown, Keyboard, Loader2, PanelRight, RefreshCw, ShoppingBasket } from "lucide-react";
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
  /** Strike inspector (wide screens only). Omit both to hide the toggle. */
  showInspector?: boolean;
  onToggleInspector?: () => void;
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

/** Borderless toolbar item (macOS): no bezel until hovered, a grey well while pressed in. */
function IconAction({ label, onClick, children, active, disabled, className }: { label: string; onClick: () => void; children: ReactNode; active?: boolean; disabled?: boolean; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className={cn(active && "bg-control-track text-primary-ink", className)} onClick={onClick} aria-label={label} aria-pressed={active} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Hairline divider between toolbar item groups. */
function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-separator-strong sm:block" />;
}

export function ChainToolbar(p: ChainToolbarProps) {
  const pills = p.expiries.slice(0, 6);
  const more = p.expiries.slice(6);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SymbolSearch value={p.symbol} onSelect={p.onSymbol} />
          <ToggleGroup type="single" value={p.viewMode} onValueChange={(v) => v && p.onViewMode(v as ChainViewMode)} aria-label="View">
            <ToggleGroupItem value="expiration">By expiry</ToggleGroupItem>
            <ToggleGroupItem value="strike">By strike</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex flex-wrap items-center gap-0.5">
          <IconAction label="Refresh (R)" onClick={p.onRefresh}>
            <RefreshCw className={cn(p.isFetching && "animate-spin")} />
          </IconAction>
          <IconAction label="Centre on ATM (G)" onClick={p.onCentreATM}>
            <Crosshair />
          </IconAction>
          <IconAction label="Price chart" onClick={p.onToggleChart} active={p.showChart}>
            <BarChart3 />
          </IconAction>
          <ToolbarDivider />
          <IconAction label="Download this chain (CSV)" onClick={p.onDownloadCSV}>
            <Download />
          </IconAction>
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Download expiry snapshot (CSV)">
                    <FileDown />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Download expiry snapshot (CSV)</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-64 p-1.5" align="end">
              <p className="px-2 pb-0.5 pt-1 text-label text-muted-foreground">Download expiry snapshot (CSV)</p>
              <p className="px-2 pb-1.5 text-body-sm text-muted-foreground">The full chain for one expiry, with derived IV, Greeks and probabilities.</p>
              <div className="max-h-64 overflow-y-auto">
                {p.expiries.length === 0 && <p className="px-2 py-1 text-body-sm text-muted-foreground">No expiries loaded yet.</p>}
                {p.expiries.map((e) => (
                  <button
                    key={e.value}
                    type="button"
                    onClick={() => p.onDownloadSnapshot(e.value)}
                    disabled={p.snapshotBusy !== null}
                    className="flex h-7 w-full items-center justify-between rounded-[5px] px-2 text-left text-body transition-colors duration-fast hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:outline-none disabled:opacity-50"
                  >
                    <span className="tabular-nums">
                      {formatDateIST(e.value)} <span className="opacity-70">({e.daysToExpiry}d)</span>
                    </span>
                    {p.snapshotBusy === e.value ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 opacity-60" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <ColumnPicker prefs={p.columnPrefs} onChange={p.onColumnPrefs} />
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts">
                    <Keyboard />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Keyboard shortcuts</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-72 p-3" align="end">
              <p className="mb-2 text-label text-muted-foreground">Keyboard shortcuts</p>
              <dl className="space-y-1 text-body-sm">
                {SHORTCUTS.map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <dt className="text-foreground/85">{d}</dt>
                    <dd>
                      <kbd className="rounded-chip bg-control-track px-1.5 py-0.5 font-sans text-micro tabular-nums text-muted-foreground">{k}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2.5 text-body-sm text-muted-foreground">Click a row to focus it. Arrow keys only move while a row is focused.</p>
            </PopoverContent>
          </Popover>
          {p.onToggleInspector && p.viewMode === "expiration" ? (
            <IconAction label="Strike inspector" onClick={p.onToggleInspector} active={p.showInspector} className="hidden lg:inline-flex">
              <PanelRight />
            </IconAction>
          ) : null}
          <ToolbarDivider />
          <Button variant={p.basketCount > 0 ? "default" : "outline"} onClick={p.onOpenBasket} className="ml-1">
            <ShoppingBasket aria-hidden="true" />
            Basket
            <span className={cn("min-w-[18px] rounded-capsule px-1.5 text-center text-micro font-semibold tabular-nums", p.basketCount > 0 ? "bg-primary-foreground/15" : "bg-control-track text-muted-foreground")}>{p.basketCount}</span>
            <span className="sr-only">legs, open basket</span>
          </Button>
        </div>
      </div>

      {p.viewMode === "expiration" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <div className="flex min-w-0 items-center gap-px overflow-x-auto rounded-pill bg-control-track p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="radiogroup" aria-label="Expiry">
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
                      "flex h-6 shrink-0 items-baseline gap-1 whitespace-nowrap rounded-[5px] px-2.5 pt-[3px] text-body font-medium transition-[background-color,color,box-shadow] duration-base ease-spring focus-visible:shadow-focus focus-visible:outline-none",
                      sel ? "bg-control text-foreground shadow-control" : "text-foreground/80 hover:text-foreground",
                    )}
                  >
                    <span>{label}</span>
                    <span className="text-micro tabular-nums text-muted-foreground">{e.daysToExpiry}d</span>
                  </button>
                );
              })}
            </div>
            {more.length > 0 && (
              <Select value={more.some((e) => e.value === p.expiry) ? p.expiry : ""} onValueChange={p.onExpiry}>
                <SelectTrigger className="w-[124px] shrink-0" aria-label="More expiries">
                  <SelectValue placeholder="More…" />
                </SelectTrigger>
                <SelectContent>
                  {more.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {formatDateIST(e.value)} ({e.daysToExpiry}d)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-body text-muted-foreground">Strikes</span>
              <ToggleGroup type="single" value={String(p.range)} onValueChange={(v) => v && p.onRange(v === "all" ? "all" : (Number(v) as StrikeRange))} aria-label="Strike range around ATM">
                {STRIKE_RANGES.map((r) => (
                  <ToggleGroupItem key={String(r)} value={String(r)} size="sm" className="tabular-nums">
                    {r === "all" ? "All" : `±${r}`}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="delta-view" checked={p.deltaView} onCheckedChange={p.onDeltaView} aria-describedby="delta-view-hint" />
              <Label htmlFor="delta-view" className="cursor-pointer text-body font-normal">Delta view</Label>
              <span id="delta-view-hint" className="sr-only">Highlights the strikes nearest 16 and 30 delta on each side</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
