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
import { Keyboard, Search, TrendingDown, TrendingUp } from "lucide-react";
import { useLiveIndices } from "@/hooks/useMarketData";
import { routesByGroup } from "@/lib/routes";
import { routeIcon } from "@/lib/routeIcons";
import { STATIC_FNO_STOCKS } from "@/lib/screener/universe";

const NAV_GROUPS = routesByGroup();
const FALLBACK_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the keyboard-shortcut overlay. */
  onShowShortcuts?: () => void;
}

export function CommandPalette({ open, onOpenChange, onShowShortcuts }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { data: indicesResult } = useLiveIndices();
  const indices = indicesResult?.data ?? [];

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, symbols, actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {NAV_GROUPS.map(({ group, routes }) => (
          <CommandGroup key={group} heading={group}>
            {routes.map((r) => {
              const Icon = routeIcon(r.icon);
              return (
                <CommandItem
                  key={r.path}
                  value={`${r.navLabel} ${r.title} ${r.path}`}
                  keywords={r.keywords}
                  onSelect={() => go(r.path)}
                >
                  <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span>{r.navLabel}</span>
                  {r.badge && <span className="ml-2 text-[10px] font-semibold uppercase text-primary-ink">{r.badge}</span>}
                  {r.shortcut && <CommandShortcut>{r.shortcut.toUpperCase()}</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}

        <CommandSeparator />

        <CommandGroup heading="Indices">
          {indices.length > 0
            ? indices.map((idx) => (
                <CommandItem key={idx.symbol} value={`index ${idx.symbol} ${idx.name}`} onSelect={() => go(`/option-chain?symbol=${idx.symbol}`)}>
                  {idx.change >= 0 ? <TrendingUp className="mr-2 h-4 w-4 text-bullish" /> : <TrendingDown className="mr-2 h-4 w-4 text-bearish" />}
                  {idx.name}
                  <span className="ml-auto font-mono text-xs">{idx.ltp.toLocaleString("en-IN")}</span>
                </CommandItem>
              ))
            : FALLBACK_INDICES.map((sym) => (
                <CommandItem key={sym} value={`index ${sym}`} onSelect={() => go(`/option-chain?symbol=${sym}`)}>
                  <Search className="mr-2 h-4 w-4" />
                  {sym}
                </CommandItem>
              ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="F&O Stocks · open option chain">
          {STATIC_FNO_STOCKS.map((stock) => (
            <CommandItem key={stock} value={`stock ${stock}`} onSelect={() => go(`/option-chain?symbol=${stock}`)}>
              <Search className="mr-2 h-4 w-4" />
              {stock}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Help">
          <CommandItem
            value="keyboard shortcuts help"
            onSelect={() => {
              onOpenChange(false);
              onShowShortcuts?.();
            }}
          >
            <Keyboard className="mr-2 h-4 w-4" />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
