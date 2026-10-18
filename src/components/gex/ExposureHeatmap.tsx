import { useEffect, useMemo, useRef, useState } from "react";
import { Grid3X3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { tokenColor } from "@/lib/chartTheme";
import { crDecimals, flatValues, formatCrCell, heatRamp, type HeatRamp } from "@/lib/gex";
import type { GexChainInput, GexConvention } from "@/lib/gexData";
import { dteLabel, formatCompactIN, formatDateIST } from "@/lib/options";
import { cn } from "@/lib/utils";
import { fmtCr, fmtLevel } from "./format";
import { buildHeatmapModel, heatAlpha, type HeatMetric } from "./heatmapModel";
import { GexSourceTag, type SourceInfo } from "./SourceTag";

const METRIC_META: Record<
  HeatMetric,
  { label: string; unit: string; short: string; crore: boolean; pos: string; neg: string }
> = {
  gex: {
    label: "Net GEX",
    unit: "₹ Cr per 1% move",
    short: "₹ Cr / 1%",
    crore: true,
    pos: "Damping",
    neg: "Amplifying",
  },
  dex: {
    label: "Net DEX",
    unit: "₹ Cr delta-notional",
    short: "₹ Cr",
    crore: true,
    pos: "Long delta",
    neg: "Short delta",
  },
  oi: {
    label: "Open interest",
    unit: "contracts (CE + PE)",
    short: "Contracts",
    crore: false,
    pos: "More OI",
    neg: "Less OI",
  },
  oiChange: {
    label: "Change in OI",
    unit: "contracts (CE + PE)",
    short: "Contracts",
    crore: false,
    pos: "OI added",
    neg: "OI cut",
  },
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

function cellText(metric: HeatMetric, v: number, decimals: number): string {
  if (!Number.isFinite(v)) return "";
  if (METRIC_META[metric].crore) return formatCrCell(v, decimals);
  return formatCompactIN(v, { decimals: 1 });
}

/** Sequential (one hue) when every value shares a sign; diverging (green / red) otherwise. */
function cellBg(ramp: HeatRamp, v: number, maxAbs: number): string | undefined {
  const a = heatAlpha(v, maxAbs);
  if (a <= 0) return undefined;
  if (ramp === "sequential") return tokenColor("primary", a);
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
  const ramp = useMemo(() => heatRamp(flatValues(model.values)), [model.values]);
  const decimals = crDecimals(model.maxAbs);
  const allNegative = useMemo(
    () => ramp === "sequential" && flatValues(model.values).some((v) => v < 0),
    [ramp, model.values],
  );
  const rowsDesc = useMemo(() => model.strikes.map((k, i) => ({ k, i })).reverse(), [model.strikes]);

  // Open the scroller centred on the spot row. Rows run high strike → low, so without this the
  // first view shows far-OTM upside strikes, where short-dated gamma has already decayed to almost
  // nothing, and the near expiry looks empty even though it is the darkest column at spot.
  const scrollRef = useRef<HTMLDivElement>(null);
  const spotStrike = model.spotStrike;
  const rowCount = model.strikes.length;
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || spotStrike === null) return;
    const row = box.querySelector<HTMLElement>(`tr[data-strike="${spotStrike}"]`);
    const head = box.querySelector<HTMLElement>("thead");
    if (!row) return;
    const headH = head?.offsetHeight ?? 0;
    const target = row.offsetTop - headH - (box.clientHeight - headH - row.offsetHeight) / 2;
    box.scrollTop = Math.max(0, target);
  }, [spotStrike, rowCount, win, loading]);

  return (
    <Card>
      <CardHeader className="space-y-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lead">
              <Grid3X3 className="h-4 w-4 text-primary-ink" aria-hidden />
              Strike × expiry heatmap
            </CardTitle>
            <p className="mt-0.5 text-body-sm text-muted-foreground">
              {meta.label} in {meta.unit}. CW / PW mark each expiry's call and put walls; F marks the flip (dealer
              model).
            </p>
          </div>
          <GexSourceTag info={source} showDerived={metric === "gex" || metric === "dex"} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Select value={metric} onValueChange={(v) => setMetric(v as HeatMetric)}>
            <SelectTrigger className="w-[170px]" aria-label="Heatmap metric">
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
          >
            {(["10", "20", "all"] as Win[]).map((w) => (
              <ToggleGroupItem
                key={w}
                value={w}
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
          <div className="flex h-[240px] items-center justify-center rounded-tile bg-muted/40 text-body text-muted-foreground">
            No multi-expiry data available.
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="hairline max-h-[480px] overflow-auto rounded-tile focus-visible:shadow-ember focus-visible:outline-none"
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
                    <th
                      scope="col"
                      className="sticky left-0 z-30 border-b border-separator-strong bg-card px-2 py-1.5 text-left font-normal"
                    >
                      <span className="block text-label text-muted-foreground">Strike</span>
                      <span className="block text-micro text-primary-ink">{meta.short}</span>
                    </th>
                    {model.expiries.map((e) => (
                      <th
                        key={e}
                        scope="col"
                        className="min-w-[84px] border-b border-separator-strong px-2 py-1.5 text-right font-normal"
                      >
                        <span className="block text-label text-foreground">
                          {formatDateIST(e).replace(/ \d{4}$/, "")}
                        </span>
                        <span className="block text-micro text-muted-foreground">{dteLabel(e)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsDesc.map(({ k, i }) => {
                    const isSpot = k === model.spotStrike;
                    return (
                      <tr
                        key={k}
                        data-strike={k}
                        className={cn(
                          isSpot &&
                            "shadow-[inset_0_1px_0_hsl(var(--primary)/0.6),inset_0_-1px_0_hsl(var(--primary)/0.6)]",
                        )}
                      >
                        <th
                          scope="row"
                          className={cn(
                            "sticky left-0 z-10 border-b border-separator bg-card px-2 py-1 text-left font-num font-medium",
                            isSpot && "bg-wash-brand text-primary-ink",
                          )}
                        >
                          {k.toLocaleString("en-IN")}
                          {isSpot && <span className="ml-1 text-micro">Spot</span>}
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
                              className="relative border-b border-separator px-2 py-1 text-right font-num"
                              style={{ backgroundColor: cellBg(ramp, v, model.maxAbs) }}
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
                                <span className={cn(!Number.isFinite(v) && "text-muted-foreground")}>
                                  {Number.isFinite(v) ? cellText(metric, v, decimals) : "·"}
                                </span>
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
              {ramp === "diverging" ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-6 rounded-sm"
                      style={{
                        background: `linear-gradient(90deg, ${tokenColor("bullish", 0.08)}, ${tokenColor("bullish", 0.6)})`,
                      }}
                      aria-hidden
                    />
                    {meta.pos}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-6 rounded-sm"
                      style={{
                        background: `linear-gradient(90deg, ${tokenColor("bearish", 0.08)}, ${tokenColor("bearish", 0.6)})`,
                      }}
                      aria-hidden
                    />
                    {meta.neg}
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-6 rounded-sm"
                    style={{
                      background: `linear-gradient(90deg, ${tokenColor("primary", 0.08)}, ${tokenColor("primary", 0.6)})`,
                    }}
                    aria-hidden
                  />
                  {allNegative
                    ? `All values negative: darker = more ${metric === "gex" && convention === "sellerShortBoth" ? "short gamma" : meta.neg.toLowerCase()}`
                    : `Darker = ${meta.pos.toLowerCase()}`}
                </span>
              )}
              <span>Opens centred on spot: near expiries concentrate gamma at strikes close to spot.</span>
              <span>
                Square-root colour scale; strongest cell ={" "}
                {meta.crore ? fmtCr(model.maxAbs) : formatCompactIN(model.maxAbs)}.
                {meta.crore ? " “<0.1” = under ₹0.1 Cr." : ""}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
