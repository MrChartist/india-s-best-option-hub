import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatCompactIN, formatNumberIN, MINUS, type OptionType, type Side } from "@/lib/options";
import type { LegView } from "./chainModel";
import type { CellContext } from "./columns";

const DASH = "—";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function num(v: number, dp = 2): string {
  return fin(v) ? formatNumberIN(v, dp, { minDecimals: dp }) : DASH;
}

/** "▲ +1.2L" style change with sign, arrow and colour. */
export function ChangeText({
  value,
  pct,
  compact = false,
  stacked = false,
  className,
}: {
  value: number | null;
  pct?: number | null;
  compact?: boolean;
  /** Put the % on a second micro line (keeps chain columns narrow). */
  stacked?: boolean;
  className?: string;
}) {
  if (value === null || !fin(value)) {
    if (pct !== null && pct !== undefined && fin(pct)) return <ChangePct pct={pct} className={className} />;
    return <span className={cn("text-muted-foreground", className)}>{DASH}</span>;
  }
  const up = value > 0;
  const down = value < 0;
  const body = compact ? formatCompactIN(Math.abs(value)) : formatNumberIN(Math.abs(value), 2, { minDecimals: 2 });
  return (
    <span className={cn("whitespace-nowrap", stacked && "inline-flex flex-col items-end leading-none [[data-side=PE]_&]:items-start", up && "text-bullish", down && "text-bearish", !up && !down && "text-muted-foreground", className)}>
      <span className={cn(stacked && "leading-[14px]")}>
        <span aria-hidden="true" className="mr-0.5 text-[10px]">{up ? "▲" : down ? "▼" : ""}</span>
        {up ? "+" : down ? MINUS : ""}
        {body}
      </span>
      {pct !== undefined && pct !== null && fin(pct) && (
        <span className={cn("text-[10px]", stacked ? "leading-[11px]" : "ml-1")}>
          ({pct > 0 ? "+" : pct < 0 ? MINUS : ""}
          {Math.abs(pct) >= 1000 ? ">999" : Math.abs(pct).toFixed(1)}%)
        </span>
      )}
    </span>
  );
}

export function ChangePct({ pct, className }: { pct: number; className?: string }) {
  const up = pct > 0;
  const down = pct < 0;
  return (
    <span className={cn("whitespace-nowrap", up && "text-bullish", down && "text-bearish", !up && !down && "text-muted-foreground", className)}>
      <span aria-hidden="true" className="mr-0.5 text-[10px]">{up ? "▲" : down ? "▼" : ""}</span>
      {up ? "+" : down ? MINUS : ""}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}


export function DerivedMark({ on, children }: { on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <span title="Derived locally with Black-76 from the option price (the feed sent 0)" className="underline decoration-muted-foreground/50 decoration-dotted underline-offset-2">
      {children}
    </span>
  );
}

export function OIBarCell({ lv, ctx }: { lv: LegView; ctx: CellContext }) {
  const max = ctx.model.maxOi || 1;
  const pct = Math.min(100, ((lv.leg.oi || 0) / max) * 100);
  const chg = lv.leg.oiChange || 0;
  const chgPct = Math.min(100, (Math.abs(chg) / (ctx.model.maxAbsOiChg || 1)) * 100);
  const isCE = ctx.side === "CE";
  return (
    <div
      className={cn("flex h-4 w-full min-w-[64px] flex-col justify-center gap-[2px]", isCE ? "items-end" : "items-start")}
      title={`OI ${formatCompactIN(lv.leg.oi)} · ${pct.toFixed(0)}% of the largest strike`}
      aria-hidden="true"
    >
      <div className={cn("h-[7px] rounded-[3px] transition-[width] duration-settle ease-expo", isCE ? "bg-bearish/70" : "bg-bullish/70")} style={{ width: `${Math.max(pct, lv.leg.oi > 0 ? 2 : 0)}%` }} />
      <div className={cn("h-[3px] rounded-[2px] transition-[width] duration-settle ease-expo", chg >= 0 ? (isCE ? "bg-bearish/35" : "bg-bullish/35") : "bg-muted-foreground/35")} style={{ width: `${chgPct}%` }} />
    </div>
  );
}

export function LtpCell({ lv, ctx }: { lv: LegView; ctx: CellContext }) {
  const pct = lv.ltpChgPct;
  return (
    <div className={cn("flex flex-col leading-none", ctx.side === "CE" ? "items-end" : "items-start")}>
      <span className="font-semibold leading-[14px] text-foreground">{lv.leg.ltp > 0 ? num(lv.leg.ltp) : DASH}</span>
      {pct !== null && fin(pct) ? <ChangePct pct={pct} className="text-[10px] leading-[11px]" /> : null}
    </div>
  );
}

export interface TradeButtonsProps {
  strike: number;
  side: OptionType;
  onTrade: (strike: number, type: OptionType, side: Side) => void;
  /** Within ±3 strikes of ATM: buttons stay faintly visible even without hover. */
  near: boolean;
}

/**
 * Buy / sell buttons in their own narrow column next to the strike, so they never cover the LTP.
 * Hidden until row hover or focus on mouse devices (faint on ATM±3), always shown on touch
 * screens, and 32px tall on coarse pointers.
 */
export function TradeButtons({ strike, side, onTrade, near }: TradeButtonsProps) {
  const label = `${strike} ${side}`;
  const btn =
    "grid h-6 w-6 place-items-center rounded-[5px] text-[10px] font-bold transition-[background-color,color,filter] duration-fast active:brightness-95 focus-visible:shadow-focus focus-visible:outline-none [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-7 [@media(pointer:coarse)]:text-[11px]";
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-0.5 transition-opacity duration-fast",
        near ? "opacity-40" : "opacity-0",
        "focus-within:opacity-100 group-hover/row:opacity-100 group-aria-selected/row:opacity-100 [@media(hover:none)]:opacity-100",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTrade(strike, side, "BUY");
        }}
        className={cn(btn, "bg-wash-profit text-bullish shadow-[inset_0_0_0_var(--hairline)_hsl(var(--bullish)/0.35)] hover:bg-bullish hover:text-bullish-foreground")}
        aria-label={`Buy ${label}: add to basket`}
        title={`Buy ${label}`}
      >
        B
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTrade(strike, side, "SELL");
        }}
        className={cn(btn, "bg-wash-loss text-bearish shadow-[inset_0_0_0_var(--hairline)_hsl(var(--bearish)/0.35)] hover:bg-bearish hover:text-bearish-foreground")}
        aria-label={`Sell ${label}: add to basket`}
        title={`Sell ${label}`}
      >
        S
      </button>
    </div>
  );
}

export function LiquidityDots({ score }: { score: number }) {
  if (!score) return <span className="text-muted-foreground">{DASH}</span>;
  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label={`Liquidity ${score} of 5`} title={`Liquidity ${score}/5 (spread and volume rank)`}>
      {[1, 2, 3, 4, 5].map((level) => (
        <span key={level} className={cn("h-1.5 w-1.5 rounded-full", level <= score ? (score >= 4 ? "bg-bullish" : score >= 3 ? "bg-warning" : "bg-bearish") : "bg-control-track")} />
      ))}
    </span>
  );
}
