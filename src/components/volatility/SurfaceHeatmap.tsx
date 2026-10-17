import { useMemo, useState, type CSSProperties } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Grid3x3, Spline } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScrollRegion } from "@/components/ScrollRegion";
import { axisProps, chartColors, gridProps, seriesColor, tooltipCursor, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { dteLabel, formatDateIST, getMarketParams, toISTDate } from "@/lib/options";
import type { Smile } from "@/lib/volatility/smile";
import {
  DELTA_BUCKETS,
  MONEYNESS_BUCKETS,
  buildExpirySmiles,
  deltaAxisLabel,
  deltaSurface,
  moneynessSurface,
  skewOverlay,
  surfaceAbsMax,
  surfaceChange,
  surfaceRange,
  type SurfaceAxis,
  type SurfaceRow,
} from "@/lib/volatility/surface";
import { sampleYesterdaySurface } from "@/lib/volatility/sampleHistory";
import { DerivedBadge, EmptyState, HelpTip, LegendChip, PanelHeader, SampleBadge, SampleWatermark } from "./VolUi";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";
import type { PrevSessionData } from "./useVolatility";

export interface SurfaceHeatmapProps {
  symbol: string;
  smiles: Smile[];
  isSample: boolean;
  /** Previous session from the NSE bhavcopy (null when unavailable). */
  prev?: PrevSessionData | null;
}

type Mode = "abs" | "rel" | "chg";

const toggleItem = "h-7 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-card";

function surfaceFor(smiles: Smile[], axis: SurfaceAxis): SurfaceRow[] {
  return axis === "delta" ? deltaSurface(smiles) : moneynessSurface(smiles);
}

export function SurfaceHeatmap({ symbol, smiles, isSample, prev }: SurfaceHeatmapProps) {
  const [mode, setMode] = useState<Mode>("abs");
  const [axis, setAxis] = useState<SurfaceAxis>("delta");
  const buckets = axis === "delta" ? DELTA_BUCKETS : MONEYNESS_BUCKETS;
  const rows = useMemo(() => surfaceFor(smiles, axis), [smiles, axis]);
  const range = useMemo(() => surfaceRange(rows), [rows]);

  // Yesterday: the bhavcopy close for real chains, a seeded perturbation for the sample chain.
  const yday = useMemo((): { rows: SurfaceRow[]; label: string } | null => {
    if (isSample) return rows.length ? { rows: sampleYesterdaySurface(rows, 3), label: "sample previous session" } : null;
    if (!prev || prev.chains.length === 0) return null;
    const spot = prev.chains.find((c) => c.underlying > 0)?.underlying ?? 0;
    if (!(spot > 0)) return null;
    const ps = buildExpirySmiles(
      prev.chains.map((c) => ({ expiry: c.expiry, chain: c.chain })),
      { spot, now: toISTDate(prev.date, "15:30"), r: getMarketParams().r },
    );
    const pr = surfaceFor(ps, axis);
    return pr.length ? { rows: pr, label: `NSE bhavcopy close, ${formatDateIST(prev.date)}` } : null;
  }, [isSample, prev, rows, axis]);

  const change = useMemo(() => (yday ? surfaceChange(rows, yday.rows) : []), [rows, yday]);
  const chgMax = useMemo(() => surfaceAbsMax(change) || 1, [change]);
  const relMax = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      const atm = r.cells.ATM;
      if (atm === null || atm === undefined) continue;
      for (const v of Object.values(r.cells)) if (v !== null && Number.isFinite(v)) m = Math.max(m, Math.abs(v - atm));
    }
    return m || 1;
  }, [rows]);
  const effectiveMode: Mode = mode === "chg" && !yday ? "abs" : mode;

  const overlay = useMemo(() => skewOverlay(smiles.filter((s) => s.T * 365 >= 1).slice(0, 6), axis), [smiles, axis]);

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={Grid3x3} title="No surface data" body="The multi-expiry chain did not return usable IVs for this symbol." />
      </Card>
    );
  }

  const changeByExp = new Map(change.map((r) => [r.expiry, r]));

  const cellStyle = (v: number | null, atm: number | null, d: number | null): CSSProperties | undefined => {
    if (effectiveMode === "chg") {
      if (d === null || !Number.isFinite(d)) return undefined;
      const a = 0.08 + 0.55 * Math.min(1, Math.abs(d) / chgMax);
      return { backgroundColor: d >= 0 ? `hsl(var(--bearish) / ${a.toFixed(3)})` : `hsl(var(--bullish) / ${a.toFixed(3)})` };
    }
    if (v === null || !Number.isFinite(v)) return undefined;
    if (effectiveMode === "abs") {
      const span = range.max - range.min || 1;
      const a = 0.08 + 0.62 * ((v - range.min) / span);
      return { backgroundColor: `hsl(var(--chart-2) / ${a.toFixed(3)})` };
    }
    if (atm === null) return undefined;
    const diff = v - atm;
    const a = 0.08 + 0.55 * Math.min(1, Math.abs(diff) / relMax);
    return { backgroundColor: diff >= 0 ? `hsl(var(--bearish) / ${a.toFixed(3)})` : `hsl(var(--bullish) / ${a.toFixed(3)})` };
  };

  const axisNoun = axis === "delta" ? "delta bucket" : "strike as a share of the forward";
  const xTick = (v: number) => (axis === "delta" ? deltaAxisLabel(v) : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`);

  return (
    <div className="space-y-4">
      <Card>
        <PanelHeader
          icon={Grid3x3}
          title={`${symbol} IV surface`}
          subtitle={`Implied volatility by ${axisNoun} (rows: expiries). Deltas and the forward are Black-76 on put-call parity.`}
          right={
            <>
              <ToggleGroup type="single" value={axis} onValueChange={(v) => v && setAxis(v as SurfaceAxis)} className="rounded-tab bg-muted p-0.5" aria-label="Surface axis">
                <ToggleGroupItem value="delta" className={toggleItem}>
                  Delta
                </ToggleGroupItem>
                <ToggleGroupItem value="moneyness" className={toggleItem}>
                  Moneyness
                </ToggleGroupItem>
              </ToggleGroup>
              <ToggleGroup type="single" value={effectiveMode} onValueChange={(v) => v && setMode(v as Mode)} className="rounded-tab bg-muted p-0.5" aria-label="Surface values">
                <ToggleGroupItem value="abs" className={toggleItem}>
                  IV
                </ToggleGroupItem>
                <ToggleGroupItem value="rel" className={toggleItem}>
                  vs ATM
                </ToggleGroupItem>
                <ToggleGroupItem value="chg" className={toggleItem} disabled={!yday} title={yday ? undefined : "Needs the previous session's bhavcopy through the proxy"}>
                  vs yesterday
                </ToggleGroupItem>
              </ToggleGroup>
              {isSample ? <SampleBadge /> : <DerivedBadge />}
            </>
          }
        />
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="relative rounded-tile border border-border">
            {isSample ? <SampleWatermark label="Sample surface" /> : null}
            <ScrollRegion label={`${symbol} IV surface table`}>
              <table className="w-full min-w-[580px] border-collapse text-body-sm">
                <caption className="sr-only">
                  Implied volatility by expiry and {axis === "delta" ? "delta" : "moneyness"} for {symbol}
                  {isSample ? " (sample data, not market prices)" : ""}
                </caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 text-left text-label uppercase text-muted-foreground">
                      Expiry
                    </th>
                    {buckets.map((b) => (
                      <th key={b.key} scope="col" className={`px-2 py-2 text-right text-label uppercase ${b.key === "ATM" ? "text-primary-ink" : "text-muted-foreground"}`}>
                        {b.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const atm = r.cells.ATM ?? null;
                    const ch = changeByExp.get(r.expiry);
                    return (
                      <tr key={r.expiry} className="border-b border-border/60 last:border-0">
                        <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">
                          {formatDateIST(r.expiry)}
                          <span className="ml-1.5 text-muted-foreground">{dteLabel(r.expiry)}</span>
                        </th>
                        {buckets.map((b) => {
                          const v = r.cells[b.key] ?? null;
                          const d = ch?.cells[b.key] ?? null;
                          const text =
                            effectiveMode === "chg"
                              ? d === null
                                ? "—"
                                : fmtVolPts(d)
                              : v === null
                                ? "—"
                                : effectiveMode === "abs" || b.key === "ATM"
                                  ? fmtVol(v)
                                  : fmtVolPts(v - (atm ?? NaN));
                          const missing = effectiveMode === "chg" ? d === null : v === null;
                          return (
                            <td
                              key={b.key}
                              className={`px-2 py-2 text-right tabular-nums ${missing ? "text-muted-foreground" : ""} ${b.key === "ATM" ? "font-semibold" : ""}`}
                              style={cellStyle(v, atm, d)}
                              title={v === null ? "Outside the quoted range" : `${b.label}: ${fmtVol(v, 2)}${d !== null ? ` (${fmtVolPts(d, 2)} vs yesterday)` : ""}`}
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
            </ScrollRegion>
          </div>
          <p className="flex items-start gap-1.5 text-body-sm text-muted-foreground">
            <HelpTip
              text={
                axis === "delta"
                  ? "Each cell interpolates IV at a target delta on the OTM side (puts for the left half, calls for the right). A dash means that delta lies outside the strikes with usable quotes."
                  : "Each cell interpolates the OTM-composite smile at a strike equal to the stated share of the forward (95% is 5% below the forward). A dash means that strike lies outside the quoted range."
              }
            />
            <span>
              {effectiveMode === "abs"
                ? `Darker cells carry higher IV (range ${fmtVol(range.min)} to ${fmtVol(range.max)}).`
                : effectiveMode === "rel"
                  ? "Red cells are richer than the expiry's ATM IV, green cells cheaper. Indian index puts are usually richer than calls."
                  : `Change in vol points against the ${yday?.label ?? "previous session"}. Red: IV rose, green: IV fell.`}
            </span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <PanelHeader
          icon={Spline}
          title="Skew by expiry"
          subtitle={`Each expiry's smile minus its own ATM IV, so shapes can be compared across expiries. X-axis: ${axis === "delta" ? "delta (puts left, calls right)" : "% from the forward"}.`}
          right={isSample ? <SampleBadge /> : <Badge variant="outline">{overlay.length} expiries</Badge>}
        />
        <CardContent className="space-y-3 p-4 pt-0">
          {overlay.length === 0 ? (
            <EmptyState icon={Spline} title="No skew to compare" body="Needs at least one expiry with quotes on both sides of the forward." />
          ) : (
            <>
              <div className="relative h-[300px]" role="img" aria-label={`Skew relative to ATM for ${overlay.length} expiries${isSample ? " (sample data)" : ""}`}>
                {isSample ? <SampleWatermark /> : null}
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis
                      type="number"
                      dataKey="x"
                      domain={axis === "delta" ? [5, 95] : ["dataMin", "dataMax"]}
                      ticks={axis === "delta" ? [10, 25, 50, 75, 90] : undefined}
                      {...axisProps}
                      tickFormatter={xTick}
                      allowDuplicatedCategory={false}
                      minTickGap={20}
                    />
                    <YAxis type="number" dataKey="skew" {...axisProps} width={48} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={tooltipLabelStyle}
                      cursor={tooltipCursor}
                      labelFormatter={(v: number) => (axis === "delta" ? deltaAxisLabel(v) : `${xTick(Math.round(v * 10) / 10)} from forward`)}
                      formatter={(v: number, name: string) => [fmtVolPts(v, 2), name]}
                    />
                    <ReferenceLine y={0} stroke={chartColors.muted} strokeDasharray="3 3" />
                    <ReferenceLine x={axis === "delta" ? 50 : 0} stroke={chartColors.muted} strokeDasharray="3 3" />
                    {overlay.map((l, i) => (
                      <Line
                        key={l.expiry}
                        data={l.points}
                        dataKey="skew"
                        name={`${formatDateIST(l.expiry)} (${dteLabel(l.expiry)})`}
                        type="monotone"
                        stroke={seriesColor(i)}
                        strokeWidth={i === 0 ? 2.25 : 1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-4">
                {overlay.map((l, i) => (
                  <LegendChip key={l.expiry} color={seriesColor(i)} label={`${formatDateIST(l.expiry)} · ${dteLabel(l.expiry)}`} />
                ))}
              </div>
              <p className="text-body-sm text-muted-foreground">
                A steeper left side means downside protection costs more relative to ATM. Near expiries usually show a sharper smile because a given % move is a bigger
                surprise over fewer days.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
