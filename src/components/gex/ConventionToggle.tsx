import { Info } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GexConvention } from "@/lib/gexData";
import { cn } from "@/lib/utils";

interface Props {
  value: GexConvention;
  onChange: (v: GexConvention) => void;
  className?: string;
}

const OPTIONS: Array<{ value: GexConvention; label: string; short: string; help: string }> = [
  {
    value: "sellerShortBoth",
    label: "Seller view (India)",
    short: "Seller",
    help: "Retail traders in India are net option buyers, so writers are assumed short both calls and puts. Every strike adds short gamma; the chart shows where hedging pressure is heaviest.",
  },
  {
    value: "dealerLongCallShortPut",
    label: "Dealer model (US)",
    short: "Dealer",
    help: "SpotGamma-style assumption: dealers are long calls and short puts. Call gamma is positive, put gamma negative, and the total crosses zero at the gamma flip.",
  },
];

/** Segmented control for the GEX sign convention. Arrow keys move between options. */
export function ConventionToggle({ value, onChange, className }: Props) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span id="gex-convention-label" className="sr-only">
        Gamma sign convention
      </span>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as GexConvention)}
        aria-labelledby="gex-convention-label"
      >
        {OPTIONS.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} aria-label={o.label}>
            <span className="hidden sm:inline">{o.label}</span>
            <span className="sm:hidden">{o.short}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-chip text-muted-foreground hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none"
            aria-label="About the sign convention"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 space-y-1.5 text-body-sm">
          {OPTIONS.map((o) => (
            <p key={o.value}>
              <span className="font-semibold">{o.label}:</span> {o.help}
            </p>
          ))}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
