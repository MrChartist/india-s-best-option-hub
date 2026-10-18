import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LineChart as LineChartIcon, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { axisProps, compactAxisTick, gridProps, legendStyle, seriesColor, tokenColor, tooltipCursor, tooltipStyle } from "@/lib/chartTheme";
import { formatTimeIST } from "@/lib/options";
import { defaultSeriesStrikes, snapshotStrikes, strikeOISeries, strikeSeriesKey, windowAround, type OISeriesMetric, type OISide } from "@/lib/oiUtils";
import { cn } from "@/lib/utils";
import { ChartCaption, EmptyState, ModuleHeader, Segmented, SessionBadge } from "./shared";
import { fmtOI, fmtOIChange, fmtStrike } from "./format";
import type { OiSession } from "./useOiSession";

/** Most strikes that can be charted at once (each strike can be two lines). */
const MAX_SERIES_STRIKES = 6;
const PICKER_PER_SIDE = 8;

type SideChoice = "CE" | "PE" | "both";
const SIDES: Record<SideChoice, OISide[]> = { CE: ["CE"], PE: ["PE"], both: ["CE", "PE"] };

const timeTick = (v: number) => formatTimeIST(v).replace(" IST", "");

/**
 * Intraday OI (or OI change since the session's first snapshot) for up to six strikes picked with
 * chips. Calls are solid lines, puts dashed, one colour per strike.
 */
export function OITimeSeries({ session, unit }: { session: OiSession; unit?: "contracts" | "qty" }) {
  const { snaps, source, loading } = session;
  const [metric, setMetric] = useState<OISeriesMetric>("chg");
  const [side, setSide] = useState<SideChoice>("both");
  const [picked, setPicked] = useState<number[] | null>(null);

  const last = snaps[snaps.length - 1];
  const options = useMemo(() => {
    const all = snapshotStrikes(snaps);
    if (!last || !(last.spot > 0)) return all.slice(0, PICKER_PER_SIDE * 2 + 1);
    return windowAround(all.map((strike) => ({ strike })), last.spot, PICKER_PER_SIDE).map((r) => r.strike);
  }, [snaps, last]);
  const defaults = useMemo(() => defaultSeriesStrikes(snaps), [snaps]);

  // Keep the user's picks that still exist (symbol or expiry may have changed); else the defaults.
  const selected = useMemo(() => {
    const kept = (picked ?? []).filter((k) => options.includes(k) || defaults.includes(k));
    return kept.length > 0 ? kept : defaults;
  }, [picked, options, defaults]);

  const chipStrikes = useMemo(() => [...new Set([...options, ...selected])].sort((a, b) => a - b), [options, selected]);
  const sides = SIDES[side];
  const rows = useMemo(() => strikeOISeries(snaps, selected, sides, metric), [snaps, selected, sides, metric]);

  const toggle = (k: number) => {
    const cur = selected;
    if (cur.includes(k)) setPicked(cur.length > 1 ? cur.filter((x) => x !== k) : cur);
    else setPicked([...cur, k].sort((a, b) => a - b).slice(-MAX_SERIES_STRIKES));
  };

  const fmt = metric === "oi" ? fmtOI : fmtOIChange;
  const unitText = unit === "qty" ? "quantity (shares)" : "contracts";
  const first = snaps[0];

  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<LineChartIcon className="h-4 w-4 text-primary-ink" />}
        title={metric === "oi" ? "Strike OI through the day" : "Strike OI change through the day"}
        hint="Pick up to six strikes. Calls are solid lines, puts dashed; each strike keeps its colour."
        right={
          <>
            <SessionBadge source={source} count={snaps.length} />
            <Segmented<OISeriesMetric> label="Metric" value={metric} onChange={setMetric} options={[{ value: "chg", label: "OI change" }, { value: "oi", label: "OI" }]} />
            <Segmented<SideChoice> label="Option side" value={side} onChange={setSide} options={[{ value: "both", label: "Both" }, { value: "CE", label: "Calls" }, { value: "PE", label: "Puts" }]} />
          </>
        }
      />
      <CardContent className="space-y-3 p-4">
        {loading && snaps.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-body text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading snapshots…
          </div>
        ) : snaps.length < 2 ? (
          <EmptyState icon={<LineChartIcon className="h-5 w-5" />} title="No intraday session to chart">
            A session needs a spot price and an unexpired contract. Pick another expiry or refresh.
          </EmptyState>
        ) : (
          <>
            <div role="group" aria-label={`Strikes to chart (up to ${MAX_SERIES_STRIKES})`} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {chipStrikes.map((k) => {
                const idx = selected.indexOf(k);
                const on = idx >= 0;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(k)}
                    className={cn(
                      "flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 font-num text-body-sm font-medium transition-[background-color,color,box-shadow] duration-fast focus-visible:shadow-focus focus-visible:outline-none [@media(pointer:coarse)]:h-9",
                      on ? "bg-control text-foreground shadow-control" : "text-foreground/80 hover:bg-control-track hover:text-foreground",
                    )}
                  >
                    {on && <span className="h-2 w-2 rounded-capsule" style={{ backgroundColor: seriesColor(idx) }} aria-hidden="true" />}
                    {fmtStrike(k)}
                  </button>
                );
              })}
            </div>
            <div className="h-[300px] sm:h-[340px]" role="img" aria-label={`Intraday ${metric === "oi" ? "open interest" : "OI change"} for strikes ${selected.map(fmtStrike).join(", ")}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis {...axisProps} dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={timeTick} minTickGap={36} />
                  <YAxis {...axisProps} tickFormatter={compactAxisTick} width={48} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(v: number) => formatTimeIST(v)} formatter={(v: number, n: string) => [typeof v === "number" ? fmt(v) : "—", n]} />
                  <Legend wrapperStyle={legendStyle} />
                  {metric === "chg" && <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.6)} />}
                  {selected.flatMap((k, i) =>
                    sides.map((s) => (
                      <Line
                        key={strikeSeriesKey(k, s)}
                        type="monotone"
                        dataKey={strikeSeriesKey(k, s)}
                        name={`${fmtStrike(k)} ${s}`}
                        stroke={seriesColor(i)}
                        strokeWidth={s === "CE" ? 2 : 1.75}
                        strokeDasharray={s === "PE" ? "5 4" : undefined}
                        dot={false}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    )),
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ChartCaption>
              Y axis: {metric === "oi" ? "open interest" : `OI change since ${first ? formatTimeIST(first.ts) : "the first snapshot"}`}, in {unitText}.{" "}
              {source === "sample" ? "Sample session: a deterministic replay ending at the sample chain, not market data." : "From snapshots saved about once a minute."}
            </ChartCaption>
          </>
        )}
      </CardContent>
    </Card>
  );
}
