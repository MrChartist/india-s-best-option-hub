import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { LayoutDashboard, TableProperties, BarChart3, Calculator, Layers, Search, TrendingUp, TrendingDown, Keyboard } from "lucide-react";
import { useLiveIndices } from "@/hooks/useMarketData";

// Static F&O stock list for command palette navigation (no prices needed)
const FNO_STOCKS = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR",
  "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK",
  "TATAMOTORS", "SUNPHARMA", "TITAN", "WIPRO", "BAJFINANCE", "HCLTECH",
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { data: indicesResult } = useLiveIndices();
  const indices = indicesResult?.data || [];

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search symbols, pages, actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Pages">
          <CommandItem onSelect={() => go("/")}><LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard <span className="ml-auto text-[10px] text-muted-foreground font-mono">Ctrl+1</span></CommandItem>
          <CommandItem onSelect={() => go("/option-chain")}><TableProperties className="mr-2 h-4 w-4" /> Option Chain <span className="ml-auto text-[10px] text-muted-foreground font-mono">Ctrl+2</span></CommandItem>
          <CommandItem onSelect={() => go("/oi-analysis")}><BarChart3 className="mr-2 h-4 w-4" /> OI Analysis <span className="ml-auto text-[10px] text-muted-foreground font-mono">Ctrl+3</span></CommandItem>
          <CommandItem onSelect={() => go("/greeks")}><Calculator className="mr-2 h-4 w-4" /> Greeks Calculator <span className="ml-auto text-[10px] text-muted-foreground font-mono">Ctrl+4</span></CommandItem>
          <CommandItem onSelect={() => go("/strategy")}><Layers className="mr-2 h-4 w-4" /> Strategy Builder <span className="ml-auto text-[10px] text-muted-foreground font-mono">Ctrl+5</span></CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Indices">
          {indices.length > 0 ? indices.map((idx: any) => (
            <CommandItem key={idx.symbol} onSelect={() => go(`/option-chain?symbol=${idx.symbol}`)}>
              {idx.change >= 0 ? <TrendingUp className="mr-2 h-4 w-4 text-bullish" /> : <TrendingDown className="mr-2 h-4 w-4 text-bearish" />}
              {idx.name}
              <span className="ml-auto font-mono text-xs">{idx.ltp.toLocaleString("en-IN")}</span>
            </CommandItem>
          )) : (
            <>
              {["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].map(sym => (
                <CommandItem key={sym} onSelect={() => go(`/option-chain?symbol=${sym}`)}>
                  <Search className="mr-2 h-4 w-4" />
                  {sym}
                </CommandItem>
              ))}
            </>
          )}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="F&O Stocks">
          {FNO_STOCKS.map(stock => (
            <CommandItem key={stock} onSelect={() => go(`/option-chain?symbol=${stock}`)}>
              <Search className="mr-2 h-4 w-4" />
              {stock}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Keyboard Shortcuts">
          <CommandItem disabled><Keyboard className="mr-2 h-4 w-4" /> / — Search &nbsp;|&nbsp; G — Greeks &nbsp;|&nbsp; Ctrl+1-5 — Navigate &nbsp;|&nbsp; Esc — Close</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
