import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DayRangeMeter } from "./DayRangeMeter";
import type { LegQuote } from "../types";

interface Props {
  /** "BANKNIFTY 58000 CE" style heading, or an index name for the spot column. */
  title: string;
  subtitle?: string;
  quote: LegQuote;
  align?: "left" | "center" | "right";
  /** Strike steppers — omitted for the spot column. */
  onStep?: (direction: 1 | -1) => void;
  /** Larger type for the spot column. */
  emphasis?: boolean;
}

const STALE_MS = 10_000;

function fmt(v: number | null, digits = 2): string {
  return v === null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

/**
 * One column of the CE / spot / PE strip. All three columns are this component;
 * the reference terminal mirrors the layout for the put side, which `align`
 * reproduces without a second copy of the markup.
 */
export function LegQuoteCard({ title, subtitle, quote, align = "left", onStep, emphasis }: Props) {
  const up = (quote.change ?? 0) >= 0;
  const stale = quote.ageMs !== null && quote.ageMs > STALE_MS;
  const rowAlign = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  const textAlign = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  return (
    <div className={`flex flex-col gap-1 min-w-0 ${textAlign}`}>
      <div className={`flex items-center gap-1.5 flex-wrap ${rowAlign}`}>
        {onStep && (
          <Button
            variant="ghost" size="icon" className="h-5 w-5 shrink-0"
            onClick={() => onStep(-1)} aria-label={`${title} strike down`} tabIndex={-1}
          >
            <Minus className="h-3 w-3" />
          </Button>
        )}
        <span className="text-xs font-medium tracking-tight truncate">{title}</span>
        {onStep && (
          <Button
            variant="ghost" size="icon" className="h-5 w-5 shrink-0"
            onClick={() => onStep(1)} aria-label={`${title} strike up`} tabIndex={-1}
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {subtitle && <div className="text-[10px] text-muted-foreground truncate">{subtitle}</div>}

      <DayRangeMeter low={quote.low} high={quote.high} current={quote.ltp} open={quote.open} align={align} />

      <div className={`flex items-baseline gap-2 flex-wrap ${rowAlign}`}>
        <span className={`font-mono tabular-nums font-semibold ${emphasis ? "text-xl" : "text-base"}`}>
          {fmt(quote.ltp)}
        </span>
        <span className={`font-mono tabular-nums text-xs ${up ? "text-bullish" : "text-bearish"}`}>
          {quote.change === null ? "—" : `${up ? "+" : ""}${fmt(quote.change)}`}
          {quote.changePercent !== null && ` (${up ? "+" : ""}${fmt(quote.changePercent)}%)`}
        </span>
        {/* A price the user might trade on must say when it stopped updating. */}
        {stale && (
          <span className="text-[10px] font-medium text-warning" title="No tick recently">
            STALE {Math.round((quote.ageMs as number) / 1000)}s
          </span>
        )}
      </div>
    </div>
  );
}
