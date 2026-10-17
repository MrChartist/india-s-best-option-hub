import { useMemo, useState, type CSSProperties } from "react";
import { Grid3x3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { dteLabel, formatDateIST } from "@/lib/options";
import { DELTA_BUCKETS, surfaceRange, type SurfaceRow } from "@/lib/volatility/surface";
import { DerivedBadge, EmptyState, HelpTip, PanelHeader, SampleBadge } from "./VolUi";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";

export interface SurfaceHeatmapProps {
  symbol: string;
  rows: SurfaceRow[];
  isSample: boolean;
}

type Mode = "abs" | "rel";

export function SurfaceHeatmap({ symbol, rows, isSample }: SurfaceHeatmapProps) {
  const [mode, setMode] = useState<Mode>("abs");
  const range = useMemo(() => surfaceRange(rows), [rows]);
  const relMax = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      const atm = r.cells.ATM;
      if (atm === null || atm === undefined) continue;
      for (const v of Object.values(r.cells)) if (v !== null && Number.isFinite(v)) m = Math.max(m, Math.abs(v - atm));
    }
    return m || 1;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={Grid3x3} title="No surface data" body="The multi-expiry chain did not return usable IVs." />
      </Card>
    );
  }

  const cellStyle = (v: number | null, atm: number | null): CSSProperties | undefined => {
    if (v === null || !Number.isFinite(v)) return undefined;
    if (mode === "abs") {
      const span = range.max - range.min || 1;
      const a = 0.08 + 0.62 * ((v - range.min) / span);
      return { backgroundColor: `hsl(var(--chart-2) / ${a.toFixed(3)})` };
    }
    if (atm === null) return undefined;
    const d = v - atm;
    const a = 0.08 + 0.55 * Math.min(1, Math.abs(d) / relMax);
    return { backgroundColor: d >= 0 ? `hsl(var(--bearish) / ${a.toFixed(3)})` : `hsl(var(--bullish) / ${a.toFixed(3)})` };
  };

  return (
    <Card>
      <PanelHeader
        icon={Grid3x3}
        title={`${symbol} IV surface`}
        subtitle="Implied volatility by delta bucket (rows: expiries). Deltas are Black-76 on the parity forward."
        right={
          <>
            <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as Mode)} className="rounded-tab bg-muted p-0.5" aria-label="Surface values">
              <ToggleGroupItem value="abs" className="h-7 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-card">
                IV
              </ToggleGroupItem>
              <ToggleGroupItem value="rel" className="h-7 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-card">
                vs ATM
              </ToggleGroupItem>
            </ToggleGroup>
            {isSample ? <SampleBadge /> : <DerivedBadge />}
          </>
        }
      />
      <CardContent className="space-y-3 p-4 pt-0">
        <div className="overflow-x-auto rounded-tile border border-border">
          <table className="w-full min-w-[560px] border-collapse text-body-sm">
            <caption className="sr-only">Implied volatility by expiry and delta for {symbol}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 text-left text-label uppercase text-muted-foreground">Expiry</th>
                {DELTA_BUCKETS.map((b) => (
                  <th key={b.key} scope="col" className={`px-2 py-2 text-right text-label uppercase ${b.key === "ATM" ? "text-primary-ink" : "text-muted-foreground"}`}>
                    {b.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const atm = r.cells.ATM ?? null;
                return (
                  <tr key={r.expiry} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">
                      {formatDateIST(r.expiry)}
                      <span className="ml-1.5 text-muted-foreground">{dteLabel(r.expiry)}</span>
                    </th>
                    {DELTA_BUCKETS.map((b) => {
                      const v = r.cells[b.key] ?? null;
                      const text = v === null ? "—" : mode === "abs" || b.key === "ATM" ? fmtVol(v) : fmtVolPts(v - (atm ?? NaN));
                      return (
                        <td
                          key={b.key}
                          className={`px-2 py-2 text-right tabular-nums ${v === null ? "text-muted-foreground" : ""} ${b.key === "ATM" ? "font-semibold" : ""}`}
                          style={cellStyle(v, atm)}
                          title={v === null ? "Outside the quoted range" : `${b.label}: ${fmtVol(v, 2)}`}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="flex items-start gap-1.5 text-body-sm text-muted-foreground">
          <HelpTip text="Each cell interpolates IV at a target delta on the OTM side (puts for the left half, calls for the right). A dash means that delta lies outside the strikes with usable quotes." />
          {mode === "abs"
            ? `Darker cells carry higher IV (range ${fmtVol(range.min)} to ${fmtVol(range.max)}).`
            : "Red cells are richer than the expiry's ATM IV, green cells cheaper. Indian index puts are usually richer than calls."}
        </p>
      </CardContent>
    </Card>
  );
}
