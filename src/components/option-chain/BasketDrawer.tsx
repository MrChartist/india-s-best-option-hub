import { useMemo } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Minus, NotebookPen, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatDateIST, formatINR, formatStrike, formatTimeIST, MINUS } from "@/lib/options";
import { basketNetPremium, groupBySymbol, type BasketGroup, type BasketLeg, type BasketSent, type SendTarget } from "./basket";

export interface BasketDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legs: BasketLeg[];
  onChange: (legs: BasketLeg[]) => void;
  lotSizeFor: (symbol: string, expiry: string) => number;
  /** Hand a group's legs to the Strategy Builder (replace / append) or Paper Trading. */
  onSend: (target: SendTarget, legs: BasketLeg[]) => void;
  /** Last hand-off, shown as a confirmation once the basket has been cleared. */
  lastSent?: BasketSent | null;
}

const TARGET_LABEL: Record<SendTarget, string> = {
  builder: "the Strategy Builder",
  append: "the current strategy",
  paper: "Paper Trading",
};

function NetAmount({ net, className }: { net: number; className?: string }) {
  return (
    <span className={cn("font-bold tabular-nums", net >= 0 ? "text-bullish" : "text-bearish", className)}>
      {formatINR(Math.abs(net), { decimals: 0 })} {net >= 0 ? "credit" : "debit"}
    </span>
  );
}

export function BasketDrawer({ open, onOpenChange, legs, onChange, lotSizeFor, onSend, lastSent }: BasketDrawerProps) {
  const groups = useMemo(() => groupBySymbol(legs, lotSizeFor), [legs, lotSizeFor]);
  const net = useMemo(() => basketNetPremium(legs, lotSizeFor), [legs, lotSizeFor]);
  const setLots = (i: number, lots: number) => onChange(legs.map((l, j) => (j === i ? { ...l, lots: Math.max(1, Math.min(500, Math.round(lots))) } : l)));
  const flip = (i: number) => onChange(legs.map((l, j) => (j === i ? { ...l, side: l.side === "BUY" ? "SELL" : "BUY" } : l)));
  const remove = (i: number) => onChange(legs.filter((_, j) => j !== i));
  const multi = groups.length > 1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="flex items-center gap-2 font-display">
            <ShoppingBasket className="h-5 w-5 text-primary-ink" /> Basket
            <Badge variant="neutral">
              {legs.length} {legs.length === 1 ? "leg" : "legs"}
            </Badge>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Legs are priced at mid (or LTP when there is no two-sided quote) and saved on this device. Send a group to the Strategy Builder for payoff, POP and margin, or to Paper Trading to practise.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {legs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              {lastSent ? (
                <>
                  <CheckCircle2 className="h-10 w-10 text-bullish" aria-hidden="true" />
                  <p className="text-sm font-semibold text-foreground">Sent to {TARGET_LABEL[lastSent.target]}</p>
                  <p className="max-w-[280px] text-xs">
                    {lastSent.count} {lastSent.count === 1 ? "leg" : "legs"} ({lastSent.symbols.join(", ")}) at {formatTimeIST(lastSent.at)} IST. The basket was cleared so the next idea starts fresh.
                  </p>
                </>
              ) : (
                <>
                  <ShoppingBasket className="h-10 w-10 opacity-30" aria-hidden="true" />
                  <p className="text-sm font-semibold text-foreground">Your basket is empty</p>
                  <p className="max-w-[260px] text-xs">Use the B / S buttons beside the strike, the right-click menu, or focus a row and press A / Shift+A.</p>
                </>
              )}
            </div>
          ) : (
            <>
              {multi && (
                <div role="alert" className="flex items-start gap-2 rounded-tile border border-warning/30 bg-wash-warning px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>
                    <span className="font-semibold">{groups.length} underlyings in one basket.</span> A strategy works on one underlying, so each group below opens on its own.
                  </p>
                </div>
              )}
              {groups.map((g) => (
                <GroupCard key={g.symbol} group={g} lotSizeFor={lotSizeFor} onLots={setLots} onFlip={flip} onRemove={remove} onSend={onSend} />
              ))}
            </>
          )}
        </div>

        <SheetFooter className="flex-col gap-2 border-t border-border p-4 sm:flex-col sm:space-x-0">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{multi ? "Net premium, all groups" : "Net premium"}</span>
            <NetAmount net={net} />
          </div>
          <p className="text-[11px] text-muted-foreground">Before brokerage, STT and other charges. Data for education and research. Not investment advice.</p>
          <Button variant="outline" onClick={() => onChange([])} disabled={legs.length === 0}>
            <Trash2 /> Clear basket
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

