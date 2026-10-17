import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownUp, Layers } from "lucide-react";
import { ScrollRegion } from "@/components/ScrollRegion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { strategyBuilderUrl } from "@/components/option-chain/basket";
import { EXIT_REASON_LABEL, WEEKDAY_SHORT, legsSummary, tradeToBasketLegs, type ExitReason, type Trade } from "@/lib/backtest";
import { formatDateIST, formatINR, formatNumberIN } from "@/lib/options";
import { cn } from "@/lib/utils";
import { dayMonth, signedINR, tone } from "./format";

const PAGE = 25;

const REASON_VARIANT: Record<ExitReason, "bullish" | "bearish" | "info" | "neutral" | "warning"> = {
  target: "bullish",
  stop: "bearish",
  time: "info",
  dte: "info",
  expiry: "neutral",
  end: "warning",
};

type SortKey = "id" | "net";

/** Short badge text so the table fits beside the form on a laptop. */
const REASON_SHORT: Record<ExitReason, string> = { target: "Target", stop: "Stop", time: "Time", dte: "DTE exit", expiry: "Expiry", end: "Data end" };

/** Per-trade results with an "Open in builder" link for each row. */
export function TradesTable({ trades, symbol, sample }: { trades: Trade[]; symbol: string; sample: boolean }) {
  const [shown, setShown] = useState(PAGE);
  const [sort, setSort] = useState<SortKey>("id");
  const rows = useMemo(() => {
    let cum = 0;
    const withCum = trades.map((t) => ({ t, cum: (cum += t.net) }));
    return sort === "net" ? [...withCum].sort((a, b) => a.t.net - b.t.net) : withCum;
  }, [trades, sort]);
  if (trades.length === 0) return null;
  const visible = rows.slice(0, shown);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-muted-foreground">
          Showing {visible.length} of {trades.length} trades{sort === "net" ? ", worst first" : ""}. Prices are per unit; P&amp;L is for the whole position.
        </p>
        <Button size="pill" variant="ghost" onClick={() => setSort((s) => (s === "id" ? "net" : "id"))} aria-pressed={sort === "net"}>
          <ArrowDownUp aria-hidden="true" /> {sort === "net" ? "Sort by date" : "Worst first"}
        </Button>
      </div>
      <ScrollRegion label="Backtest trades">
        <table className="w-full min-w-[680px] text-body-sm">
          <caption className="sr-only">Backtest trades for {symbol}{sample ? " on the sample dataset" : ""}</caption>
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th scope="col" className="py-2 pl-1 pr-1 font-semibold">#</th>
              <th scope="col" className="px-2 py-2 font-semibold">Entry → exit</th>
              <th scope="col" className="px-2 py-2 font-semibold">Expiry</th>
              <th scope="col" className="px-2 py-2 font-semibold">Legs (entry → exit)</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Spot</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Premium</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Net P&amp;L</th>
              <th scope="col" className="px-2 py-2 font-semibold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="font-num tabular-nums">
            {visible.map(({ t, cum }) => {
              const { legs, droppedFutures } = tradeToBasketLegs(t, symbol);
              return (
                <tr key={t.id} className="border-b border-border/70 align-top last:border-0 hover:bg-surface/70">
                  <td className="py-2 pl-1 pr-1 text-muted-foreground">{t.id}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <span className="font-semibold text-foreground">{dayMonth(t.entryDate)}</span>
                    <span className="text-muted-foreground"> {WEEKDAY_SHORT[t.weekday]}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      → {dayMonth(t.exitDate)} · {t.daysHeld} session{t.daysHeld === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    {formatDateIST(t.expiry)}
                    <span className="block text-[11px] text-muted-foreground">DTE {t.entryDte}{t.vix ? ` · VIX ${formatNumberIN(t.vix, 1)}` : ""}</span>
                  </td>
                  <td className="px-2 py-2">
                    <ul className="space-y-0.5">
                      {t.legs.map((l) => (
                        <li key={`${l.side}-${l.type}-${l.strike}-${l.expiry}`} className="whitespace-nowrap text-[12px]">
                          <span className={cn("font-semibold", l.side === "BUY" ? "text-bullish" : "text-bearish")}>{l.side === "BUY" ? "B" : "S"}</span>{" "}
                          {l.lots}× {l.type === "FUT" ? "FUT" : `${formatNumberIN(l.strike)} ${l.type}`}
                          {l.expiry !== t.expiry ? <span className="text-muted-foreground"> · {dayMonth(l.expiry)}</span> : null}
                          <span className="text-muted-foreground">
                            {" "}
                            {formatNumberIN(l.entry, 2)} → {formatNumberIN(l.exit, 2)}
                          </span>
                          {l.modelEntry || l.modelExit ? (
                            <span className="ml-1 text-warning" title="Priced with Black-76: the strike had no close that day">
                              *
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <span className="sr-only">{legsSummary(t)}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {formatNumberIN(t.entrySpot, 0)}
                    <span className="block text-[11px] text-muted-foreground">→ {formatNumberIN(t.exitSpot, 0)}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    <span className={t.netPremium >= 0 ? "text-bullish" : "text-foreground"} title={t.netPremium >= 0 ? "Net credit received" : "Net debit paid"}>
                      {signedINR(t.netPremium)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatINR(t.charges, { decimals: 0 })} costs
                    </span>
                  </td>
                  <td className={cn("whitespace-nowrap px-2 py-2 text-right font-semibold", tone(t.net))}>
                    <span title={`Running total ${signedINR(cum)}`}>{signedINR(t.net)}</span>
                    <span className="mt-0.5 flex justify-end">
                      <Badge variant={REASON_VARIANT[t.reason]} title={EXIT_REASON_LABEL[t.reason]}>
                        {REASON_SHORT[t.reason]}
                      </Badge>
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    {legs.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild size="pill" variant="outline" className="px-2">
                            <Link to={strategyBuilderUrl(legs)} aria-label={`Open trade ${t.id} in the Strategy Builder`}>
                              <Layers aria-hidden="true" />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[240px] text-xs">
                          Open in the Strategy Builder. Loads the entry legs at their {sample ? "sample " : ""}entry prices for {formatDateIST(t.entryDate)}.
                          {droppedFutures ? " Futures legs are not carried over." : ""}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title="The builder basket carries options only">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Futures
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      {shown < rows.length ? (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" onClick={() => setShown((n) => n + PAGE * 2)}>
            Show {Math.min(PAGE * 2, rows.length - shown)} more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
