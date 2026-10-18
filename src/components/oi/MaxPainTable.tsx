import { Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dteLabel, formatDateIST } from "@/lib/options";
import type { ExpirySummary } from "@/lib/oiUtils";
import { cn } from "@/lib/utils";
import MetricHelp from "@/components/learn/MetricHelp";
import { EmptyState, ModuleHeader } from "./shared";
import { fmtStrike } from "./format";

export interface ExpiryRow extends ExpirySummary {
  sample: boolean;
}

/** Short tag for the expected-move method shown beside the EM value. */
// eslint-disable-next-line react-refresh/only-export-components
export function emMethodTag(source: "iv" | "straddle"): string {
  return source === "iv" ? "IV 1σ" : "Straddle ×0.85";
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
  // The page header already says "Sample data" when everything is sample; flag only a mix.
  const mixed = anySample && rows.some((r) => !r.sample);
  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<Table2 className="h-4 w-4 text-primary-ink" />}
        title="Max pain across expiries"
        hint="Distance is max pain minus spot. EM is the 1σ expected move to that expiry. Select a row to chart it."
        right={mixed ? <Badge variant="warning">Includes sample data</Badge> : undefined}
      />
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyState icon={<Table2 className="h-5 w-5" />} title={loading ? "Loading expiries…" : "No expiry chains available"} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">
                    <MetricHelp metric="maxPain">Max pain</MetricHelp>
                  </TableHead>
                  <TableHead className="text-right">Distance</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">
                    <MetricHelp metric="em">EM ±</MetricHelp>
                  </TableHead>
                  <TableHead className="text-right">× EM</TableHead>
                  <TableHead className="text-right">
                    <MetricHelp metric="pcr">PCR</MetricHelp>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const active = r.expiry === selected;
                  return (
                    <TableRow
                      key={r.expiry}
                      className={cn("font-num text-body-sm", mixed && r.sample && "italic")}
                      data-state={active ? "selected" : undefined}
                      aria-selected={active}
                      title={mixed && r.sample ? "Sample data for this expiry" : undefined}
                    >
                      <TableCell className="whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelect(r.expiry)}
                          className={cn("rounded-chip text-left font-semibold hover:text-primary-ink focus-visible:shadow-focus focus-visible:outline-none", mixed && r.sample && "text-warning")}
                          aria-label={`Show ${formatDateIST(r.expiry)} expiry${r.sample ? " (sample data)" : ""}`}
                        >
                          {formatDateIST(r.expiry)}
                        </button>
                        <span className="ml-1.5 text-body-sm font-normal text-muted-foreground">{dteLabel(r.expiry)}</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-warning">{fmtStrike(r.maxPain)}</TableCell>
                      <TableCell className={cn("text-right", r.distance !== null && (r.distance > 0 ? "text-bullish" : r.distance < 0 ? "text-bearish" : ""))}>
                        {r.distance === null ? "—" : `${r.distance > 0 ? "+" : r.distance < 0 ? "−" : ""}${Math.abs(r.distance).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{r.distancePct === null ? "—" : `${r.distancePct > 0 ? "+" : r.distancePct < 0 ? "−" : ""}${Math.abs(r.distancePct).toFixed(2)}%`}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {r.expectedMove === null ? "—" : r.expectedMove.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        {r.emSource && (
                          <span className="ml-1.5 inline-flex rounded-chip bg-control-track px-1 py-px text-micro font-medium not-italic text-muted-foreground" title={r.emSource === "iv" ? "1σ move from ATM implied volatility" : "0.85 × ATM straddle (IV missing)"}>
                            {emMethodTag(r.emSource)}
                          </span>
                        )}
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
        <p className="hairline-t px-4 py-2 text-body-sm text-muted-foreground">
          Spot {spot > 0 ? spot.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}. Positive distance means max pain sits above spot. EM method: IV 1σ from ATM implied volatility, Straddle ×0.85 where IV was missing.{mixed && " Amber italic rows are sample data."}
        </p>
      </CardContent>
    </Card>
  );
}
