import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useOIAnalysisContext } from "./OIAnalysisLayout";
import {
  TARGET_DELTAS, deltaLabel, pickNearestDeltaStrikes, recordDeltaStrikeSnapshot, fetchDeltaStrikeSeries,
} from "@/lib/deltaStrikeTracking";

const moduleCardClass = "overflow-hidden";
const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", padding: "8px 12px" };

function fmtDate(d: string): string {
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// Tracks how the premium of the chain strike nearest each target delta (0.10..0.50,
// CE and PE separately) has moved day by day since the backend started recording it.
export default function OIDeltaTracker() {
  const { chain, spotPrice, symbol, expiry, hasData } = useOIAnalysisContext();
  const [selectedDelta, setSelectedDelta] = useState<number>(0.30);

  const picks = useMemo(() => pickNearestDeltaStrikes(chain), [chain]);
  const cePick = useMemo(() => picks.find(p => p.leg === "CE" && p.targetDelta === selectedDelta), [picks, selectedDelta]);
  const pePick = useMemo(() => picks.find(p => p.leg === "PE" && p.targetDelta === selectedDelta), [picks, selectedDelta]);

  // Records all 5 buckets x 2 legs once per symbol+expiry+day, regardless of which
  // bucket is selected, so switching buckets later already has history building up.
  // The chain refetches every 3s during market hours — this ref stops that from
  // becoming a POST per tick (the backend's own store also dedupes per day either way).
  const recordedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasData || !symbol || !expiry || picks.length === 0) return;
    const todayKey = `${symbol}_${expiry}_${new Date().toLocaleDateString("en-CA")}`;
    if (recordedKeyRef.current === todayKey) return;
    recordedKeyRef.current = todayKey;
    recordDeltaStrikeSnapshot(symbol, expiry, picks);
  }, [symbol, expiry, hasData, picks]);

  const ceLabel = deltaLabel(selectedDelta, "CE");
  const peLabel = deltaLabel(selectedDelta, "PE");
  const hasSymbolExpiry = !!symbol && !!expiry;

  const { data: ceSeries = [], isLoading: ceLoading } = useQuery({
    queryKey: ["delta-strike-series", symbol, expiry, ceLabel],
    queryFn: () => fetchDeltaStrikeSeries(symbol, expiry, ceLabel),
    enabled: hasSymbolExpiry,
    staleTime: 60000,
  });

  const { data: peSeries = [], isLoading: peLoading } = useQuery({
    queryKey: ["delta-strike-series", symbol, expiry, peLabel],
    queryFn: () => fetchDeltaStrikeSeries(symbol, expiry, peLabel),
    enabled: hasSymbolExpiry,
    staleTime: 60000,
  });

  // Outer join by date — a date only present in one leg's series just leaves the
  // other leg undefined for that point rather than fabricating a value for it.
  const chartData = useMemo(() => {
    const dates = Array.from(new Set([...ceSeries.map(s => s.date), ...peSeries.map(s => s.date)])).sort();
    return dates.map(date => ({
      date,
      dateLabel: fmtDate(date),
      ce: ceSeries.find(s => s.date === date)?.value,
      pe: peSeries.find(s => s.date === date)?.value,
    }));
  }, [ceSeries, peSeries]);

  const bucketSuffix = `${Math.round(selectedDelta * 100)}D`;
  const isLoadingSeries = ceLoading || peLoading;
  const hasHistory = chartData.length > 0;

  const statCards = [
    {
      label: `CE ${bucketSuffix} Strike`,
      value: cePick ? cePick.strike.toLocaleString("en-IN") : "—",
      sub: cePick ? `Premium ${cePick.premium.toFixed(2)} · Δ ${cePick.actualDelta.toFixed(2)}` : "No match yet",
      valueClass: "text-bullish",
      accentClass: "bg-bullish",
    },
    {
      label: `PE ${bucketSuffix} Strike`,
      value: pePick ? pePick.strike.toLocaleString("en-IN") : "—",
      sub: pePick ? `Premium ${pePick.premium.toFixed(2)} · Δ ${pePick.actualDelta.toFixed(2)}` : "No match yet",
      valueClass: "text-bearish",
      accentClass: "bg-bearish",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Delta Strike Tracker</h2>
          <p className="text-xs text-muted-foreground">
            Nearest chain strike to the selected delta on each side
            {spotPrice > 0 && <> · Spot <span className="font-mono">{spotPrice.toLocaleString("en-IN")}</span></>}
          </p>
        </div>
        <div className="flex rounded-md border border-border/60 bg-background/70 p-0.5">
          {TARGET_DELTAS.map(d => (
            <button
              key={d}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${selectedDelta === d ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setSelectedDelta(d)}
            >
              {Math.round(d * 100)}D
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {statCards.map(s => (
          <Card key={s.label} className="overflow-hidden">
            <CardContent className="relative p-4">
              <div className={`absolute inset-x-0 top-0 h-0.5 ${s.accentClass}`} />
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className={`mt-1 font-mono text-lg font-semibold leading-none tabular-nums ${s.valueClass}`}>{s.value}</p>
              <p className="mt-1.5 text-xs text-muted-foreground font-mono">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className={moduleCardClass}>
        <CardHeader>
          <CardTitle className="text-sm">{`CE ${bucketSuffix} vs PE ${bucketSuffix} Premium — Daily`}</CardTitle>
          <p className="text-xs text-muted-foreground">One point per trading day since this bucket was first recorded.</p>
        </CardHeader>
        <CardContent>
          {!isLoadingSeries && !hasHistory ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No history yet — this builds up one data point per trading day. Check back tomorrow.
            </div>
          ) : (
            <div className="h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="ce" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={{ r: 3 }} name={`CE ${bucketSuffix}`} connectNulls />
                  <Line type="monotone" dataKey="pe" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={{ r: 3 }} name={`PE ${bucketSuffix}`} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
