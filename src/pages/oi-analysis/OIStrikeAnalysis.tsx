import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell, LineChart, Line, ComposedChart } from "recharts";
import { getMaxPain, getDeltaOI, getStrikePCR } from "@/lib/oiUtils";
import { useOIAnalysisContext } from "./OIAnalysisLayout";

const moduleCardClass = "overflow-hidden";
const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", padding: "8px 12px" };
const fmtOI = (v: number, name: string) => [`${v.toLocaleString("en-IN")}K`, name];

// Strike-level breakdowns: Delta OI, Strike PCR, OI Distribution/Change/Correlation,
// buildup interpretation, and the top-5 tables. Split out of the old single OI
// Analysis page's 11-tab wall so each view gets room to breathe.
export default function OIStrikeAnalysis() {
  const { chain, spotPrice, stepSize } = useOIAnalysisContext();
  const maxPain = useMemo(() => getMaxPain(chain), [chain]);

  const deltaOIData = useMemo(() => getDeltaOI(chain, spotPrice, stepSize), [chain, spotPrice, stepSize]);
  const strikePCRData = useMemo(() => getStrikePCR(chain, spotPrice), [chain, spotPrice]);

  const oiData = useMemo(() => chain
    .filter(o => o.ce.oi > 50000 || o.pe.oi > 50000)
    .map(o => ({ strike: o.strikePrice, callOI: Math.round(o.ce.oi / 1000), putOI: Math.round(o.pe.oi / 1000) })), [chain]);

  const oiChangeData = useMemo(() => chain
    .filter(o => Math.abs(o.ce.oiChange) > 5000 || Math.abs(o.pe.oiChange) > 5000)
    .map(o => ({ strike: o.strikePrice, callOIChg: Math.round(o.ce.oiChange / 1000), putOIChg: Math.round(o.pe.oiChange / 1000) })), [chain]);

  const oiCorrelationData = useMemo(() => chain
    .filter(o => o.ce.oi > 50000 || o.pe.oi > 50000)
    .map(o => ({
      strike: o.strikePrice,
      ceOI: Math.round(o.ce.oi / 1000), peOI: Math.round(o.pe.oi / 1000),
      ceOIChg: Math.round(o.ce.oiChange / 1000), peOIChg: Math.round(o.pe.oiChange / 1000),
      ceVol: Math.round(o.ce.volume / 1000), peVol: Math.round(o.pe.volume / 1000),
    })), [chain]);

  // Long/Short Buildup vs Covering/Unwinding needs premium direction as a second
  // signal alongside OI change, which OptionLegData doesn't carry — so this only
  // reports what the OI change itself honestly tells us: rising = writing, falling = unwinding.
  const oiInterpretation = useMemo(() => chain
    .filter(o => o.ce.oi > 100000 || o.pe.oi > 100000)
    .map(o => ({
      strike: o.strikePrice, ceOI: o.ce.oi, ceOIChg: o.ce.oiChange,
      ceInterp: o.ce.oiChange > 0 ? "Call Writing" : "Call Unwinding",
      peOI: o.pe.oi, peOIChg: o.pe.oiChange,
      peInterp: o.pe.oiChange > 0 ? "Put Writing" : "Put Unwinding",
    }))
    .sort((a, b) => Math.abs(b.ceOIChg) + Math.abs(b.peOIChg) - Math.abs(a.ceOIChg) - Math.abs(a.peOIChg))
    .slice(0, 10), [chain]);

  const topCEOI = useMemo(() => [...chain].sort((a, b) => b.ce.oi - a.ce.oi).slice(0, 5), [chain]);
  const topPEOI = useMemo(() => [...chain].sort((a, b) => b.pe.oi - a.pe.oi).slice(0, 5), [chain]);

  return (
    <Tabs defaultValue="delta-oi">
      <TabsList className="mb-3 h-auto flex-wrap gap-1 rounded-lg border border-border/70 bg-card/80 p-1 shadow-card">
        <TabsTrigger value="delta-oi" className="text-xs py-1.5 px-3">Delta OI</TabsTrigger>
        <TabsTrigger value="strike-pcr" className="text-xs py-1.5 px-3">Strike PCR</TabsTrigger>
        <TabsTrigger value="oi-correlation" className="text-xs py-1.5 px-3">OI Correlation</TabsTrigger>
        <TabsTrigger value="oi-dist" className="text-xs py-1.5 px-3">OI Distribution</TabsTrigger>
        <TabsTrigger value="oi-change" className="text-xs py-1.5 px-3">OI Change</TabsTrigger>
        <TabsTrigger value="oi-interp" className="text-xs py-1.5 px-3">OI Interpretation</TabsTrigger>
        <TabsTrigger value="top-oi" className="text-xs py-1.5 px-3">Top Strikes</TabsTrigger>
      </TabsList>

      <TabsContent value="delta-oi">
        <Card className={moduleCardClass}>
          <CardHeader>
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

      <TabsContent value="strike-pcr">
        <Card className={moduleCardClass}>
          <CardHeader>
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

      <TabsContent value="oi-correlation">
        <Card className={moduleCardClass}>
          <CardHeader>
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
          <CardHeader><CardTitle className="text-sm">Call vs Put OI by Strike (in '000s)</CardTitle></CardHeader>
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
          <CardHeader><CardTitle className="text-sm">Change in OI by Strike (in '000s)</CardTitle></CardHeader>
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

      <TabsContent value="oi-interp">
        <Card className={moduleCardClass}>
          <CardHeader><CardTitle className="text-sm">OI Buildup Interpretation (Top 10 Active Strikes)</CardTitle></CardHeader>
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
                      <Badge variant="outline" className={`text-xs h-4 ${row.ceInterp === "Call Writing" ? "text-bearish" : "text-bullish"}`}>{row.ceInterp}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{(row.peOI / 1000).toFixed(0)}K</TableCell>
                    <TableCell className={`text-right ${row.peOIChg >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {row.peOIChg >= 0 ? "+" : ""}{(row.peOIChg / 1000).toFixed(1)}K
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs h-4 ${row.peInterp === "Put Writing" ? "text-bullish" : "text-bearish"}`}>{row.peInterp}</Badge>
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
            <CardHeader><CardTitle className="text-sm text-bullish">Top 5 Call OI (Resistance)</CardTitle></CardHeader>
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
            <CardHeader><CardTitle className="text-sm text-bearish">Top 5 Put OI (Support)</CardTitle></CardHeader>
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
  );
}
