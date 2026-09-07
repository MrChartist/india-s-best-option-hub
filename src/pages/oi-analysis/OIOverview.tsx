import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getATMZoneAnalysis, calculatePCR, getWeightedPCR } from "@/lib/oiUtils";
import { OIHeatmap } from "@/components/OIHeatmap";
import { SupportResistance } from "@/components/SupportResistance";
import { InfoTooltip } from "@/components/dashboard/InfoTooltip";
import { useOIAnalysisContext } from "./OIAnalysisLayout";

const moduleCardClass = "overflow-hidden";

// Landing page for OI Analysis — at-a-glance metrics, the ATM zone, the heatmap,
// and support/resistance. Deep-dive strike/IV/gamma breakdowns live on their own tabs.
export default function OIOverview() {
  const { chain, spotPrice, stepSize, maxPain } = useOIAnalysisContext();
  const [atmZoneSize, setATMZoneSize] = useState<number>(5);

  const pcrData = useMemo(() => calculatePCR(chain), [chain]);
  const weightedPcrData = useMemo(() => getWeightedPCR(chain, spotPrice, stepSize), [chain, spotPrice, stepSize]);
  const atmZone5 = useMemo(() => getATMZoneAnalysis(chain, spotPrice, stepSize, 5), [chain, spotPrice, stepSize]);
  const atmZone10 = useMemo(() => getATMZoneAnalysis(chain, spotPrice, stepSize, 10), [chain, spotPrice, stepSize]);
  const activeATMZone = atmZoneSize === 5 ? atmZone5 : atmZone10;

  const totalCEOI = chain.reduce((s, o) => s + o.ce.oi, 0);
  const totalPEOI = chain.reduce((s, o) => s + o.pe.oi, 0);
  const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI) : 0;
  const totalCEOIChg = chain.reduce((s, o) => s + o.ce.oiChange, 0);
  const totalPEOIChg = chain.reduce((s, o) => s + o.pe.oiChange, 0);

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
      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metricCards.map((metric) => (
          <Card key={metric.label} className="overflow-hidden">
            <CardContent className="relative p-4">
              <div className={`absolute inset-x-0 top-0 h-0.5 ${metric.accentClass}`} />
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</p>
              <p className={`mt-1 font-mono text-lg font-semibold leading-none tabular-nums ${metric.valueClass}`}>{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ATM Zone Dashboard */}
      <Card className={moduleCardClass}>
        <CardHeader>
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
        <CardContent>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-4">
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-xs text-muted-foreground">Zone PCR</p>
              <p className={`text-lg font-semibold font-mono ${activeATMZone.pcr > 1 ? "text-bullish" : "text-bearish"}`}>{activeATMZone.pcr}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-xs text-muted-foreground">CE OI</p>
              <p className="text-sm font-semibold font-mono">{(activeATMZone.totalCEOI / 100000).toFixed(1)}L</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-xs text-muted-foreground">PE OI</p>
              <p className="text-sm font-semibold font-mono">{(activeATMZone.totalPEOI / 100000).toFixed(1)}L</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-xs text-muted-foreground">CE OI Chg%</p>
              <p className={`text-sm font-semibold font-mono ${activeATMZone.ceOIChgPercent >= 0 ? "text-bullish" : "text-bearish"}`}>{activeATMZone.ceOIChgPercent >= 0 ? "+" : ""}{activeATMZone.ceOIChgPercent}%</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-xs text-muted-foreground">PE OI Chg%</p>
              <p className={`text-sm font-semibold font-mono ${activeATMZone.peOIChgPercent >= 0 ? "text-bullish" : "text-bearish"}`}>{activeATMZone.peOIChgPercent >= 0 ? "+" : ""}{activeATMZone.peOIChgPercent}%</p>
            </div>
            <div className="col-span-3 rounded-md border border-border/60 bg-background/65 p-2 text-center">
              <p className="text-xs text-muted-foreground">Strike-wise PCR in Zone</p>
              <div className="mt-1 flex flex-wrap justify-center gap-1">
                {activeATMZone.strikeData.map(s => (
                  <div key={s.strike} className={`px-1.5 py-0.5 rounded text-xs font-mono ${s.pcr > 1 ? "bg-bullish/15 text-bullish" : "bg-bearish/15 text-bearish"}`}>
                    {s.strike.toString().slice(-3)}: {s.pcr}
                  </div>
                ))}
              </div>
            </div>
          </div>
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
                <TableRow key={s.strike} className="font-mono text-xs hover:bg-muted/30">
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

      {/* PCR Trend gauge + OI breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className={moduleCardClass}>
          <CardHeader><CardTitle className="text-sm">Put-Call Ratio (OI)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <p className={`text-4xl font-semibold font-mono ${pcrData.signalColor}`}>{pcrData.pcrOI.toFixed(2)}</p>
              <Badge variant="outline" className={`mt-2 ${pcrData.signalColor}`}>{pcrData.signal}</Badge>
            </div>
            <div className="relative h-3 rounded-full bg-gradient-to-r from-bearish/30 via-warning/30 to-bullish/30 overflow-hidden">
              <div
                className="absolute top-0 h-full w-1.5 bg-foreground rounded-full shadow-lg transition-all"
                style={{ left: `${Math.min(Math.max((pcrData.pcrOI / 2) * 100, 2), 98)}%`, transform: "translateX(-50%)" }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground font-mono">
              <span>0.0 (Bearish)</span>
              <span>1.0</span>
              <span>2.0 (Bullish)</span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <p className="text-xs text-muted-foreground">OI PCR</p>
                <p className="text-lg font-semibold font-mono">{pcrData.pcrOI.toFixed(2)}</p>
              </div>
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <p className="text-xs text-muted-foreground">Vol PCR</p>
                <p className="text-lg font-semibold font-mono">{pcrData.pcrVolume.toFixed(2)}</p>
              </div>
              <div className="p-2 rounded-md bg-accent/30 text-center">
                <div className="flex items-center justify-center text-xs text-muted-foreground">
                  Weighted PCR
                  <InfoTooltip text="Strikes near spot price count more than far OTM/ITM strikes" />
                </div>
                <p className={`text-lg font-semibold font-mono ${weightedPcrData.weightedPcrOI > 1 ? "text-bullish" : "text-bearish"}`}>{weightedPcrData.weightedPcrOI.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`${moduleCardClass} lg:col-span-2`}>
          <CardHeader><CardTitle className="text-sm">Open Interest Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-bearish">CALL OI (Writers = Resistance)</h4>
                <div className="p-3 rounded-md bg-bearish/5 border border-bearish/10">
                  <p className="text-2xl font-semibold font-mono text-bearish">{(pcrData.totalCEOI / 100000).toFixed(1)}L</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total CE Open Interest</p>
                </div>
                <div className="p-3 rounded-md bg-accent/30">
                  <p className="text-lg font-semibold font-mono">{(pcrData.totalCEVol / 100000).toFixed(1)}L</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total CE Volume</p>
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-bullish">PUT OI (Writers = Support)</h4>
                <div className="p-3 rounded-md bg-bullish/5 border border-bullish/10">
                  <p className="text-2xl font-semibold font-mono text-bullish">{(pcrData.totalPEOI / 100000).toFixed(1)}L</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total PE Open Interest</p>
                </div>
                <div className="p-3 rounded-md bg-accent/30">
                  <p className="text-lg font-semibold font-mono">{(pcrData.totalPEVol / 100000).toFixed(1)}L</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total PE Volume</p>
                </div>
              </div>
            </div>

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
    </div>
  );
}
