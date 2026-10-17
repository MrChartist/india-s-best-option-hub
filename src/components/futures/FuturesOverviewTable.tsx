import { useMemo } from "react";
import { ScrollRegion } from "@/components/ScrollRegion";
import { BuildupBadge, Signed } from "@/components/screener/ScreenerUi";
import { buildFuturesView, type FuturesView, type SeriesView } from "@/lib/futures/model";
import type { SymbolSnapshot } from "@/lib/futures/api";
import { cn } from "@/lib/utils";
import { fmtOi, fmtPrice } from "./format";

function SeriesCell({ s }: { s: SeriesView | undefined }) {
  if (!s) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="font-num tabular-nums">{fmtPrice(s.price)}</span>
      <span className="text-micro">
        <Signed value={s.priceChgPct} />
      </span>
    </div>
  );
}

export interface FuturesOverviewTableProps {
  snapshots: SymbolSnapshot[];
  selected: string;
  onSelect: (symbol: string) => void;
  caption: string;
}

/** Near / next / far prices, basis, carry, roll cost, rollover and OI for a list of symbols. */
export function FuturesOverviewTable({ snapshots, selected, onSelect, caption }: FuturesOverviewTableProps) {
  const rows = useMemo(
    () =>
      snapshots.map((s) => ({
        symbol: s.symbol,
        view: s.latest ? buildFuturesView(s.latest, s.prev) : null,
      })) as Array<{ symbol: string; view: FuturesView | null }>,
    [snapshots],
  );

  return (
    // The right-edge fade (phones only) tells the user the table scrolls sideways; the symbol column is sticky.
    <div className="relative">
      <ScrollRegion label={caption} className="relative">
        <table className="w-full min-w-[980px] border-collapse text-body-sm">
          <caption className="sr-only">
            {caption}. Select a row to see its term structure, rollover and history.
          </caption>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-label uppercase text-muted-foreground">
              <th scope="col" className="sticky left-0 z-10 bg-card py-2 pl-4 pr-2 text-left">
                Symbol
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Spot
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Near
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Next
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Far
              </th>
              <th scope="col" className="px-2 py-2 text-right" title="Near future minus spot, and as % of spot">
                Basis
              </th>
              <th scope="col" className="px-2 py-2 text-right" title="Annualised: (F ÷ S − 1) × 365 ÷ days to expiry">
                Carry p.a.
              </th>
              <th
                scope="col"
                className="px-2 py-2 text-right"
                title="Next minus near, annualised over the gap between the expiries"
              >
                Roll cost p.a.
              </th>
              <th scope="col" className="px-2 py-2 text-right" title="Share of futures OI in the next and far months">
                Rollover
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Fut OI
              </th>
              <th scope="col" className="px-2 py-2 pr-4 text-left" title="Near-month price and OI direction">
                Buildup
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ symbol, view: v }) => {
              const active = symbol === selected;
              const near = v?.series[0];
              return (
                <tr
                  key={symbol}
                  className={cn(
                    "group border-b border-border/60 transition-colors duration-fast hover:bg-accent/50",
                    // Dark wash-brand is a deep orange; at full strength small red/green text drops below 4.5:1.
                    active && "bg-wash-brand dark:bg-wash-brand/40",
                  )}
                >
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 py-1.5 pl-2 pr-2 text-left font-normal group-hover:bg-accent/50",
                      active
                        ? "bg-wash-brand dark:bg-[hsl(var(--card))] dark:bg-[linear-gradient(hsl(var(--wash-brand)/0.4),hsl(var(--wash-brand)/0.4))]"
                        : "bg-card",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(symbol)}
                      aria-pressed={active}
                      className="inline-flex min-h-9 items-center rounded-chip px-2 font-semibold text-foreground hover:text-primary-ink focus-visible:shadow-ember focus-visible:outline-none"
                    >
                      {symbol}
                    </button>
                  </th>
                  {v ? (
                    <>
                      <td className="px-2 text-right font-num tabular-nums">{fmtPrice(v.underlying)}</td>
                      <td className="px-2 text-right">
                        <SeriesCell s={v.series[0]} />
                      </td>
                      <td className="px-2 text-right">
                        <SeriesCell s={v.series[1]} />
                      </td>
                      <td className="px-2 text-right">
                        <SeriesCell s={v.series[2]} />
                      </td>
                      <td className="px-2 text-right">
                        <div className="flex flex-col items-end leading-tight">
                          <Signed value={near?.basis ?? null} suffix="" />
                          <span className="text-micro">
                            <Signed value={near?.basisPct ?? null} />
                          </span>
                        </div>
                      </td>
                      <td className="px-2 text-right">
                        <Signed value={near?.carryPct ?? null} decimals={1} />
                      </td>
                      <td className="px-2 text-right">
                        <Signed value={v.rollCost?.annualisedPct ?? null} decimals={1} />
                      </td>
                      <td className="px-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span
                            aria-hidden="true"
                            className="hidden h-1.5 w-12 overflow-hidden rounded-capsule bg-muted md:block"
                          >
                            <span
                              className="block h-full rounded-capsule bg-primary"
                              style={{ width: `${Math.max(0, Math.min(100, v.rolloverPct ?? 0))}%` }}
                            />
                          </span>
                          <span className="font-num tabular-nums">
                            {v.rolloverPct === null ? "—" : `${v.rolloverPct.toFixed(1)}%`}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 text-right">
                        <div className="flex flex-col items-end leading-tight">
                          <span className="font-num tabular-nums">{fmtOi(v.totalOi)}</span>
                          <span className="text-micro">
                            <Signed value={v.totalOiChgPct} decimals={1} />
                          </span>
                        </div>
                      </td>
                      <td className="px-2 pr-4">
                        {near?.buildup ? (
                          <BuildupBadge buildup={near.buildup} short />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </>
                  ) : (
                    <td colSpan={10} className="px-2 py-2 text-muted-foreground">
                      No futures file for {symbol} yet.
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent lg:hidden"
      />
    </div>
  );
}
