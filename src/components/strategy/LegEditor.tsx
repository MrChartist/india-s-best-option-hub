import { memo } from "react";
import { Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateIST, formatINR, formatStrike } from "@/lib/options";
import { cn } from "@/lib/utils";
import { clampLots, type BuilderLeg } from "./strategyState";

export interface LegEditorProps {
  leg: BuilderLeg;
  index: number;
  expiries: string[];
  /** Strikes available for this leg's expiry (listed chain strikes or a step grid). */
  strikes: number[];
  /** Current chain/theoretical price for this leg, for the "reset to market" hint. */
  marketPrice?: number;
  focused: boolean;
  onChange: (id: string, patch: Partial<BuilderLeg>) => void;
  onRemove: (id: string) => void;
  onFocus: (id: string) => void;
}

function LegEditorImpl({ leg, index, expiries, strikes, marketPrice, focused, onChange, onRemove, onFocus }: LegEditorProps) {
  const isBuy = leg.side === "BUY";
  const qty = leg.lots * leg.lotSize;
  const value = leg.premium * qty;
  const strikeList = strikes.includes(leg.strike) || leg.type === "FUT" ? strikes : [...strikes, leg.strike].sort((a, b) => a - b);
  const expiryList = expiries.includes(leg.expiry) ? expiries : [...expiries, leg.expiry].sort();
  const label = `Leg ${index + 1}: ${leg.side} ${leg.type === "FUT" ? "FUT" : `${leg.strike} ${leg.type}`}`;
  const drift = marketPrice !== undefined && marketPrice > 0 && Math.abs(marketPrice - leg.premium) >= 0.05;

  return (
    <div
      role="group"
      aria-label={label}
      tabIndex={0}
      onFocus={() => onFocus(leg.id)}
      onClick={() => onFocus(leg.id)}
      data-leg-id={leg.id}
      className={cn(
        "rounded-tile border bg-card p-2 transition-colors duration-fast focus-visible:outline-none focus-visible:shadow-ember",
        focused ? "border-primary/50 bg-wash-brand/25" : "border-border",
        !leg.enabled && "opacity-55",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Switch
          checked={leg.enabled}
          onCheckedChange={(v) => onChange(leg.id, { enabled: v })}
          aria-label={leg.enabled ? `Disable leg ${index + 1}` : `Enable leg ${index + 1}`}
          className="scale-90"
        />
        <Button
          type="button"
          variant={isBuy ? "buy" : "sell"}
          size="pill"
          className="w-10 justify-center px-0 font-bold"
          onClick={() => onChange(leg.id, { side: isBuy ? "SELL" : "BUY" })}
          aria-label={`Side ${leg.side}. Click to switch to ${isBuy ? "SELL" : "BUY"}`}
        >
          {isBuy ? "B" : "S"}
        </Button>
        <Select value={leg.type} onValueChange={(v) => onChange(leg.id, { type: v as BuilderLeg["type"], manual: false })}>
          <SelectTrigger className="h-7 w-[64px] px-2 text-xs" aria-label="Instrument type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CE">CE</SelectItem>
            <SelectItem value="PE">PE</SelectItem>
            <SelectItem value="FUT">FUT</SelectItem>
          </SelectContent>
        </Select>
        <Select value={leg.expiry} onValueChange={(v) => onChange(leg.id, { expiry: v, manual: false })}>
          <SelectTrigger className="h-7 w-[112px] px-2 text-xs" aria-label="Expiry">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {expiryList.map((e) => (
              <SelectItem key={e} value={e} className="text-xs">
                {formatDateIST(e)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {leg.type !== "FUT" ? (
          <Select value={String(leg.strike)} onValueChange={(v) => onChange(leg.id, { strike: Number(v), manual: false })}>
            <SelectTrigger className="h-7 w-[96px] px-2 font-num text-xs" aria-label="Strike">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {strikeList.map((k) => (
                <SelectItem key={k} value={String(k)} className="font-num text-xs">
                  {formatStrike(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="inline-flex h-7 w-[96px] items-center rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground">Futures</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-bearish"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(leg.id);
            }}
            aria-label={`Remove leg ${index + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1">
          <span className="text-micro uppercase text-muted-foreground">Lots</span>
          <Button type="button" variant="outline" size="icon" className="h-7 w-7 shadow-none" onClick={() => onChange(leg.id, { lots: clampLots(leg.lots - 1) })} aria-label="Decrease lots" disabled={leg.lots <= 1}>
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={leg.lots}
            onChange={(e) => onChange(leg.id, { lots: clampLots(Number(e.target.value)) })}
            className="h-7 w-12 px-1 text-center font-num text-xs"
            aria-label="Lots"
          />
          <Button type="button" variant="outline" size="icon" className="h-7 w-7 shadow-none" onClick={() => onChange(leg.id, { lots: clampLots(leg.lots + 1) })} aria-label="Increase lots">
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-micro uppercase text-muted-foreground">{leg.type === "FUT" ? "Price" : "Prem"}</span>
          <Input
            type="number"
            inputMode="decimal"
            step={0.05}
            min={0}
            value={Number.isFinite(leg.premium) ? leg.premium : 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange(leg.id, { premium: Number.isFinite(v) && v >= 0 ? v : 0, manual: true });
            }}
            className={cn("h-7 w-[84px] px-1.5 text-right font-num text-xs", leg.manual && "border-warning/60")}
            aria-label={leg.type === "FUT" ? "Entry futures price" : "Entry premium per unit"}
          />
          {leg.manual && drift && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-warning"
                    onClick={() => onChange(leg.id, { manual: false })}
                    aria-label={`Reset to market price ${marketPrice?.toFixed(2)}`}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">Manual price. Market: ₹{marketPrice?.toFixed(2)}. Click to reset.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="ml-auto text-right font-num text-[11px] leading-tight">
          <div className={isBuy ? "text-bearish" : "text-bullish"}>
            {leg.type === "FUT" ? "Notional" : isBuy ? "Debit" : "Credit"} {formatINR(value, { decimals: 0 })}
          </div>
          <div className="text-muted-foreground">
            {qty.toLocaleString("en-IN")} qty{leg.type !== "FUT" && leg.iv ? ` · IV ${(leg.iv * 100).toFixed(1)}%` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

export const LegEditor = memo(LegEditorImpl);
