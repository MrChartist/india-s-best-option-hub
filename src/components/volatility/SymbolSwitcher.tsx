import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SCREENER_INDICES, SCREENER_STOCKS } from "@/lib/volatility/screener";

const VOL_INDICES: readonly string[] = SCREENER_INDICES;
const VOL_STOCKS: readonly string[] = SCREENER_STOCKS;

export function SymbolSwitcher({ value, onChange, className }: { value: string; onChange: (s: string) => void; className?: string }) {
  const known = VOL_INDICES.includes(value) || VOL_STOCKS.includes(value);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Index">
        {VOL_INDICES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={value === s}
            className={cn(
              "h-7 rounded-capsule border px-3 text-xs font-semibold transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
              value === s ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-accent",
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <Select value={VOL_INDICES.includes(value) ? "" : value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[150px]" aria-label="Stock">
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
