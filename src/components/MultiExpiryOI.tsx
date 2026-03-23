import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLiveOptionChain, useExpiryList } from "@/hooks/useNSEData";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, ComposedChart, Line, Cell } from "recharts";
import { Layers, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

interface Props {
  symbol: string;
}

export function MultiExpiryOI({ symbol }: Props) {
  const { data: expiryData } = useExpiryList(symbol);
  const expiries = expiryData?.expiries || [];

  // Pick first 3 expiries
  const exp1 = expiries[0]?.value || "";
  const exp2 = expiries[1]?.value || "";
  const exp3 = expiries[2]?.value || "";

  const { data: chain1 } = useLiveOptionChain(symbol, exp1);
  const { data: chain2 } = useLiveOptionChain(symbol, exp2);
  const { data: chain3 } = useLiveOptionChain(symbol, exp3);

  const [showOIChange, setShowOIChange] = useState(false);
  const [selectedExpiries, setSelectedExpiries] = useState<number[]>([0, 1]);

  const spotPrice = chain1?.spotPrice || 0;
  const stepSize = chain1?.stepSize || 50;

  // Merge data from multiple expiries
  const mergedData = useMemo(() => {
    const chains = [chain1, chain2, chain3];
    const allStrikes = new Set<number>();

    chains.forEach((c, idx) => {
      if (!selectedExpiries.includes(idx) || !c) return;
      c.chain.forEach(o => {
        if (o.ce.oi > 30000 || o.pe.oi > 30000) allStrikes.add(o.strikePrice);
      });
    });

    const strikes = Array.from(allStrikes).sort((a, b) => a - b);
    // Filter to ±15 strikes from ATM
    const atm = Math.round(spotPrice / stepSize) * stepSize;
    const filtered = strikes.filter(s => Math.abs(s - atm) <= stepSize * 15);

    return filtered.map(strike => {
      const row: any = { strike };
      chains.forEach((c, idx) => {
        if (!selectedExpiries.includes(idx) || !c) return;
        const opt = c.chain.find(o => o.strikePrice === strike);
        const suffix = `_exp${idx}`;
        if (showOIChange) {
          row[`ceOIChg${suffix}`] = opt ? Math.round(opt.ce.oiChange / 1000) : 0;
          row[`peOIChg${suffix}`] = opt ? Math.round(opt.pe.oiChange / 1000) : 0;
        } else {
          row[`ceOI${suffix}`] = opt ? Math.round(opt.ce.oi / 1000) : 0;
          row[`peOI${suffix}`] = opt ? Math.round(opt.pe.oi / 1000) : 0;
        }
      });
      return row;
    });
  }, [chain1, chain2, chain3, selectedExpiries, showOIChange, spotPrice, stepSize]);

  // Buildup/Unwinding analysis
  const buildupAnalysis = useMemo(() => {
    if (!chain1 || !chain2) return [];
    const atm = Math.round(spotPrice / stepSize) * stepSize;
    const analysis: Array<{
      strike: number;
      signal: string;
      type: "bullish" | "bearish" | "neutral";
      detail: string;
    }> = [];

    chain1.chain
      .filter(o => Math.abs(o.strikePrice - atm) <= stepSize * 10)
      .forEach(o1 => {
        const o2 = chain2?.chain.find(x => x.strikePrice === o1.strikePrice);
        if (!o2) return;

        // Compare weekly vs monthly OI patterns
        const ceOIRatio = o2.ce.oi > 0 ? o1.ce.oi / o2.ce.oi : 0;
        const peOIRatio = o2.pe.oi > 0 ? o1.pe.oi / o2.pe.oi : 0;

        if (o1.ce.oiChange > 50000 && o1.ce.oi > o2.ce.oi * 0.8) {
          analysis.push({
            strike: o1.strikePrice,
            signal: "CE Writing",
            type: "bearish",
            detail: `Strong resistance — CE OI ${(o1.ce.oi / 100000).toFixed(1)}L, Chg +${(o1.ce.oiChange / 1000).toFixed(0)}K`,
          });
        }
        if (o1.pe.oiChange > 50000 && o1.pe.oi > o2.pe.oi * 0.8) {
          analysis.push({
            strike: o1.strikePrice,
            signal: "PE Writing",
            type: "bullish",
            detail: `Strong support — PE OI ${(o1.pe.oi / 100000).toFixed(1)}L, Chg +${(o1.pe.oiChange / 1000).toFixed(0)}K`,
          });
        }
        if (o1.ce.oiChange < -30000) {
          analysis.push({
            strike: o1.strikePrice,
            signal: "CE Unwinding",
            type: "bullish",
            detail: `Resistance breaking — CE OI dropped ${(Math.abs(o1.ce.oiChange) / 1000).toFixed(0)}K`,
          });
        }
        if (o1.pe.oiChange < -30000) {
          analysis.push({
            strike: o1.strikePrice,
            signal: "PE Unwinding",
            type: "bearish",
            detail: `Support breaking — PE OI dropped ${(Math.abs(o1.pe.oiChange) / 1000).toFixed(0)}K`,
          });
        }
      });

    return analysis
      .sort((a, b) => {
        const priority = { bearish: 0, bullish: 1, neutral: 2 };
        return priority[a.type] - priority[b.type];
      })
      .slice(0, 8);
  }, [chain1, chain2, spotPrice, stepSize]);

  const expiryColors = [
    { ce: "hsl(var(--bearish))", pe: "hsl(var(--bullish))" },
    { ce: "hsl(0 68% 52% / 0.5)", pe: "hsl(152 60% 44% / 0.5)" },
    { ce: "hsl(0 68% 52% / 0.25)", pe: "hsl(152 60% 44% / 0.25)" },
  ];

  const expiryLabels = expiries.slice(0, 3).map((e, i) => e.label || `Expiry ${i + 1}`);
  const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" };

  const toggleExpiry = (idx: number) => {
    setSelectedExpiries(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {expiryLabels.map((label, idx) => (
            <button
              key={idx}
              onClick={() => toggleExpiry(idx)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                selectedExpiries.includes(idx)
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              {idx === 0 && <span className="ml-1 text-[9px] opacity-60">(Weekly)</span>}
              {idx === 1 && <span className="ml-1 text-[9px] opacity-60">(Next)</span>}
              {idx === 2 && <span className="ml-1 text-[9px] opacity-60">(Monthly)</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-muted-foreground">Show OI Change</Label>
          <Switch checked={showOIChange} onCheckedChange={setShowOIChange} />
        </div>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Multi-Expiry OI {showOIChange ? "Change" : "Distribution"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mergedData} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="strike" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}K`, ""]} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
                <ReferenceLine x={Math.round(spotPrice / stepSize) * stepSize} stroke="hsl(var(--primary))" strokeDasharray="3 3" label={{ value: "ATM", fill: "hsl(var(--primary))", fontSize: 9 }} />
                {selectedExpiries.map(idx => {
                  const suffix = `_exp${idx}`;
                  const colors = expiryColors[idx];
                  if (showOIChange) {
                    return [
                      <Bar key={`ceChg${idx}`} dataKey={`ceOIChg${suffix}`} fill={colors.ce} name={`CE Chg ${expiryLabels[idx] || ""}`} radius={[2, 2, 0, 0]} />,
                      <Bar key={`peChg${idx}`} dataKey={`peOIChg${suffix}`} fill={colors.pe} name={`PE Chg ${expiryLabels[idx] || ""}`} radius={[2, 2, 0, 0]} />,
                    ];
                  }
                  return [
                    <Bar key={`ce${idx}`} dataKey={`ceOI${suffix}`} fill={colors.ce} name={`CE OI ${expiryLabels[idx] || ""}`} radius={[2, 2, 0, 0]} />,
                    <Bar key={`pe${idx}`} dataKey={`peOI${suffix}`} fill={colors.pe} name={`PE OI ${expiryLabels[idx] || ""}`} radius={[2, 2, 0, 0]} />,
                  ];
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Buildup/Unwinding Signals */}
      {buildupAnalysis.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              OI Buildup / Unwinding Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {buildupAnalysis.map((signal, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 p-3 rounded-md border ${
                    signal.type === "bullish"
                      ? "bg-bullish/5 border-bullish/20"
                      : signal.type === "bearish"
                      ? "bg-bearish/5 border-bearish/20"
                      : "bg-accent/50 border-border"
                  }`}
                >
                  <div className="shrink-0 mt-0.5">
                    {signal.type === "bullish" ? (
                      <TrendingUp className="h-4 w-4 text-bullish" />
                    ) : signal.type === "bearish" ? (
                      <TrendingDown className="h-4 w-4 text-bearish" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-warning" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-mono">{signal.strike.toLocaleString("en-IN")}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] h-4 ${
                          signal.type === "bullish" ? "text-bullish border-bullish/30" :
                          signal.type === "bearish" ? "text-bearish border-bearish/30" : ""
                        }`}
                      >
                        {signal.signal}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{signal.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