interface GroupCardProps {
  group: BasketGroup;
  lotSizeFor: (symbol: string, expiry: string) => number;
  onLots: (i: number, lots: number) => void;
  onFlip: (i: number) => void;
  onRemove: (i: number) => void;
  onSend: (target: SendTarget, legs: BasketLeg[]) => void;
}

function GroupCard({ group, lotSizeFor, onLots, onFlip, onRemove, onSend }: GroupCardProps) {
  const headingId = `basket-group-${group.symbol}`;
  return (
    <section aria-labelledby={headingId} className="rounded-card border border-border bg-surface p-2">
      <header className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <h3 id={headingId} className="font-display text-sm font-bold">
          {group.symbol}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {group.legs.length} {group.legs.length === 1 ? "leg" : "legs"}
          </span>
        </h3>
        <span className="text-xs">
          <span className="text-muted-foreground">Subtotal </span>
          <NetAmount net={group.net} />
        </span>
      </header>
      <ul className="space-y-1.5">
        {group.items.map(({ leg: l, index: i }) => {
          const lot = lotSizeFor(l.symbol, l.expiry);
          const legLabel = `${l.symbol} ${l.strike} ${l.type}`;
          return (
            <li key={`${l.expiry}-${l.strike}-${l.type}-${l.side}-${i}`} className="rounded-tile border border-border bg-card p-2.5 shadow-card">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onFlip(i)}
                  title="Switch buy / sell"
                  className={cn(
                    "h-7 w-9 shrink-0 rounded-chip text-[11px] font-bold focus-visible:shadow-ember focus-visible:outline-none",
                    l.side === "BUY" ? "bg-bullish text-bullish-foreground" : "bg-bearish text-bearish-foreground",
                  )}
                  aria-label={`${l.side === "BUY" ? "Buy" : "Sell"} ${legLabel}; switch side`}
                >
                  {l.side === "BUY" ? "B" : "S"}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {formatStrike(l.strike)} <span className={l.type === "CE" ? "text-bearish" : "text-bullish"}>{l.type}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateIST(l.expiry)} · {formatINR(l.premium)} {l.iv ? `· IV ${(l.iv * 100).toFixed(1)}%` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-bearish" onClick={() => onRemove(i)} aria-label={`Remove ${legLabel}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1" role="group" aria-label={`Lots for ${legLabel}`}>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onLots(i, l.lots - 1)} aria-label="Fewer lots" disabled={l.lots <= 1}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={l.lots}
                    onChange={(e) => onLots(i, Number(e.target.value) || 1)}
                    className="h-8 w-12 rounded-md border border-input bg-background text-center text-xs tabular-nums focus:border-primary focus:shadow-ember focus:outline-none"
                    aria-label="Lots"
                  />
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onLots(i, l.lots + 1)} aria-label="More lots">
                    <Plus className="h-3 w-3" />
                  </Button>
                  <span className="ml-1 text-[11px] text-muted-foreground">× {lot || "—"} qty</span>
                </div>
                <span className={cn("text-xs font-semibold tabular-nums", l.side === "SELL" ? "text-bullish" : "text-bearish")}>
                  {l.side === "SELL" ? "+" : MINUS}
                  {formatINR(l.premium * l.lots * (lot || 0), { decimals: 0 })}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Button className="col-span-2" size="sm" onClick={() => onSend("builder", group.legs)}>
          Open in builder <ArrowUpRight />
        </Button>
        <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal py-1.5 leading-tight" onClick={() => onSend("append", group.legs)} title="Add these legs to the strategy already open in the builder">
          <Plus /> Add to current strategy
        </Button>
        <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal py-1.5 leading-tight" onClick={() => onSend("paper", group.legs)}>
          <NotebookPen /> Paper trade
        </Button>
      </div>
    </section>
  );
}
