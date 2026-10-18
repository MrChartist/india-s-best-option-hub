import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDateIST } from "@/lib/options";
import { DEFAULT_TAPE_FILTERS, MIN_PREMIUM_STEPS, activeFilterCount, type TapeFilters } from "@/lib/flow";

interface FlowFiltersProps {
  value: TapeFilters;
  onChange: (next: TapeFilters) => void;
  symbols: string[];
  expiries: string[];
}

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-label text-muted-foreground" id={`seg-${label}`}>
        {label}
      </p>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        aria-labelledby={`seg-${label}`}
        className="justify-start"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} size="sm">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** Filter bar for the flow tape. */
export function FlowFilters({ value, onChange, symbols, expiries }: FlowFiltersProps) {
  const set = <K extends keyof TapeFilters>(k: K, v: TapeFilters[K]) => onChange({ ...value, [k]: v });
  const active = activeFilterCount(value);
  return (
    <div className="rounded-tile bg-muted/50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="flow-f-symbol" className="text-label text-muted-foreground">
            Underlying
          </Label>
          <Select value={value.symbol} onValueChange={(v) => set("symbol", v)}>
            <SelectTrigger id="flow-f-symbol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All underlyings</SelectItem>
              {symbols.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="flow-f-premium" className="text-label text-muted-foreground">
            Min premium
          </Label>
          <Select value={String(value.minPremium)} onValueChange={(v) => set("minPremium", Number(v))}>
            <SelectTrigger id="flow-f-premium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MIN_PREMIUM_STEPS.map((s) => (
                <SelectItem key={s.value} value={String(s.value)}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="flow-f-expiry" className="text-label text-muted-foreground">
            Expiry
          </Label>
          <Select value={value.expiry} onValueChange={(v) => set("expiry", v)}>
            <SelectTrigger id="flow-f-expiry">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All expiries</SelectItem>
              {expiries.map((e) => (
                <SelectItem key={e} value={e}>
                  {formatDateIST(e)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-2 pb-1">
            <Switch id="flow-f-dte0" checked={value.dte0} onCheckedChange={(c) => set("dte0", c)} />
            <Label htmlFor="flow-f-dte0" className="text-body-sm">
              Expiry today only (0DTE)
            </Label>
          </div>
        </div>
        <Seg
          label="Type"
          value={value.type}
          onChange={(v) => set("type", v)}
          options={[
            { value: "ALL", label: "All" },
            { value: "CE", label: "Calls" },
            { value: "PE", label: "Puts" },
          ]}
        />
        <Seg
          label="Side"
          value={value.side}
          onChange={(v) => set("side", v)}
          options={[
            { value: "ALL", label: "All" },
            { value: "ASK", label: "Ask" },
            { value: "BID", label: "Bid" },
            { value: "MID", label: "Mid" },
          ]}
        />
        <Seg
          label="Moneyness"
          value={value.moneyness}
          onChange={(v) => set("moneyness", v)}
          options={[
            { value: "ALL", label: "All" },
            { value: "ITM", label: "ITM" },
            { value: "ATM", label: "ATM" },
            { value: "OTM", label: "OTM" },
          ]}
        />
        <Seg
          label="OI"
          value={value.tag}
          onChange={(v) => set("tag", v)}
          options={[
            { value: "ALL", label: "All" },
            { value: "OPENING", label: "Opening" },
            { value: "CLOSING", label: "Closing" },
          ]}
        />
      </div>
      {active > 0 ? (
        <div className="hairline-t mt-3 flex items-center justify-between pt-2">
          <p className="text-body-sm text-muted-foreground">
            {active} filter{active === 1 ? "" : "s"} on
          </p>
          <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_TAPE_FILTERS)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
          </Button>
        </div>
      ) : null}
    </div>
  );
}
