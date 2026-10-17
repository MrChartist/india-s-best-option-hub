import { useMemo, useState } from "react";
import { CartesianGrid, Cell, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Crosshair } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { axisProps, chartColors, gridProps, tokenColor, tooltipStyle } from "@/lib/chartTheme";
import { BUILDUP_LABEL, buildupCounts, buildupQuadrantPoints, buildupTone, quantile, type Buildup, type BuildupPoint, type OptionData } from "@/lib/oiUtils";
import { EmptyState, ModuleHeader, Segmented } from "./shared";
import { fmtOI, fmtOIChange, fmtStrike } from "./format";

const TONE_FILL: Record<ReturnType<typeof buildupTone>, string> = {
  bullish: chartColors.bullish,
  bearish: chartColors.bearish,
  info: chartColors.info,
  warning: chartColors.warning,
  neutral: chartColors.muted,
};

const ORDER: Buildup[] = ["LONG_BUILDUP", "SHORT_BUILDUP", "SHORT_COVERING", "LONG_UNWINDING"];

type SideFilter = "ALL" | "CE" | "PE";

interface PlotPoint extends BuildupPoint {
  x: number;
  y: number;
  clipped: boolean;
}

function QuadrantTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PlotPoint }> }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div style={tooltipStyle} className="space-y-0.5 text-xs">
      <p className="font-semibold">
        {fmtStrike(p.strike)} {p.side}
      </p>
      <p>Premium change: {p.pricePct > 0 ? "+" : ""}{p.pricePct.toFixed(2)}%</p>
      <p>OI change: {p.oiPct > 0 ? "+" : ""}{p.oiPct.toFixed(2)}% ({fmtOIChange(p.oiChange)})</p>
      <p>OI: {fmtOI(p.oi)}</p>
      <p className="font-medium">{BUILDUP_LABEL[p.buildup]}</p>
      {p.clipped && <p className="text-muted-foreground">Drawn at the chart edge (outlier).</p>}
    </div>
  );
}

/**
 * Long/short buildup quadrant per strike and side: x = % premium change, y = % OI change.
 * Top-right long build-up, top-left short build-up, bottom-right short covering, bottom-left long
 * unwinding. Outliers beyond the 95th percentile are pinned to the edge so the core stays readable.
 */
export function BuildupQuadrant({ chain, sample }: { chain: OptionData[]; sample?: boolean }) {
  const [side, setSide] = useState<SideFilter>("ALL");
  const all = useMemo(() => buildupQuadrantPoints(chain), [chain]);
  const points = useMemo(() => (side === "ALL" ? all : all.filter((p) => p.side === side)), [all, side]);
  const counts = useMemo(() => buildupCounts(points), [points]);

  const { plot, xMax, yMax } = useMemo(() => {
    const xLim = Math.max(1, quantile(points.map((p) => Math.abs(p.pricePct)), 0.95) * 1.15 || 1);
    const yLim = Math.max(1, quantile(points.map((p) => Math.abs(p.oiPct)), 0.95) * 1.15 || 1);
    const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
    return {
      xMax: Math.ceil(xLim),
      yMax: Math.ceil(yLim),
      plot: points.map<PlotPoint>((p) => ({ ...p, x: clamp(p.pricePct, xLim), y: clamp(p.oiPct, yLim), clipped: Math.abs(p.pricePct) > xLim || Math.abs(p.oiPct) > yLim })),
    };
  }, [points]);

  const ce = plot.filter((p) => p.side === "CE");
  const pe = plot.filter((p) => p.side === "PE");

  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<Crosshair className="h-4 w-4 text-primary-ink" />}
        title="Buildup quadrant"
        hint="Each dot is one strike and side. Right = premium up, top = OI up. Circles are calls, diamonds are puts."
        right={
          <>
            {sample && <Badge variant="warning">Sample data</Badge>}
            <Segmented<SideFilter>
              label="Show side"
              value={side}
              onChange={setSide}
              options={[
                { value: "ALL", label: "Both" },
                { value: "CE", label: "Calls" },
                { value: "PE", label: "Puts" },
              ]}
            />
          </>
        }
      />
      <CardContent className="p-4">
        {plot.length === 0 ? (
          <EmptyState icon={<Crosshair className="h-5 w-5" />} title="No buildup data for this chain">
            The quadrant needs each leg's day change in premium and in OI. This source did not send them, or OI is too thin.
          </EmptyState>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Count per quadrant">
              {ORDER.map((b) => (
                <Badge key={b} variant={buildupTone(b)}>
                  {BUILDUP_LABEL[b]} · {counts[b]}
                </Badge>
              ))}
            </div>
            <div className="h-[340px] sm:h-[380px]" role="img" aria-label={`Buildup quadrant scatter with ${plot.length} legs`}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 12, bottom: 18, left: 0 }}>
                  <CartesianGrid {...gridProps} vertical />
                  <ReferenceArea x1={0} x2={xMax} y1={0} y2={yMax} fill={tokenColor("bullish", 0.05)} stroke="none" label={{ value: "Long build-up", position: "insideTopRight", fill: chartColors.bullish, fontSize: 11 }} />
                  <ReferenceArea x1={-xMax} x2={0} y1={0} y2={yMax} fill={tokenColor("bearish", 0.05)} stroke="none" label={{ value: "Short build-up", position: "insideTopLeft", fill: chartColors.bearish, fontSize: 11 }} />
                  <ReferenceArea x1={0} x2={xMax} y1={-yMax} y2={0} fill={tokenColor("info", 0.05)} stroke="none" label={{ value: "Short covering", position: "insideBottomRight", fill: chartColors.info, fontSize: 11 }} />
                  <ReferenceArea x1={-xMax} x2={0} y1={-yMax} y2={0} fill={tokenColor("warning", 0.05)} stroke="none" label={{ value: "Long unwinding", position: "insideBottomLeft", fill: chartColors.warning, fontSize: 11 }} />
                  <XAxis {...axisProps} type="number" dataKey="x" name="Premium change" unit="%" domain={[-xMax, xMax]} allowDataOverflow label={{ value: "Premium change %", position: "insideBottom", offset: -10, fill: chartColors.axis, fontSize: 11 }} />
                  <YAxis {...axisProps} type="number" dataKey="y" name="OI change" unit="%" domain={[-yMax, yMax]} allowDataOverflow width={48} />
                  <ZAxis type="number" dataKey="oi" range={[24, 220]} />
                  <ReferenceLine x={0} stroke={chartColors.axis} />
                  <ReferenceLine y={0} stroke={chartColors.axis} />
                  <Tooltip content={<QuadrantTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                  {ce.length > 0 && (
                    <Scatter name="Calls" data={ce} shape="circle" isAnimationActive={false}>
                      {ce.map((p) => (
                        <Cell key={`ce-${p.strike}`} fill={TONE_FILL[buildupTone(p.buildup)]} fillOpacity={0.75} />
                      ))}
                    </Scatter>
                  )}
                  {pe.length > 0 && (
                    <Scatter name="Puts" data={pe} shape="diamond" isAnimationActive={false}>
                      {pe.map((p) => (
                        <Cell key={`pe-${p.strike}`} fill={TONE_FILL[buildupTone(p.buildup)]} fillOpacity={0.75} />
                      ))}
                    </Scatter>
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Dot size follows OI. The same rule applies to calls and puts: premium and OI up is long build-up, premium down with OI up is short build-up.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
