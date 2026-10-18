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
        <SheetHeader className="hairline-b px-4 pb-3 pt-3.5 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingBasket className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Basket
            <Badge variant="neutral" className="normal-case">
              {legs.length} {legs.length === 1 ? "leg" : "legs"}
            </Badge>
          </SheetTitle>
          <SheetDescription className="text-body-sm">
            Legs are priced at mid (or LTP when there is no two-sided quote) and saved on this device. Send a group to the Strategy Builder for payoff, POP and margin, or to Paper Trading to practise.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto bg-surface px-3 py-3">
          {legs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              {lastSent ? (
                <>
                  <CheckCircle2 className="h-9 w-9 text-bullish" aria-hidden="true" />
                  <p className="text-headline text-foreground">Sent to {TARGET_LABEL[lastSent.target]}</p>
                  <p className="max-w-[280px] text-body-sm">
                    {lastSent.count} {lastSent.count === 1 ? "leg" : "legs"} ({lastSent.symbols.join(", ")}) at {formatTimeIST(lastSent.at)} IST. The basket was cleared so the next idea starts fresh.
                  </p>
                </>
              ) : (
                <>
                  <ShoppingBasket className="h-9 w-9 opacity-40" aria-hidden="true" />
                  <p className="text-headline text-foreground">Your basket is empty</p>
                  <p className="max-w-[260px] text-body-sm">Use the B / S buttons beside the strike, the right-click menu, or focus a row and press A / Shift+A.</p>
                </>
              )}
            </div>
          ) : (
            <>
              {multi && (
                <div role="alert" className="flex items-start gap-2 rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning">
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

        <SheetFooter className="hairline-t flex-col gap-2 px-4 py-3 sm:flex-col sm:space-x-0">
          <div className="flex items-center justify-between text-body">
            <span className="text-muted-foreground">{multi ? "Net premium, all groups" : "Net premium"}</span>
            <NetAmount net={net} />
          </div>
          <p className="text-body-sm text-muted-foreground">Before brokerage, STT and other charges. Data for education and research. Not investment advice.</p>
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
    <section aria-labelledby={headingId} className="space-y-1.5">
      <header className="flex items-center justify-between gap-2 px-3">
        <h3 id={headingId} className="text-headline">
          {group.symbol}
          <span className="ml-1.5 text-body-sm font-normal text-muted-foreground">
            {group.legs.length} {group.legs.length === 1 ? "leg" : "legs"}
          </span>
        </h3>
        <span className="text-body-sm">
          <span className="text-muted-foreground">Subtotal </span>
          <NetAmount net={group.net} />
        </span>
      </header>
      {/* Grouped inset list (System Settings): one box, hairline rows. */}
      <ul className="divide-y divide-separator overflow-hidden rounded-tile border border-separator bg-card shadow-card">
        {group.items.map(({ leg: l, index: i }) => {
          const lot = lotSizeFor(l.symbol, l.expiry);
          const legLabel = `${l.symbol} ${l.strike} ${l.type}`;
          return (
            <li key={`${l.expiry}-${l.strike}-${l.type}-${l.side}-${i}`} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onFlip(i)}
                  title="Switch buy / sell"
                  className={cn(
                    "h-6 w-8 shrink-0 rounded-[5px] text-label shadow-control transition-[filter] duration-fast active:brightness-95 focus-visible:shadow-focus focus-visible:outline-none",
                    l.side === "BUY" ? "bg-bullish text-bullish-foreground" : "bg-bearish text-bearish-foreground",
                  )}
                  aria-label={`${l.side === "BUY" ? "Buy" : "Sell"} ${legLabel}; switch side`}
                >
                  {l.side === "BUY" ? "B" : "S"}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-headline tabular-nums">
                    {formatStrike(l.strike)} <span className={l.type === "CE" ? "text-bearish" : "text-bullish"}>{l.type}</span>
                  </p>
                  <p className="text-body-sm tabular-nums text-muted-foreground">
                    {formatDateIST(l.expiry)} · {formatINR(l.premium)} {l.iv ? `· IV ${(l.iv * 100).toFixed(1)}%` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-bearish" onClick={() => onRemove(i)} aria-label={`Remove ${legLabel}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 pl-10">
                {/* macOS stepper: one bezel, minus / value / plus. */}
                <div className="flex items-center gap-2" role="group" aria-label={`Lots for ${legLabel}`}>
                  <div className="flex h-7 items-center rounded-pill bg-control shadow-control [@media(pointer:coarse)]:h-9">
                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-r-none" onClick={() => onLots(i, l.lots - 1)} aria-label="Fewer lots" disabled={l.lots <= 1}>
                      <Minus className="!size-3" />
                    </Button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={l.lots}
                      onChange={(e) => onLots(i, Number(e.target.value) || 1)}
                      className="h-7 w-10 border-x border-separator [@media(pointer:coarse)]:h-9 bg-transparent text-center text-body tabular-nums [appearance:textfield] focus:shadow-focus focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      aria-label="Lots"
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-l-none" onClick={() => onLots(i, l.lots + 1)} aria-label="More lots">
                      <Plus className="!size-3" />
                    </Button>
                  </div>
                  <span className="text-body-sm tabular-nums text-muted-foreground">× {lot || "—"} qty</span>
                </div>
                <span className={cn("text-body font-semibold tabular-nums", l.side === "SELL" ? "text-bullish" : "text-bearish")}>
                  {l.side === "SELL" ? "+" : MINUS}
                  {formatINR(l.premium * l.lots * (lot || 0), { decimals: 0 })}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-2 gap-1.5 pt-1">
        <Button className="col-span-2" onClick={() => onSend("builder", group.legs)}>
          Open in builder <ArrowUpRight />
        </Button>
        <Button variant="outline" className="h-auto min-h-7 whitespace-normal py-1 leading-tight" onClick={() => onSend("append", group.legs)} title="Add these legs to the strategy already open in the builder">
          <Plus /> Add to current strategy
        </Button>
        <Button variant="outline" className="h-auto min-h-7 whitespace-normal py-1 leading-tight" onClick={() => onSend("paper", group.legs)}>
          <NotebookPen /> Paper trade
        </Button>
      </div>
    </section>
  );
}
