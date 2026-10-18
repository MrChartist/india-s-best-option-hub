/** Expectancy by strategy, DTE, weekday, time of day, underlying or tag, always net of charges. */
import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DIMENSION_LABEL, groupStats, type Annotation, type Dimension, type RoundTrip } from "@/lib/journal";
import { formatINR, formatPct } from "@/lib/options";
import { cn } from "@/lib/utils";
import { signedClass, signedINR } from "@/components/positions/helpers";
import { HelpTip, STICKY_CELL } from "@/components/positions/ui";

const DIMS: Dimension[] = ["strategy", "dte", "weekday", "timeOfDay", "underlying", "tag"];

export function EdgeTable({ trips, notes }: { trips: RoundTrip[]; notes: Record<string, Annotation> }) {
  const [dim, setDim] = useState<Dimension>("strategy");
  const rows = useMemo(() => groupStats(trips, dim, notes), [trips, dim, notes]);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.expectancy) || 0));

  return (
    <div className="space-y-3">
      <div className="-mx-1 overflow-x-auto px-4 pt-3">
        <ToggleGroup type="single" value={dim} onValueChange={(v) => v && setDim(v as Dimension)} aria-label="Split expectancy by" size="sm" className="justify-start">
          {DIMS.map((d) => (
            <ToggleGroupItem key={d} value={d} className="whitespace-nowrap">
              {DIMENSION_LABEL[d]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-surface">{DIMENSION_LABEL[dim]}</TableHead>
            <TableHead className="text-right">Trades</TableHead>
            <TableHead className="text-right">Win rate</TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1">
                Expectancy <HelpTip text="Average net P&L per trade after every charge. Positive means this bucket has paid you on average." />
              </span>
            </TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Charges</TableHead>
            <TableHead className="text-right">
              <span className="inline-flex items-center gap-1">
                Chg % gross <HelpTip text="Charges as a share of the absolute gross P&L. Above 30 to 40% the costs are eating most of the edge." />
              </span>
            </TableHead>
            <TableHead className="text-right">Net</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const w = Number.isFinite(r.expectancy) ? (Math.abs(r.expectancy) / maxAbs) * 100 : 0;
            return (
              <TableRow key={r.key}>
                <TableCell className={cn(STICKY_CELL, "font-semibold")}>{r.key}</TableCell>
                <TableCell className="text-right tabular-nums">{r.trades}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPct(r.winRate, { decimals: 0 })}</TableCell>
                <TableCell className="min-w-[180px]">
                  <div className="flex items-center gap-2">
                    <span className={cn("w-20 shrink-0 text-right font-num font-semibold tabular-nums", signedClass(r.expectancy))}>{signedINR(r.expectancy)}</span>
                    <span className="relative h-2 flex-1 overflow-hidden rounded-capsule bg-muted" aria-hidden="true">
                      <span className={cn("absolute inset-y-0 left-0 rounded-capsule", r.expectancy >= 0 ? "bg-bullish" : "bg-bearish")} style={{ width: `${w}%` }} />
                    </span>
                  </div>
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", signedClass(r.gross))}>{signedINR(r.gross)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatINR(r.charges, { decimals: 0 })}</TableCell>
                <TableCell className={cn("text-right tabular-nums", r.chargesPctOfGross > 40 && "font-semibold text-warning")}>{Number.isFinite(r.chargesPctOfGross) ? formatPct(r.chargesPctOfGross, { decimals: 0 }) : "—"}</TableCell>
                <TableCell className={cn("text-right font-semibold tabular-nums", signedClass(r.net))}>{signedINR(r.net)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {dim === "tag" && rows.length === 1 && rows[0].key === "Untagged" ? <p className="px-4 pb-3 text-body-sm text-muted-foreground">Tag trades in the trade log (for example “breakout”, “revenge”, “plan followed”) to see which habits pay.</p> : null}
    </div>
  );
}
