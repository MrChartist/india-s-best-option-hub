import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, Minus, Clock, ArrowUp, ArrowDown } from "lucide-react";
import { getATMZoneAnalysis } from "@/lib/oiUtils";
import { useFuturesScanner } from "@/hooks/useMarketData";
import {
  getTrendingOIHistory, recordTrendingOISnapshot, classifyTrendingOI,
  annotateTrendingOIRows, resampleTrendingOIRows,
  type TrendingOISignalKind,
} from "@/lib/trendingOiStore";
import { useOIAnalysisContext } from "./OIAnalysisLayout";

// ATM + 7 above + 7 below — the "most active strikes" window this methodology uses.
const ZONE_STRIKES = 15;

function signalStyle(signal: TrendingOISignalKind) {
  switch (signal) {
    case "Bullish": return { badge: "border-bullish text-bullish bg-bullish/10", Icon: TrendingUp };
    case "Bearish": return { badge: "border-bearish text-bearish bg-bearish/10", Icon: TrendingDown };
    default: return { badge: "border-muted-foreground/40 text-muted-foreground bg-muted/30", Icon: Minus };
  }
}

const fmtSigned = (v: number) => `${v >= 0 ? "+" : ""}${(v / 1000).toFixed(0)}K`;
const fmtTime = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// The backend's "last close" cache timestamp reflects when it last talked to Dhan
// successfully, not the trading date of the quote — Dhan can hand back Friday's
// frozen numbers as a "successful" response on a Sunday, re-stamping the cache
// time to now. So this is computed from the calendar instead: walk back over
// Sat/Sun (and, if it's a weekday before the 9:15 AM open, one more day) to the
// most recent day the market was actually open. Doesn't know about exchange
// holidays — there's no holiday calendar in this app — but gets weekends right,
// which is the case that was showing "Sunday" instead of "Friday."
function lastTradingDayLabel(): string {
  const d = new Date();
  const beforeOpen = d.getHours() < 9 || (d.getHours() === 9 && d.getMinutes() < 15);
  if (beforeOpen) d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
}

