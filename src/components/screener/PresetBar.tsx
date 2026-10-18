import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRESETS, type PresetId, type PresetTone } from "@/lib/screener/presets";
import { cn } from "@/lib/utils";

const DOT: Record<PresetTone, string> = {
  bullish: "bg-bullish",
  bearish: "bg-bearish",
  info: "bg-info",
  warning: "bg-warning",
  neutral: "bg-primary",
};

export interface PresetBarProps {
  active: PresetId | null;
  counts: Record<PresetId, number>;
  onSelect: (id: PresetId | null) => void;
}

const SCOPE =
  "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-body-sm font-medium transition-[background-color,color,box-shadow] duration-fast focus-visible:shadow-focus focus-visible:outline-none [@media(pointer:coarse)]:h-9";
const SCOPE_ON = "bg-control text-foreground shadow-control";
const SCOPE_OFF = "text-foreground/80 hover:bg-control-track hover:text-foreground";

/** One-click presets. Selecting the active preset again clears it. */
export function PresetBar({ active, counts, onSelect }: PresetBarProps) {
  return (
    <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0" role="group" aria-label="Screener presets">
      {/* Finder-style scope bar: the selected scope is a raised segment. */}
      <div className="flex w-max gap-1 sm:w-auto sm:flex-wrap">
        <button
          type="button"
          aria-pressed={active === null}
          onClick={() => onSelect(null)}
          className={cn(
            SCOPE,
            active === null ? SCOPE_ON : SCOPE_OFF,
          )}
        >
          All
        </button>
        {PRESETS.map((p) => {
          const on = active === p.id;
          const n = counts[p.id] ?? 0;
          return (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(on ? null : p.id)}
                  className={cn(
                    SCOPE,
                    on ? SCOPE_ON : SCOPE_OFF,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-capsule", DOT[p.tone])} aria-hidden="true" />
                  {p.label}
                  <span className="font-num text-body-sm font-normal tabular-nums text-muted-foreground">{n}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-body-sm">{p.description}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
