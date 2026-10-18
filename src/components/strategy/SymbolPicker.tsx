import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { fnoStocks } from "@/lib/mockData";
import { CONTRACT_SPECS } from "@/lib/options";
import { cn } from "@/lib/utils";

/** Searchable symbol picker: indices first, then F&O stocks (contract specs plus the wider F&O list). */
export function SymbolPicker({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const { indices, stocks } = useMemo(() => {
    const specs = Object.values(CONTRACT_SPECS);
    const idx = specs.filter((s) => s.kind === "INDEX").map((s) => s.symbol);
    const known = new Set(specs.map((s) => s.symbol));
    const st = Array.from(new Set([...specs.filter((s) => s.kind === "STOCK").map((s) => s.symbol), ...fnoStocks.filter((s) => !known.has(s))])).sort();
    return { indices: idx, stocks: st };
  }, []);

  const pick = (s: string) => {
    onChange(s);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={`Underlying: ${value}`} className="w-[150px] justify-between pl-2.5 pr-1.5 font-semibold">
          <span className="truncate">{value}</span>
          <ChevronsUpDown className="!size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search symbol…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No symbol found.</CommandEmpty>
            <CommandGroup heading="Indices">
              {indices.map((s) => (
                <CommandItem key={s} value={s} onSelect={() => pick(s)} className="text-body-sm">
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === s ? "opacity-100" : "opacity-0")} />
                  {s}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="F&O stocks">
              {stocks.map((s) => (
                <CommandItem key={s} value={s} onSelect={() => pick(s)} className="text-body-sm">
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === s ? "opacity-100" : "opacity-0")} />
                  {s}
                  {!CONTRACT_SPECS[s] && <span className="ml-auto text-micro text-muted-foreground">lot size unverified</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
