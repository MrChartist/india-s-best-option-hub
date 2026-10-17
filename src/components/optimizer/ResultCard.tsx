import { memo, type ReactNode } from "react";
import { AlertTriangle, ExternalLink, Info, NotebookPen, ShoppingBasket, Target } from "lucide-react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCompactIN, formatDateIST, formatINR, formatPct, formatStrike } from "@/lib/options";
import type { RankedCandidate } from "@/lib/optimizer";
import { cn } from "@/lib/utils";
import { MiniPayoff } from "./MiniPayoff";
import {
  ELM_HINT,
  FUNDS_HINT,
  RETURN_HINT,
  TONE_VARIANT,
  VIEW_HINT_DIRECTIONAL,
  VIEW_HINT_NEUTRAL,
  money,
  sizeLabel,
  tagFor,
  type PayoffView,
  type ResultActions,
} from "./resultHelpers";

export type { PayoffView } from "./resultHelpers";

export interface ResultCardProps extends ResultActions {
  candidate: RankedCandidate;
  view: PayoffView;
  /** The top card gets the filled "Open in Builder" button; the rest are outline. */
  primary?: boolean;
  /** Neutral view: explain why "matches your view" was given. */
  neutralView?: boolean;
}

/** Small chip with a tooltip explaining it (a real button so keyboard users can reach the hint). */
export function HintChip({ label, hint, variant, icon }: { label: string; hint: string; variant: "bullish" | "bearish" | "neutral" | "info" | "warning" | "default"; icon?: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn(badgeVariants({ variant }), "cursor-help")} aria-label={`${label}: ${hint}`}>
          {icon}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
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

function ResultCardImpl({ candidate: c, view, onOpen, onAddToBasket, onPaperTrade, primary = false, neutralView = false }: ResultCardProps) {
  const credit = c.netPremium > 0;
  const tag = tagFor(c, view);
  return (
    <article
      className={cn(
        "flex h-full min-w-0 flex-col gap-2.5 rounded-card border bg-card p-3 shadow-card transition-shadow duration-hover hover:shadow-card-hover",
        primary ? "border-primary/60" : "border-border",
      )}
      aria-label={`${c.label}, rank ${c.rank}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-num text-[11px] font-semibold text-muted-foreground">#{c.rank}</span>
            {c.definedRisk ? <Badge variant="info">Defined risk</Badge> : <Badge variant="warning">Undefined risk</Badge>}
            {c.matchesView && <HintChip label="Matches your view" hint={neutralView ? VIEW_HINT_NEUTRAL : VIEW_HINT_DIRECTIONAL} variant="default" icon={<Target aria-hidden="true" />} />}
          </div>
          <h3 className="mt-1 truncate font-display text-[15px] font-bold leading-tight" title={c.label}>
            {c.label}
          </h3>
        </div>
        <span className="shrink-0 rounded-chip bg-wash-brand px-1.5 py-0.5 text-[11px] font-semibold text-primary-ink">{sizeLabel(c)}</span>
      </header>

      <div className="flex items-start gap-1.5 text-[12px] font-semibold leading-snug">
        <Badge variant={TONE_VARIANT[tag.tone]} className="mt-px shrink-0">
          {tag.tone === "volatile" ? "Big move" : tag.tone}
        </Badge>
        <span className="min-w-0">{tag.text}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-tile bg-wash-profit/60 px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Return on funds</div>
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
        {c.legs.map((l) => (
          <li key={`${l.side}-${l.type}-${l.strike}-${l.expiry}`} className="flex items-center justify-between gap-2 font-num tabular-nums">
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
              {formatINR(l.premium, { decimals: 2 })}
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
        <Metric label="Net profit" value={formatINR(c.netProfit, { decimals: 0 })} tone={c.netProfit >= 0 ? "bullish" : "bearish"} hint={RETURN_HINT} />
        <Metric label="Max loss" value={money(c.maxLoss, c.unlimitedLoss)} tone="bearish" hint={c.maxIsEstimate ? "Read off a price grid at the front expiry (mixed expiries). An estimate." : "Worst case at expiry, before charges."} />
        <Metric label="Max profit" value={money(c.maxProfit, c.unlimitedProfit)} tone="bullish" hint={c.maxIsEstimate ? "Read off a price grid at the front expiry (mixed expiries). An estimate." : "Best case at expiry, before charges."} />
        <Metric label="Funds (est.)" value={formatINR(c.fundsRequired, { decimals: 0 })} hint={FUNDS_HINT} />
        <Metric label={credit ? "Credit" : "Debit"} value={formatINR(Math.abs(c.netPremium), { decimals: 0 })} tone="muted" />
        <Metric label="Charges" value={formatINR(c.charges, { decimals: 0 })} tone="muted" />
      </dl>

      {(c.elm > 0 || c.breakevens.length > 0 || c.quoteWarning || c.hedgeBenefit > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {c.elm > 0 && <HintChip label="incl. expiry-day ELM" hint={`${ELM_HINT} ELM here: ${formatINR(c.elm, { decimals: 0 })}.`} variant="warning" />}
          {c.breakevens.length > 0 && <span>Breakeven {c.breakevens.map((b) => formatStrike(Math.round(b))).join(" · ")}</span>}
          {c.hedgeBenefit > 0 && <span>Hedge benefit {formatCompactIN(c.hedgeBenefit, { symbol: true })}</span>}
          {c.quoteWarning && (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> LTP used where no bid/ask
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant={primary ? "default" : "outline"} className="min-w-[9rem] flex-1" onClick={() => onOpen(c)}>
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Open in Builder
        </Button>
        <Button size="sm" variant="outline" onClick={() => onPaperTrade(c)}>
          <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="ml-1.5">Paper trade</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAddToBasket(c)} aria-label={`Add ${c.label} to basket`}>
          <ShoppingBasket className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="ml-1.5 hidden sm:inline">Basket</span>
        </Button>
      </div>
    </article>
  );
}

export const ResultCard = memo(ResultCardImpl);
