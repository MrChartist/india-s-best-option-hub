import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { BellPlus, Moon, Search, TrendingUp, TrendingDown } from "lucide-react";
import { useLiveIndices } from "@/hooks/useMarketData";
import { useTheme } from "@/hooks/useTheme";
import { NAV_ALL } from "@/lib/navigation";
import { alertStore } from "@/lib/alerts";

// Static F&O stock list for command palette navigation (no prices needed)
const FNO_STOCKS = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
  "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK",
  "TATAMOTORS", "SUNPHARMA", "TITAN", "WIPRO", "BAJFINANCE", "HCLTECH",
];

const FALLBACK_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { toggle: toggleTheme, isDark } = useTheme();
  const { data: indicesResult } = useLiveIndices();
  const indices = indicesResult?.data || [];

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const go = (path: string) => run(() => navigate(path));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search symbols, pages, actions…" />
      <CommandList className="max-h-[420px] p-1.5">
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Go to">
          {NAV_ALL.map((n) => (
            <CommandItem key={n.url} onSelect={() => go(n.url)}>
              <n.icon className="mr-2 h-4 w-4" /> {n.title}
              {n.key && <CommandShortcut className="font-mono">{n.key}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => alertStore.setPanelOpen(true))}>
            <BellPlus className="mr-2 h-4 w-4" /> New alert…
            <CommandShortcut className="font-mono">A</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(toggleTheme)}>
            <Moon className="mr-2 h-4 w-4" /> Switch to {isDark ? "light" : "dark"} mode
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Option chain — indices">
          {indices.length > 0
            ? indices.map((idx: any) => (
                <CommandItem key={idx.symbol} value={`${idx.name} ${idx.symbol}`} onSelect={() => go(`/option-chain?symbol=${idx.symbol}`)}>
                  {idx.change >= 0 ? <TrendingUp className="mr-2 h-4 w-4 text-bullish" /> : <TrendingDown className="mr-2 h-4 w-4 text-bearish" />}
                  {idx.name}
                  <span className="num ml-auto font-mono text-xs">{idx.ltp.toLocaleString("en-IN")}</span>
                </CommandItem>
              ))
            : FALLBACK_INDICES.map((sym) => (
                <CommandItem key={sym} onSelect={() => go(`/option-chain?symbol=${sym}`)}>
                  <Search className="mr-2 h-4 w-4" /> {sym}
                </CommandItem>
              ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Option chain — F&O stocks">
          {FNO_STOCKS.map((stock) => (
            <CommandItem key={stock} onSelect={() => go(`/option-chain?symbol=${stock}`)}>
              <Search className="mr-2 h-4 w-4" /> {stock}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
