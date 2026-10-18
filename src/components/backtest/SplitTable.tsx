import { ScrollRegion } from "@/components/ScrollRegion";
import type { SplitRow } from "@/lib/backtest";
import { cn } from "@/lib/utils";
import { pct, ratio, signedINR, tone } from "./format";

/** Trades grouped by a key (VIX regime, weekday, exit reason) with a bar for each group's net P&L. */
export function SplitTable({ rows, caption, groupLabel, empty }: { rows: SplitRow[]; caption: string; groupLabel: string; empty: string }) {
  if (rows.length === 0) return <p className="px-1 py-6 text-center text-body-sm text-muted-foreground">{empty}</p>;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  return (
    <ScrollRegion label={caption}>
      <table className="w-full min-w-[560px] text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="[&_th]:shadow-[inset_0_calc(-1*var(--hairline))_0_hsl(var(--separator-strong))]">
          <tr className="text-left">
            <th scope="col" className="px-2 py-1.5">{groupLabel}</th>
            <th scope="col" className="px-2 py-1.5 text-right">Trades</th>
            <th scope="col" className="px-2 py-1.5 text-right">Win rate</th>
            <th scope="col" className="px-2 py-1.5 text-right">Expectancy</th>
            <th scope="col" className="px-2 py-1.5 text-right">Profit factor</th>
            <th scope="col" className="px-2 py-1.5 text-right">Net P&amp;L</th>
            <th scope="col" className="w-[28%] px-2 py-1.5"><span className="sr-only">Share of P&amp;L</span></th>
          </tr>
        </thead>
        <tbody className="zebra-rows font-num tabular-nums">
          {rows.map((r) => {
            const w = (Math.abs(r.net) / maxAbs) * 50;
            return (
              <tr key={r.key}>
                <th scope="row" className="px-2 py-1.5 text-left font-sans font-semibold text-foreground">
                  {r.label}
                  {r.hint ? <span className="block text-body-sm font-normal text-muted-foreground">{r.hint}</span> : null}
                </th>
                <td className="px-2 py-1.5 text-right">{r.trades}</td>
                <td className="px-2 py-1.5 text-right">{pct(r.winRate, 0)}</td>
                <td className={cn("px-2 py-1.5 text-right", tone(r.expectancy))}>{signedINR(r.expectancy)}</td>
                <td className="px-2 py-1.5 text-right">{ratio(r.profitFactor)}</td>
                <td className={cn("px-2 py-1.5 text-right font-semibold", tone(r.net))}>{signedINR(r.net)}</td>
                <td className="px-2 py-1.5" aria-hidden="true">
                  <div className="relative h-2 rounded-pill bg-control-track">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-separator-strong" />
                    <div
                      className={cn("absolute inset-y-0 rounded-pill", r.net >= 0 ? "left-1/2 bg-bullish/70" : "right-1/2 bg-bearish/70")}
                      style={{ width: `${w}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
