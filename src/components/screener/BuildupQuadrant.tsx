import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Crosshair } from "lucide-react";
import { Card } from "@/components/ui/card";
import { axisProps, chartColors, legendStyle, tokenColor, tooltipStyle } from "@/lib/chartTheme";
import { BUILDUP_LABEL, type Buildup } from "@/lib/options";
import type { ScreenerRow } from "@/lib/screener/metrics";
import { EmptyState, PanelHeader, SampleBadge, Signed } from "./ScreenerUi";

const SERIES: Array<{ key: Exclude<Buildup, "NEUTRAL">; color: string; wash: string }> = [
  { key: "LONG_BUILDUP", color: chartColors.bullish, wash: tokenColor("bullish", 0.05) },
  { key: "SHORT_COVERING", color: chartColors.info, wash: tokenColor("info", 0.05) },
  { key: "SHORT_BUILDUP", color: chartColors.bearish, wash: tokenColor("bearish", 0.05) },
  { key: "LONG_UNWINDING", color: chartColors.warning, wash: tokenColor("warning", 0.05) },
];

interface Point {
  x: number;
  y: number;
  symbol: string;
  buildup: Buildup;
  clipped: boolean;
}

/** Cap at the 97th percentile of |value| so one outlier does not squash the cloud. */
function bound(values: number[], floor: number): number {
  const abs = values.map((v) => Math.abs(v)).sort((a, b) => a - b);
  if (abs.length === 0) return floor;
  const p = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.97))];
  return Math.max(floor, Math.ceil(p * 1.1));
}

function QuadTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={tooltipStyle}>
      <p className="font-semibold">{p.symbol}</p>
      <p className="text-muted-foreground">{BUILDUP_LABEL[p.buildup]}</p>
      <p>
        Price <Signed value={p.x} /> · OI <Signed value={p.y} />
      </p>
      {p.clipped ? <p className="text-micro text-muted-foreground">Beyond the axis range, pinned to the edge</p> : null}
    </div>
  );
}

export function BuildupQuadrant({ rows, isSample }: { rows: ScreenerRow[]; isSample: boolean }) {
  const navigate = useNavigate();
  const { points, xMax, yMax, tops } = useMemo(() => {
    const valid = rows.filter((r) => r.oiChangePct !== null && Number.isFinite(r.changePct));
    const xMax = bound(valid.map((r) => r.changePct), 2);
    const yMax = bound(valid.map((r) => r.oiChangePct as number), 5);
    const points: Point[] = valid.map((r) => {
      const y = r.oiChangePct as number;
      const cx = Math.max(-xMax, Math.min(xMax, r.changePct));
      const cy = Math.max(-yMax, Math.min(yMax, y));
      return { x: cx, y: cy, symbol: r.symbol, buildup: r.buildup, clipped: cx !== r.changePct || cy !== y };
    });
    const tops = SERIES.map((s) => ({
      ...s,
      rows: valid
        .filter((r) => r.buildup === s.key)
        .sort((a, b) => Math.abs(b.oiChangePct as number) - Math.abs(a.oiChangePct as number))
        .slice(0, 5),
      count: valid.filter((r) => r.buildup === s.key).length,
    }));
    return { points, xMax, yMax, tops };
  }, [rows]);

  return (
    <Card>
      <PanelHeader
        title="Buildup quadrant"
        icon={<Crosshair className="h-4 w-4 text-primary-ink" aria-hidden="true" />}
        help="Each dot is an underlying: price change on the horizontal axis, futures OI change on the vertical axis. Top-right is long buildup, bottom-right short covering, top-left short buildup, bottom-left long unwinding."
      >
        {isSample ? <SampleBadge /> : null}
        <span className="text-body-sm text-muted-foreground">{points.length} plotted</span>
      </PanelHeader>
      {points.length === 0 ? (
        <EmptyState title="No OI data yet" body="OI change arrives from NSE OI spurts and the futures scan. Points appear as data comes in." />
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="h-[380px] sm:h-[440px]" role="img" aria-label={`Scatter of price change against OI change for ${points.length} underlyings. Quadrant lists follow.`}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 12, bottom: 24, left: 0 }}>
                <ReferenceArea x1={0} x2={xMax} y1={0} y2={yMax} fill={SERIES[0].wash} stroke="none" ifOverflow="hidden" />
                <ReferenceArea x1={0} x2={xMax} y1={-yMax} y2={0} fill={SERIES[1].wash} stroke="none" ifOverflow="hidden" />
                <ReferenceArea x1={-xMax} x2={0} y1={0} y2={yMax} fill={SERIES[2].wash} stroke="none" ifOverflow="hidden" />
                <ReferenceArea x1={-xMax} x2={0} y1={-yMax} y2={0} fill={SERIES[3].wash} stroke="none" ifOverflow="hidden" />
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" />
                <XAxis
                  {...axisProps}
                  type="number"
                  dataKey="x"
                  name="Price change"
                  domain={[-xMax, xMax]}
                  tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`}
                  label={{ value: "Price change %", position: "insideBottom", offset: -14, fill: chartColors.axis, fontSize: 11 }}
                />
                <YAxis
                  {...axisProps}
                  type="number"
                  dataKey="y"
                  name="OI change"
                  domain={[-yMax, yMax]}
                  width={52}
                  tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}%`}
                />
                <ZAxis range={[64, 64]} />
                <ReferenceLine x={0} stroke={chartColors.axis} strokeWidth={1} />
                <ReferenceLine y={0} stroke={chartColors.axis} strokeWidth={1} />
                <Tooltip content={<QuadTooltip />} cursor={{ strokeDasharray: "3 3", stroke: chartColors.muted }} />
                <Legend wrapperStyle={{ ...legendStyle, paddingTop: 18 }} />
                {SERIES.map((s) => (
                  <Scatter
                    key={s.key}
                    name={BUILDUP_LABEL[s.key]}
                    data={points.filter((p) => p.buildup === s.key)}
                    fill={s.color}
                    fillOpacity={0.85}
                    stroke={chartColors.card}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                    cursor="pointer"
                    onClick={(d: unknown) => {
                      const sym = (d as { symbol?: string } | undefined)?.symbol ?? (d as { payload?: { symbol?: string } } | undefined)?.payload?.symbol;
                      if (sym) navigate(`/option-chain?symbol=${encodeURIComponent(sym)}`);
                    }}
                  />
                ))}
                <Scatter name="Neutral" data={points.filter((p) => p.buildup === "NEUTRAL")} fill={chartColors.muted} fillOpacity={0.5} isAnimationActive={false} legendType="none" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {tops.map((t) => (
              <section key={t.key} aria-label={`${BUILDUP_LABEL[t.key]}: top by OI change`} className="rounded-tile border border-border p-2.5">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-label uppercase text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: t.color }} aria-hidden="true" />
                  {BUILDUP_LABEL[t.key]}
                  <span className="ml-auto font-num text-foreground">{t.count}</span>
                </h3>
                {t.rows.length === 0 ? (
                  <p className="text-body-sm text-muted-foreground">None right now</p>
                ) : (
                  <ul className="space-y-0.5 text-body-sm">
                    {t.rows.map((r) => (
                      <li key={r.symbol} className="flex items-center justify-between gap-2">
                        <span className="font-medium">{r.symbol}</span>
                        <span className="flex gap-2">
                          <Signed value={r.changePct} />
                          <Signed value={r.oiChangePct} decimals={1} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
