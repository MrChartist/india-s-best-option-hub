import { useMemo, useState } from "react";
import { Grid3X3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { tokenColor } from "@/lib/chartTheme";
import type { GexChainInput, GexConvention } from "@/lib/gexData";
import { dteLabel, formatCompactIN, formatDateIST } from "@/lib/options";
import { cn } from "@/lib/utils";
import { fmtCr, fmtLevel } from "./format";
import { buildHeatmapModel, heatAlpha, type HeatMetric } from "./heatmapModel";
import { GexSourceTag, type SourceInfo } from "./SourceTag";

const METRIC_META: Record<HeatMetric, { label: string; unit: string; diverging: boolean; pos: string; neg: string }> = {
  gex: { label: "Net GEX", unit: "₹ Cr per 1%", diverging: true, pos: "Damping", neg: "Amplifying" },
  dex: { label: "Net DEX", unit: "₹ Cr", diverging: true, pos: "Long delta", neg: "Short delta" },
  oi: { label: "Open interest", unit: "contracts (CE + PE)", diverging: false, pos: "More OI", neg: "" },
  oiChange: { label: "Change in OI", unit: "contracts (CE + PE)", diverging: true, pos: "OI added", neg: "OI cut" },
};

type Win = "10" | "20" | "all";

interface Props {
  chains: GexChainInput[];
  spot: number;
  convention: GexConvention;
  oiUnit: "contracts" | "qty";
  loading?: boolean;
  source?: SourceInfo | null;
}

function cellText(metric: HeatMetric, v: number): string {
  if (!Number.isFinite(v)) return "";
  if (metric === "gex" || metric === "dex") return fmtCr(v).replace("₹", "");
  return formatCompactIN(v, { decimals: 1 });
}

function cellBg(metric: HeatMetric, v: number, maxAbs: number): string | undefined {
  const a = heatAlpha(v, maxAbs);
  if (a <= 0) return undefined;
  if (!METRIC_META[metric].diverging) return tokenColor("primary", a);
  return v > 0 ? tokenColor("bullish", a) : tokenColor("bearish", a);
}

/** Strike × expiry heatmap with call wall, put wall and flip markers per expiry. */
export function ExposureHeatmap({ chains, spot, convention, oiUnit, loading, source = null }: Props) {
  const [metric, setMetric] = useState<HeatMetric>("gex");
  const [win, setWin] = useState<Win>("20");

  const model = useMemo(
    () => buildHeatmapModel(chains, spot, metric, { convention, oiUnit, window: win === "all" ? "all" : Number(win) }),
    [chains, spot, metric, convention, oiUnit, win],
  );
  const meta = METRIC_META[metric];
  const rowsDesc = useMemo(() => model.strikes.map((k, i) => ({ k, i })).reverse(), [model.strikes]);

  return (
    <Card className="rounded-card">
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lead">
              <Grid3X3 className="h-4 w-4 text-primary-ink" aria-hidden />
              Strike × expiry heatmap
            </CardTitle>
            <p className="mt-0.5 text-body-sm text-muted-foreground">
              {meta.label} · {meta.unit}. CW / PW mark each expiry's call and put walls; F marks the flip (dealer model).
            </p>
          </div>
          <GexSourceTag info={source} showDerived={metric === "gex" || metric === "dex"} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Select value={metric} onValueChange={(v) => setMetric(v as HeatMetric)}>
            <SelectTrigger className="h-8 w-[170px]" aria-label="Heatmap metric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(METRIC_META) as HeatMetric[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {METRIC_META[m].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            value={win}
            onValueChange={(v) => v && setWin(v as Win)}
            aria-label="Heatmap strike window"
            className="rounded-tab bg-muted p-0.5"
          >
            {(["10", "20", "all"] as Win[]).map((w) => (
              <ToggleGroupItem
                key={w}
                value={w}
                className="h-7 rounded-[7px] px-2 text-body-sm data-[state=on]:bg-card data-[state=on]:shadow-card"
                aria-label={w === "all" ? "All strikes" : `${w} strikes either side of spot`}
              >
                {w === "all" ? "All" : `±${w}`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-[420px] w-full rounded-tile" />
        ) : model.expiries.length === 0 || model.strikes.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center rounded-tile border border-dashed border-border text-body text-muted-foreground">
            No multi-expiry data available.
          </div>
        ) : (
          <>
            <div
              className="max-h-[480px] overflow-auto rounded-tile border border-border focus-visible:shadow-ember focus-visible:outline-none"
              tabIndex={0}
              role="region"
              aria-label={`${meta.label} heatmap, ${model.strikes.length} strikes by ${model.expiries.length} expiries`}
            >
              <table className="w-full border-collapse text-body-sm">
                <caption className="sr-only">
                  {meta.label} by strike and expiry, in {meta.unit}. Spot {fmtLevel(spot)}.
                </caption>
                <thead className="sticky top-0 z-20 bg-card">
                  <tr>
                    <th scope="col" className="sticky left-0 z-30 border-b border-border bg-card px-2 py-1.5 text-left text-label uppercase text-muted-foreground">
                      Strike
                    </th>
                    {model.expiries.map((e) => (
                      <th key={e} scope="col" className="min-w-[84px] border-b border-border px-2 py-1.5 text-right font-normal">
                        <span className="block text-label uppercase text-foreground">{formatDateIST(e).replace(/ \d{4}$/, "")}</span>
                        <span className="block text-micro text-muted-foreground">{dteLabel(e)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsDesc.map(({ k, i }) => {
                    const isSpot = k === model.spotStrike;
                    return (
                      <tr key={k} className={cn(isSpot && "shadow-[inset_0_1px_0_hsl(var(--primary)/0.6),inset_0_-1px_0_hsl(var(--primary)/0.6)]")}>
                        <th
                          scope="row"
                          className={cn(
                            "sticky left-0 z-10 border-b border-border/60 bg-card px-2 py-1 text-left font-num font-medium",
                            isSpot && "bg-wash-brand text-primary-ink",
                          )}
                        >
                          {k.toLocaleString("en-IN")}
                          {isSpot && <span className="ml-1 text-micro uppercase">Spot</span>}
                        </th>
                        {model.expiries.map((e, j) => {
                          const v = model.values[i][j];
                          const mk = model.markers[j];
                          const tags: string[] = [];
                          if (mk?.callWall === k) tags.push("CW");
                          if (mk?.putWall === k) tags.push("PW");
                          if (mk?.flipStrike === k) tags.push("F");
                          const title = `${k.toLocaleString("en-IN")} · ${formatDateIST(e)}: ${Number.isFinite(v) ? (metric === "gex" || metric === "dex" ? fmtCr(v, { signed: true }) : `${Math.round(v).toLocaleString("en-IN")} contracts`) : "not listed"}${tags.length ? ` · ${tags.map((t) => (t === "CW" ? "Call wall" : t === "PW" ? "Put wall" : `Flip ≈ ${fmtLevel(mk?.flip)}`)).join(", ")}` : ""}`;
                          return (
                            <td
                              key={e}
                              title={title}
                              className="relative border-b border-border/60 px-2 py-1 text-right font-num"
                              style={{ backgroundColor: cellBg(metric, v, model.maxAbs) }}
                            >
                              <span className="flex items-center justify-end gap-1">
                                {tags.map((t) => (
                                  <span
                                    key={t}
                                    className={cn(
                                      "rounded-[4px] px-1 text-micro font-semibold leading-4",
                                      t === "CW" && "bg-bearish text-card",
                                      t === "PW" && "bg-bullish text-card",
                                      t === "F" && "bg-warning text-card",
                                    )}
                                  >
                                    {t}
                                  </span>
                                ))}
                                <span className={cn(!Number.isFinite(v) && "text-muted-foreground")}>{Number.isFinite(v) ? cellText(metric, v) : "·"}</span>
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
              {meta.diverging ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-6 rounded-sm" style={{ background: `linear-gradient(90deg, ${tokenColor("bullish", 0.08)}, ${tokenColor("bullish", 0.6)})` }} aria-hidden />
                    {meta.pos}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-6 rounded-sm" style={{ background: `linear-gradient(90deg, ${tokenColor("bearish", 0.08)}, ${tokenColor("bearish", 0.6)})` }} aria-hidden />
                    {meta.neg}
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-6 rounded-sm" style={{ background: `linear-gradient(90deg, ${tokenColor("primary", 0.08)}, ${tokenColor("primary", 0.6)})` }} aria-hidden />
                  {meta.pos}
                </span>
              )}
              <span>Square-root colour scale; strongest cell = {metric === "gex" || metric === "dex" ? fmtCr(model.maxAbs) : formatCompactIN(model.maxAbs)}.</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default ExposureHeatmap;
