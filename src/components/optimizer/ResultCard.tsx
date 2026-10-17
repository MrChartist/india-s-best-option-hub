import { memo } from "react";
import { AlertTriangle, ExternalLink, Info, ShoppingBasket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCompactIN, formatDateIST, formatINR, formatPct, formatStrike } from "@/lib/options";
import { KIND_META, type RankedCandidate, type StrategyBias } from "@/lib/optimizer";
import { cn } from "@/lib/utils";
import { MiniPayoff } from "./MiniPayoff";

export interface PayoffView {
  symbol: string;
  spot: number;
  target: number;
  lower: number;
  upper: number;
  nowMs: number;
  atDateMs: number;
  frontExpiryMs: number;
  atExpiry: boolean;
  r: number;
}

export interface ResultCardProps {
  candidate: RankedCandidate;
  view: PayoffView;
  onOpen: (c: RankedCandidate) => void;
  onAddToBasket: (c: RankedCandidate) => void;
}

const BIAS_VARIANT: Record<StrategyBias, "bullish" | "bearish" | "neutral" | "info"> = {
  bullish: "bullish",
  bearish: "bearish",
  neutral: "neutral",
  volatile: "info",
};

function money(v: number, unlimited: boolean): string {
  if (unlimited || v === Infinity || v === -Infinity) return "Unlimited";
  return formatINR(v, { decimals: 0 });
}

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: "bullish" | "bearish" | "muted"; hint?: string }) {
  return (
    <div className="min-w-0 rounded-tile bg-muted/50 px-2 py-1.5">
      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {label}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="rounded-full text-muted-foreground hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none" aria-label={`About ${label}`}>
                <Info className="h-3 w-3" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[240px] text-xs">{hint}</TooltipContent>
          </Tooltip>
        )}
      </dt>
      <dd
        className={cn(
          "font-num truncate text-[13px] font-semibold tabular-nums",
          tone === "bullish" && "text-bullish",
          tone === "bearish" && "text-bearish",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ResultCardImpl({ candidate: c, view, onOpen, onAddToBasket }: ResultCardProps) {
  const meta = KIND_META[c.kind];
  const credit = c.netPremium > 0;
  return (
    <article className="flex h-full min-w-0 flex-col gap-2.5 rounded-card border border-border bg-card p-3 shadow-card transition-shadow duration-hover hover:shadow-card-hover" aria-label={`${c.label}, rank ${c.rank}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-num text-[11px] font-semibold text-muted-foreground">#{c.rank}</span>
            <Badge variant={BIAS_VARIANT[meta.bias]}>{meta.bias}</Badge>
            {c.definedRisk ? <Badge variant="info">Defined risk</Badge> : <Badge variant="warning">Undefined risk</Badge>}
          </div>
          <h3 className="mt-1 truncate font-display text-[15px] font-bold leading-tight" title={c.label}>
            {c.label}
          </h3>
        </div>
        <span className="shrink-0 rounded-chip bg-wash-brand px-1.5 py-0.5 text-[11px] font-semibold text-primary-ink">
          {c.legs.every((l) => l.ratio === 1) ? `${c.lots} lot${c.lots === 1 ? "" : "s"}` : `${c.lots}× set`}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-tile bg-wash-profit/60 px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Return</div>
          <div className={cn("font-num text-[20px] font-bold leading-tight tabular-nums", c.roi >= 0 ? "text-bullish" : "text-bearish")}>
            {formatPct(c.roi * 100, { decimals: 1, signed: true })}
          </div>
        </div>
        <div className="rounded-tile bg-wash-info/70 px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Chance of profit</div>
          <div className="font-num text-[20px] font-bold leading-tight tabular-nums text-info">{formatPct(c.pop * 100, { decimals: 1 })}</div>
        </div>
      </div>

      <MiniPayoff candidate={c} {...view} />

      <ul className="space-y-0.5 text-[12px]" aria-label="Legs">
        {c.legs.map((l, i) => (
          <li key={i} className="flex items-center justify-between gap-2 font-num tabular-nums">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn("w-9 shrink-0 rounded-chip px-1 text-center text-[10px] font-bold", l.side === "BUY" ? "bg-wash-profit text-bullish" : "bg-wash-loss text-bearish")}>
                {l.side === "BUY" ? "BUY" : "SELL"}
              </span>
              <span className="truncate">
                {l.ratio * c.lots}× {formatStrike(l.strike)} {l.type}
                <span className="text-muted-foreground"> · {formatDateIST(l.expiry)}</span>
              </span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              ₹{l.premium.toFixed(2)}
              {l.noQuote && (
                <span className="ml-1 text-warning" title="No two-sided quote: last traded price used">
                  *
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <Metric label="Net profit" value={formatINR(c.netProfit, { decimals: 0 })} tone={c.netProfit >= 0 ? "bullish" : "bearish"} hint="P&L at your target price and date, after estimated round-trip brokerage, STT, exchange fees, SEBI fee, stamp duty and GST." />
        <Metric label="Max loss" value={money(c.maxLoss, c.unlimitedLoss)} tone="bearish" hint={c.maxIsEstimate ? "Read off a price grid at the front expiry (mixed expiries). An estimate." : "Worst case at expiry, before charges."} />
        <Metric label="Max profit" value={money(c.maxProfit, c.unlimitedProfit)} tone="bullish" hint={c.maxIsEstimate ? "Read off a price grid at the front expiry (mixed expiries). An estimate." : "Best case at expiry, before charges."} />
        <Metric label="Margin (est.)" value={formatINR(c.capital, { decimals: 0 })} hint="SPAN-style estimate with exposure margin and hedge benefit. Your broker's figure will differ." />
        <Metric label={credit ? "Credit" : "Debit"} value={formatINR(Math.abs(c.netPremium), { decimals: 0 })} tone="muted" />
        <Metric label="Charges" value={formatINR(c.charges, { decimals: 0 })} tone="muted" />
      </dl>

      {(c.breakevens.length > 0 || c.quoteWarning || c.hedgeBenefit > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {c.breakevens.length > 0 && <span>Breakeven {c.breakevens.map((b) => formatStrike(Math.round(b))).join(" · ")}</span>}
          {c.hedgeBenefit > 0 && <span>Hedge benefit {formatCompactIN(c.hedgeBenefit, { symbol: true })}</span>}
          {c.quoteWarning && (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> LTP used where no bid/ask
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex gap-2 pt-1">
        <Button size="sm" className="flex-1" onClick={() => onOpen(c)}>
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Open in Builder
        </Button>
        <Button size="sm" variant="outline" onClick={() => onAddToBasket(c)} aria-label={`Add ${c.label} to basket`}>
          <ShoppingBasket className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="ml-1.5 hidden sm:inline">Basket</span>
        </Button>
      </div>
    </article>
  );
}

export const ResultCard = memo(ResultCardImpl);
