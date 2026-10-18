import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ALL_SYMBOLS, filterSymbols } from "./symbols";

export function SymbolSearch({ value, onSelect }: { value: string; onSelect: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => filterSymbols(search), [search]);
  const flat = useMemo(() => filtered.flatMap((c) => c.symbols), [filtered]);
  const currentLabel = ALL_SYMBOLS.find((s) => s.value === value)?.label || value;

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  const choose = (v: string) => {
    onSelect(v);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[176px] justify-between gap-1 pl-2.5 pr-2 font-semibold" role="combobox" aria-expanded={open} aria-label={`Symbol: ${currentLabel}. Change symbol`}>
          <span className="truncate">{currentLabel}</span>
          <Search className="!size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <div className="hairline-b flex items-center gap-2 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && flat.length > 0) {
                e.preventDefault();
                choose(flat[0].value);
              }
            }}
            placeholder="Search F&O symbols"
            aria-label="Search F&O symbols"
            className="h-7 border-0 bg-transparent p-0 shadow-none focus:shadow-none focus-visible:shadow-none focus-visible:ring-0"
          />
          {search && (
            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setSearch("")} aria-label="Clear search">
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <div className="max-h-[340px] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-body-sm text-muted-foreground">No F&O symbol matches “{search}”.</p>
          ) : (
            filtered.map((cat) => (
              <div key={cat.label}>
                <p className="sticky top-0 bg-popover px-2 pb-1 pt-2 text-label text-muted-foreground">{cat.label}</p>
                <div className="grid grid-cols-3 gap-0.5">
                  {cat.symbols.map((s) => (
                    <button
                      key={`${cat.label}-${s.value}`}
                      type="button"
                      onClick={() => choose(s.value)}
                      className={cn(
                        "h-7 truncate rounded-[5px] px-2 text-left text-body transition-colors duration-fast hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:outline-none",
                        s.value === value && "bg-control-track font-semibold",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
