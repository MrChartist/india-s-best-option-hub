/**
 * Ten most active F&O stocks by traded volume, with OI and the price/OI buildup when NSE OI is
 * available. Without OI the card shows price change only (no invented "buy/sell" labels).
 */
import { Link } from "react-router-dom";
import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollRegion } from "@/components/ScrollRegion";
import { formatCompactIN, formatNumberIN, formatPct } from "@/lib/options";
import { cn } from "@/lib/utils";
import { ARROW, signTone, sourceName, statusFrom } from "./dashboardModel";
import { DataState, DataStatus } from "./DataState";
import { useDensityClasses } from "./density";
import { useDashFno } from "./useDashboardData";

const BUILDUP: Record<string, { short: string; variant: "bullish" | "bearish" | "info" | "warning" | "neutral" }> = {
  "Long Buildup": { short: "Long buildup", variant: "bullish" },
  "Short Buildup": { short: "Short buildup", variant: "bearish" },
  "Short Covering": { short: "Short covering", variant: "info" },
  "Long Unwinding": { short: "Long unwinding", variant: "warning" },
  Neutral: { short: "Neutral", variant: "neutral" },
};

export function MostActiveFnO() {
  const q = useDashFno();
  const d = useDensityClasses();
  const rows = q.data?.mostActive ?? [];
  const hasOI = q.data?.source === "nse" || q.data?.source === "database" || q.data?.source === "sample";
  const status = statusFrom({ isLoading: q.isLoading, isError: q.isError, hasData: rows.length > 0, source: q.data?.source, stale: q.data?.stale, isLive: q.data?.isLive });

  return (
    <Card className="overflow-hidden">
      <div className={cn("flex flex-wrap items-center gap-2", d.headPad)}>
        <Zap className="h-4 w-4 text-warning" aria-hidden="true" />
        <h3 className="font-display text-headline">Most active by volume</h3>
        {!hasOI && rows.length > 0 ? <span className="text-body-sm text-muted-foreground">OI not available from this source</span> : null}
        <div className="ml-auto">
          <DataStatus status={status} lastUpdated={q.data?.asOf} source={sourceName(q.data?.source)} reason={q.data?.reason} />
        </div>
      </div>
      <DataState status={status} onRetry={() => void q.refetch()} className={d.padX} emptyText="No F&O activity data" emptyHint="Loads from NSE during market hours">
        <ScrollRegion label="Most active F&O stocks table">
          <table className="w-full min-w-[560px] text-body">
            <caption className="sr-only">Most active F&O stocks by volume</caption>
            <thead>
              <tr className="text-left text-label text-muted-foreground [&>th]:hairline-b">
                <th scope="col" className={cn("px-4 font-semibold", d.cell)}>Symbol</th>
                <th scope="col" className={cn("px-2 text-right font-semibold", d.cell)}>LTP</th>
                <th scope="col" className={cn("px-2 text-right font-semibold", d.cell)}>Change</th>
                <th scope="col" className={cn("px-2 text-right font-semibold", d.cell)}>Volume</th>
                {hasOI ? <th scope="col" className={cn("px-2 text-right font-semibold", d.cell)}>OI</th> : null}
                {hasOI ? <th scope="col" className={cn("px-2 text-right font-semibold", d.cell)}>OI chg</th> : null}
                {hasOI ? <th scope="col" className={cn("px-4 font-semibold", d.cell)}>Buildup</th> : null}
              </tr>
            </thead>
            <tbody className="zebra-rows">
              {rows.map((s) => {
                const b = BUILDUP[s.oiInterpretation] ?? BUILDUP.Neutral;
                const dir = s.changePercent > 0 ? "up" : s.changePercent < 0 ? "down" : "flat";
                return (
                  <tr key={s.symbol} className="hover:bg-control-track">
                    <th scope="row" className={cn("px-4 text-left font-medium", d.cell)}>
                      <Link to={`/option-chain?symbol=${encodeURIComponent(s.symbol)}`} className="rounded-sm hover:underline focus-visible:shadow-focus focus-visible:outline-none" aria-label={`${s.symbol}, open option chain`}>
                        {s.symbol}
                      </Link>
                    </th>
                    <td className={cn("px-2 text-right font-num tabular-nums", d.cell)}>{formatNumberIN(s.ltp, 2, { minDecimals: 2 })}</td>
                    <td className={cn("px-2 text-right font-num font-semibold tabular-nums", signTone(s.changePercent), d.cell)}>
                      <span aria-hidden="true">{ARROW[dir]} </span>
                      {formatPct(s.changePercent, { signed: true })}
                    </td>
                    <td className={cn("px-2 text-right font-num tabular-nums text-muted-foreground", d.cell)}>{s.volume > 0 ? formatCompactIN(s.volume) : "—"}</td>
                    {hasOI ? <td className={cn("px-2 text-right font-num tabular-nums", d.cell)}>{s.oi > 0 ? formatCompactIN(s.oi) : "—"}</td> : null}
                    {hasOI ? (
                      <td className={cn("px-2 text-right font-num tabular-nums", signTone(s.oiChange), d.cell)}>
                        {s.oiChange ? `${s.oiChange > 0 ? "+" : ""}${formatCompactIN(s.oiChange)}` : "—"}
                      </td>
                    ) : null}
                    {hasOI ? (
                      <td className={cn("px-4", d.cell)}>
                        <Badge variant={b.variant}>{b.short}</Badge>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
        <p className="px-4 py-2 text-body-sm text-muted-foreground">Volume and OI are in shares. Buildup compares today's price change with the OI change.</p>
      </DataState>
    </Card>
  );
}
