import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAllIndices, useLiveIndices, useLiveOptionChain, useStoredCandles } from "@/hooks/useMarketData";
import { useWebSocketVix, useWebSocketIndices, useWebSocketStatus } from "@/hooks/useWebSocket";
import { Globe, Activity, Radio, Database } from "lucide-react";
import { useChartData } from "@/hooks/useChartData";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  Cell, ReferenceLine, AreaChart, Area, LineChart, Line,
} from "recharts";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontSize: "11px",
};

export function FuturesVIX() {
  const { data: indicesData } = useAllIndices();
  const { data: liveIndices } = useLiveIndices();
  const { vix: wsVix } = useWebSocketVix();
  const { indices: wsIndices } = useWebSocketIndices();
  const wsConnected = useWebSocketStatus();
  
  // Try to load stored VIX candle data from IndexedDB
  const { data: storedVixCandles } = useStoredCandles("INDIAVIX");
  
  // Also get NIFTY stored candles for a real intraday chart
  const { data: storedNiftyCandles } = useStoredCandles("NIFTY");

  const vix = wsVix || indicesData?.vix;
  const isLive = wsConnected || indicesData?.isLive || false;
  
  // Fallback: fetch VIX history from Dhan API when IndexedDB is empty
  const hasStoredVixData = !!storedVixCandles?.candles?.length;
  const { data: apiVixCandles } = useChartData("INDIAVIX", "1M", !hasStoredVixData);
  
  // VIX chart data: IndexedDB → Dhan API fallback
  const vixChartData = useMemo(() => {
    if (storedVixCandles?.candles?.length) {
      return storedVixCandles.candles.map((c: any) => ({
        time: c.date,
        vix: c.close,
      }));
    }
    if (apiVixCandles && apiVixCandles.length > 0) {
      return apiVixCandles.map(c => ({
        time: new Date(c.time * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        vix: c.close,
      }));
    }
    return [];
  }, [storedVixCandles, apiVixCandles]);
  
  const hasVixChartData = vixChartData.length > 0;

  // Build index performance data using live spot prices — honest display without fake futures
  const liveFuturesData = useMemo(() => {
    const wsIdxMap = new Map(wsIndices.map(i => [i.symbol, i]));
    const polledIndices = liveIndices?.data || [];
    const allLiveIndices = [...polledIndices];
    // Add websocket indices that aren't already in polled
    for (const wsIdx of wsIndices) {
      if (!allLiveIndices.find((i: any) => i.symbol === wsIdx.symbol)) {
        allLiveIndices.push(wsIdx);
      }
    }
    return allLiveIndices.filter((idx: any) => idx.ltp > 0).map((idx: any) => ({
      symbol: idx.symbol || idx.name,
      spotPrice: idx.ltp,
      change: idx.change || 0,
      changePercent: idx.changePercent || 0,
      high: idx.high || idx.ltp,
      low: idx.low || idx.ltp,
      open: idx.open || idx.ltp,
    }));
  }, [wsIndices, liveIndices]);

  const indexChangeChart = useMemo(() => {
    return liveFuturesData.map((f) => ({
      label: f.symbol,
      change: f.change,
      changePct: f.changePercent,
    }));
  }, [liveFuturesData]);

  return (
    <div className="grid lg:grid-cols-3 gap-3">
      <div className="lg:col-span-2">
        <Card className="hover:shadow-card-hover transition-all duration-300">
          <CardHeader className="pb-3 pt-4 px-5 bg-gradient-to-r from-primary/5 to-transparent">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.5)]" /> Index Performance
              {isLive && <Badge variant="outline" className="text-[10px] h-5 px-2 border-bullish/30 text-bullish ml-auto gap-1"><Radio className="h-3 w-3 animate-pulse" />LIVE</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <div className="h-[160px] mb-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={indexChangeChart} layout="vertical" barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={100} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value >= 0 ? "+" : ""}${value.toFixed(2)}%`, "Change"]} />
                  <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                  <Bar dataKey="changePct" name="Change %" radius={[0, 4, 4, 0]}>
                    {indexChangeChart.map((entry, i) => (
                      <Cell key={i} fill={entry.changePct >= 0 ? "hsl(var(--bullish) / 0.7)" : "hsl(var(--bearish) / 0.7)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="text-xs border-b-white/5">
                  <TableHead className="h-9">Index</TableHead>
                  <TableHead className="h-9 text-right">Spot</TableHead>
                  <TableHead className="h-9 text-right">Open</TableHead>
                  <TableHead className="h-9 text-right">High</TableHead>
                  <TableHead className="h-9 text-right">Low</TableHead>
                  <TableHead className="h-9 text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveFuturesData.map((f, i) => (
                  <TableRow key={i} className="text-sm font-mono border-b-white/5 hover:bg-accent/30 transition-colors">
                    <TableCell className="font-medium font-sans py-2">{f.symbol}</TableCell>
                    <TableCell className="text-right py-2 font-semibold text-foreground">{f.spotPrice.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right py-2 text-muted-foreground">{f.open.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right py-2 text-bullish/80">{f.high.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right py-2 text-bearish/80">{f.low.toLocaleString("en-IN")}</TableCell>
                    <TableCell className={`text-right font-medium py-2 ${f.changePercent >= 0 ? "text-bullish drop-shadow-[0_0_5px_rgba(0,255,100,0.3)]" : "text-bearish drop-shadow-[0_0_5px_rgba(255,50,50,0.3)]"}`}>
                      {f.changePercent >= 0 ? "+" : ""}{f.changePercent.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="hover:shadow-card-hover transition-all duration-300">
        <CardHeader className="pb-3 pt-4 px-5 bg-gradient-to-r from-warning/5 to-transparent">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-5 w-5 text-warning drop-shadow-[0_0_8px_rgba(255,165,0,0.5)]" /> India VIX
            {vix && <span className={`ml-auto text-lg font-mono font-bold ${vix.changePercent >= 0 ? "text-bearish drop-shadow-[0_0_5px_rgba(255,50,50,0.3)]" : "text-bullish drop-shadow-[0_0_5px_rgba(0,255,100,0.3)]"}`}>
              {vix.value.toFixed(2)}
            </span>}
            {hasVixChartData && (
              <span className="text-[10px] text-primary/50 flex items-center gap-1 font-mono">
                <Database className="h-3 w-3" />DB
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          {/* Live VIX stats */}
          {vix && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-md bg-accent/30 p-2 text-center border border-white/5">
                <p className="text-xs text-muted-foreground mb-0.5">Current</p>
                <p className="text-base font-bold font-mono">{vix.value.toFixed(2)}</p>
              </div>
              <div className="rounded-md bg-accent/30 p-2 text-center border border-white/5">
                <p className="text-xs text-muted-foreground mb-0.5">High</p>
                <p className="text-base font-bold font-mono text-bearish">{vix.high.toFixed(2)}</p>
              </div>
              <div className="rounded-md bg-accent/30 p-2 text-center border border-white/5">
                <p className="text-xs text-muted-foreground mb-0.5">Low</p>
                <p className="text-base font-bold font-mono text-bullish">{vix.low.toFixed(2)}</p>
              </div>
            </div>
          )}
          <div className="h-[120px]">
            {hasVixChartData ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={vixChartData}>
                <defs>
                  <linearGradient id="vixGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--warning))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={["auto", "auto"]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="vix" stroke="hsl(var(--warning))" fill="url(#vixGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-1.5">
                <Activity className="h-6 w-6 opacity-20" />
                <p className="text-[10px]">VIX chart data unavailable</p>
                <p className="text-[8px] opacity-50">Download database or wait for market hours</p>
              </div>
            )}
          </div>
          {/* Index Snapshot */}
          <div className="mt-4 space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Index Snapshot</p>
            {liveFuturesData.slice(0, 4).map((f, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-md bg-accent/30 border border-white/5">
                <span className="text-xs font-semibold">{f.symbol}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground">
                    {f.spotPrice.toLocaleString("en-IN")}
                  </span>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${f.changePercent >= 0 ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                    {f.changePercent >= 0 ? "+" : ""}{f.changePercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
