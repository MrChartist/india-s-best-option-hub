import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sliders, Clock, Percent, Activity } from "lucide-react";
import type { Position } from "@/lib/mockData";
import { getSpotPrice } from "@/lib/positionStore";
import {
  black76Price,
  formatDateIST,
  formatINR,
  formatPct,
  forwardFromSpot,
  getExpiries,
  getMarketParams,
  impliedVol76,
  intrinsic,
  normalizeExpiry,
  timeToExpiryYears,
} from "@/lib/options";

interface Props {
  positions: Position[];
  /** Optional live spot per symbol; falls back to the stored reference spot. */
  spots?: Record<string, number>;
}

interface Prepared {
  pos: Position;
  spot: number;
  expiry: string;
  /** Decimal IV solved from the current price, else the stored IV. */
  iv: number;
  ivSolved: boolean;
}

const PRESETS = [
  { label: "Budget day", spot: 0, iv: 5, days: 0 },
  { label: "Election result", spot: 3, iv: 8, days: 0 },
  { label: "RBI policy", spot: -1, iv: 2, days: 0 },
  { label: "Sharp sell-off", spot: -5, iv: 8, days: 0 },
  { label: "Theta decay", spot: 0, iv: -2, days: 3 },
  { label: "IV crush", spot: 0, iv: -5, days: 1 },
] as const;

/**
 * What-if scenarios for open positions: shift every underlying's spot by a percentage, shift IV and
 * move the clock forward. Each position uses its own symbol's spot, its own expiry and an IV solved
 * from its current price (Black-76). A thin wrapper over @/lib/options.
 */
