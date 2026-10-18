import { Columns3, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { columnDefs, type ColumnGroup } from "./columns";
import { PRESETS, matchPreset, normaliseColumns, presetColumns, type ColumnId, type ColumnPrefs, type PresetId } from "./preferences";

export interface ColumnPickerProps {
  prefs: ColumnPrefs;
  onChange: (p: ColumnPrefs) => void;
}

const GROUPS: ColumnGroup[] = ["OI & volume", "Price", "Greeks", "Probability", "Liquidity"];

export function ColumnPicker({ prefs, onChange }: ColumnPickerProps) {
  const toggle = (id: ColumnId, on: boolean) => {
    const next = normaliseColumns(on ? [...prefs.visible, id] : prefs.visible.filter((x) => x !== id));
    if (next.length === 0) return; // keep at least one column
    onChange({ preset: matchPreset(next), visible: next });
  };
  const applyPreset = (p: Exclude<PresetId, "custom">) => onChange({ preset: p, visible: presetColumns(p) });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="px-2">
          <Columns3 aria-hidden="true" />
          <span className="sr-only">Columns:</span>
          <span className="hidden sm:inline">{prefs.preset === "custom" ? "Custom" : PRESETS[prefs.preset].label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <div className="hairline-b p-3">
          <p className="mb-1.5 text-label text-muted-foreground">Presets</p>
          <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Column presets">
            {(Object.keys(PRESETS) as Array<Exclude<PresetId, "custom">>).map((p) => {
              const active = prefs.preset === p;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => applyPreset(p)}
                  title={PRESETS[p].description}
                  className={cn(
                    "flex h-7 items-center justify-between gap-1 rounded-pill px-2 text-left text-body transition-[background-color,box-shadow] duration-fast focus-visible:shadow-focus focus-visible:outline-none",
                    active ? "bg-control font-medium text-foreground shadow-control" : "text-foreground/85 hover:bg-control-track",
                  )}
                >
                  <span className="truncate">{PRESETS[p].label}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary-ink" />}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-body-sm text-muted-foreground">Saved on this device. Columns mirror on the put side.</p>
        </div>
        <div className="max-h-[320px] space-y-3 overflow-y-auto p-3">
          {GROUPS.map((g) => (
            <fieldset key={g}>
              <legend className="mb-1 text-label text-muted-foreground">{g}</legend>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {columnDefs.filter((c) => c.group === g).map((c) => {
                  const checked = prefs.visible.includes(c.id);
                  const inputId = `col-${c.id}`;
                  return (
                    <label key={c.id} htmlFor={inputId} className="flex h-6 cursor-pointer items-center gap-2 rounded-chip px-1 text-body hover:bg-control-track" title={c.description}>
                      <Checkbox id={inputId} checked={checked} onCheckedChange={(v) => toggle(c.id, v === true)} />
                      <span className="truncate">{c.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
