import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { getOptionChain, getMaxPain } from "@/lib/mockData";

export default function OIAnalysis() {
  const [symbol, setSymbol] = useState("NIFTY");
  const { data: chain, spotPrice } = useMemo(() => getOptionChain(symbol), [symbol]);
  const maxPain = useMemo(() => getMaxPain(chain), [chain]);

  // OI Distribution data
  const oiData = useMemo(() => {
    return chain
      .filter(o => o.ce.oi > 50000 || o.pe.oi > 50000)
      .map(o => ({
        strike: o.strikePrice,
        callOI: Math.round(o.ce.oi / 1000),
        putOI: Math.round(o.pe.oi / 1000),
      }));
  }, [chain]);

  // OI Change data
  const oiChangeData = useMemo(() => {
    return chain
      .filter(o => Math.abs(o.ce.oiChange) > 10000 || Math.abs(o.pe.oiChange) > 10000)
      .map(o => ({
        strike: o.strikePrice,
        callOIChg: Math.round(o.ce.oiChange / 1000),
        putOIChg: Math.round(o.pe.oiChange / 1000),
      }));
  }, [chain]);

  // Top OI table
  const topCEOI = useMemo(() => [...chain].sort((a, b) => b.ce.oi - a.ce.oi).slice(0, 5), [chain]);
  const topPEOI = useMemo(() => [...chain].sort((a, b) => b.pe.oi - a.pe.oi).slice(0, 5), [chain]);

  const totalCEOI = chain.reduce((s, o) => s + o.ce.oi, 0);
  const totalPEOI = chain.reduce((s, o) => s + o.pe.oi, 0);
  const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OI Analysis</h1>
          <p className="text-sm text-muted-foreground">Open Interest Distribution & Change Analysis</p>
        </div>
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="NIFTY">NIFTY</SelectItem>
            <SelectItem value="BANKNIFTY">BANKNIFTY</SelectItem>
            <SelectItem value="FINNIFTY">FINNIFTY</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Max Pain</p>
          <p className="text-xl font-bold font-mono text-warning">{maxPain.toLocaleString("en-IN")}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">PCR (OI)</p>
          <p className={`text-xl font-bold font-mono ${pcr > 1 ? "text-bullish" : "text-bearish"}`}>{pcr.toFixed(2)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Total Call OI</p>
          <p className="text-xl font-bold font-mono">{(totalCEOI / 100000).toFixed(1)}L</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Total Put OI</p>
          <p className="text-xl font-bold font-mono">{(totalPEOI / 100000).toFixed(1)}L</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="oi-dist">
        <TabsList>
          <TabsTrigger value="oi-dist">OI Distribution</TabsTrigger>
          <TabsTrigger value="oi-change">OI Change</TabsTrigger>
          <TabsTrigger value="top-oi">Top OI Strikes</TabsTrigger>
        </TabsList>

        <TabsContent value="oi-dist">
          <Card>
            <CardHeader><CardTitle className="text-sm">Call vs Put OI by Strike (in '000s)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oiData} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="strike" tick={{ fontSize: 10, fill: "hsl(215 15% 55%)" }} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(215 15% 55%)" }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)", borderRadius: "8px", fontSize: "12px" }}
                      labelStyle={{ color: "hsl(210 20% 92%)" }}
                    />
                    <ReferenceLine x={maxPain} stroke="hsl(38 92% 50%)" strokeDasharray="5 5" label={{ value: "Max Pain", fill: "hsl(38 92% 50%)", fontSize: 10 }} />
                    <Bar dataKey="callOI" fill="hsl(142 71% 45%)" opacity={0.8} name="Call OI" />
                    <Bar dataKey="putOI" fill="hsl(0 84% 60%)" opacity={0.8} name="Put OI" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="oi-change">
          <Card>
            <CardHeader><CardTitle className="text-sm">Change in OI by Strike (in '000s)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oiChangeData} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="strike" tick={{ fontSize: 10, fill: "hsl(215 15% 55%)" }} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(215 15% 55%)" }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(220 18% 10%)", border: "1px solid hsl(220 14% 16%)", borderRadius: "8px", fontSize: "12px" }}
                    />
                    <ReferenceLine y={0} stroke="hsl(215 15% 55%)" />
                    <Bar dataKey="callOIChg" name="Call OI Chg">
                      {oiChangeData.map((entry, i) => (
                        <Cell key={i} fill={entry.callOIChg >= 0 ? "hsl(142 71% 45%)" : "hsl(142 71% 45% / 0.4)"} />
                      ))}
                    </Bar>
                    <Bar dataKey="putOIChg" name="Put OI Chg">
                      {oiChangeData.map((entry, i) => (
                        <Cell key={i} fill={entry.putOIChg >= 0 ? "hsl(0 84% 60%)" : "hsl(0 84% 60% / 0.4)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="top-oi">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm text-bullish">Top 5 Call OI Strikes</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="text-xs">
                    <TableHead>Strike</TableHead><TableHead className="text-right">OI</TableHead><TableHead className="text-right">OI Chg</TableHead><TableHead className="text-right">LTP</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {topCEOI.map(r => (
                      <TableRow key={r.strikePrice} className="text-xs font-mono">
                        <TableCell>{r.strikePrice.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right">{(r.ce.oi / 1000).toFixed(1)}K</TableCell>
                        <TableCell className={`text-right ${r.ce.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>{(r.ce.oiChange / 1000).toFixed(1)}K</TableCell>
                        <TableCell className="text-right">{r.ce.ltp.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm text-bearish">Top 5 Put OI Strikes</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow className="text-xs">
                    <TableHead>Strike</TableHead><TableHead className="text-right">OI</TableHead><TableHead className="text-right">OI Chg</TableHead><TableHead className="text-right">LTP</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {topPEOI.map(r => (
                      <TableRow key={r.strikePrice} className="text-xs font-mono">
                        <TableCell>{r.strikePrice.toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-right">{(r.pe.oi / 1000).toFixed(1)}K</TableCell>
                        <TableCell className={`text-right ${r.pe.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>{(r.pe.oiChange / 1000).toFixed(1)}K</TableCell>
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
