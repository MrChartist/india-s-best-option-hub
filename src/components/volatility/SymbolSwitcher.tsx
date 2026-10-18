import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SCREENER_INDICES, SCREENER_STOCKS } from "@/lib/volatility/screener";

const VOL_INDICES: readonly string[] = SCREENER_INDICES;
const VOL_STOCKS: readonly string[] = SCREENER_STOCKS;

export function SymbolSwitcher({ value, onChange, className }: { value: string; onChange: (s: string) => void; className?: string }) {
  const known = VOL_INDICES.includes(value) || VOL_STOCKS.includes(value);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* macOS segmented control. Buttons with aria-pressed (not radios): a stock can be picked instead. */}
      <div className="inline-flex flex-wrap items-center gap-px rounded-pill bg-control-track p-0.5" role="group" aria-label="Index">
        {VOL_INDICES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={value === s}
            className="h-6 rounded-[5px] px-2.5 text-body font-medium text-foreground/80 transition-[background-color,color,box-shadow] duration-base ease-spring hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none aria-pressed:bg-control aria-pressed:text-foreground aria-pressed:shadow-control [@media(pointer:coarse)]:h-8"
          >
            {s}
          </button>
        ))}
      </div>
      <Select value={VOL_INDICES.includes(value) ? "" : value} onValueChange={onChange}>
        <SelectTrigger className="w-[150px]" aria-label="Stock">
          <SelectValue placeholder="Stocks" />
        </SelectTrigger>
        <SelectContent>
          {!known && value ? (
            <>
              <SelectGroup>
                <SelectItem value={value}>{value}</SelectItem>
              </SelectGroup>
              <SelectSeparator />
            </>
          ) : null}
          <SelectGroup>
            <SelectLabel>Liquid F&amp;O stocks</SelectLabel>
            {VOL_STOCKS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
