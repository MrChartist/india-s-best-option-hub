import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatCompactIN, formatNumberIN, MINUS } from "@/lib/options";
import type { LegView } from "./chainModel";
import type { CellContext } from "./columns";

const DASH = "—";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function num(v: number, dp = 2): string {
  return fin(v) ? formatNumberIN(v, dp, { minDecimals: dp }) : DASH;
}

/** "▲ +1.2L" style change with sign, arrow and colour. */
export function ChangeText({ value, pct, compact = false, className }: { value: number | null; pct?: number | null; compact?: boolean; className?: string }) {
  if (value === null || !fin(value)) {
    if (pct !== null && pct !== undefined && fin(pct)) return <ChangePct pct={pct} className={className} />;
    return <span className={cn("text-muted-foreground", className)}>{DASH}</span>;
  }
  const up = value > 0;
  const down = value < 0;
  const body = compact ? formatCompactIN(Math.abs(value)) : formatNumberIN(Math.abs(value), 2, { minDecimals: 2 });
  return (
    <span className={cn("whitespace-nowrap", up && "text-bullish", down && "text-bearish", !up && !down && "text-muted-foreground", className)}>
      <span aria-hidden="true" className="mr-0.5 text-[10px]">{up ? "▲" : down ? "▼" : ""}</span>
      {up ? "+" : down ? MINUS : ""}
      {body}
      {pct !== undefined && pct !== null && fin(pct) && (
        <span className="ml-1 text-[10px] opacity-80">
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
  const isCE = ctx.side === "CE";
  const strike = ctx.row.strike;
  const label = `${strike} ${ctx.side}`;
  return (
    <div className={cn("group/ltp relative flex items-center gap-1", isCE ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "pointer-events-none absolute top-1/2 z-[1] flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity duration-fast focus-within:pointer-events-auto focus-within:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-aria-selected/row:pointer-events-auto group-aria-selected/row:opacity-100",
          isCE ? "left-0" : "right-0",
        )}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); ctx.onTrade(strike, ctx.side, "BUY"); }}
          className="h-5 w-5 rounded-chip bg-bullish text-[10px] font-bold text-bullish-foreground shadow-card focus-visible:opacity-100 focus-visible:shadow-ember focus-visible:outline-none"
          aria-label={`Buy ${label}: add to basket`}
          title={`Buy ${label}`}
        >
          B
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); ctx.onTrade(strike, ctx.side, "SELL"); }}
          className="h-5 w-5 rounded-chip bg-bearish text-[10px] font-bold text-bearish-foreground shadow-card focus-visible:opacity-100 focus-visible:shadow-ember focus-visible:outline-none"
          aria-label={`Sell ${label}: add to basket`}
          title={`Sell ${label}`}
        >
          S
        </button>
      </div>
      <span className="font-semibold text-foreground">{lv.leg.ltp > 0 ? num(lv.leg.ltp) : DASH}</span>
    </div>
  );
}

export function LiquidityDots({ score }: { score: number }) {
  if (!score) return <span className="text-muted-foreground">{DASH}</span>;
  return (
    <span className="inline-flex items-center gap-[3px]" role="img" aria-label={`Liquidity ${score} of 5`} title={`Liquidity ${score}/5 (spread and volume rank)`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i <= score ? (score >= 4 ? "bg-bullish" : score >= 3 ? "bg-warning" : "bg-bearish") : "bg-muted")} />
      ))}
    </span>
  );
}
