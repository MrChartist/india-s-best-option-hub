import { memo, useEffect, useState } from "react";
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

/**
 * Lots field with a local draft: the field may be empty while the user retypes it. Valid values
 * (1 or more) apply as typed; a blank or invalid field snaps back to the current lots on blur or Enter.
 */
function LotsInput({ lots, onCommit }: { lots: number; onCommit: (lots: number) => void }) {
  const [text, setText] = useState(String(lots));
  // Follow outside changes (stepper buttons, clamping) without clobbering a matching draft.
  useEffect(() => {
    setText((t) => (Number(t) === lots ? t : String(lots)));
  }, [lots]);
  const settle = () => {
    const v = Number(text);
    if (text.trim() === "" || !Number.isFinite(v) || v < 1) setText(String(lots));
    else {
      const next = clampLots(v);
      setText(String(next));
      if (next !== lots) onCommit(next);
    }
  };
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={1}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const v = Number(t);
        if (t.trim() !== "" && Number.isFinite(v) && v >= 1) {
          const next = clampLots(v);
          if (next !== lots) onCommit(next);
        }
      }}
      onBlur={settle}
      onKeyDown={(e) => {
        if (e.key === "Enter") settle();
      }}
      className="h-full w-11 rounded-none bg-transparent px-1 text-center font-num text-body-sm shadow-none focus-visible:shadow-none"
      aria-label="Lots"
    />
  );
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
        // A row in a grouped list; the selected leg reads as a macOS selection (grey fill, accent edge).
        "relative px-2.5 py-2 transition-colors duration-fast focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.6)]",
        focused && "bg-selection-unfocused shadow-[inset_2px_0_0_hsl(var(--primary))]",
        !leg.enabled && "opacity-55",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Switch
          checked={leg.enabled}
          onCheckedChange={(v) => onChange(leg.id, { enabled: v })}
          aria-label={leg.enabled ? `Disable leg ${index + 1}` : `Enable leg ${index + 1}`}
        />
        <Button
          type="button"
          variant={isBuy ? "buy" : "sell"}
          size="pill"
          className="w-9 justify-center px-0 font-semibold"
          onClick={() => onChange(leg.id, { side: isBuy ? "SELL" : "BUY" })}
          aria-label={`Side ${leg.side}. Click to switch to ${isBuy ? "SELL" : "BUY"}`}
        >
          {isBuy ? "B" : "S"}
        </Button>
        <Select value={leg.type} onValueChange={(v) => onChange(leg.id, { type: v as BuilderLeg["type"], manual: false })}>
          <SelectTrigger className="w-[64px] text-body-sm" aria-label="Instrument type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CE">CE</SelectItem>
            <SelectItem value="PE">PE</SelectItem>
            <SelectItem value="FUT">FUT</SelectItem>
          </SelectContent>
        </Select>
        <Select value={leg.expiry} onValueChange={(v) => onChange(leg.id, { expiry: v, manual: false })}>
          <SelectTrigger className="w-[112px] text-body-sm" aria-label="Expiry">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {expiryList.map((e) => (
              <SelectItem key={e} value={e} className="text-body-sm">
                {formatDateIST(e)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {leg.type !== "FUT" ? (
          <Select value={String(leg.strike)} onValueChange={(v) => onChange(leg.id, { strike: Number(v), manual: false })}>
            <SelectTrigger className="w-[96px] font-num text-body-sm" aria-label="Strike">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {strikeList.map((k) => (
                <SelectItem key={k} value={String(k)} className="font-num text-body-sm">
                  {formatStrike(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="inline-flex h-7 w-[96px] items-center rounded-pill bg-control-track px-2 text-body-sm text-muted-foreground">Futures</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-bearish"
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
        <div className="flex items-center gap-1.5">
          <span className="text-label text-muted-foreground">Lots</span>
          {/* macOS stepper: field and a joined −/+ pair in one bezel */}
          <div className="inline-flex h-7 items-stretch overflow-hidden rounded-sm bg-control shadow-control focus-within:shadow-[var(--shadow-control),var(--focus-ring)] [@media(pointer:coarse)]:h-9">
            <LotsInput lots={leg.lots} onCommit={(lots) => onChange(leg.id, { lots })} />
            <button type="button" className="grid w-6 place-items-center text-muted-foreground shadow-[inset_var(--hairline)_0_0_hsl(var(--separator))] hover:text-foreground active:bg-control-track disabled:opacity-40" onClick={() => onChange(leg.id, { lots: clampLots(leg.lots - 1) })} aria-label="Decrease lots" disabled={leg.lots <= 1}>
              <Minus className="h-3 w-3" aria-hidden="true" />
            </button>
            <button type="button" className="grid w-6 place-items-center text-muted-foreground shadow-[inset_var(--hairline)_0_0_hsl(var(--separator))] hover:text-foreground active:bg-control-track" onClick={() => onChange(leg.id, { lots: clampLots(leg.lots + 1) })} aria-label="Increase lots">
              <Plus className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-label text-muted-foreground">{leg.type === "FUT" ? "Price" : "Prem"}</span>
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
            className={cn("w-[84px] text-right font-num text-body-sm", leg.manual && "shadow-[0_0_0_1.5px_hsl(var(--warning)/0.7)]")}
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
                    className="text-warning"
                    onClick={() => onChange(leg.id, { manual: false })}
                    aria-label={`Reset to market price ${marketPrice?.toFixed(2)}`}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-body-sm">Manual price. Market: ₹{marketPrice?.toFixed(2)}. Click to reset.</TooltipContent>
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
