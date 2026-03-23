import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LineChart, Line, ComposedChart, Area } from "recharts";
import { getMaxPain, generatePCRHistory } from "@/lib/mockData";
import { OIHeatmap } from "@/components/OIHeatmap";
import { SupportResistance } from "@/components/SupportResistance";
import { useLiveOptionChain } from "@/hooks/useNSEData";
import { Wifi, WifiOff } from "lucide-react";

export default function OIAnalysis() {
  const [symbol, setSymbol] = useState("NIFTY");
  const { data: liveData } = useLiveOptionChain(symbol);
  const chain = liveData?.chain || [];
  const spotPrice = liveData?.spotPrice || 0;
  const isLive = liveData?.isLive || false;
  const maxPain = useMemo(() => getMaxPain(chain), [chain]);
  const pcrHistory = useMemo(() => generatePCRHistory(), []);

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

  // Multi-expiry OI comparison
  const multiExpiryData = useMemo(() => {
    // Simulate different expiry OI distributions
    const baseChain = chain.filter(o => o.ce.oi > 50000 || o.pe.oi > 50000);
    return baseChain.map(o => ({
      strike: o.strikePrice,
      ceOI_weekly: Math.round(o.ce.oi / 1000),
      peOI_weekly: Math.round(o.pe.oi / 1000),
      ceOI_monthly: Math.round(o.ce.oi * 0.6 / 1000),
      peOI_monthly: Math.round(o.pe.oi * 0.7 / 1000),
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

  const tooltipStyle = { backgroundColor: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)", borderRadius: "8px", fontSize: "11px" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OI Analysis</h1>
          <p className="text-sm text-muted-foreground">Open Interest · Heatmap · S/R Levels · Multi-Expiry · IV Smile</p>
        </div>
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

      {/* Heatmap + S/R side panels */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <OIHeatmap chain={chain} spotPrice={spotPrice} />
        </div>
        <SupportResistance chain={chain} spotPrice={spotPrice} />
      </div>

      <Tabs defaultValue="oi-dist">
        <TabsList className="flex-wrap">
          <TabsTrigger value="oi-dist">OI Distribution</TabsTrigger>
          <TabsTrigger value="oi-change">OI Change</TabsTrigger>
          <TabsTrigger value="multi-expiry">Multi-Expiry</TabsTrigger>
          <TabsTrigger value="iv-smile">IV Smile</TabsTrigger>
          <TabsTrigger value="pcr-trend">PCR Trend</TabsTrigger>
          <TabsTrigger value="oi-interp">OI Interpretation</TabsTrigger>
          <TabsTrigger value="top-oi">Top Strikes</TabsTrigger>
        </TabsList>

        <TabsContent value="oi-dist">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Call vs Put OI by Strike (in '000s)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oiData} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} domain={["auto", "auto"]} label={{ value: "IV %", angle: -90, position: "insideLeft", fill: "hsl(215 15% 55%)", fontSize: 10 }} />
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
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Intraday PCR vs Spot Price</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={pcrHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} />
                    <YAxis yAxisId="pcr" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} domain={["auto", "auto"]} />
                    <YAxis yAxisId="spot" orientation="right" tick={{ fontSize: 9, fill: "hsl(215 15% 55%)" }} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine yAxisId="pcr" y={1} stroke="hsl(38 92% 50%)" strokeDasharray="3 3" label={{ value: "PCR=1", fill: "hsl(38 92% 50%)", fontSize: 9 }} />
                    <Area yAxisId="pcr" type="monotone" dataKey="pcr" stroke="hsl(210 100% 52%)" fill="hsl(210 100% 52% / 0.1)" strokeWidth={2} name="PCR" />
                    <Line yAxisId="spot" type="monotone" dataKey="spotPrice" stroke="hsl(38 92% 50%)" strokeWidth={1.5} dot={false} name="Spot" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
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
