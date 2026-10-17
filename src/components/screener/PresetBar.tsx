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

/** One-click presets. Selecting the active preset again clears it. */
export function PresetBar({ active, counts, onSelect }: PresetBarProps) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Screener presets">
      <div className="flex w-max gap-1.5 sm:w-auto sm:flex-wrap">
        <button
          type="button"
          aria-pressed={active === null}
          onClick={() => onSelect(null)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-body-sm font-medium transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
            active === null ? "border-primary/50 bg-wash-brand text-primary-ink" : "border-border bg-card text-foreground hover:bg-accent",
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
                    "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 text-body-sm font-medium transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
                    on ? "border-primary/50 bg-wash-brand text-primary-ink shadow-card" : "border-border bg-card text-foreground hover:bg-accent",
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", DOT[p.tone])} aria-hidden="true" />
                  {p.label}
                  <span className={cn("rounded-chip px-1 font-num text-label tabular-nums", n > 0 ? "bg-muted text-foreground" : "text-muted-foreground")}>{n}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-xs">{p.description}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
