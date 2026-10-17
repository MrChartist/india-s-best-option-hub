import { Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dteLabel, formatDateIST } from "@/lib/options";
import type { ExpirySummary } from "@/lib/oiUtils";
import { cn } from "@/lib/utils";
import { EmptyState, ModuleHeader } from "./shared";
import { fmtStrike } from "./format";

export interface ExpiryRow extends ExpirySummary {
  sample: boolean;
}

function emTone(m: number | null): string {
  if (m === null) return "text-muted-foreground";
  if (m <= 0.5) return "text-foreground";
  if (m <= 1) return "text-warning";
  return "text-muted-foreground";
}

/**
 * Max pain across expiries with the distance from spot in points, percent and multiples of the
 * expected move. Within 0.5× EM, max pain is a realistic settlement magnet; beyond 1× it rarely is.
 */
export function MaxPainTable({ rows, spot, selected, onSelect, loading }: { rows: ExpiryRow[]; spot: number; selected: string; onSelect: (expiry: string) => void; loading?: boolean }) {
  const anySample = rows.some((r) => r.sample);
  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<Table2 className="h-4 w-4 text-primary-ink" />}
        title="Max pain across expiries"
        hint="Distance is max pain minus spot. EM is the 1σ expected move to that expiry. Select a row to chart it."
        right={anySample ? <Badge variant="warning">Includes sample data</Badge> : undefined}
      />
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyState icon={<Table2 className="h-5 w-5" />} title={loading ? "Loading expiries…" : "No expiry chains available"} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-label uppercase">Expiry</TableHead>
                  <TableHead className="text-right text-label uppercase">Max pain</TableHead>
                  <TableHead className="text-right text-label uppercase">Distance</TableHead>
                  <TableHead className="text-right text-label uppercase">%</TableHead>
                  <TableHead className="text-right text-label uppercase">EM ±</TableHead>
                  <TableHead className="text-right text-label uppercase">× EM</TableHead>
                  <TableHead className="text-right text-label uppercase">PCR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const active = r.expiry === selected;
                  return (
                    <TableRow key={r.expiry} className={cn("font-num text-xs", active && "bg-wash-brand/55 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.45)]")} aria-selected={active}>
                      <TableCell className="whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelect(r.expiry)}
                          className="rounded-chip text-left font-semibold hover:text-primary-ink focus-visible:shadow-ember focus-visible:outline-none"
                          aria-label={`Show ${formatDateIST(r.expiry)} expiry`}
                        >
                          {formatDateIST(r.expiry)}
                        </button>
                        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{dteLabel(r.expiry)}</span>
                        {r.sample && <Badge variant="warning" className="ml-1.5">Sample</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-warning">{fmtStrike(r.maxPain)}</TableCell>
                      <TableCell className={cn("text-right", r.distance !== null && (r.distance > 0 ? "text-bullish" : r.distance < 0 ? "text-bearish" : ""))}>
                        {r.distance === null ? "—" : `${r.distance > 0 ? "+" : r.distance < 0 ? "−" : ""}${Math.abs(r.distance).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{r.distancePct === null ? "—" : `${r.distancePct > 0 ? "+" : r.distancePct < 0 ? "−" : ""}${Math.abs(r.distancePct).toFixed(2)}%`}</TableCell>
                      <TableCell className="text-right" title={r.emSource === "straddle" ? "From 0.85 × ATM straddle" : "From ATM IV"}>
                        {r.expectedMove === null ? "—" : r.expectedMove.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        {r.emSource === "straddle" && <span className="text-muted-foreground">*</span>}
                      </TableCell>
                      <TableCell className={cn("text-right font-semibold", emTone(r.emMultiple))}>{r.emMultiple === null ? "—" : `${r.emMultiple.toFixed(2)}×`}</TableCell>
                      <TableCell className="text-right">{r.pcr.pcrOI > 0 ? r.pcr.pcrOI.toFixed(2) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Spot {spot > 0 ? spot.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}. Positive distance means max pain sits above spot. * expected move from 0.85 × ATM straddle where IV was missing.
        </p>
      </CardContent>
    </Card>
  );
}
