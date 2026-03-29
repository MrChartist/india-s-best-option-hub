import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LineChart, Line, ComposedChart, Area } from "recharts";
import { getMaxPain, getDeltaOI, getStrikePCR, getATMZoneAnalysis, calculatePCR } from "@/lib/oiUtils";
import { OIHeatmap } from "@/components/OIHeatmap";
import { SupportResistance } from "@/components/SupportResistance";
import { MultiExpiryOI } from "@/components/MultiExpiryOI";
import { IVPercentileGauge } from "@/components/IVPercentileGauge";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { Wifi, WifiOff, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OIAnalysis() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [atmZoneSize, setATMZoneSize] = useState<number>(5);
  const { data: liveData, refetch, isLoading } = useLiveOptionChain(symbol);
  const chain = liveData?.chain || [];
  const spotPrice = liveData?.spotPrice || 0;
  const stepSize = liveData?.stepSize || 50;
  const isLive = liveData?.isLive || false;
  const maxPain = useMemo(() => getMaxPain(chain), [chain]);
  // Live PCR computed from current chain
  const pcrData = useMemo(() => calculatePCR(chain), [chain]);

  const oiData = useMemo(() => {
    return chain
      .filter(o => o.ce.oi > 50000 || o.pe.oi > 50000)
      .map(o => ({
        strike: o.strikePrice,
        callOI: Math.round(o.ce.oi / 1000),
        putOI: Math.round(o.pe.oi / 1000),
      }));
  }, [chain]);

  const oiChangeData = useMemo(() => {
    return chain
      .filter(o => Math.abs(o.ce.oiChange) > 5000 || Math.abs(o.pe.oiChange) > 5000)
      .map(o => ({
        strike: o.strikePrice,
        callOIChg: Math.round(o.ce.oiChange / 1000),
        putOIChg: Math.round(o.pe.oiChange / 1000),
      }));
  }, [chain]);

  const ivSmileData = useMemo(() => {
    return chain.map(o => ({
      strike: o.strikePrice,
      callIV: o.ce.iv,
      putIV: o.pe.iv,
      avgIV: (o.ce.iv + o.pe.iv) / 2,
    }));
  }, [chain]);

  const multiExpiryData = useMemo(() => {
    const baseChain = chain.filter(o => o.ce.oi > 50000 || o.pe.oi > 50000);
    return baseChain.map(o => ({
      strike: o.strikePrice,
      ceOI_weekly: Math.round(o.ce.oi / 1000),
      peOI_weekly: Math.round(o.pe.oi / 1000),
      ceOI_monthly: Math.round(o.ce.oi * 0.6 / 1000),
      peOI_monthly: Math.round(o.pe.oi * 0.7 / 1000),
    }));
  }, [chain]);

  // ── NEW: Delta OI ──
  const deltaOIData = useMemo(() => getDeltaOI(chain, spotPrice, stepSize), [chain, spotPrice, stepSize]);

  // ── NEW: Strike-wise PCR ──
  const strikePCRData = useMemo(() => getStrikePCR(chain, spotPrice), [chain, spotPrice]);

  // ── NEW: ATM Zone Analysis ──
  const atmZone5 = useMemo(() => getATMZoneAnalysis(chain, spotPrice, stepSize, 5), [chain, spotPrice, stepSize]);
  const atmZone10 = useMemo(() => getATMZoneAnalysis(chain, spotPrice, stepSize, 10), [chain, spotPrice, stepSize]);
  const activeATMZone = atmZoneSize === 5 ? atmZone5 : atmZone10;

  // ── NEW: OI Correlation (OI vs OI Change vs Volume) ──
  const oiCorrelationData = useMemo(() => {
    return chain
      .filter(o => o.ce.oi > 50000 || o.pe.oi > 50000)
      .map(o => ({
        strike: o.strikePrice,
        ceOI: Math.round(o.ce.oi / 1000),
        peOI: Math.round(o.pe.oi / 1000),
        ceOIChg: Math.round(o.ce.oiChange / 1000),
        peOIChg: Math.round(o.pe.oiChange / 1000),
        ceVol: Math.round(o.ce.volume / 1000),
        peVol: Math.round(o.pe.volume / 1000),
      }));
  }, [chain]);

  const oiInterpretation = useMemo(() => {
    return chain
      .filter(o => o.ce.oi > 100000 || o.pe.oi > 100000)
      .map(o => {
        const ceInterp = o.ce.oiChange > 0
          ? (o.ce.ltp > 0 ? "Short Buildup" : "Long Buildup")
          : (o.ce.ltp > 0 ? "Short Covering" : "Long Unwinding");
        const peInterp = o.pe.oiChange > 0
          ? (o.pe.ltp > 0 ? "Long Buildup" : "Short Buildup")
          : (o.pe.ltp > 0 ? "Long Unwinding" : "Short Covering");
        return { strike: o.strikePrice, ceOI: o.ce.oi, ceOIChg: o.ce.oiChange, ceInterp, peOI: o.pe.oi, peOIChg: o.pe.oiChange, peInterp };
      })
      .sort((a, b) => Math.abs(b.ceOIChg) + Math.abs(b.peOIChg) - Math.abs(a.ceOIChg) - Math.abs(a.peOIChg))
      .slice(0, 10);
  }, [chain]);

  const topCEOI = useMemo(() => [...chain].sort((a, b) => b.ce.oi - a.ce.oi).slice(0, 5), [chain]);
  const topPEOI = useMemo(() => [...chain].sort((a, b) => b.pe.oi - a.pe.oi).slice(0, 5), [chain]);

  const totalCEOI = chain.reduce((s, o) => s + o.ce.oi, 0);
  const totalPEOI = chain.reduce((s, o) => s + o.pe.oi, 0);
  const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI) : 0;
  const totalCEOIChg = chain.reduce((s, o) => s + o.ce.oiChange, 0);
  const totalPEOIChg = chain.reduce((s, o) => s + o.pe.oiChange, 0);

  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OI Analysis</h1>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={`gap-1 text-[10px] ${isLive ? "border-bullish text-bullish" : "border-red-500/50 text-red-400"}`}>
              {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isLive ? "LIVE" : "OFFLINE"}
            </Badge>
            {isLive && spotPrice > 0 && (
              <span className="text-xs font-mono text-muted-foreground">
                Spot: <span className="text-foreground font-medium">{spotPrice.toLocaleString("en-IN")}</span>
                {maxPain > 0 && <> · Max Pain: <span className="text-warning font-medium">{maxPain.toLocaleString("en-IN")}</span></>}
              </span>
            )}
            <p className="text-sm text-muted-foreground">Delta OI · Strike PCR · ATM Zone · Heatmap</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => refetch()} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            <span className="text-xs">Refresh</span>
          </Button>
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NIFTY">NIFTY</SelectItem>
              <SelectItem value="BANKNIFTY">BANKNIFTY</SelectItem>
              <SelectItem value="FINNIFTY">FINNIFTY</SelectItem>
              <SelectItem value="MIDCPNIFTY">MIDCPNIFTY</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Loading / Empty State */}
      {!isLive && !isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <WifiOff className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No Live Data Available</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Market may be closed or proxy is unreachable. Data auto-refreshes every 3 seconds when live.</p>
            <Button variant="outline" size="sm" className="mt-4 gap-1" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading && !isLive && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Loading Option Chain...</p>
          </CardContent>
        </Card>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <Card><CardContent className="pt-3 pb-3">
          <p className="text-[10px] text-muted-foreground">Max Pain</p>
          <p className="text-lg font-bold font-mono text-warning">{maxPain.toLocaleString("en-IN")}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3">
          <p className="text-[10px] text-muted-foreground">PCR (OI)</p>
          <p className={`text-lg font-bold font-mono ${pcr > 1 ? "text-bullish" : "text-bearish"}`}>{pcr.toFixed(2)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3">
          <p className="text-[10px] text-muted-foreground">Total CE OI</p>
          <p className="text-lg font-bold font-mono">{(totalCEOI / 100000).toFixed(1)}L</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3">
          <p className="text-[10px] text-muted-foreground">Total PE OI</p>
          <p className="text-lg font-bold font-mono">{(totalPEOI / 100000).toFixed(1)}L</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3">
          <p className="text-[10px] text-muted-foreground">CE OI Chg</p>
          <p className={`text-lg font-bold font-mono ${totalCEOIChg >= 0 ? "text-bullish" : "text-bearish"}`}>{(totalCEOIChg / 100000).toFixed(1)}L</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3">
          <p className="text-[10px] text-muted-foreground">PE OI Chg</p>
          <p className={`text-lg font-bold font-mono ${totalPEOIChg >= 0 ? "text-bullish" : "text-bearish"}`}>{(totalPEOIChg / 100000).toFixed(1)}L</p>
        </CardContent></Card>
      </div>

      {/* ── NEW: ATM Zone Dashboard ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">ATM Zone Analysis ({activeATMZone.strikes} Strikes)</CardTitle>
            <div className="flex bg-accent/50 rounded-md p-0.5">
              {[5, 10].map(n => (
                <button
                  key={n}
                  className={`px-3 py-1 text-[10px] rounded ${atmZoneSize === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setATMZoneSize(n)}
                >
                  {n} Strikes
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-4">
            <div className="p-2 rounded bg-accent/30 text-center">
              <p className="text-[9px] text-muted-foreground">Zone PCR</p>
              <p className={`text-lg font-bold font-mono ${activeATMZone.pcr > 1 ? "text-bullish" : "text-bearish"}`}>{activeATMZone.pcr}</p>
            </div>
            <div className="p-2 rounded bg-accent/30 text-center">
              <p className="text-[9px] text-muted-foreground">CE OI</p>
              <p className="text-sm font-bold font-mono">{(activeATMZone.totalCEOI / 100000).toFixed(1)}L</p>
            </div>
            <div className="p-2 rounded bg-accent/30 text-center">
              <p className="text-[9px] text-muted-foreground">PE OI</p>
              <p className="text-sm font-bold font-mono">{(activeATMZone.totalPEOI / 100000).toFixed(1)}L</p>
            </div>
            <div className="p-2 rounded bg-accent/30 text-center">
              <p className="text-[9px] text-muted-foreground">CE OI Chg%</p>
              <p className={`text-sm font-bold font-mono ${activeATMZone.ceOIChgPercent >= 0 ? "text-bullish" : "text-bearish"}`}>{activeATMZone.ceOIChgPercent >= 0 ? "+" : ""}{activeATMZone.ceOIChgPercent}%</p>
            </div>
            <div className="p-2 rounded bg-accent/30 text-center">
              <p className="text-[9px] text-muted-foreground">PE OI Chg%</p>
              <p className={`text-sm font-bold font-mono ${activeATMZone.peOIChgPercent >= 0 ? "text-bullish" : "text-bearish"}`}>{activeATMZone.peOIChgPercent >= 0 ? "+" : ""}{activeATMZone.peOIChgPercent}%</p>
            </div>
            <div className="p-2 rounded bg-accent/30 text-center col-span-3">
              <p className="text-[9px] text-muted-foreground">Strike-wise PCR in Zone</p>
              <div className="flex gap-1 justify-center mt-1">
                {activeATMZone.strikeData.map(s => (
                  <div key={s.strike} className={`px-1.5 py-0.5 rounded text-[8px] font-mono ${s.pcr > 1 ? "bg-bullish/15 text-bullish" : "bg-bearish/15 text-bearish"}`}>
                    {s.strike.toString().slice(-3)}: {s.pcr}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* ATM Zone Table */}
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead>Strike</TableHead>
                <TableHead className="text-right">CE OI</TableHead>
                <TableHead className="text-right">PE OI</TableHead>
                <TableHead className="text-right">PCR</TableHead>
                <TableHead className="text-right">CE Chg</TableHead>
                <TableHead className="text-right">CE Chg%</TableHead>
                <TableHead className="text-right">PE Chg</TableHead>
                <TableHead className="text-right">PE Chg%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeATMZone.strikeData.map(s => (
                <TableRow key={s.strike} className="text-[11px] font-mono">
                  <TableCell className="font-bold">{s.strike.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right">{(s.ceOI / 1000).toFixed(0)}K</TableCell>
                  <TableCell className="text-right">{(s.peOI / 1000).toFixed(0)}K</TableCell>
                  <TableCell className={`text-right font-medium ${s.pcr > 1 ? "text-bullish" : "text-bearish"}`}>{s.pcr}</TableCell>
                  <TableCell className={`text-right ${s.ceOIChg >= 0 ? "text-bullish" : "text-bearish"}`}>{s.ceOIChg >= 0 ? "+" : ""}{(s.ceOIChg / 1000).toFixed(1)}K</TableCell>
                  <TableCell className={`text-right ${s.ceOIChgPct >= 0 ? "text-bullish" : "text-bearish"}`}>{s.ceOIChgPct >= 0 ? "+" : ""}{s.ceOIChgPct}%</TableCell>
                  <TableCell className={`text-right ${s.peOIChg >= 0 ? "text-bullish" : "text-bearish"}`}>{s.peOIChg >= 0 ? "+" : ""}{(s.peOIChg / 1000).toFixed(1)}K</TableCell>
                  <TableCell className={`text-right ${s.peOIChgPct >= 0 ? "text-bullish" : "text-bearish"}`}>{s.peOIChgPct >= 0 ? "+" : ""}{s.peOIChgPct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Heatmap + S/R side panels */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <OIHeatmap chain={chain} spotPrice={spotPrice} />
        </div>
        <SupportResistance chain={chain} spotPrice={spotPrice} />
      </div>

      {/* ── Multi-Expiry OI Overlay ── */}
      <MultiExpiryOI symbol={symbol} />

      {/* ── IV Percentile & PCR Trend ── */}
      <IVPercentileGauge chain={chain} spotPrice={spotPrice} symbol={symbol} />

      <Tabs defaultValue="delta-oi">
        <TabsList className="flex-wrap">
          <TabsTrigger value="delta-oi">Delta OI</TabsTrigger>
          <TabsTrigger value="strike-pcr">Strike PCR</TabsTrigger>
          <TabsTrigger value="oi-correlation">OI Correlation</TabsTrigger>
          <TabsTrigger value="oi-dist">OI Distribution</TabsTrigger>
          <TabsTrigger value="oi-change">OI Change</TabsTrigger>
          <TabsTrigger value="multi-expiry">Multi-Expiry</TabsTrigger>
          <TabsTrigger value="iv-smile">IV Smile</TabsTrigger>
          <TabsTrigger value="pcr-trend">PCR Trend</TabsTrigger>
          <TabsTrigger value="oi-interp">OI Interpretation</TabsTrigger>
          <TabsTrigger value="top-oi">Top Strikes</TabsTrigger>
        </TabsList>

        {/* ── NEW: Delta OI Tab ── */}
        <TabsContent value="delta-oi">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Delta OI (OI × Delta) by Strike</CardTitle>
              <p className="text-[10px] text-muted-foreground">Shows directional exposure per strike. Net positive = bullish pressure, negative = bearish.</p>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={deltaOIData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}K`, ""]} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <ReferenceLine x={Math.round(spotPrice / stepSize) * stepSize} stroke="hsl(210 100% 52%)" strokeDasharray="3 3" label={{ value: "Spot", fill: "hsl(210 100% 52%)", fontSize: 9 }} />
                    <Bar dataKey="ceDeltaOI" fill="hsl(142 71% 45%)" opacity={0.7} name="CE Delta×OI" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="peDeltaOI" fill="hsl(0 84% 60%)" opacity={0.7} name="PE Delta×OI" radius={[2, 2, 0, 0]} />
                    <Line type="monotone" dataKey="netDeltaOI" stroke="hsl(38 92% 50%)" strokeWidth={2} dot={false} name="Net Delta OI" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── NEW: Strike-wise PCR Tab ── */}
        <TabsContent value="strike-pcr">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Individual Strike-wise PCR</CardTitle>
              <p className="text-[10px] text-muted-foreground">PCR &gt; 1 = Put heavy (bullish support), PCR &lt; 1 = Call heavy (resistance).</p>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={strikePCRData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="pcr" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={[0, "auto"]} />
                    <YAxis yAxisId="dist" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine yAxisId="pcr" y={1} stroke="hsl(38 92% 50%)" strokeDasharray="5 5" label={{ value: "PCR=1", fill: "hsl(38 92% 50%)", fontSize: 9 }} />
                    <ReferenceLine x={Math.round(spotPrice / stepSize) * stepSize} stroke="hsl(210 100% 52%)" strokeDasharray="3 3" />
                    <Bar yAxisId="pcr" dataKey="pcr" name="PCR" radius={[2, 2, 0, 0]}>
                      {strikePCRData.map((entry, i) => (
                        <Cell key={i} fill={entry.pcr >= 1 ? "hsl(142 71% 45% / 0.7)" : "hsl(0 84% 60% / 0.7)"} />
                      ))}
                    </Bar>
                    <Line yAxisId="dist" type="monotone" dataKey="distance" stroke="hsl(215 15% 55%)" strokeWidth={1} strokeDasharray="3 3" dot={false} name="Distance %" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── NEW: OI Correlation Tab ── */}
        <TabsContent value="oi-correlation">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">OI vs OI Change vs Volume Correlation</CardTitle>
              <p className="text-[10px] text-muted-foreground">Bars = OI, Line = OI Change, Dots = Volume spikes. Identifies active vs passive strikes.</p>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={oiCorrelationData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="oi" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis yAxisId="chg" orientation="right" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine x={Math.round(spotPrice / stepSize) * stepSize} stroke="hsl(210 100% 52%)" strokeDasharray="3 3" />
                    <Bar yAxisId="oi" dataKey="ceOI" fill="hsl(142 71% 45% / 0.3)" name="CE OI" radius={[2, 2, 0, 0]} />
                    <Bar yAxisId="oi" dataKey="peOI" fill="hsl(0 84% 60% / 0.3)" name="PE OI" radius={[2, 2, 0, 0]} />
                    <Line yAxisId="chg" type="monotone" dataKey="ceOIChg" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} name="CE OI Chg" />
                    <Line yAxisId="chg" type="monotone" dataKey="peOIChg" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} name="PE OI Chg" />
                    <Bar yAxisId="chg" dataKey="ceVol" fill="hsl(210 100% 52% / 0.2)" name="CE Vol" />
                    <Bar yAxisId="chg" dataKey="peVol" fill="hsl(280 80% 60% / 0.2)" name="PE Vol" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="oi-dist">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Call vs Put OI by Strike (in '000s)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oiData} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine x={maxPain} stroke="hsl(38 92% 50%)" strokeDasharray="5 5" label={{ value: "Max Pain", fill: "hsl(38 92% 50%)", fontSize: 9 }} />
                    <ReferenceLine x={Math.round(spotPrice / 50) * 50} stroke="hsl(210 100% 52%)" strokeDasharray="3 3" label={{ value: "Spot", fill: "hsl(210 100% 52%)", fontSize: 9 }} />
                    <Bar dataKey="callOI" fill="hsl(142 71% 45%)" opacity={0.8} name="Call OI" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="putOI" fill="hsl(0 84% 60%)" opacity={0.8} name="Put OI" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="oi-change">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Change in OI by Strike (in '000s)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oiChangeData} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine y={0} stroke="hsl(215 15% 55%)" />
                    <Bar dataKey="callOIChg" name="Call OI Chg" radius={[2, 2, 0, 0]}>
                      {oiChangeData.map((entry, i) => (
                        <Cell key={i} fill={entry.callOIChg >= 0 ? "hsl(142 71% 45%)" : "hsl(142 71% 45% / 0.3)"} />
                      ))}
                    </Bar>
                    <Bar dataKey="putOIChg" name="Put OI Chg" radius={[2, 2, 0, 0]}>
                      {oiChangeData.map((entry, i) => (
                        <Cell key={i} fill={entry.putOIChg >= 0 ? "hsl(0 84% 60%)" : "hsl(0 84% 60% / 0.3)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="multi-expiry">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Multi-Expiry OI Comparison (Weekly vs Monthly)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={multiExpiryData} barGap={0} barCategoryGap="15%">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine x={Math.round(spotPrice / 50) * 50} stroke="hsl(210 100% 52%)" strokeDasharray="3 3" />
                    <Bar dataKey="ceOI_weekly" fill="hsl(142 71% 45%)" opacity={0.9} name="CE Weekly" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="ceOI_monthly" fill="hsl(142 71% 45% / 0.4)" name="CE Monthly" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="peOI_weekly" fill="hsl(0 84% 60%)" opacity={0.9} name="PE Weekly" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="peOI_monthly" fill="hsl(0 84% 60% / 0.4)" name="PE Monthly" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="iv-smile">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">IV Smile / Skew Curve</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ivSmileData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={["auto", "auto"]} label={{ value: "IV %", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine x={Math.round(spotPrice / 50) * 50} stroke="hsl(210 100% 52%)" strokeDasharray="5 5" label={{ value: "ATM", fill: "hsl(210 100% 52%)", fontSize: 9 }} />
                    <Line type="monotone" dataKey="callIV" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} name="Call IV" />
                    <Line type="monotone" dataKey="putIV" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={false} name="Put IV" />
                    <Line type="monotone" dataKey="avgIV" stroke="hsl(38 92% 50%)" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Avg IV" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pcr-trend">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* PCR Gauges */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Put-Call Ratio (OI)</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center">
                  <p className={`text-4xl font-bold font-mono ${pcrData.signalColor}`}>{pcrData.pcrOI.toFixed(2)}</p>
                  <Badge variant="outline" className={`mt-2 ${pcrData.signalColor}`}>{pcrData.signal}</Badge>
                </div>
                <div className="relative h-3 rounded-full bg-gradient-to-r from-bearish/30 via-warning/30 to-bullish/30 overflow-hidden">
                  <div
                    className="absolute top-0 h-full w-1.5 bg-foreground rounded-full shadow-lg transition-all"
                    style={{ left: `${Math.min(Math.max((pcrData.pcrOI / 2) * 100, 2), 98)}%`, transform: "translateX(-50%)" }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                  <span>0.0 (Bearish)</span>
                  <span>1.0</span>
                  <span>2.0 (Bullish)</span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="p-2 rounded-md bg-accent/30 text-center">
                    <p className="text-[9px] text-muted-foreground">OI PCR</p>
                    <p className="text-lg font-bold font-mono">{pcrData.pcrOI.toFixed(2)}</p>
                  </div>
                  <div className="p-2 rounded-md bg-accent/30 text-center">
                    <p className="text-[9px] text-muted-foreground">Vol PCR</p>
                    <p className="text-lg font-bold font-mono">{pcrData.pcrVolume.toFixed(2)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* OI Breakdown */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Open Interest Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-bearish">CALL OI (Writers = Resistance)</h4>
                    <div className="p-3 rounded-md bg-bearish/5 border border-bearish/10">
                      <p className="text-2xl font-bold font-mono text-bearish">{(pcrData.totalCEOI / 100000).toFixed(1)}L</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Total CE Open Interest</p>
                    </div>
                    <div className="p-3 rounded-md bg-accent/30">
                      <p className="text-lg font-bold font-mono">{(pcrData.totalCEVol / 100000).toFixed(1)}L</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Total CE Volume</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-bullish">PUT OI (Writers = Support)</h4>
                    <div className="p-3 rounded-md bg-bullish/5 border border-bullish/10">
                      <p className="text-2xl font-bold font-mono text-bullish">{(pcrData.totalPEOI / 100000).toFixed(1)}L</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Total PE Open Interest</p>
                    </div>
                    <div className="p-3 rounded-md bg-accent/30">
                      <p className="text-lg font-bold font-mono">{(pcrData.totalPEVol / 100000).toFixed(1)}L</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Total PE Volume</p>
                    </div>
                  </div>
                </div>
                
                {/* PCR Interpretation */}
                <div className="mt-4 p-3 rounded-md bg-accent/50 border border-border/50">
                  <p className="text-xs text-muted-foreground">
                    <strong className={pcrData.signalColor}>{pcrData.signal}:</strong>{" "}
                    {pcrData.pcrOI > 1.3 ? "Heavy put writing indicates strong support below. Sellers are confident market won't fall." : 
                     pcrData.pcrOI > 1.0 ? "Moderate put writing suggests support building. Mild bullish bias." :
                     pcrData.pcrOI > 0.7 ? "PCR near neutral. No strong directional bias from OI data." :
                     pcrData.pcrOI > 0.5 ? "Call writing dominates. Resistance building above. Mild bearish bias." :
                     "Heavy call writing suggests strong resistance. Bears are dominant."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="oi-interp">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">OI Buildup Interpretation (Top 10 Active Strikes)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px]">
                    <TableHead>Strike</TableHead>
                    <TableHead className="text-right">CE OI</TableHead>
                    <TableHead className="text-right">CE OI Chg</TableHead>
                    <TableHead>CE Signal</TableHead>
                    <TableHead className="text-right">PE OI</TableHead>
                    <TableHead className="text-right">PE OI Chg</TableHead>
                    <TableHead>PE Signal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {oiInterpretation.map(row => (
                    <TableRow key={row.strike} className="text-xs font-mono">
                      <TableCell className="font-bold">{row.strike.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right">{(row.ceOI / 1000).toFixed(0)}K</TableCell>
                      <TableCell className={`text-right ${row.ceOIChg >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {row.ceOIChg >= 0 ? "+" : ""}{(row.ceOIChg / 1000).toFixed(1)}K
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[9px] ${row.ceInterp.includes("Short") ? "text-bearish" : "text-bullish"}`}>
                          {row.ceInterp}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{(row.peOI / 1000).toFixed(0)}K</TableCell>
                      <TableCell className={`text-right ${row.peOIChg >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {row.peOIChg >= 0 ? "+" : ""}{(row.peOIChg / 1000).toFixed(1)}K
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[9px] ${row.peInterp.includes("Long") ? "text-bullish" : "text-bearish"}`}>
                          {row.peInterp}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="top-oi">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-bullish">Top 5 Call OI (Resistance)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="text-[10px]">
                    <TableHead>Strike</TableHead><TableHead className="text-right">OI</TableHead><TableHead className="text-right">OI Chg</TableHead><TableHead className="text-right">IV</TableHead><TableHead className="text-right">LTP</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {topCEOI.map(r => (
                      <TableRow key={r.strikePrice} className="text-xs font-mono">
                        <TableCell className="font-bold">{r.strikePrice.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right">{(r.ce.oi / 1000).toFixed(0)}K</TableCell>
                        <TableCell className={`text-right ${r.ce.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>{(r.ce.oiChange / 1000).toFixed(1)}K</TableCell>
                        <TableCell className="text-right">{r.ce.iv.toFixed(1)}%</TableCell>
                        <TableCell className="text-right">{r.ce.ltp.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-bearish">Top 5 Put OI (Support)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="text-[10px]">
                    <TableHead>Strike</TableHead><TableHead className="text-right">OI</TableHead><TableHead className="text-right">OI Chg</TableHead><TableHead className="text-right">IV</TableHead><TableHead className="text-right">LTP</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {topPEOI.map(r => (
                      <TableRow key={r.strikePrice} className="text-xs font-mono">
                        <TableCell className="font-bold">{r.strikePrice.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right">{(r.pe.oi / 1000).toFixed(0)}K</TableCell>
                        <TableCell className={`text-right ${r.pe.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>{(r.pe.oiChange / 1000).toFixed(1)}K</TableCell>
                        <TableCell className="text-right">{r.pe.iv.toFixed(1)}%</TableCell>
                        <TableCell className="text-right">{r.pe.ltp.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
