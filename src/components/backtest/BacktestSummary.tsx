import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BacktestStats } from "@/lib/backtest";
import { DASH, formatCompactIN, formatNumberIN } from "@/lib/options";
import { cn } from "@/lib/utils";
import { pct, ratio, signedCompact, tone } from "./format";

interface Tile {
  id: string;
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: string;
  help: string;
}

/** Headline statistics for a backtest run as a grid of tiles. */
export function BacktestSummary({ stats, capital }: { stats: BacktestStats; capital: number }) {
  const s = stats;
  const tiles: Tile[] = [
    {
      id: "net",
      label: "Net P&L",
      value: signedCompact(s.netPnl),
      tone: tone(s.netPnl),
      sub: <>{pct(s.returnPct, 1, true)} on {formatCompactIN(capital, { symbol: true })}</>,
      help: "Total profit after every charge and slippage, and the return on the starting capital.",
    },
    {
      id: "win",
      label: "Win rate",
      value: pct(s.winRate, 1),
      sub: `${s.wins} won · ${s.losses} lost`,
      help: "Share of trades that closed with a net profit. Break-even trades count as losses.",
    },
    {
      id: "exp",
      label: "Expectancy",
      value: signedCompact(s.expectancy),
      tone: tone(s.expectancy),
      sub: `per trade · ${s.trades} trades`,
      help: "Average net P&L per trade: what each new trade has made on average.",
    },
    {
      id: "pf",
      label: "Profit factor",
      value: ratio(s.profitFactor),
      tone: Number.isFinite(s.profitFactor) || s.profitFactor === Infinity ? (s.profitFactor >= 1 ? "text-bullish" : "text-bearish") : undefined,
      sub: Number.isFinite(s.payoffRatio) ? `Avg win ÷ loss ${ratio(s.payoffRatio)}` : DASH,
      help: "Money won on winners divided by money lost on losers. Above 1 is profitable.",
    },
    {
      id: "dd",
      label: "Max drawdown",
      value: s.maxDrawdown > 0 ? `−${formatCompactIN(s.maxDrawdown, { symbol: true })}` : "₹0",
      tone: s.maxDrawdown > 0 ? "text-bearish" : undefined,
      sub: s.maxDrawdown > 0 ? `${pct(-s.maxDrawdownPct, 1)} from peak` : "No drawdown",
      help: "Largest fall of the daily equity curve (including open positions marked at the close) from its previous high.",
    },
    {
      id: "streak",
      label: "Max losing streak",
      value: `${s.maxConsecLosses}`,
      sub: `Best winning streak ${s.maxConsecWins}`,
      help: "Most losing trades in a row. Size positions so you can sit through it.",
    },
    {
      id: "sharpe",
      label: "Sharpe",
      value: ratio(s.sharpe),
      sub: Number.isFinite(s.cagrPct) ? `CAGR ${pct(s.cagrPct, 1, true)}` : `Recovery ${ratio(s.recoveryFactor)}`,
      help: "Annualised Sharpe ratio of daily equity changes (risk-free rate 0). CAGR annualises the return.",
    },
    {
      id: "costs",
      label: "Charges paid",
      value: formatCompactIN(s.charges, { symbol: true }),
      sub: `Avg hold ${Number.isFinite(s.avgDaysHeld) ? formatNumberIN(s.avgDaysHeld, 1) : DASH} sessions`,
      help: "Brokerage, STT (including exercise STT at expiry), exchange, SEBI, stamp duty and GST across all trades.",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="list" aria-label="Backtest summary">
      {tiles.map((t) => (
        <div key={t.id} role="listitem" className="min-w-0 rounded-tile border border-border bg-card px-3 py-2 shadow-card">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="max-w-full truncate rounded-chip text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 focus-visible:shadow-ember focus-visible:outline-none">
                {t.label}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-xs">{t.help}</TooltipContent>
          </Tooltip>
          <div className={cn("truncate font-num text-[17px] font-bold tabular-nums", t.tone)}>{t.value}</div>
          {t.sub ? <div className="truncate text-[11px] text-muted-foreground">{t.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
