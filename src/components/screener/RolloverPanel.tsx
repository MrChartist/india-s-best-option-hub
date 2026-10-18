import { useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { dteLabel, formatDateIST, formatNumberIN, getExpiries } from "@/lib/options";
import type { ScreenerRow } from "@/lib/screener/metrics";
import { cn } from "@/lib/utils";
import { DerivedBadge, EmptyState, PanelHeader, Signed } from "./ScreenerUi";

type SortBy = "rollover" | "carry" | "basis";

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function RolloverPanel({ rows, isSample }: { rows: ScreenerRow[]; isSample: boolean }) {
  const [sortBy, setSortBy] = useState<SortBy>("rollover");
  const monthly = useMemo(() => getExpiries("RELIANCE", new Date(), 3).find((e) => e.type === "monthly"), []);

  const withFut = useMemo(() => rows.filter((r) => r.rolloverPct !== null || r.carryPct !== null), [rows]);
  const sorted = useMemo(() => {
    const key = sortBy === "rollover" ? "rolloverPct" : sortBy === "carry" ? "carryPct" : "basisPct";
    return [...withFut].sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity)).slice(0, 40);
  }, [withFut, sortBy]);

  const carryMed = median(withFut.map((r) => r.carryPct).filter((x): x is number => x !== null));
  const rollMed = median(withFut.map((r) => r.rolloverPct).filter((x): x is number => x !== null));
  const discount = withFut.filter((r) => r.basis !== null && r.basis < 0).length;
  const rolloverWeek = monthly ? monthly.dte <= 7 : false;

  return (
    <Card>
      <PanelHeader
        title="Rollover and basis"
        icon={<Repeat className="h-4 w-4 text-primary-ink" aria-hidden="true" />}
        help="From the NSE F&O bhavcopy (end of day). Basis = near-month future close minus the underlying close in the same file. Carry is annualised: (F ÷ S − 1) × 365 ÷ days to expiry. Rollover = share of futures OI already in the next and far months."
      >
        {/* In sample mode the page header carries the one sample label. */}
        {isSample ? null : <DerivedBadge title="EOD · derived" />}
      </PanelHeader>

      <div className="hairline-b grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <div
          className={cn(
            "rounded-md border p-3",
            rolloverWeek ? "border-warning/50 bg-wash-warning" : "border-transparent bg-control-track",
          )}
        >
          <p className="text-body-sm font-medium text-muted-foreground">Stock futures expiry</p>
          <p className="mt-1 font-display text-title">{monthly ? formatDateIST(monthly.date) : "—"}</p>
          <p className={cn("text-body-sm", rolloverWeek ? "text-warning" : "text-muted-foreground")}>
            {monthly ? `${dteLabel(monthly.date)}${rolloverWeek ? " · rollover week" : ""}` : ""}
          </p>
        </div>
        <div className="rounded-md bg-control-track p-3">
          <p className="text-body-sm font-medium text-muted-foreground">Median rollover</p>
          <p className="mt-1 font-num text-title">{rollMed === null ? "—" : `${rollMed.toFixed(0)}%`}</p>
          <p className="text-body-sm text-muted-foreground">{withFut.length} underlyings</p>
        </div>
        <div className="rounded-md bg-control-track p-3">
          <p className="text-body-sm font-medium text-muted-foreground">Median carry</p>
          <p className="mt-1 text-title">
            <Signed value={carryMed} decimals={1} />
          </p>
          <p className="text-body-sm text-muted-foreground">Annualised</p>
        </div>
        <div className="rounded-md bg-control-track p-3">
          <p className="text-body-sm font-medium text-muted-foreground">Futures at discount</p>
          <p className="mt-1 font-num text-title">{discount}</p>
          <p className="text-body-sm text-muted-foreground">Negative basis, often a dividend or heavy shorts</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <span className="text-body-sm text-muted-foreground">Top 40 by</span>
        <ToggleGroup
          type="single"
          value={sortBy}
          onValueChange={(v) => v && setSortBy(v as SortBy)}
          aria-label="Sort rollover table"
          size="sm"
        >
          <ToggleGroupItem value="rollover">Rollover</ToggleGroupItem>
          <ToggleGroupItem value="carry">Carry</ToggleGroupItem>
          <ToggleGroupItem value="basis">Basis</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="Futures data is still loading"
          body="The scanner fetches each symbol's bhavcopy rows in turn, at most one request every 3 seconds. Rows appear here as they arrive."
        />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[620px] text-body-sm">
            <caption className="sr-only">Futures rollover, basis and carry</caption>
            <thead>
              <tr className="bg-surface text-label text-muted-foreground [&>th]:shadow-[inset_0_calc(-1*var(--hairline))_0_hsl(var(--separator-strong))]">
                <th scope="col" className="px-4 py-2 text-left">
                  Symbol
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-right"
                  aria-sort={sortBy === "rollover" ? "descending" : "none"}
                >
                  Rollover
                </th>
                <th scope="col" className="px-2 py-2 text-right" aria-sort={sortBy === "basis" ? "descending" : "none"}>
                  Basis ₹
                </th>
                <th scope="col" className="px-2 py-2 text-right">
                  Basis %
                </th>
                <th scope="col" className="px-2 py-2 text-right" aria-sort={sortBy === "carry" ? "descending" : "none"}>
                  Carry p.a.
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Days
                </th>
              </tr>
            </thead>
            <tbody className="zebra-rows">
              {sorted.map((r) => (
                <tr key={r.symbol}>
                  <th scope="row" className="px-4 py-1.5 text-left font-semibold">
                    {r.symbol}
                  </th>
                  <td className="px-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div
                        className="hidden h-1.5 w-16 overflow-hidden rounded-capsule bg-control-track sm:block"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-capsule bg-primary"
                          style={{ width: `${Math.max(0, Math.min(100, r.rolloverPct ?? 0))}%` }}
                        />
                      </div>
                      <span className="font-num tabular-nums">
                        {r.rolloverPct === null ? "—" : `${r.rolloverPct.toFixed(0)}%`}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 text-right">
                    <Signed value={r.basis} suffix="" />
                  </td>
                  <td className="px-2 text-right">
                    <Signed value={r.basisPct} decimals={2} />
                  </td>
                  <td className="px-2 text-right">
                    <Signed value={r.carryPct} decimals={1} />
                  </td>
                  <td className="px-4 text-right font-num tabular-nums">
                    {r.futDte === null ? "—" : formatNumberIN(r.futDte)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
