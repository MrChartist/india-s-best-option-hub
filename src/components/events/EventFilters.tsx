/** Type chips, symbol picker and the F&O / high-impact switches. */
import { useId } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EVENT_KINDS, EVENT_KIND_LABEL, fnoStocks, type EventKind } from "@/lib/events";
import { cn } from "@/lib/utils";
import { EVENT_KIND_STYLE } from "./eventStyle";

const INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
const ALL = "__all__";

export interface EventFiltersValue {
  kinds: EventKind[];
  symbol: string;
  fnoOnly: boolean;
  highOnly: boolean;
}

export interface EventFiltersProps {
  value: EventFiltersValue;
  onChange: (patch: Partial<EventFiltersValue>) => void;
  onReset: () => void;
  /** Event counts per kind in the current view (after the symbol filter). */
  counts: Partial<Record<EventKind, number>>;
  dirty: boolean;
}

export function EventFilters({ value, onChange, onReset, counts, dirty }: EventFiltersProps) {
  const fnoId = useId();
  const highId = useId();
  const stocks = fnoStocks();
  const toggle = (k: EventKind) => {
    const has = value.kinds.includes(k);
    const next = has ? value.kinds.filter((x) => x !== k) : [...value.kinds, k];
    onChange({ kinds: EVENT_KINDS.filter((x) => next.includes(x)) });
  };
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-tile border border-separator bg-card px-3 py-2.5 shadow-card lg:flex-row lg:items-center lg:justify-between" role="group" aria-label="Filter events">
      <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Event types">
        {EVENT_KINDS.map((k) => {
          const on = value.kinds.includes(k);
          const s = EVENT_KIND_STYLE[k];
          const Icon = s.icon;
          return (
            <li key={k}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(k)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-body font-medium transition-colors duration-fast focus-visible:shadow-focus focus-visible:outline-none [@media(pointer:coarse)]:h-9",
                  on ? s.chip : "bg-control-track text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {EVENT_KIND_LABEL[k]}
                <span className="font-num text-body-sm tabular-nums">{counts[k] ?? 0}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Select value={value.symbol || ALL} onValueChange={(v) => onChange({ symbol: v === ALL ? "" : v })}>
          <SelectTrigger className="w-[160px]" aria-label="Symbol">
            <SelectValue placeholder="All symbols" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>All symbols</SelectItem>
            <SelectGroup>
              <SelectLabel>Indices</SelectLabel>
              {INDICES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>F&amp;O stocks</SelectLabel>
              {stocks.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id={fnoId} checked={value.fnoOnly} onCheckedChange={(c) => onChange({ fnoOnly: c })} />
          <Label htmlFor={fnoId} className="text-body">
            F&amp;O stocks only
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={highId} checked={value.highOnly} onCheckedChange={(c) => onChange({ highOnly: c })} />
          <Label htmlFor={highId} className="text-body">
            High impact only
          </Label>
        </div>
        {dirty ? (
          <Button variant="ghost" onClick={onReset}>
            <RotateCcw className="!size-3.5" aria-hidden="true" />
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
