import { useMemo, useState } from "react";
import { ListTree } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { OptionData } from "@/lib/mockData";
import { findATMStrike, formatDateIST, formatStrike, type OptionType, type Side } from "@/lib/options";
import { quoteLeg, type PriceMode } from "@/lib/strategyTemplates";
import { cn } from "@/lib/utils";

export interface MiniChainPickerProps {
  chain: OptionData[];
  spot: number;
  expiry: string;
  priceMode: PriceMode;
  loading?: boolean;
  /** Strikes already in the strategy, highlighted. */
  usedStrikes?: Set<string>;
  /** When set, the B/S buttons are disabled and this explains why (e.g. the leg limit). */
  disabledReason?: string;
  onAdd: (o: { type: OptionType; side: Side; strike: number; premium: number; ivPct: number }) => void;
}

const RANGES = [6, 10, 15] as const;

export function MiniChainPicker({ chain, spot, expiry, priceMode, loading, usedStrikes, disabledReason, onAdd }: MiniChainPickerProps) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(6);
  const rows = useMemo(() => {
    const sorted = [...chain].filter((r) => r.strikePrice > 0).sort((a, b) => a.strikePrice - b.strikePrice);
    if (sorted.length === 0) return [];
    const atmK = findATMStrike(sorted, spot);
    const idx = Math.max(0, sorted.findIndex((r) => r.strikePrice === atmK));
    return sorted.slice(Math.max(0, idx - range), idx + range + 1).map((r) => ({ row: r, atm: r.strikePrice === atmK }));
  }, [chain, spot, range]);

  const cell = (row: OptionData, type: OptionType) => {
    const leg = type === "CE" ? row.ce : row.pe;
    const buy = quoteLeg(leg, "BUY", priceMode);
    const sell = quoteLeg(leg, "SELL", priceMode);
    const itm = type === "CE" ? row.strikePrice < spot : row.strikePrice > spot;
    const used = usedStrikes?.has(`${row.strikePrice}${type}`);
    const label = `${formatStrike(row.strikePrice)} ${type}`;
    return (
      <div className={cn("flex items-center gap-1 px-1.5 py-1", type === "CE" ? "justify-end" : "justify-start", itm && "bg-surface/80")}>
        {type === "PE" && <QuickButtons label={label} disabled={!(buy > 0) || !!disabledReason} title={disabledReason} onBuy={() => onAdd({ type, side: "BUY", strike: row.strikePrice, premium: buy, ivPct: leg.iv })} onSell={() => onAdd({ type, side: "SELL", strike: row.strikePrice, premium: sell, ivPct: leg.iv })} />}
        <div className={cn("min-w-[58px] text-right font-num text-xs", type === "PE" && "text-left", used && "font-bold text-primary-ink")}>
          {buy > 0 ? buy.toFixed(2) : "—"}
          <div className="text-[10px] text-muted-foreground">{leg.iv > 0 ? `${leg.iv.toFixed(1)}%` : ""}</div>
        </div>
        {type === "CE" && <QuickButtons label={label} disabled={!(buy > 0) || !!disabledReason} title={disabledReason} onBuy={() => onAdd({ type, side: "BUY", strike: row.strikePrice, premium: buy, ivPct: leg.iv })} onSell={() => onAdd({ type, side: "SELL", strike: row.strikePrice, premium: sell, ivPct: leg.iv })} />}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ListTree className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Option chain
            <span className="text-xs font-normal text-muted-foreground">{expiry ? formatDateIST(expiry) : ""}</span>
          </CardTitle>
          <div className="flex items-center gap-0.5 rounded-tab bg-muted p-0.5" role="group" aria-label="Strikes around ATM">
            {RANGES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRange(n)}
                aria-pressed={range === n}
                className={cn("rounded-chip px-2 py-0.5 text-[11px] font-semibold transition-colors [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:px-3", range === n ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}
              >
                ±{n}
              </button>
            ))}
          </div>
        </div>
        {disabledReason ? <p className="text-[11px] font-medium text-warning">{disabledReason}</p> : null}
        <p className="text-[11px] text-muted-foreground">Tap B or S to add a leg at the {priceMode === "natural" ? "natural (ask to buy, bid to sell)" : priceMode === "ltp" ? "last traded" : "mid"} price.</p>
      </CardHeader>
      <CardContent className="px-2 pb-3 sm:px-4">
        {loading && rows.length === 0 ? (
          <div className="space-y-1.5" role="status" aria-busy="true" aria-label="Loading chain">
            {["s1", "s2", "s3", "s4", "s5", "s6"].map((k) => <Skeleton key={k} className="h-8 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No chain for this expiry yet. You can still add legs by hand.</p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto rounded-tile border border-border">
            <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] border-b border-border bg-card text-label uppercase text-muted-foreground">
              <div className="px-2 py-1.5 text-right">Calls</div>
              <div className="w-[76px] px-2 py-1.5 text-center">Strike</div>
              <div className="px-2 py-1.5">Puts</div>
            </div>
            {rows.map(({ row, atm }) => (
              <div key={row.strikePrice} className={cn("grid grid-cols-[1fr_auto_1fr] border-b border-border/60 last:border-0", atm && "bg-wash-brand/55 ring-1 ring-inset ring-primary/45")}>
                {cell(row, "CE")}
                <div className="flex w-[76px] items-center justify-center font-num text-xs font-semibold">
                  {formatStrike(row.strikePrice)}
                </div>
                {cell(row, "PE")}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickButtons({ label, disabled, title, onBuy, onSell }: { label: string; disabled: boolean; title?: string; onBuy: () => void; onSell: () => void }) {
  return (
    <div className="flex gap-0.5" title={title}>
      <Button type="button" variant="buy" className="h-6 w-6 rounded-chip p-0 text-[10px] font-bold [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8 [@media(pointer:coarse)]:text-xs" disabled={disabled} onClick={onBuy} aria-label={`Buy ${label}`}>
        B
      </Button>
      <Button type="button" variant="sell" className="h-6 w-6 rounded-chip p-0 text-[10px] font-bold [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8 [@media(pointer:coarse)]:text-xs" disabled={disabled} onClick={onSell} aria-label={`Sell ${label}`}>
        S
      </Button>
    </div>
  );
}