export function WhatIfSimulator({ positions, spots }: Props) {
  const [spotChange, setSpotChange] = useState(0); // %
  const [ivChange, setIvChange] = useState(0); // vol points
  const [daysForward, setDaysForward] = useState(0); // calendar days

  const now = useMemo(() => new Date(), []);
  const { r } = getMarketParams();

  const prepared = useMemo<Prepared[]>(
    () =>
      positions.map((pos) => {
        const spot = spots?.[pos.symbol] && spots[pos.symbol] > 0 ? spots[pos.symbol] : getSpotPrice(pos.symbol);
        const expiry = normalizeExpiry(pos.expiry || "") || getExpiries(pos.symbol, now, 1)[0]?.date || "";
        const T = timeToExpiryYears(expiry, now);
        const fallback = pos.iv > 0 ? pos.iv / 100 : 0.15;
        let iv = fallback;
        let ivSolved = false;
        if (T > 0 && pos.currentPrice > 0 && spot > 0) {
          const solved = impliedVol76(pos.currentPrice, { F: forwardFromSpot(spot, T, r), K: pos.strike, T, r, type: pos.type });
          if (Number.isFinite(solved)) {
            iv = solved;
            ivSolved = true;
          }
        }
        return { pos, spot, expiry, iv, ivSolved };
      }),
    [positions, spots, now, r],
  );

  const maxDays = useMemo(() => {
    const ds = prepared.map((p) => Math.ceil((timeToExpiryYears(p.expiry, now) || 0) * 365)).filter((d) => d > 0);
    return Math.max(1, ...ds);
  }, [prepared, now]);

  const simulation = useMemo(() => {
    const at = new Date(now.getTime() + daysForward * 864e5);
    return prepared.map(({ pos, spot, expiry, iv, ivSolved }) => {
      const S = spot * (1 + spotChange / 100);
      const T = timeToExpiryYears(expiry, at);
      const sigma = Math.max(iv + ivChange / 100, 0.01);
      const simPrice = T > 0 ? black76Price({ F: forwardFromSpot(S, T, r), K: pos.strike, T, r, sigma, type: pos.type }) : intrinsic(S, pos.strike, pos.type);
      const sign = pos.action === "BUY" ? 1 : -1;
      const qty = pos.lots * pos.lotSize;
      const simPnl = (simPrice - pos.entryPrice) * sign * qty;
      const currentPnl = (pos.currentPrice - pos.entryPrice) * sign * qty;
      return {
        pos,
        expiry,
        ivSolved,
        iv,
        simPrice,
        simPnl,
        currentPnl,
        pnlChange: simPnl - currentPnl,
        // Signed: a short position that falls in price shows a positive %.
        simPnlPct: pos.entryPrice > 0 ? ((simPrice - pos.entryPrice) / pos.entryPrice) * sign * 100 : NaN,
      };
    });
  }, [prepared, spotChange, ivChange, daysForward, now, r]);

  const totalSim = simulation.reduce((s, p) => s + p.simPnl, 0);
  const totalCurrent = simulation.reduce((s, p) => s + p.currentPnl, 0);
  const totalChange = totalSim - totalCurrent;
  const symbols = Array.from(new Set(prepared.map((p) => p.pos.symbol)));

  if (positions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sliders className="h-4 w-4 text-primary-ink" /> What-if scenarios
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">Add positions to run what-if scenarios.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Sliders className="h-4 w-4 text-primary-ink" /> What-if scenarios
          {symbols.slice(0, 4).map((s) => (
            <Badge key={s} variant="neutral" className="font-num">
              {s} {prepared.find((p) => p.pos.symbol === s)?.spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </Badge>
          ))}
          {!spots && <Badge variant="warning" title="Reference spot from the position store, not a live quote">Reference spot</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Scenario presets">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="rounded-chip border border-border bg-card px-2 py-1 text-[11px] font-medium transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:shadow-ember"
              onClick={() => {
                setSpotChange(p.spot);
                setIvChange(p.iv);
                setDaysForward(Math.min(p.days, maxDays));
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className="rounded-chip px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              setSpotChange(0);
              setIvChange(0);
              setDaysForward(0);
            }}
          >
            Reset
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 rounded-tile bg-surface p-3 md:grid-cols-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1 text-xs"><Activity className="h-3 w-3" /> Spot change</Label>
              <Badge variant="outline" className={`font-num ${spotChange > 0 ? "text-bullish" : spotChange < 0 ? "text-bearish" : ""}`}>{formatPct(spotChange, { decimals: 2, signed: true })}</Badge>
            </div>
            <Slider value={[spotChange]} onValueChange={([v]) => setSpotChange(v)} min={-10} max={10} step={0.25} aria-label="Spot change percent" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1 text-xs"><Percent className="h-3 w-3" /> IV change</Label>
              <Badge variant="outline" className="font-num">{ivChange >= 0 ? "+" : "−"}{Math.abs(ivChange)} pts</Badge>
            </div>
            <Slider value={[ivChange]} onValueChange={([v]) => setIvChange(v)} min={-10} max={10} step={0.5} aria-label="IV change in vol points" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1 text-xs"><Clock className="h-3 w-3" /> Days forward</Label>
              <Badge variant="outline" className="font-num">T+{daysForward}d</Badge>
            </div>
            <Slider value={[daysForward]} onValueChange={([v]) => setDaysForward(v)} min={0} max={maxDays} step={1} aria-label="Days forward" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Current P&L", v: totalCurrent },
            { label: "Simulated P&L", v: totalSim },
            { label: "Change", v: totalChange },
          ].map((x) => (
            <div key={x.label} className={`rounded-tile p-2.5 text-center ${x.v >= 0 ? "bg-wash-profit/40" : "bg-wash-loss/40"}`}>
              <p className="text-[11px] text-muted-foreground">{x.label}</p>
              <p className={`font-num text-base font-bold ${x.v >= 0 ? "text-bullish" : "text-bearish"}`}>{formatINR(x.v, { decimals: 0 })}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead>Position</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">IV</TableHead>
                <TableHead className="text-right">Sim price</TableHead>
                <TableHead className="text-right">Sim P&L</TableHead>
                <TableHead className="text-right">Sim %</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {simulation.map((s) => (
                <TableRow key={s.pos.id} className="font-num text-[11px]">
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={s.pos.action === "BUY" ? "bullish" : "bearish"}>{s.pos.action}</Badge>
                      <span className="font-sans text-xs">{s.pos.symbol} {s.pos.strike} {s.pos.type}</span>
                      <span className="text-[10px] text-muted-foreground">{s.expiry ? formatDateIST(s.expiry) : "—"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{s.pos.entryPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{s.pos.currentPrice.toFixed(2)}</TableCell>
                  <TableCell className="text-right" title={s.ivSolved ? "Solved from the current price" : "Stored IV (could not solve from price)"}>
                    {(s.iv * 100).toFixed(1)}%{s.ivSolved ? "" : "*"}
                  </TableCell>
                  <TableCell className="text-right font-medium">{s.simPrice.toFixed(2)}</TableCell>
                  <TableCell className={`text-right font-medium ${s.simPnl >= 0 ? "text-bullish" : "text-bearish"}`}>{formatINR(s.simPnl, { decimals: 0 })}</TableCell>
                  <TableCell className={`text-right ${s.simPnlPct >= 0 ? "text-bullish" : "text-bearish"}`}>{formatPct(s.simPnlPct, { decimals: 1, signed: true })}</TableCell>
                  <TableCell className={`text-right ${s.pnlChange >= 0 ? "text-bullish" : "text-bearish"}`}>{formatINR(s.pnlChange, { decimals: 0 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground">Black-76 model prices with each position's own expiry (15:30 IST) and IV solved from its current price. * stored IV used. Data for education and research. Not investment advice.</p>
      </CardContent>
    </Card>
  );
}
