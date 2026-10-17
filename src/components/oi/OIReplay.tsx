import { useEffect, useMemo, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, History, Pause, Play, Radio, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSnapshotRecorder, useSnapshots } from "@/hooks/useSnapshotRecorder";
import { axisProps, barCursor, chartColors, gridProps, legendStyle, tokenColor, tooltipCursor, tooltipStyle } from "@/lib/chartTheme";
import { formatDateIST, formatTimeIST, getMarketSession } from "@/lib/options";
import { diffSnapshots, snapshotSeries, windowAround } from "@/lib/oiUtils";
import { snapshotDateIST, snapshotsToCSV, type ChainSnapshot } from "@/lib/snapshotStore";
import { cn } from "@/lib/utils";
import { EmptyState, ModuleHeader, Segmented, StatTile } from "./shared";
import { fmtOI, fmtOIChange, fmtRatio, fmtStrike } from "./format";

type Mode = "single" | "diff";
const PLAY_MS = 450;

function TimeSlider({ value, max, onChange, labels, ariaLabel }: { value: number[]; max: number; onChange: (v: number[]) => void; labels: string[]; ariaLabel: string[] }) {
  return (
    <SliderPrimitive.Root
      className="relative flex h-6 w-full touch-none select-none items-center"
      min={0}
      max={Math.max(0, max)}
      step={1}
      value={value}
      onValueChange={onChange}
      minStepsBetweenThumbs={0}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-capsule bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary/70" />
      </SliderPrimitive.Track>
      {value.map((v, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={ariaLabel[i]}
          aria-valuetext={labels[v] ?? ""}
          className="block h-5 w-5 rounded-full border-2 border-primary bg-card shadow-card transition-colors focus-visible:shadow-ember focus-visible:outline-none"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

/**
 * Intraday OI replay over snapshots recorded in this browser: OI and ΔOI by strike at time T,
 * T1-vs-T2 diff, play-through, and the max-OI strikes, max pain and spot over the day.
 */
export function OIReplay({ symbol, expiry }: { symbol: string; expiry: string }) {
  const recorder = useSnapshotRecorder(expiry ? [{ symbol, expiry }] : []);
  const { data: snaps = [], isLoading, isError, refetch } = useSnapshots(symbol, expiry);

  const days = useMemo(() => {
    const m = new Map<string, ChainSnapshot[]>();
    for (const s of snaps) {
      const d = snapshotDateIST(s.ts);
      const list = m.get(d);
      if (list) list.push(s);
      else m.set(d, [s]);
    }
    return m;
  }, [snaps]);
  const dayKeys = useMemo(() => [...days.keys()].sort().reverse(), [days]);
  const [day, setDay] = useState<string>("");
  const activeDay = day && days.has(day) ? day : dayKeys[0] ?? "";
  const daySnaps = useMemo(() => days.get(activeDay) ?? [], [days, activeDay]);
  const last = Math.max(0, daySnaps.length - 1);

  const [mode, setMode] = useState<Mode>("single");
  const [t, setT] = useState<number | null>(null); // null = follow latest
  const [range, setRange] = useState<[number, number] | null>(null);
  const [playing, setPlaying] = useState(false);

  const tIdx = Math.min(t ?? last, last);
  const [r1, r2] = range ? [Math.min(range[0], last), Math.min(range[1], last)] : [0, last];

  useEffect(() => {
    setT(null);
    setRange(null);
    setPlaying(false);
  }, [symbol, expiry, activeDay]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setT((cur) => Math.min((cur ?? 0) + 1, last));
    }, PLAY_MS);
    return () => window.clearInterval(id);
  }, [playing, last]);

  useEffect(() => {
    if (playing && tIdx >= last) setPlaying(false);
  }, [playing, tIdx, last]);

  const series = useMemo(() => snapshotSeries(daySnaps), [daySnaps]);
  const labels = useMemo(() => daySnaps.map((s) => formatTimeIST(s.ts)), [daySnaps]);

  const at = mode === "single" ? daySnaps[tIdx] : daySnaps[r2];
  const base = mode === "single" ? daySnaps[0] : daySnaps[r1];
  const bars = useMemo(() => {
    const d = diffSnapshots(at, base);
    return windowAround(d, at?.spot ?? NaN, 12);
  }, [at, base]);
  const point = series.find((p) => p.ts === at?.ts);
  const basePoint = series.find((p) => p.ts === base?.ts);
  const sumChg = bars.reduce((acc, b) => ({ ce: acc.ce + b.ceChg, pe: acc.pe + b.peChg }), { ce: 0, pe: 0 });

  const downloadCSV = () => {
    try {
      const blob = new Blob([snapshotsToCSV(daySnaps)], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${symbol}_${expiry}_${activeDay}_snapshots.csv`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* download not available */
    }
  };

  const recordingBadge = recorder.recording ? (
    <Badge variant="bullish">
      <Radio aria-hidden="true" /> Recording
    </Badge>
  ) : (
    <Badge variant="neutral">{getMarketSession() === "open" ? "Starting recorder" : "Market closed"}</Badge>
  );

  if (!expiry) {
    return (
      <Card>
        <EmptyState icon={<History className="h-5 w-5" />} title="Pick an expiry to replay" />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <EmptyState icon={<History className="h-5 w-5" />} title="Could not read recorded snapshots" action={<Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button>}>
          Browser storage (IndexedDB) may be blocked in this window.
        </EmptyState>
      </Card>
    );
  }

  if (!isLoading && daySnaps.length < 2) {
    return (
      <Card className="overflow-hidden">
        <ModuleHeader icon={<History className="h-4 w-4 text-primary-ink" />} title="Intraday OI replay" right={recordingBadge} />
        <EmptyState icon={<History className="h-5 w-5" />} title="Recording starts when the market is open; keep this tab open">
          Snapshots of the {symbol} {formatDateIST(expiry)} chain are saved in this browser about once a minute during 09:15 to 15:30 IST.
          {daySnaps.length === 1 ? " One snapshot so far; the replay needs at least two." : ""}
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <ModuleHeader
          icon={<History className="h-4 w-4 text-primary-ink" />}
          title="Intraday OI replay"
          hint={`${daySnaps.length} snapshots recorded in this browser · ${labels[0] ?? ""} to ${labels[last] ?? ""}`}
          right={
            <>
              {recordingBadge}
              {dayKeys.length > 1 && (
                <Select value={activeDay} onValueChange={setDay}>
                  <SelectTrigger className="h-8 w-[136px] text-xs" aria-label="Replay day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dayKeys.map((d) => (
                      <SelectItem key={d} value={d} className="text-xs">
                        {formatDateIST(d)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Segmented<Mode>
                label="Replay mode"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setPlaying(false);
                }}
                options={[
                  { value: "single", label: "At time T" },
                  { value: "diff", label: "T1 vs T2" },
                ]}
              />
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={downloadCSV} aria-label="Download this day's snapshots as CSV">
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </>
          }
        />
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center gap-3">
            {mode === "single" && (
              <>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    if (!playing && tIdx >= last) setT(0);
                    setPlaying((p) => !p);
                  }}
                  aria-label={playing ? "Pause replay" : "Play replay"}
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => { setPlaying(false); setT(null); }} aria-label="Jump to latest snapshot">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </>
            )}
            <div className="min-w-0 flex-1">
              {mode === "single" ? (
                <TimeSlider value={[tIdx]} max={last} onChange={(v) => { setPlaying(false); setT(v[0]); }} labels={labels} ariaLabel={["Replay time"]} />
              ) : (
                <TimeSlider value={[r1, r2]} max={last} onChange={(v) => setRange([v[0], v[1]])} labels={labels} ariaLabel={["Time T1", "Time T2"]} />
              )}
              <div className="mt-1 flex justify-between font-num text-[11px] text-muted-foreground">
                <span>{labels[0]}</span>
                <span className="font-semibold text-foreground" aria-live="polite">
                  {mode === "single" ? `T = ${labels[tIdx] ?? ""}` : `T1 ${labels[r1] ?? ""} → T2 ${labels[r2] ?? ""}`}
                </span>
                <span>{labels[last]}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <StatTile label="Spot" value={point ? point.spot.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"} sub={basePoint && point ? `${point.spot - basePoint.spot >= 0 ? "+" : ""}${(point.spot - basePoint.spot).toFixed(2)} vs ${mode === "single" ? "first" : "T1"}` : undefined} />
            <StatTile label="PCR (OI)" value={fmtRatio(point?.pcrOI)} sub={basePoint?.pcrOI && point?.pcrOI ? `${point.pcrOI - basePoint.pcrOI >= 0 ? "+" : ""}${(point.pcrOI - basePoint.pcrOI).toFixed(2)}` : undefined} />
            <StatTile label="Max pain" value={fmtStrike(point?.maxPain)} sub={basePoint?.maxPain && point?.maxPain && basePoint.maxPain !== point.maxPain ? `from ${fmtStrike(basePoint.maxPain)}` : "unchanged"} />
            <StatTile label="Call ΔOI (window)" value={fmtOIChange(sumChg.ce)} valueClass="text-bearish" />
            <StatTile label="Put ΔOI (window)" value={fmtOIChange(sumChg.pe)} valueClass="text-bullish" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-label uppercase text-muted-foreground">OI by strike at {mode === "single" ? "T" : "T2"}</p>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={bars} barGap={0} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis {...axisProps} dataKey="strike" tickFormatter={(v: number) => fmtStrike(v)} minTickGap={14} />
                    <YAxis {...axisProps} tickFormatter={(v: number) => fmtOI(v)} width={50} />
                    <Tooltip contentStyle={tooltipStyle} cursor={barCursor} labelFormatter={(v: number) => `Strike ${fmtStrike(v)}`} formatter={(v: number, n: string) => [fmtOI(v), n]} />
                    {point && <ReferenceLine x={nearestStrike(bars, point.spot)} stroke={chartColors.spot} strokeDasharray="4 4" />}
                    <Bar dataKey="ceOI" name="Call OI" fill={chartColors.call} fillOpacity={0.8} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="peOI" name="Put OI" fill={chartColors.put} fillOpacity={0.8} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <p className="mb-1 text-label uppercase text-muted-foreground">ΔOI {mode === "single" ? "since first snapshot" : "T1 → T2"}</p>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={bars} barGap={0} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis {...axisProps} dataKey="strike" tickFormatter={(v: number) => fmtStrike(v)} minTickGap={14} />
                    <YAxis {...axisProps} tickFormatter={(v: number) => fmtOIChange(v)} width={54} />
                    <Tooltip contentStyle={tooltipStyle} cursor={barCursor} labelFormatter={(v: number) => `Strike ${fmtStrike(v)}`} formatter={(v: number, n: string) => [fmtOIChange(v), n]} />
                    <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.6)} />
                    <Bar dataKey="ceChg" name="Call ΔOI" fill={chartColors.call} fillOpacity={0.8} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="peChg" name="Put ΔOI" fill={chartColors.put} fillOpacity={0.8} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <ModuleHeader title="OI walls and max pain through the day" hint="Strike with the highest call OI and put OI at each snapshot, intraday max pain and spot." />
        <CardContent className="p-4">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis {...axisProps} dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={(v: number) => formatTimeIST(v).replace(" IST", "")} minTickGap={30} />
                <YAxis {...axisProps} domain={["auto", "auto"]} tickFormatter={(v: number) => fmtStrike(v)} width={58} />
                <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={(v: number) => formatTimeIST(v)} formatter={(v: number, n: string) => [fmtStrike(v), n]} />
                <Legend wrapperStyle={legendStyle} />
                {at && <ReferenceLine x={at.ts} stroke={chartColors.foreground} strokeOpacity={0.4} />}
                {mode === "diff" && base && <ReferenceLine x={base.ts} stroke={chartColors.foreground} strokeOpacity={0.25} strokeDasharray="3 3" />}
                <Line type="stepAfter" dataKey="maxCEStrike" name="Max call OI strike" stroke={chartColors.call} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line type="stepAfter" dataKey="maxPEStrike" name="Max put OI strike" stroke={chartColors.put} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line type="stepAfter" dataKey="maxPain" name="Max pain" stroke={chartColors.warning} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
                <Line type="monotone" dataKey="spot" name="Spot" stroke={chartColors.spot} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className={cn("mt-2 text-[11px] text-muted-foreground")}>Recorded only while this tab was open. Gaps mean the tab was closed or the feed was not live.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function nearestStrike(rows: Array<{ strike: number }>, spot: number): number | undefined {
  if (rows.length === 0 || !Number.isFinite(spot)) return undefined;
  let best = rows[0].strike;
  for (const r of rows) if (Math.abs(r.strike - spot) < Math.abs(best - spot)) best = r.strike;
  return best;
}
