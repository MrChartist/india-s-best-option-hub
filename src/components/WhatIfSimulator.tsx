import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Sliders, Clock, Percent, Activity } from "lucide-react";
import type { Position } from "@/lib/mockData";

interface Props {
  positions: Position[];
}

// Simplified BS for what-if
function bsPrice(S: number, K: number, T: number, sigma: number, type: "CE" | "PE"): number {
  if (T <= 0) return type === "CE" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const r = 0.065;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const nd1 = normCDF(d1);
  const nd2 = normCDF(d2);
  if (type === "CE") return S * nd1 - K * Math.exp(-r * T) * nd2;
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

function normCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

export function WhatIfSimulator({ positions }: Props) {
  const [spotChange, setSpotChange] = useState(0); // % change
  const [ivChange, setIvChange] = useState(0); // absolute % change
  const [daysForward, setDaysForward] = useState(0); // days forward

  const baseSpot = 24250; // approximate
  const baseDTE = 7;

  const simulation = useMemo(() => {
    const newSpot = baseSpot * (1 + spotChange / 100);
    const newDTE = Math.max(0, baseDTE - daysForward);
    const T = newDTE / 365;

    return positions.map(pos => {
      const baseIV = (pos.iv || 14) / 100;
      const newIV = baseIV + ivChange / 100;
      const newPrice = bsPrice(newSpot, pos.strike, T, Math.max(0.01, newIV), pos.type);
      const mult = (pos.action === "BUY" ? 1 : -1) * pos.lots * pos.lotSize;
      const newPnl = (newPrice - pos.entryPrice) * mult;
      const pnlChange = newPnl - pos.pnl;

      return {
        ...pos,
        simPrice: Math.round(newPrice * 100) / 100,
        simPnl: Math.round(newPnl),
        pnlChange: Math.round(pnlChange),
        simPnlPct: pos.entryPrice > 0 ? Math.round(((newPrice - pos.entryPrice) / pos.entryPrice) * 10000) / 100 : 0,
      };
    });
  }, [positions, spotChange, ivChange, daysForward]);

  const totalSimPnl = simulation.reduce((s, p) => s + p.simPnl, 0);
  const totalCurrentPnl = positions.reduce((s, p) => s + p.pnl, 0);
  const totalPnlChange = totalSimPnl - totalCurrentPnl;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" /> What-If Scenario Simulator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sliders */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 rounded-lg bg-accent/30">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] flex items-center gap-1">
                <Activity className="h-3 w-3" /> Spot Change
              </Label>
              <Badge variant="outline" className={`text-xs font-mono ${spotChange > 0 ? "text-bullish" : spotChange < 0 ? "text-bearish" : ""}`}>
                {spotChange >= 0 ? "+" : ""}{spotChange.toFixed(1)}%
              </Badge>
            </div>
            <Slider
              value={[spotChange]}
              onValueChange={([v]) => setSpotChange(v)}
              min={-5}
              max={5}
              step={0.25}
            />
            <p className="text-[9px] text-muted-foreground font-mono text-center">
              {baseSpot.toLocaleString("en-IN")} → {(baseSpot * (1 + spotChange / 100)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] flex items-center gap-1">
                <Percent className="h-3 w-3" /> IV Change
              </Label>
              <Badge variant="outline" className={`text-xs font-mono ${ivChange > 0 ? "text-bearish" : ivChange < 0 ? "text-bullish" : ""}`}>
                {ivChange >= 0 ? "+" : ""}{ivChange}%
              </Badge>
            </div>
            <Slider
              value={[ivChange]}
              onValueChange={([v]) => setIvChange(v)}
              min={-8}
              max={8}
              step={0.5}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] flex items-center gap-1">
                <Clock className="h-3 w-3" /> Days Forward
              </Label>
              <Badge variant="outline" className="text-xs font-mono">
                T+{daysForward}d
              </Badge>
            </div>
            <Slider
              value={[daysForward]}
              onValueChange={([v]) => setDaysForward(v)}
              min={0}
              max={baseDTE}
              step={1}
            />
            <p className="text-[9px] text-muted-foreground font-mono text-center">
              {baseDTE - daysForward} DTE remaining
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className={`p-3 rounded-md text-center ${totalCurrentPnl >= 0 ? "bg-bullish/5" : "bg-bearish/5"}`}>
            <p className="text-[9px] text-muted-foreground">Current P&L</p>
            <p className={`text-lg font-bold font-mono ${totalCurrentPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
              ₹{totalCurrentPnl.toLocaleString("en-IN")}
            </p>
          </div>
          <div className={`p-3 rounded-md text-center ${totalSimPnl >= 0 ? "bg-bullish/5" : "bg-bearish/5"}`}>
            <p className="text-[9px] text-muted-foreground">Simulated P&L</p>
            <p className={`text-lg font-bold font-mono ${totalSimPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
              ₹{totalSimPnl.toLocaleString("en-IN")}
            </p>
          </div>
          <div className={`p-3 rounded-md text-center ${totalPnlChange >= 0 ? "bg-bullish/10" : "bg-bearish/10"}`}>
            <p className="text-[9px] text-muted-foreground">P&L Impact</p>
            <p className={`text-lg font-bold font-mono ${totalPnlChange >= 0 ? "text-bullish" : "text-bearish"}`}>
              {totalPnlChange >= 0 ? "+" : ""}₹{totalPnlChange.toLocaleString("en-IN")}
            </p>
          </div>
        </div>

        {/* Per-Position Table */}
        <Table>
          <TableHeader>
            <TableRow className="text-[10px]">
              <TableHead>Position</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Sim Price</TableHead>
              <TableHead className="text-right">Current P&L</TableHead>
              <TableHead className="text-right">Sim P&L</TableHead>
              <TableHead className="text-right">Impact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {simulation.map(pos => (
              <TableRow key={pos.id} className="text-[11px] font-mono">
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Badge variant={pos.action === "BUY" ? "default" : "destructive"} className="text-[8px] h-3.5 px-1">{pos.action}</Badge>
                    <span className="font-sans text-[10px]">{pos.symbol} {pos.strike} {pos.type}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">₹{pos.entryPrice}</TableCell>
                <TableCell className="text-right">₹{pos.currentPrice}</TableCell>
                <TableCell className="text-right font-medium">₹{pos.simPrice}</TableCell>
                <TableCell className={`text-right ${pos.pnl >= 0 ? "text-bullish" : "text-bearish"}`}>
                  ₹{pos.pnl.toLocaleString("en-IN")}
                </TableCell>
                <TableCell className={`text-right font-medium ${pos.simPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
                  ₹{pos.simPnl.toLocaleString("en-IN")}
                </TableCell>
                <TableCell className={`text-right ${pos.pnlChange >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {pos.pnlChange >= 0 ? "+" : ""}₹{pos.pnlChange.toLocaleString("en-IN")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
