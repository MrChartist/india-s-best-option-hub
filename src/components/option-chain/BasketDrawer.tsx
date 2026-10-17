import { useMemo } from "react";
import { ArrowUpRight, Minus, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatDateIST, formatINR, formatStrike } from "@/lib/options";
import { basketNetPremium, type BasketLeg } from "./basket";

export interface BasketDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legs: BasketLeg[];
  onChange: (legs: BasketLeg[]) => void;
  lotSizeFor: (symbol: string, expiry: string) => number;
  onOpenInBuilder: () => void;
}

export function BasketDrawer({ open, onOpenChange, legs, onChange, lotSizeFor, onOpenInBuilder }: BasketDrawerProps) {
  const net = useMemo(() => basketNetPremium(legs, lotSizeFor), [legs, lotSizeFor]);
  const setLots = (i: number, lots: number) => onChange(legs.map((l, j) => (j === i ? { ...l, lots: Math.max(1, Math.min(500, Math.round(lots))) } : l)));
  const flip = (i: number) => onChange(legs.map((l, j) => (j === i ? { ...l, side: l.side === "BUY" ? "SELL" : "BUY" } : l)));
  const remove = (i: number) => onChange(legs.filter((_, j) => j !== i));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="flex items-center gap-2 font-display">
            <ShoppingBasket className="h-5 w-5 text-primary-ink" /> Basket
            <Badge variant="neutral">{legs.length} {legs.length === 1 ? "leg" : "legs"}</Badge>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Legs are priced at mid (or LTP when there is no two-sided quote) and saved on this device. Open them in the Strategy Builder to see payoff, POP and margin.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-3">
          {legs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <ShoppingBasket className="h-10 w-10 opacity-30" />
              <p className="text-sm font-semibold text-foreground">Your basket is empty</p>
              <p className="max-w-[260px] text-xs">Hover an LTP and press B or S, use the right-click menu, or focus a row and press A / Shift+A.</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {legs.map((l, i) => {
                const lot = lotSizeFor(l.symbol, l.expiry);
                return (
                  <li key={`${l.symbol}-${l.expiry}-${l.strike}-${l.type}-${l.side}-${i}`} className="rounded-tile border border-border bg-card p-2.5 shadow-card">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => flip(i)}
                        title="Switch buy / sell"
                        className={cn(
                          "h-6 w-9 shrink-0 rounded-chip text-[11px] font-bold focus-visible:shadow-ember focus-visible:outline-none",
                          l.side === "BUY" ? "bg-bullish text-bullish-foreground" : "bg-bearish text-bearish-foreground",
                        )}
                        aria-label={`${l.side === "BUY" ? "Buy" : "Sell"}; switch side`}
                      >
                        {l.side === "BUY" ? "B" : "S"}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {l.symbol} {formatStrike(l.strike)} <span className={l.type === "CE" ? "text-bearish" : "text-bullish"}>{l.type}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateIST(l.expiry)} · {formatINR(l.premium)} {l.iv ? `· IV ${(l.iv * 100).toFixed(1)}%` : ""}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-bearish" onClick={() => remove(i)} aria-label="Remove leg">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1" role="group" aria-label="Lots">
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setLots(i, l.lots - 1)} aria-label="Fewer lots" disabled={l.lots <= 1}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={l.lots}
                          onChange={(e) => setLots(i, Number(e.target.value) || 1)}
                          className="h-7 w-12 rounded-md border border-input bg-background text-center text-xs tabular-nums focus:border-primary focus:shadow-ember focus:outline-none"
                          aria-label="Lots"
                        />
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setLots(i, l.lots + 1)} aria-label="More lots">
                          <Plus className="h-3 w-3" />
                        </Button>
                        <span className="ml-1 text-[11px] text-muted-foreground">× {lot || "—"} qty</span>
                      </div>
                      <span className={cn("text-xs font-semibold tabular-nums", l.side === "SELL" ? "text-bullish" : "text-bearish")}>
                        {l.side === "SELL" ? "+" : "−"}
                        {formatINR(l.premium * l.lots * (lot || 0), { decimals: 0 })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 border-t border-border p-4 sm:flex-col sm:space-x-0">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Net premium</span>
            <span className={cn("font-bold tabular-nums", net >= 0 ? "text-bullish" : "text-bearish")}>
              {formatINR(Math.abs(net), { decimals: 0 })} {net >= 0 ? "credit" : "debit"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">Before brokerage, STT and other charges. Data for education and research. Not investment advice.</p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onChange([])} disabled={legs.length === 0}>
              Clear
            </Button>
            <Button className="flex-[2]" onClick={onOpenInBuilder} disabled={legs.length === 0}>
              Open in Strategy Builder <ArrowUpRight />
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
