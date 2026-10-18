import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Infinity as InfinityIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR, formatPct, formatStrike, marginFundsRequired } from "@/lib/options";
import { cn } from "@/lib/utils";
import { MetricTip } from "./MetricTip";
import type { StrategyAnalysis } from "./strategyAnalysis";

export interface StatsPanelProps {
  a: StrategyAnalysis;
  p50: number;
  spot: number;
  roundTrip: boolean;
}

interface TileProps {
  label: string;
  help: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
  className?: string;
  badge?: ReactNode;
  /** Learn lesson linked from the help tip. */
  helpHref?: string;
}

function Tile({ label, help, children, sub, className, badge, helpHref }: TileProps) {
  return (
    <div className={cn("min-w-0 rounded-tile border border-separator bg-card px-3 py-2.5 shadow-card", className)}>
      <div className="flex items-start gap-1 text-label text-muted-foreground">
        <span className="min-w-0 break-words leading-tight">{label}</span>
        <MetricTip label={label} href={helpHref}>
          {help}
        </MetricTip>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      <div className="mt-1 font-num text-lead font-semibold">{children}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Unlimited({ tone }: { tone: "profit" | "loss" }) {
  return (
    <span className={cn("inline-flex items-center gap-1", tone === "profit" ? "text-bullish" : "text-bearish")}>
      <InfinityIcon className="h-4 w-4" aria-hidden="true" />
      <span>Unlimited</span>
    </span>
  );
}

const POP_LESSON = "/learn/probability-of-profit";

const pct = (p: number) => (Number.isFinite(p) ? formatPct(p * 100, { decimals: 1 }) : "—");
const levels = (xs: number[]) => (xs.length ? xs.map((x) => formatStrike(Math.round(x))).join(" · ") : "None");

export function StatsPanel({ a, p50, spot, roundTrip }: StatsPanelProps) {
  if (a.empty) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-body text-muted-foreground">Stats appear once at least one leg is switched on.</CardContent>
      </Card>
    );
  }
  const m = a.margin;
  const beDist = a.breakevens.map((b) => ((b - spot) / spot) * 100);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      <Tile label="Max profit" help={a.multiExpiry ? "Highest P&L at the front expiry, with later legs valued by the model." : "Highest P&L at expiry. Unlimited when net call or futures exposure is long."}>
        {a.unlimitedProfit ? <Unlimited tone="profit" /> : <span className="text-bullish">{formatINR(a.maxProfit, { decimals: 0 })}</span>}
      </Tile>
      <Tile label="Max loss" help="Worst P&L at expiry. Unlimited when you are net short calls or futures (or naked short puts down to zero).">
        {a.unlimitedLoss ? <Unlimited tone="loss" /> : <span className="text-bearish">{formatINR(a.maxLoss, { decimals: 0 })}</span>}
      </Tile>
      <Tile label="Reward : risk" help="Max profit divided by max loss. Shown only when both are capped.">
        {a.riskReward !== null ? `${a.riskReward.toFixed(2)} : 1` : <span className="text-muted-foreground">—</span>}
        {a.riskReward === null && <span className="sr-only">Not defined because profit or loss is unlimited</span>}
      </Tile>
      <Tile
        label="Prob. of profit"
        help="Chance the position is in profit at expiry, from a lognormal model on the forward using each strike's own IV (the smile). Not a forecast."
        sub={a.multiExpiry ? "At front expiry (model)" : "Lognormal, per-strike IV"}
      >
        <span className={a.pop >= 0.5 ? "text-bullish" : "text-bearish"}>{pct(a.pop)}</span>
      </Tile>
      <Tile
        label="Chance to hit 50% profit"
        helpHref={POP_LESSON}
        badge={<span className="rounded-chip bg-control-track px-1 font-num text-micro text-muted-foreground">P50</span>}
        help="Also called P50: the chance of touching 50% of max profit at any day-end before expiry (Monte-Carlo, 1,200 lognormal paths). Useful for take-profit rules; higher than POP for most credit trades."
        sub={
          <>
            {a.multiExpiry ? "Single expiry only" : !Number.isFinite(a.maxProfit) ? "Needs capped profit" : "Touch 50% of max profit"} ·{" "}
            <Link to={POP_LESSON} className="text-primary-ink underline underline-offset-2">
              Lesson
            </Link>
          </>
        }
      >
        {pct(p50)}
      </Tile>
      <Tile label="Expected value" help="Average expiry P&L under the same lognormal model, before charges. Close to zero for fairly priced options; negative EV means you pay for the edge you hope to have.">
        <span className={a.ev >= 0 ? "text-bullish" : "text-bearish"}>{formatINR(a.ev, { decimals: 0 })}</span>
      </Tile>
      <Tile label="Breakevens" help="Underlying prices where expiry P&L is zero. 'After costs' subtracts round-trip brokerage, STT, exchange fees, stamp duty and GST." className="col-span-2" sub={<>After costs: <span className="font-num">{levels(a.breakevensNet)}</span></>}>
        <span className="text-body">{levels(a.breakevens)}</span>
        {beDist.length > 0 && <span className="ml-2 text-body-sm font-normal text-muted-foreground">({beDist.map((d) => formatPct(d, { decimals: 1, signed: true })).join(", ")})</span>}
      </Tile>
      <Tile
        label="Funds required"
        className="col-span-2"
        badge={<Badge variant="warning">Est.</Badge>}
        help="Funds to put on the trade: a SPAN-style estimate (16 price/volatility scenarios) plus exposure margin and the extra expiry-day ELM on short index options, plus the net premium paid. The same number the Optimizer shows. Your broker's number will differ."
        sub={
          <>
            <span className="block font-num">
              SPAN {formatINR(m.span, { decimals: 0 })} · Exposure {formatINR(m.exposure, { decimals: 0 })} · Expiry-day ELM {formatINR(m.elmExpiryDay, { decimals: 0 })}
            </span>
            <span className="block">
              {m.hedgeBenefit > 0 ? (
                <>
                  Hedge benefit <span className="font-num text-bullish">{formatINR(m.hedgeBenefit, { decimals: 0 })}</span> vs naked {formatINR(m.nakedTotal, { decimals: 0 })}
                </>
              ) : m.method === "long-only" ? (
                "Premium only (long options)"
              ) : (
                "No hedge benefit"
              )}
            </span>
          </>
        }
      >
        {formatINR(marginFundsRequired(m), { decimals: 0 })}
      </Tile>
      <Tile label="Return on funds" help="Max profit divided by the funds required (same basis as the Optimizer). Not shown when profit is unlimited.">
        {a.returnOnMargin !== null ? formatPct(a.returnOnMargin * 100, { decimals: 1 }) : <span className="text-muted-foreground">—</span>}
      </Tile>
      <Tile label={roundTrip ? "Charges (round trip)" : "Charges (entry)"} help="Brokerage, STT, exchange transaction charges, SEBI fee, stamp duty and GST at current rates. See the breakdown below.">
        {formatINR(a.charges.total, { decimals: 0 })}
      </Tile>
      <Tile label="P&L now" help="Model P&L if you exited at the current spot right now, using today's IV. Differs from zero when entry prices differ from model prices.">
        <span className={a.pnlNow >= 0 ? "text-bullish" : "text-bearish"}>{formatINR(a.pnlNow, { decimals: 0 })}</span>
      </Tile>
    </div>
  );
}
