import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAllIndices, useLiveIndices, useLiveOptionChain, useStoredCandles } from "@/hooks/useMarketData";
import { useWebSocketVix, useWebSocketIndices, useWebSocketStatus } from "@/hooks/useWebSocket";
import { Globe, Activity, Radio, Database } from "lucide-react";
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
  
  // VIX chart data: use stored candle data only
  const vixChartData = useMemo(() => {
    if (storedVixCandles?.candles?.length) {
      return storedVixCandles.candles.map((c: any) => ({
        time: c.date,
        vix: c.close,
      }));
    }
    return [];
  }, [storedVixCandles]);
  
  const hasStoredVixData = !!storedVixCandles?.candles?.length;

  // Build futures data using live spot prices when available
  const liveFuturesData = useMemo(() => {
    // No mock futures data — only show when we have live indices
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
      futuresPrice: idx.ltp, // We don't have futures price, show spot
      premium: 0,
      premiumPercent: 0,
      expiry: "Spot",
      change: idx.change || 0,
      changePercent: idx.changePercent || 0,
    }));
  }, [wsIndices, liveIndices]);

  const futuresPremiumChart = useMemo(() => {
    return liveFuturesData.map((f) => ({
      label: `${f.symbol} ${f.expiry}`,
      premium: f.premium,
      premiumPct: f.premiumPercent,
    }));
  }, [liveFuturesData]);

  return (
    <div className="grid lg:grid-cols-3 gap-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="h-4 w-4" /> Futures Premium / Discount
              {isLive && <Badge variant="outline" className="text-[8px] h-4 px-1 border-bullish/30 text-bullish ml-auto gap-1"><Radio className="h-2 w-2 animate-pulse" />LIVE</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-[160px] mb-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={futuresPremiumChart} layout="vertical" barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={110} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`₹${value.toFixed(2)}`, "Premium"]} />
                  <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                  <Bar dataKey="premium" name="Premium" radius={[0, 4, 4, 0]}>
                    {futuresPremiumChart.map((entry, i) => (
                      <Cell key={i} fill={entry.premium >= 0 ? "hsl(var(--bullish) / 0.7)" : "hsl(var(--bearish) / 0.7)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="text-[10px]">
                  <TableHead className="h-7">Symbol</TableHead>
                  <TableHead className="h-7">Expiry</TableHead>
                  <TableHead className="h-7 text-right">Spot</TableHead>
                  <TableHead className="h-7 text-right">Futures</TableHead>
                  <TableHead className="h-7 text-right">Premium</TableHead>
                  <TableHead className="h-7 text-right">OI Chg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveFuturesData.map((f, i) => (
                  <TableRow key={i} className="text-xs font-mono">
                    <TableCell className="font-medium font-sans py-1.5">{f.symbol}</TableCell>
                    <TableCell className="text-muted-foreground py-1.5">{f.expiry}</TableCell>
                    <TableCell className="text-right py-1.5">{f.spotPrice.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right py-1.5">{f.futuresPrice.toLocaleString("en-IN")}</TableCell>
                    <TableCell className={`text-right font-medium py-1.5 ${f.premium >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {f.premium >= 0 ? "+" : ""}₹{f.premium.toFixed(2)}
                    </TableCell>
                    <TableCell className={`text-right py-1.5 ${f.changePercent >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {f.changePercent >= 0 ? "+" : ""}{f.changePercent.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" /> India VIX
            {vix && <span className={`ml-auto text-sm font-mono font-bold ${vix.changePercent >= 0 ? "text-bearish" : "text-bullish"}`}>
              {vix.value.toFixed(2)}
            </span>}
            {hasStoredVixData && (
              <span className="text-[8px] text-primary/50 flex items-center gap-0.5">
                <Database className="h-2 w-2" />DB
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3">
          {/* Live VIX stats */}
          {vix && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-md bg-accent/30 p-2 text-center">
                <p className="text-[9px] text-muted-foreground">Current</p>
                <p className="text-sm font-bold font-mono">{vix.value.toFixed(2)}</p>
              </div>
              <div className="rounded-md bg-accent/30 p-2 text-center">
                <p className="text-[9px] text-muted-foreground">High</p>
                <p className="text-sm font-bold font-mono text-bearish">{vix.high.toFixed(2)}</p>
              </div>
              <div className="rounded-md bg-accent/30 p-2 text-center">
                <p className="text-[9px] text-muted-foreground">Low</p>
                <p className="text-sm font-bold font-mono text-bullish">{vix.low.toFixed(2)}</p>
              </div>
            </div>
          )}
          <div className="h-[120px]">
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
          </div>
          {/* Basis Summary */}
          <div className="mt-3 space-y-1.5">
            <p className="text-[10px] text-muted-foreground font-medium">Basis Summary</p>
            {liveFuturesData.slice(0, 3).map((f, i) => (
              <div key={i} className="flex items-center justify-between p-1.5 rounded-md bg-accent/30">
                <span className="text-[10px] font-medium">{f.symbol}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono font-bold ${f.premium >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {f.premium >= 0 ? "Premium" : "Discount"}
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${f.premium >= 0 ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                    {f.premium >= 0 ? "+" : ""}{f.premiumPercent.toFixed(2)}%
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
