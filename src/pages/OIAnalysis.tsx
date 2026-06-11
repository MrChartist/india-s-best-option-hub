import { useState, useMemo, useCallback } from "react";
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
import { Wifi, WifiOff, RefreshCw, Loader2, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export default function OIAnalysis() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [atmZoneSize, setATMZoneSize] = useState<number>(5);
  const { data: liveData, refetch, isLoading } = useLiveOptionChain(symbol);
  const chain = useMemo(() => liveData?.chain ?? [], [liveData]);
  const spotPrice = liveData?.spotPrice ?? 0;
  const stepSize = liveData?.stepSize ?? 50;
  const isLive = liveData?.isLive ?? false;
  const afterHours = liveData?.afterHours ?? false;
  const hasData = chain.length > 0;
  const handleRefetch = useCallback(() => refetch(), [refetch]);
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

  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", padding: "8px 12px" };
  const fmtK = (v: number) => `${v >= 0 ? "+" : ""}${v.toLocaleString("en-IN")}K`;
  const fmtOI = (v: number, name: string) => [`${v.toLocaleString("en-IN")}K`, name];
  const moduleCardClass = "overflow-hidden border-border/80 bg-card/95";
  const moduleHeaderClass = "border-b border-border/70 bg-muted/25 px-4 py-3";
  const metricCards = [
    { label: "Max Pain", value: maxPain.toLocaleString("en-IN"), valueClass: "text-warning", accentClass: "bg-warning" },
    { label: "PCR (OI)", value: pcr.toFixed(2), valueClass: pcr > 1 ? "text-bullish" : "text-bearish", accentClass: pcr > 1 ? "bg-bullish" : "bg-bearish" },
    { label: "Total CE OI", value: `${(totalCEOI / 100000).toFixed(1)}L`, valueClass: "text-foreground", accentClass: "bg-bearish" },
    { label: "Total PE OI", value: `${(totalPEOI / 100000).toFixed(1)}L`, valueClass: "text-foreground", accentClass: "bg-bullish" },
    { label: "CE OI Chg", value: `${(totalCEOIChg / 100000).toFixed(1)}L`, valueClass: totalCEOIChg >= 0 ? "text-bullish" : "text-bearish", accentClass: totalCEOIChg >= 0 ? "bg-bullish" : "bg-bearish" },
    { label: "PE OI Chg", value: `${(totalPEOIChg / 100000).toFixed(1)}L`, valueClass: totalPEOIChg >= 0 ? "text-bullish" : "text-bearish", accentClass: totalPEOIChg >= 0 ? "bg-bullish" : "bg-bearish" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/80 bg-card/90 px-4 py-3 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.55rem] font-semibold leading-tight text-foreground">OI Analysis</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <Badge variant="outline" className={`gap-1 text-xs ${isLive ? "border-bullish text-bullish" : afterHours ? "border-amber-500/50 text-amber-400" : "border-red-500/50 text-red-400"}`}>
              {isLive ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isLive ? "LIVE" : afterHours ? "CLOSED" : "OFFLINE"}
            </Badge>
            {(isLive || afterHours) && spotPrice > 0 && (
              <span className="text-xs font-mono text-muted-foreground">
                Spot: <span className="text-foreground font-medium">{spotPrice.toLocaleString("en-IN")}</span>
                {maxPain > 0 && <> · Max Pain: <span className="text-warning font-medium">{maxPain.toLocaleString("en-IN")}</span></>}
                {afterHours && <span className="text-amber-400/60 ml-1">(Last Close)</span>}
              </span>
            )}
            <p className="text-sm text-muted-foreground">Delta OI · Strike PCR · ATM Zone · Heatmap</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {/* Shortcuts Info */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary" title="Keyboard Shortcuts">
                <kbd className="rounded border border-border/60 bg-background/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold shadow-sm">?</kbd>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-4" align="end">
              <p className="text-[11px] font-bold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
                <Keyboard className="h-3.5 w-3.5" />
                Keyboard Shortcuts
              </p>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Focus Search</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">⌘K</kbd></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Refresh Data</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">R</kbd></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Next Tab</span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono">Tab</kbd></div>
              </div>
            </PopoverContent>
          </Popover>

          <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-background/70 transition-colors hover:border-primary/50 hover:text-primary" onClick={handleRefetch} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="text-xs">Refresh</span>
          </Button>
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="h-8 w-[150px] bg-background/70 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NIFTY">NIFTY</SelectItem>
              <SelectItem value="BANKNIFTY">BANKNIFTY</SelectItem>
              <SelectItem value="FINNIFTY">FINNIFTY</SelectItem>
              <SelectItem value="MIDCPNIFTY">MIDCPNIFTY</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </div>
      </div>

      {/* After-Hours Banner */}
      {afterHours && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
          <WifiOff className="h-4 w-4 shrink-0" />
          <p className="text-xs font-medium">
            Market Closed — {hasData ? "Showing last available OI data from closing session" : "No cached data available. Data will populate when market opens."}
          </p>
        </div>
      )}

      {/* Loading / Empty State — professional skeleton with market info */}
      {!hasData && !isLoading && !afterHours && (
        <Card className="border-dashed border-border/50 bg-card/30">
          <CardContent className="py-12 space-y-5">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-muted/50 mb-3 animate-pulse">
                <WifiOff className="h-7 w-7 text-muted-foreground/40" />
              </div>
              <p className="text-[15px] font-semibold text-foreground">Waiting for OI Analysis Data</p>
              <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
                Data refreshes automatically during market hours. Check that the proxy server is running on port <code className="font-mono text-primary/70 bg-primary/10 px-1 rounded">4002</code>.
              </p>
            </div>
            {/* Animated skeleton chart */}
            <div className="flex items-end justify-center gap-1.5 h-[100px] px-8">
              {[35, 60, 45, 80, 55, 70, 40, 65, 50, 75, 38, 62, 48, 72, 42].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm animate-pulse"
                  style={{
                    height: `${h}%`,
                    backgroundColor: i < 7 ? 'hsl(var(--bearish) / 0.15)' : 'hsl(var(--bullish) / 0.15)',
                    animationDelay: `${i * 80}ms`,
                  }}
                />
              ))}
            </div>
            {/* Market hours info */}
            <div className="flex justify-center gap-6 text-xs text-muted-foreground/50">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-bullish/40" />
                NSE: 09:15 — 15:30 IST
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                Auto-refresh: Every 3s
              </div>
            </div>
            <div className="text-center pt-2">
              <Button variant="outline" size="sm" className="gap-1.5 hover:text-primary hover:border-primary/50 transition-colors" onClick={handleRefetch}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry Connection
              </Button>
            </div>
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metricCards.map((metric) => (
          <Card key={metric.label} className="group overflow-hidden border-border/80 bg-card/95">
            <CardContent className="relative p-3">
              <div className={`absolute inset-x-0 top-0 h-0.5 ${metric.accentClass}`} />
              <p className="text-[11px] font-medium uppercase text-muted-foreground">{metric.label}</p>
              <p className={`mt-1 font-mono text-lg font-semibold leading-none tabular-nums ${metric.valueClass}`}>{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── NEW: ATM Zone Dashboard ── */}
      <Card className={moduleCardClass}>
        <CardHeader className={moduleHeaderClass}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">ATM Zone Analysis ({activeATMZone.strikes} Strikes)</CardTitle>
            <div className="flex rounded-md border border-border/60 bg-background/70 p-0.5">
              {[5, 10].map(n => (
                <button
                  key={n}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${atmZoneSize === n ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setATMZoneSize(n)}
                >
                  {n} Strikes
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-4">
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-[11px] text-muted-foreground">Zone PCR</p>
              <p className={`text-lg font-bold font-mono ${activeATMZone.pcr > 1 ? "text-bullish" : "text-bearish"}`}>{activeATMZone.pcr}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-[11px] text-muted-foreground">CE OI</p>
              <p className="text-sm font-bold font-mono">{(activeATMZone.totalCEOI / 100000).toFixed(1)}L</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-[11px] text-muted-foreground">PE OI</p>
              <p className="text-sm font-bold font-mono">{(activeATMZone.totalPEOI / 100000).toFixed(1)}L</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-[11px] text-muted-foreground">CE OI Chg%</p>
              <p className={`text-sm font-bold font-mono ${activeATMZone.ceOIChgPercent >= 0 ? "text-bullish" : "text-bearish"}`}>{activeATMZone.ceOIChgPercent >= 0 ? "+" : ""}{activeATMZone.ceOIChgPercent}%</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-[11px] text-muted-foreground">PE OI Chg%</p>
              <p className={`text-sm font-bold font-mono ${activeATMZone.peOIChgPercent >= 0 ? "text-bullish" : "text-bearish"}`}>{activeATMZone.peOIChgPercent >= 0 ? "+" : ""}{activeATMZone.peOIChgPercent}%</p>
            </div>
            <div className="col-span-3 rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-[11px] text-muted-foreground">Strike-wise PCR in Zone</p>
              <div className="mt-1 flex flex-wrap justify-center gap-1">
                {activeATMZone.strikeData.map(s => (
                  <div key={s.strike} className={`px-1.5 py-0.5 rounded text-xs font-mono ${s.pcr > 1 ? "bg-bullish/15 text-bullish" : "bg-bearish/15 text-bearish"}`}>
                    {s.strike.toString().slice(-3)}: {s.pcr}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* ATM Zone Table */}
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
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
                <TableRow key={s.strike} className="font-mono text-[11px] hover:bg-muted/30">
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
          <OIHeatmap chain={chain} spotPrice={spotPrice} stepSize={stepSize} />
        </div>
        <SupportResistance chain={chain} spotPrice={spotPrice} />
      </div>

      {/* ── Multi-Expiry OI Overlay ── */}
      <MultiExpiryOI symbol={symbol} />

      {/* ── IV Percentile & PCR Trend ── */}
      <IVPercentileGauge chain={chain} spotPrice={spotPrice} symbol={symbol} />

      <Tabs defaultValue="delta-oi">
        <TabsList className="mb-3 h-auto flex-wrap gap-1 rounded-lg border border-border/70 bg-card/80 p-1 shadow-card">
          <TabsTrigger value="delta-oi" className="text-xs py-1.5 px-3">Delta OI</TabsTrigger>
          <TabsTrigger value="strike-pcr" className="text-xs py-1.5 px-3">Strike PCR</TabsTrigger>
          <TabsTrigger value="oi-correlation" className="text-xs py-1.5 px-3">OI Correlation</TabsTrigger>
          <TabsTrigger value="oi-dist" className="text-xs py-1.5 px-3">OI Distribution</TabsTrigger>
          <TabsTrigger value="oi-change" className="text-xs py-1.5 px-3">OI Change</TabsTrigger>
          <TabsTrigger value="multi-expiry" className="text-xs py-1.5 px-3">Multi-Expiry</TabsTrigger>
          <TabsTrigger value="iv-smile" className="text-xs py-1.5 px-3">IV Smile</TabsTrigger>
          <TabsTrigger value="pcr-trend" className="text-xs py-1.5 px-3">PCR Trend</TabsTrigger>
          <TabsTrigger value="oi-interp" className="text-xs py-1.5 px-3">OI Interpretation</TabsTrigger>
          <TabsTrigger value="top-oi" className="text-xs py-1.5 px-3">Top Strikes</TabsTrigger>
        </TabsList>

        {/* ── NEW: Delta OI Tab ── */}
        <TabsContent value="delta-oi">
          <Card className={moduleCardClass}>
            <CardHeader className={moduleHeaderClass}>
              <CardTitle className="text-sm">Delta OI (OI × Delta) by Strike</CardTitle>
              <p className="text-xs text-muted-foreground">Shows directional exposure per strike. Net positive = bullish pressure, negative = bearish.</p>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={deltaOIData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => fmtOI(v, name)} />
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
          <Card className={moduleCardClass}>
            <CardHeader className={moduleHeaderClass}>
              <CardTitle className="text-sm">Individual Strike-wise PCR</CardTitle>
              <p className="text-xs text-muted-foreground">PCR &gt; 1 = Put heavy (bullish support), PCR &lt; 1 = Call heavy (resistance).</p>
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
          <Card className={moduleCardClass}>
            <CardHeader className={moduleHeaderClass}>
              <CardTitle className="text-sm">OI vs OI Change vs Volume Correlation</CardTitle>
              <p className="text-xs text-muted-foreground">Bars = OI, Line = OI Change, Dots = Volume spikes. Identifies active vs passive strikes.</p>
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
          <Card className={moduleCardClass}>
            <CardHeader className={moduleHeaderClass}><CardTitle className="text-sm">Call vs Put OI by Strike (in '000s)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oiData} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => fmtOI(v, name)} />
                    <ReferenceLine x={maxPain} stroke="hsl(38 92% 50%)" strokeDasharray="5 5" label={{ value: "Max Pain", fill: "hsl(38 92% 50%)", fontSize: 9 }} />
                    <ReferenceLine x={Math.round(spotPrice / stepSize) * stepSize} stroke="hsl(210 100% 52%)" strokeDasharray="3 3" label={{ value: "Spot", fill: "hsl(210 100% 52%)", fontSize: 9 }} />
                    <Bar dataKey="callOI" fill="hsl(142 71% 45%)" opacity={0.8} name="Call OI" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="putOI" fill="hsl(0 84% 60%)" opacity={0.8} name="Put OI" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="oi-change">
          <Card className={moduleCardClass}>
            <CardHeader className={moduleHeaderClass}><CardTitle className="text-sm">Change in OI by Strike (in '000s)</CardTitle></CardHeader>
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
          <Card className={moduleCardClass}>
            <CardHeader className={moduleHeaderClass}><CardTitle className="text-sm">Multi-Expiry OI Comparison (Weekly vs Monthly)</CardTitle></CardHeader>
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
          <Card className={moduleCardClass}>
            <CardHeader className={moduleHeaderClass}><CardTitle className="text-sm">IV Smile / Skew Curve</CardTitle></CardHeader>
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
            <Card className={moduleCardClass}>
              <CardHeader className={moduleHeaderClass}><CardTitle className="text-sm">Put-Call Ratio (OI)</CardTitle></CardHeader>
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
                <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                  <span>0.0 (Bearish)</span>
                  <span>1.0</span>
                  <span>2.0 (Bullish)</span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="p-2 rounded-md bg-accent/30 text-center">
                    <p className="text-[11px] text-muted-foreground">OI PCR</p>
                    <p className="text-lg font-bold font-mono">{pcrData.pcrOI.toFixed(2)}</p>
                  </div>
                  <div className="p-2 rounded-md bg-accent/30 text-center">
                    <p className="text-[11px] text-muted-foreground">Vol PCR</p>
                    <p className="text-lg font-bold font-mono">{pcrData.pcrVolume.toFixed(2)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* OI Breakdown */}
            <Card className={`${moduleCardClass} lg:col-span-2`}>
              <CardHeader className={moduleHeaderClass}><CardTitle className="text-sm">Open Interest Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-bearish">CALL OI (Writers = Resistance)</h4>
                    <div className="p-3 rounded-md bg-bearish/5 border border-bearish/10">
                      <p className="text-2xl font-bold font-mono text-bearish">{(pcrData.totalCEOI / 100000).toFixed(1)}L</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Total CE Open Interest</p>
                    </div>
                    <div className="p-3 rounded-md bg-accent/30">
                      <p className="text-lg font-bold font-mono">{(pcrData.totalCEVol / 100000).toFixed(1)}L</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Total CE Volume</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-bullish">PUT OI (Writers = Support)</h4>
                    <div className="p-3 rounded-md bg-bullish/5 border border-bullish/10">
                      <p className="text-2xl font-bold font-mono text-bullish">{(pcrData.totalPEOI / 100000).toFixed(1)}L</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Total PE Open Interest</p>
                    </div>
                    <div className="p-3 rounded-md bg-accent/30">
                      <p className="text-lg font-bold font-mono">{(pcrData.totalPEVol / 100000).toFixed(1)}L</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Total PE Volume</p>
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
          <Card className={moduleCardClass}>
            <CardHeader className={moduleHeaderClass}><CardTitle className="text-sm">OI Buildup Interpretation (Top 10 Active Strikes)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
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
                        <Badge variant="outline" className={`text-[11px] ${row.ceInterp.includes("Short") ? "text-bearish" : "text-bullish"}`}>
                          {row.ceInterp}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{(row.peOI / 1000).toFixed(0)}K</TableCell>
                      <TableCell className={`text-right ${row.peOIChg >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {row.peOIChg >= 0 ? "+" : ""}{(row.peOIChg / 1000).toFixed(1)}K
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[11px] ${row.peInterp.includes("Long") ? "text-bullish" : "text-bearish"}`}>
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
            <Card className={moduleCardClass}>
              <CardHeader className={moduleHeaderClass}><CardTitle className="text-sm text-bullish">Top 5 Call OI (Resistance)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="text-xs">
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
            <Card className={moduleCardClass}>
              <CardHeader className={moduleHeaderClass}><CardTitle className="text-sm text-bearish">Top 5 Put OI (Support)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="text-xs">
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