export default function OITrendingOI() {
  const { chain, spotPrice, stepSize, symbol, isLive } = useOIAnalysisContext();
  const zone = useMemo(() => getATMZoneAnalysis(chain, spotPrice, stepSize, ZONE_STRIKES), [chain, spotPrice, stepSize]);
  const { data: futuresData } = useFuturesScanner();
  const futuresRow = useMemo(() => futuresData?.rows.find(r => r.symbol === symbol), [futuresData, symbol]);

  const [rawHistory, setRawHistory] = useState(() => getTrendingOIHistory(symbol));
  const [intervalMinutes, setIntervalMinutes] = useState(5);

  // Symbol switched — load that symbol's own history rather than carrying the previous one over.
  useEffect(() => {
    setRawHistory(getTrendingOIHistory(symbol));
  }, [symbol]);

  // Latest reading, kept in a ref so the interval below always sees fresh values
  // without needing chain/zone in its dependency array (which would tear down
  // and restart the interval on every 3s chain refresh).
  const latestReading = useRef({ isLive: false, hasChain: false, spotPrice: 0, ceOI: 0, peOI: 0, ceOIChg: 0, peOIChg: 0 });
  latestReading.current = {
    isLive,
    hasChain: chain.length > 0 && spotPrice > 0,
    spotPrice, ceOI: zone.totalCEOI, peOI: zone.totalPEOI, ceOIChg: zone.totalCEOIChg, peOIChg: zone.totalPEOIChg,
  };

  // Ticks every 3s and attempts a snapshot regardless of whether the chain's
  // OI actually moved since the last tick — recordTrendingOISnapshot's own
  // 10s throttle governs the real cadence. Only records while genuinely live:
  // the cached "last close" chain never changes once the market shuts, so
  // recording through afterHours would just stamp fresh-looking timestamps on
  // identical numbers over and over — a real reading of nothing happening,
  // dressed up as a live-updating table. Recording stops the moment isLive
  // does; the closed-market view below shows the last real snapshot instead.
  useEffect(() => {
    const tryRecord = () => {
      const r = latestReading.current;
      if (!r.isLive || !r.hasChain) return;
      setRawHistory(recordTrendingOISnapshot(symbol, {
        spot: r.spotPrice, ceOI: r.ceOI, peOI: r.peOI, ceOIChg: r.ceOIChg, peOIChg: r.peOIChg,
      }));
    };
    tryRecord();
    const id = setInterval(tryRecord, 3000);
    return () => clearInterval(id);
  }, [symbol]);

  const signal = useMemo(() => classifyTrendingOI(rawHistory), [rawHistory]);
  const { badge: signalBadge, Icon: SignalIcon } = signalStyle(signal.signal);

  // Day high/low detection needs full resolution — resample the annotated result, not the raw input.
  const rows = useMemo(() => {
    const annotated = annotateTrendingOIRows(rawHistory);
    return resampleTrendingOIRows(annotated, intervalMinutes).slice().reverse();
  }, [rawHistory, intervalMinutes]);

  const now = new Date();
  const isPastSettleTime = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() >= 45);
  const diff = zone.totalPEOIChg - zone.totalCEOIChg;

  const chartData = useMemo(() => rawHistory.map(s => ({
    time: fmtTime(s.time).slice(0, 5),
    "CE OI Chg": Math.round(s.ceOIChg / 1000),
    "PE OI Chg": Math.round(s.peOIChg / 1000),
    "Diff": Math.round(s.diff / 1000),
  })), [rawHistory]);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Trending OI ({zone.strikes || ZONE_STRIKES} Most Active Strikes)
            <Badge variant="outline" className={`gap-1 text-xs ${signalBadge}`}>
              <SignalIcon className="h-3 w-3" /> {signal.signal}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            {isLive && !isPastSettleTime && (
              <Badge variant="outline" className="gap-1 text-xs border-warning/50 text-warning">
                <Clock className="h-3 w-3" /> Pre-9:45 — let the market settle
              </Badge>
            )}
            <Select value={String(intervalMinutes)} onValueChange={v => setIntervalMinutes(Number(v))}>
              <SelectTrigger className="h-7 w-[100px] bg-background/70 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 min</SelectItem>
                <SelectItem value="3">3 min</SelectItem>
                <SelectItem value="5">5 min</SelectItem>
                <SelectItem value="15">15 min</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Bullish when Put OI change keeps rising as Call OI change keeps falling (sellers betting on a rise); Bearish is the mirror image. Each row's Sentiment reads that row's Diff-in-OI sign directly; the badge above smooths the last {signal.readingsUsed || 30} readings (~5 min) into a session bias. Live only — recorded from this session, no historical intraday replay.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 mb-4 md:grid-cols-5">
          <MetricTile label="Zone CE OI Chg" value={fmtSigned(zone.totalCEOIChg)} positive={zone.totalCEOIChg >= 0} />
          <MetricTile label="Zone PE OI Chg" value={fmtSigned(zone.totalPEOIChg)} positive={zone.totalPEOIChg >= 0} />
          <MetricTile label="Diff in OI" value={fmtSigned(diff)} positive={diff >= 0} />
          <MetricTile label="Net PCR" value={zone.pcr.toFixed(2)} positive={zone.pcr >= 1} />
          <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
            <p className="text-xs text-muted-foreground">Futures OI Chg%</p>
            {futuresRow && futuresRow.oiChangePercent !== null ? (
              <p className={`text-sm font-semibold font-mono ${futuresRow.oiChangePercent >= 0 ? "text-bullish" : "text-bearish"}`}>
                {futuresRow.oiChangePercent >= 0 ? "+" : ""}{futuresRow.oiChangePercent.toFixed(1)}%
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">{futuresRow.buildupSignal}</span>
              </p>
            ) : <p className="text-sm text-muted-foreground">—</p>}
          </div>
        </div>

        {!isLive ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Market is closed — the metrics above are {lastTradingDayLabel()}'s closing snapshot. Live intraday tracking resumes automatically once the market opens at 9:15 AM IST.
          </div>
        ) : rawHistory.length < 3 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Collecting readings — every ~10s. The table needs at least 3 ({rawHistory.length}/3 so far today).
          </div>
        ) : (
          <>
            <div className="h-[200px] mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                  <Line type="monotone" dataKey="CE OI Chg" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="PE OI Chg" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Diff" stroke="hsl(38 92% 50%)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs whitespace-nowrap">
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">LTP</TableHead>
                    <TableHead>Day H/L Break</TableHead>
                    <TableHead className="text-right">Chng in Call OI</TableHead>
                    <TableHead className="text-right">Chng in Put OI</TableHead>
                    <TableHead className="text-right">Diff in OI</TableHead>
                    <TableHead className="text-center">Direction</TableHead>
                    <TableHead className="text-right">Chng in Direction</TableHead>
                    <TableHead className="text-right">Direction %</TableHead>
                    <TableHead className="text-right">Net PCR</TableHead>
                    <TableHead>Diff Day High/Low</TableHead>
                    <TableHead>Sentiment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.time} className="font-mono text-xs whitespace-nowrap hover:bg-muted/30">
                      <TableCell>{fmtTime(r.time)}</TableCell>
                      <TableCell className="text-right">{r.spot.toLocaleString("en-IN")}</TableCell>
                      <TableCell>
                        {r.dayHighBreak ? <Badge variant="outline" className="text-2xs h-5 border-bullish/50 text-bullish">D.H.B.</Badge>
                          : r.dayLowBreak ? <Badge variant="outline" className="text-2xs h-5 border-bearish/50 text-bearish">D.L.B.</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">{r.ceOIChg.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right">{r.peOIChg.toLocaleString("en-IN")}</TableCell>
                      <TableCell className={`text-right font-semibold ${r.diff >= 0 ? "text-bullish" : "text-bearish"}`}>{r.diff.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-center">
                        {r.directionOfChange === "up" ? <ArrowUp className="h-3.5 w-3.5 text-bullish inline" />
                          : r.directionOfChange === "down" ? <ArrowDown className="h-3.5 w-3.5 text-bearish inline" />
                          : <Minus className="h-3.5 w-3.5 text-muted-foreground inline" />}
                      </TableCell>
                      <TableCell className={`text-right ${r.changeInDirection >= 0 ? "text-bullish" : "text-bearish"}`}>{r.changeInDirection.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right">{r.directionChangePercent === null ? "—" : `${r.directionChangePercent}%`}</TableCell>
                      <TableCell className="text-right">{r.netPCR.toFixed(2)}</TableCell>
                      <TableCell>
                        {r.diffDayHighBreak ? <Badge variant="outline" className="text-2xs h-5 border-bullish/50 text-bullish">Day High Break</Badge>
                          : r.diffDayLowBreak ? <Badge variant="outline" className="text-2xs h-5 border-bearish/50 text-bearish">Day Low Break</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-2xs h-5 ${r.sentiment === "Bullish" ? "border-bullish/50 text-bullish bg-bullish/10" : r.sentiment === "Bearish" ? "border-bearish/50 text-bearish bg-bearish/10" : "border-muted-foreground/40 text-muted-foreground"}`}>
                          {r.sentiment}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MetricTile({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold font-mono ${positive ? "text-bullish" : "text-bearish"}`}>{value}</p>
    </div>
  );
}
