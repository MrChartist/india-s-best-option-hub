/**
 * Top five F&O gainers and losers with a three-month sparkline (hidden for sample rows, which have no
 * history). Symbols link to the option chain.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MiniChart } from "@/components/MiniChart";
import { ScrollRegion } from "@/components/ScrollRegion";
import type { FnOStockData } from "@/lib/marketApi";
import { formatCompactIN, formatNumberIN, formatPct } from "@/lib/options";
import { cn } from "@/lib/utils";
import { sourceName, statusFrom } from "./dashboardModel";
import { DataState, DataStatus } from "./DataState";
import { useDensityClasses } from "./density";
import { useDashFno } from "./useDashboardData";

export function TopMovers() {
  const q = useDashFno();
  const d = useDensityClasses();
  const gainers = q.data?.gainers ?? [];
  const losers = q.data?.losers ?? [];
  const status = statusFrom({ isLoading: q.isLoading, isError: q.isError, hasData: gainers.length + losers.length > 0, source: q.data?.source, stale: q.data?.stale, isLive: q.data?.isLive });
  const chip = <DataStatus status={status} lastUpdated={q.data?.asOf} source={sourceName(q.data?.source)} reason={q.data?.reason} />;

  return (
    <div className={cn("grid lg:grid-cols-2", d.gap)}>
      <MoversCard title="Top gainers" up rows={gainers} status={status} chip={chip} onRetry={() => void q.refetch()} />
      <MoversCard title="Top losers" up={false} rows={losers} status={status} chip={chip} onRetry={() => void q.refetch()} />
    </div>
  );
}

function MoversCard({ title, up, rows, status, chip, onRetry }: { title: string; up: boolean; rows: FnOStockData[]; status: ReturnType<typeof statusFrom>; chip: ReactNode; onRetry: () => void }) {
  const sample = status === "sample";
  // Sample rows have no price history, so the sparkline column would be "—" on every row: hide it.
  const showSpark = !sample;
  const d = useDensityClasses();
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="overflow-hidden">
      <div className={cn("flex items-center gap-2", d.headPad)}>
        <Icon className={cn("h-4 w-4", up ? "text-bullish" : "text-bearish")} aria-hidden="true" />
        <h3 className="font-display text-lead font-bold">{title}</h3>
        <div className="ml-auto">{chip}</div>
      </div>
      <DataState status={status !== "loading" && status !== "error" && rows.length === 0 ? "empty" : status} onRetry={onRetry} className={d.padX} emptyText={up ? "No gainers right now" : "No losers right now"} emptyHint="F&O stock prices load from NSE during market hours">
        <ScrollRegion label={`${title} table`}>
          <table className="w-full text-body">
            <caption className="sr-only">{title} among F&O stocks</caption>
            <thead>
              <tr className="border-y border-border text-left text-label uppercase text-muted-foreground">
                <th scope="col" className={cn("px-4 font-[650]", d.cell)}>Symbol</th>
                <th scope="col" className={cn("px-2 text-right font-[650]", d.cell)}>LTP</th>
                <th scope="col" className={cn("px-2 text-right font-[650]", d.cell)}>Change</th>
                {showSpark ? <th scope="col" className={cn("hidden px-2 text-center font-[650] sm:table-cell", d.cell)}>3M</th> : null}
                <th scope="col" className={cn("px-4 text-right font-[650]", d.cell)}>Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.symbol} className="border-b border-border last:border-0 hover:bg-accent/40">
                  <th scope="row" className={cn("px-4 text-left font-medium", d.cell)}>
                    <Link to={`/option-chain?symbol=${encodeURIComponent(s.symbol)}`} className="rounded-sm hover:underline focus-visible:shadow-ember focus-visible:outline-none" aria-label={`${s.symbol}, open option chain`}>
                      {s.symbol}
                    </Link>
                  </th>
                  <td className={cn("px-2 text-right font-num tabular-nums", d.cell)}>{formatNumberIN(s.ltp, 2, { minDecimals: 2 })}</td>
                  <td className={cn("px-2 text-right", d.cell)}>
                    <span className={cn("inline-flex rounded-chip px-1.5 py-0.5 font-num text-body-sm font-semibold tabular-nums", up ? "bg-wash-profit text-bullish" : "bg-wash-loss text-bearish")}>
                      <span aria-hidden="true">{up ? "▲" : "▼"}&nbsp;</span>
                      {formatPct(s.changePercent, { signed: true })}
                    </span>
                  </td>
                  {showSpark ? (
                    <td className={cn("hidden px-2 sm:table-cell", d.cell)}>
                      <div className="flex justify-center">
                        <MiniChart symbol={s.symbol} width={72} height={24} />
                      </div>
                    </td>
                  ) : null}
                  <td className={cn("px-4 text-right font-num tabular-nums text-muted-foreground", d.cell)}>{s.volume > 0 ? formatCompactIN(s.volume) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </DataState>
    </Card>
  );
}

export default TopMovers;
