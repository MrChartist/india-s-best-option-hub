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
        <table className="w-full min-w-[980px] border-collapse text-body">
          <caption className="sr-only">
            {caption}. Select a row to see its term structure, rollover and history.
          </caption>
          <thead>
            <tr className="border-b border-separator-strong bg-surface text-label text-muted-foreground">
              <th scope="col" className="sticky left-0 z-10 h-7 bg-surface py-1 pl-4 pr-2 text-left">
                Symbol
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                Spot
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                Near
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                Next
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                Far
              </th>
              <th scope="col" className="px-2 py-1 text-right" title="Near future minus spot, and as % of spot">
                Basis
              </th>
              <th scope="col" className="px-2 py-1 text-right" title="Annualised: (F ÷ S − 1) × 365 ÷ days to expiry">
                Carry p.a.
              </th>
              <th
                scope="col"
                className="px-2 py-1 text-right"
                title="Next minus near, annualised over the gap between the expiries"
              >
                Roll cost p.a.
              </th>
              <th scope="col" className="px-2 py-1 text-right" title="Share of futures OI in the next and far months">
                Rollover
              </th>
              <th scope="col" className="px-2 py-1 text-right">
                Fut OI
              </th>
              <th scope="col" className="px-2 py-1 pr-4 text-left" title="Near-month price and OI direction">
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
                    // Finder-style selection: a neutral fill (the accent pill is reserved for focused lists),
                    // so the red/green figures in the row keep their contrast. In dark mode the 10% selection
                    // fill drops the 10px bearish % lines below 4.5:1, so the selected row uses the lighter
                    // control-track fill there and hover steps down to the zebra tint.
                    "group border-b border-separator transition-colors duration-fast last:border-0 hover:bg-control-track dark:hover:bg-zebra",
                    active &&
                      "bg-selection-unfocused hover:bg-selection-unfocused dark:bg-control-track dark:hover:bg-control-track",
                  )}
                >
                  <th
                    scope="row"
                    className={cn(
                      // Sticky cell: opaque card underneath, row tint layered on top as a gradient.
                      "sticky left-0 z-10 bg-card py-1 pl-2 pr-2 text-left font-normal",
                      active
                        ? "bg-[linear-gradient(hsl(var(--selection-unfocused)),hsl(var(--selection-unfocused)))] dark:bg-[linear-gradient(hsl(var(--control-track)),hsl(var(--control-track)))]"
                        : "group-hover:bg-[linear-gradient(hsl(var(--control-track)),hsl(var(--control-track)))] dark:group-hover:bg-[linear-gradient(hsl(var(--zebra)),hsl(var(--zebra)))]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(symbol)}
                      aria-pressed={active}
                      className="inline-flex min-h-7 items-center rounded-chip px-2 font-semibold text-foreground hover:text-primary-ink focus-visible:shadow-ember focus-visible:outline-none aria-pressed:text-primary-ink [@media(pointer:coarse)]:min-h-9"
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
