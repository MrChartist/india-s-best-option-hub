import type { ReactNode } from "react";
import { Infinity as InfinityIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR, formatPct, formatStrike } from "@/lib/options";
import { cn } from "@/lib/utils";
import { MetricTip } from "./MetricTip";
import type { StrategyAnalysis } from "./strategyAnalysis";

export interface StatsPanelProps {
  a: StrategyAnalysis;
  p50: number;
  spot: number;
  roundTrip: boolean;
}

function Tile({ label, help, children, sub, tone, className, badge }: { label: string; help: ReactNode; children: ReactNode; sub?: ReactNode; tone?: "profit" | "loss"; className?: string; badge?: ReactNode }) {
  return (
    <div className={cn("rounded-tile border border-border bg-card p-2.5", tone === "profit" && "bg-wash-profit/40", tone === "loss" && "bg-wash-loss/40", className)}>
      <div className="flex items-center gap-1 text-label uppercase text-muted-foreground">
        <span className="truncate">{label}</span>
        <MetricTip label={label}>{help}</MetricTip>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      <div className="mt-1 font-num text-base font-bold leading-tight">{children}</div>
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

const pct = (p: number) => (Number.isFinite(p) ? formatPct(p * 100, { decimals: 1 }) : "—");
const levels = (xs: number[]) => (xs.length ? xs.map((x) => formatStrike(Math.round(x))).join(" · ") : "None");

export function StatsPanel({ a, p50, spot, roundTrip }: StatsPanelProps) {
  if (a.empty) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">Stats appear once at least one leg is switched on.</CardContent>
      </Card>
    );
  }
  const m = a.margin;
  const beDist = a.breakevens.map((b) => ((b - spot) / spot) * 100);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      <Tile label="Max profit" tone="profit" help={a.multiExpiry ? "Highest P&L at the front expiry, with later legs valued by the model." : "Highest P&L at expiry. Unlimited when net call or futures exposure is long."}>
        {a.unlimitedProfit ? <Unlimited tone="profit" /> : <span className="text-bullish">{formatINR(a.maxProfit, { decimals: 0 })}</span>}
      </Tile>
      <Tile label="Max loss" tone="loss" help="Worst P&L at expiry. Unlimited when you are net short calls or futures (or naked short puts down to zero).">
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
      <Tile label="P50" help="Chance of touching 50% of max profit at any day-end before expiry (Monte-Carlo, 1,200 paths). Useful for take-profit rules." sub={a.multiExpiry ? "Single expiry only" : !Number.isFinite(a.maxProfit) ? "Needs capped profit" : "Touch 50% of max profit"}>
        {pct(p50)}
      </Tile>
      <Tile label="Expected value" help="Average expiry P&L under the same lognormal model, before charges. Close to zero for fairly priced options; negative EV means you pay for the edge you hope to have.">
        <span className={a.ev >= 0 ? "text-bullish" : "text-bearish"}>{formatINR(a.ev, { decimals: 0 })}</span>
      </Tile>
      <Tile label="Breakevens" help="Underlying prices where expiry P&L is zero. 'After costs' subtracts round-trip brokerage, STT, exchange fees, stamp duty and GST." className="col-span-2" sub={<>After costs: <span className="font-num">{levels(a.breakevensNet)}</span></>}>
        <span className="text-sm">{levels(a.breakevens)}</span>
        {beDist.length > 0 && <span className="ml-2 text-[11px] font-normal text-muted-foreground">({beDist.map((d) => formatPct(d, { decimals: 1, signed: true })).join(", ")})</span>}
      </Tile>
      <Tile label="Margin" badge={<Badge variant="warning">Est.</Badge>} help="SPAN-style estimate: 16 price/volatility scenarios plus exposure margin (and expiry-day ELM for short index options). Your broker's number will differ." sub={m.hedgeBenefit > 0 ? <>Hedge benefit <span className="font-num text-bullish">{formatINR(m.hedgeBenefit, { decimals: 0 })}</span> vs naked {formatINR(m.nakedTotal, { decimals: 0 })}</> : m.method === "long-only" ? "Premium only (long options)" : "No hedge benefit"}>
        {formatINR(m.total, { decimals: 0 })}
      </Tile>
      <Tile label="Return on margin" help="Max profit divided by estimated margin. Not shown when profit is unlimited.">
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
