import { useMemo, useState } from "react";
import { Download, Grid3x3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { tokenColor } from "@/lib/chartTheme";
import { formatCompactIN, formatINR, formatStrike, pnlMatrix, type Leg } from "@/lib/options";
import { cn } from "@/lib/utils";
import { Segmented } from "./Segmented";
import { downloadText } from "./exportPng";
import { heatColumns, toCsv } from "./strategyState";

export interface PnlHeatTableProps {
  legs: Leg[];
  symbol: string;
  spot: number;
  now: Date;
  r: number;
  q: number;
  ivShift: number;
  frontExpiry: string;
  /** Years to front expiry. */
  T: number;
  atmIv: number;
  strikes: number[];
  /** |max loss| when finite, else null. */
  maxRisk: number | null;
  margin: number;
}

type RowMode = "sigma" | "strikes";
type Unit = "inr" | "pct";

const SIGMA_STEPS = [2, 1.5, 1, 0.75, 0.5, 0.25, 0, -0.25, -0.5, -0.75, -1, -1.5, -2];

export function PnlHeatTable({ legs, symbol, spot, now, r, q, ivShift, frontExpiry, T, atmIv, strikes, maxRisk, margin }: PnlHeatTableProps) {
  const [rowMode, setRowMode] = useState<RowMode>("sigma");
  const [unit, setUnit] = useState<Unit>("inr");

  const columns = useMemo(() => heatColumns(frontExpiry, now, 9), [frontExpiry, now]);

  const rows = useMemo(() => {
    if (!(spot > 0)) return [] as Array<{ spot: number; label: string; atSpot: boolean }>;
    if (rowMode === "sigma") {
      const sd = Math.max(atmIv, 0.01) * Math.sqrt(Math.max(T, 1 / 365));
      return SIGMA_STEPS.map((k) => ({
        spot: Math.round(spot * Math.exp(k * sd) * 100) / 100,
        label: k === 0 ? "Spot" : `${k > 0 ? "+" : "−"}${Math.abs(k)}σ`,
        atSpot: k === 0,
      }));
    }
    const sorted = [...strikes].sort((a, b) => b - a);
    if (sorted.length === 0) return [];
    let atmIdx = 0;
    sorted.forEach((k, i) => {
      if (Math.abs(k - spot) < Math.abs(sorted[atmIdx] - spot)) atmIdx = i;
    });
    const start = Math.max(0, atmIdx - 7);
    return sorted.slice(start, atmIdx + 8).map((k, i) => {
      const pct = ((k - spot) / spot) * 100;
      return { spot: k, label: `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`, atSpot: i === atmIdx - start };
    });
  }, [rowMode, spot, atmIv, T, strikes]);

  const matrix = useMemo(
    () => (legs.length && rows.length && columns.length ? pnlMatrix(legs, rows.map((x) => x.spot), columns.map((c) => c.at), { ivShift, now, spot, r, q }) : []),
    [legs, rows, columns, ivShift, now, spot, r, q],
  );

  const denom = maxRisk && maxRisk > 0 ? maxRisk : margin > 0 ? margin : null;
  const denomLabel = maxRisk && maxRisk > 0 ? "max risk" : "margin";
  const maxAbs = useMemo(() => Math.max(1, ...matrix.flat().filter(Number.isFinite).map(Math.abs)), [matrix]);

  const display = (v: number) => {
    if (!Number.isFinite(v)) return "—";
    if (unit === "pct" && denom) return `${v >= 0 ? "+" : "−"}${Math.abs((v / denom) * 100).toFixed(0)}%`;
    return formatCompactIN(Math.round(v), { decimals: Math.abs(v) >= 1e5 ? 2 : 1 });
  };

  const colLabel = (i: number) => {
    const c = columns[i];
    if (!c) return "";
    if (c.label === "Now") return "Now";
    if (c.label === "At expiry") return "Expiry";
    if (c.label.startsWith("Expiry day ")) return c.label.replace("Expiry day ", "Exp ");
    return c.label.replace(" close", "");
  };

  const exportCsv = () => {
    const header = ["Spot", ...columns.map((_, i) => colLabel(i))];
    const body = rows.map((row, ri) => [row.spot, ...(matrix[ri] ?? []).map((v) => (unit === "pct" && denom ? (v / denom) * 100 : v))]);
    downloadText(toCsv(header, body), `${symbol}-pnl-table-${unit === "pct" ? "pct" : "inr"}.csv`);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Grid3x3 className="h-4 w-4 text-primary-ink" aria-hidden="true" /> P&L table
            <span className="text-xs font-normal text-muted-foreground">spot × date{ivShift !== 0 ? `, IV ${ivShift > 0 ? "+" : "−"}${Math.abs(ivShift * 100).toFixed(1)} pts` : ""}</span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Segmented ariaLabel="Rows" value={rowMode} onChange={setRowMode} options={[{ value: "sigma", label: "σ steps" }, { value: "strikes", label: "Strikes" }]} />
            <Segmented
              ariaLabel="Units"
              value={unit}
              onChange={setUnit}
              options={[
                { value: "inr", label: "₹" },
                { value: "pct", label: `% ${denomLabel}`, title: `P&L as a percentage of ${denomLabel}` },
              ]}
            />
            <Button type="button" variant="outline" size="pill" onClick={exportCsv} disabled={matrix.length === 0}>
              <Download /> CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {matrix.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Add legs to see P&L across prices and dates.</p>
        ) : (
          <div className="overflow-x-auto rounded-tile border border-border">
            <table className="w-full min-w-[480px] border-collapse text-xs">
              <caption className="sr-only">Model P&L by underlying price (rows) and date (columns)</caption>
              <thead>
                <tr className="bg-surface">
                  <th scope="col" className="sticky left-0 z-10 w-[1%] bg-surface px-2 py-1.5 text-left text-label uppercase text-muted-foreground">
                    {symbol}
                  </th>
                  {columns.map((c, i) => (
                    <th key={c.at.getTime()} scope="col" className={cn("px-1.5 py-1.5 text-right text-label uppercase text-muted-foreground", c.label === "At expiry" && "text-foreground")}>
                      {colLabel(i)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={`${row.spot}-${ri}`} className={cn("border-t border-border/60", row.atSpot && "outline outline-1 -outline-offset-1 outline-primary/45")}>
                    <th scope="row" className={cn("sticky left-0 z-10 w-[1%] whitespace-nowrap bg-card px-2 py-1 text-left font-num font-medium normal-case tracking-normal", row.atSpot && "bg-wash-brand")}>
                      {formatStrike(Math.round(row.spot))}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">{row.label}</span>
                    </th>
                    {(matrix[ri] ?? []).map((v, ci) => {
                      const a = Number.isFinite(v) ? Math.min(1, Math.pow(Math.abs(v) / maxAbs, 0.7)) * 0.55 : 0;
                      return (
                        <td
                          key={ci}
                          className="px-1.5 py-1 text-right font-num"
                          style={{ backgroundColor: v >= 0 ? tokenColor("bullish", a) : tokenColor("bearish", a) }}
                          title={`${formatStrike(Math.round(row.spot))} · ${colLabel(ci)}: ${formatINR(v, { decimals: 0 })}`}
                        >
                          {display(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Model values (Black-76, current IV{ivShift !== 0 ? " with your shift" : ""}). Columns are trading-day closes at 15:30 IST. {rowMode === "sigma" ? "σ = ATM IV × √time to expiry." : ""}
        </p>
      </CardContent>
    </Card>
  );
}
