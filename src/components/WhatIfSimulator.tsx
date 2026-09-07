import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sliders, Clock, Percent, Activity } from "lucide-react";
import type { Position } from "@/lib/mockData";
import { getSpotPrice, parseExpiryDate, daysToExpiry } from "@/lib/positionStore";

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

// Derive the dominant underlying from positions
function deriveBaseSpot(positions: Position[]): number {
  if (positions.length === 0) return getSpotPrice("NIFTY");

  // Count occurrences of each symbol
  const counts: Record<string, number> = {};
  for (const p of positions) {
    counts[p.symbol] = (counts[p.symbol] || 0) + 1;
  }

  // Pick the most common symbol
  const topSymbol = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return getSpotPrice(topSymbol);
}

// Derive DTE from expiry strings — picks the *nearest* valid expiry across
// all legs (a multi-expiry calendar/diagonal book previously just used
// whichever leg happened to appear first in the array). Parsing now goes
// through the shared parseExpiryDate() helper, which resolves a missing year
// against today's date instead of a value that used to be hardcoded to a
// single fixed year (silently wrong for any expiry once that year passed).
function deriveDTE(positions: Position[]): number {
  if (positions.length === 0) return 7;

  const now = new Date();
  // Use parseExpiryDate only to filter out unparseable/empty expiry strings,
  // then delegate the actual day-count to the shared daysToExpiry() helper —
  // duplicating that arithmetic here previously risked the two drifting apart.
  const candidateDays = positions
    .filter(p => p.expiry && parseExpiryDate(p.expiry, now) !== null)
    .map(p => daysToExpiry(p.expiry, 7, now))
    .filter(days => days > 0 && days < 90);

  return candidateDays.length > 0 ? Math.min(...candidateDays) : 7;
}

export function WhatIfSimulator({ positions }: Props) {
  const [spotChange, setSpotChange] = useState(0); // % change
  const [ivChange, setIvChange] = useState(0); // absolute % change
  const [daysForward, setDaysForward] = useState(0); // days forward

  const baseSpot = useMemo(() => deriveBaseSpot(positions), [positions]);
  const baseDTE = useMemo(() => deriveDTE(positions), [positions]);

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
  }, [positions, spotChange, ivChange, daysForward, baseSpot, baseDTE]);

  const totalSimPnl = simulation.reduce((s, p) => s + p.simPnl, 0);
  const totalCurrentPnl = positions.reduce((s, p) => s + p.pnl, 0);
  const totalPnlChange = totalSimPnl - totalCurrentPnl;

  if (positions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Sliders className="h-4 w-4 text-primary" /> What-If Scenario Simulator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">Add positions to use the What-If simulator.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Sliders className="h-4 w-4 text-primary" /> What-If Scenario Simulator
          <Badge variant="outline" className="text-xs font-mono">Base: {baseSpot.toLocaleString("en-IN")} | {baseDTE} DTE</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Scenario Presets */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground self-center mr-1">Presets:</span>
          {[
            { label: "📊 Budget Day", spot: 0, iv: 5, days: 0 },
            { label: "🗳️ Election", spot: 3, iv: 8, days: 0 },
            { label: "🏦 RBI Policy", spot: -1, iv: 2, days: 0 },
            { label: "🦢 Black Swan", spot: -5, iv: 8, days: 0 },
            { label: "⏰ Theta Decay", spot: 0, iv: -2, days: 3 },
            { label: "📈 Expiry Day", spot: 0, iv: -5, days: Math.max(baseDTE - 1, 0) },
            { label: "↩️ Reset", spot: 0, iv: 0, days: 0 },
          ].map(preset => (
            <button
              key={preset.label}
              className="text-xs px-2 py-1 rounded-md bg-accent/50 hover:bg-accent border border-transparent hover:border-border/50 transition-all duration-150 font-medium"
              onClick={() => { setSpotChange(preset.spot); setIvChange(preset.iv); setDaysForward(preset.days); }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Sliders */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 rounded-lg bg-accent/30">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1.5">
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
            <p className="text-xs text-muted-foreground font-mono text-center">
              {baseSpot.toLocaleString("en-IN")} → {(baseSpot * (1 + spotChange / 100)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1.5">
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
              <Label className="text-xs flex items-center gap-1.5">
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
              max={Math.max(baseDTE, 1)}
              step={1}
            />
            <p className="text-xs text-muted-foreground font-mono text-center">
              {Math.max(0, baseDTE - daysForward)} DTE remaining
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className={`p-3 rounded-md text-center ${totalCurrentPnl >= 0 ? "bg-bullish/5" : "bg-bearish/5"}`}>
            <p className="text-xs text-muted-foreground">Current P&L</p>
            <p className={`text-lg font-semibold font-mono ${totalCurrentPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
              ₹{totalCurrentPnl.toLocaleString("en-IN")}
            </p>
          </div>
          <div className={`p-3 rounded-md text-center ${totalSimPnl >= 0 ? "bg-bullish/5" : "bg-bearish/5"}`}>
            <p className="text-xs text-muted-foreground">Simulated P&L</p>
            <p className={`text-lg font-semibold font-mono ${totalSimPnl >= 0 ? "text-bullish" : "text-bearish"}`}>
              ₹{totalSimPnl.toLocaleString("en-IN")}
            </p>
          </div>
          <div className={`p-3 rounded-md text-center ${totalPnlChange >= 0 ? "bg-bullish/10" : "bg-bearish/10"}`}>
            <p className="text-xs text-muted-foreground">P&L Impact</p>
            <p className={`text-lg font-semibold font-mono ${totalPnlChange >= 0 ? "text-bullish" : "text-bearish"}`}>
              {totalPnlChange >= 0 ? "+" : ""}₹{totalPnlChange.toLocaleString("en-IN")}
            </p>
          </div>
        </div>

        {/* Per-Position Table */}
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
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
              <TableRow key={pos.id} className="text-xs font-mono">
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Badge variant={pos.action === "BUY" ? "default" : "destructive"} className="text-xs h-4 px-1.5">{pos.action}</Badge>
                    <span className="font-sans text-xs">{pos.symbol} {pos.strike} {pos.type}</span>
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
