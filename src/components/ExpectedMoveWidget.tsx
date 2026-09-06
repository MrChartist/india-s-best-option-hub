import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { calculateExpectedMove } from "@/lib/gexData";
import { Target, ArrowUpDown } from "lucide-react";

interface Props {
  symbol?: string;
  spotPrice?: number;
  iv?: number;
  daysToExpiry?: number;
  compact?: boolean;
}

export function ExpectedMoveWidget({ symbol = "NIFTY", spotPrice = 0, iv, daysToExpiry = 4, compact = false }: Props) {
  const effectiveIV = iv || 0;
  // Callers can legitimately pass daysToExpiry=0 on expiry day (e.g. Index.tsx's
  // getDTE parses "0d 5h" as 0). At DTE=0, expectedMove collapses to exactly 0,
  // which makes rangeWidth below 0 too and turns every range-bar percentage into
  // NaN (division by zero) — floor it to a small positive value instead.
  const effectiveDTE = Math.max(daysToExpiry, 0.25);
  const move = useMemo(() => calculateExpectedMove(spotPrice, effectiveIV, effectiveDTE), [spotPrice, effectiveIV, effectiveDTE]);

  // Show placeholder if data not ready
  if (effectiveIV === 0 || spotPrice === 0) {
    return (
      <Card>
        <CardContent className="p-4 py-6 text-center">
          <Target className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">{symbol} Expected Move</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Waiting for VIX / spot data…</p>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="h-3.5 w-3.5 text-primary" />
            <p className="text-xs text-muted-foreground">Expected Move ({daysToExpiry}D)</p>
          </div>
          <p className="text-lg font-semibold font-mono text-primary">±{move.expectedMove.toFixed(0)}</p>
          <p className="text-xs text-muted-foreground font-mono">
            {move.lowerBound1SD.toLocaleString("en-IN")} — {move.upperBound1SD.toLocaleString("en-IN")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Defensive fallback: rangeWidth is 0 only in the degenerate case where
  // expectedMove itself is 0 (e.g. iv rounds to 0), which would otherwise turn
  // every percentage below into NaN and silently break the range-bar layout.
  const rangeWidth = (move.upperBound2SD - move.lowerBound2SD) || 1;
  const spotPct = ((spotPrice - move.lowerBound2SD) / rangeWidth) * 100;
  const lower1Pct = ((move.lowerBound1SD - move.lowerBound2SD) / rangeWidth) * 100;
  const upper1Pct = ((move.upperBound1SD - move.lowerBound2SD) / rangeWidth) * 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-primary" />
          Expected Move — {symbol}
          <Badge variant="outline" className="text-xs ml-auto">{daysToExpiry}D to Expiry</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Main stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-accent/30">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">±1σ Move</p>
            <p className="text-xl font-semibold font-mono text-primary">±{move.expectedMove.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground font-mono">({move.expectedMovePercent.toFixed(2)}%)</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-accent/30">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">ATM Straddle</p>
            <p className="text-xl font-semibold font-mono">₹{move.straddlePrice.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground font-mono">Est. from IV</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-accent/30">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">IV Used</p>
            <p className="text-xl font-semibold font-mono">{effectiveIV.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground font-mono">Annualized</p>
          </div>
        </div>

        {/* Visual range bar */}
        <div className="relative h-12 rounded-lg bg-accent/20 overflow-hidden">
          {/* 2σ background */}
          <div className="absolute inset-0 flex items-center">
            {/* 1σ band */}
            <div
              className="absolute h-full bg-primary/10 border-x border-primary/30"
              style={{ left: `${lower1Pct}%`, width: `${upper1Pct - lower1Pct}%` }}
            />
            {/* Spot marker */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-foreground z-10" style={{ left: `${spotPct}%` }}>
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs font-mono px-1 rounded whitespace-nowrap">
                {spotPrice.toLocaleString("en-IN")}
              </div>
            </div>
          </div>
          {/* Labels */}
          <div className="absolute bottom-0.5 left-1 text-xs font-mono text-bearish">{move.lowerBound2SD.toLocaleString("en-IN")}</div>
          <div className="absolute bottom-0.5 text-xs font-mono text-bearish" style={{ left: `${lower1Pct}%`, transform: "translateX(-50%)" }}>{move.lowerBound1SD.toLocaleString("en-IN")}</div>
          <div className="absolute bottom-0.5 text-xs font-mono text-bullish" style={{ left: `${upper1Pct}%`, transform: "translateX(-50%)" }}>{move.upperBound1SD.toLocaleString("en-IN")}</div>
          <div className="absolute bottom-0.5 right-1 text-xs font-mono text-bullish">{move.upperBound2SD.toLocaleString("en-IN")}</div>
        </div>

        {/* Range table */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded bg-primary/5 border border-primary/10">
            <span className="text-muted-foreground">1σ Range (68%): </span>
            <span className="font-mono font-semibold">{move.lowerBound1SD.toLocaleString("en-IN")} — {move.upperBound1SD.toLocaleString("en-IN")}</span>
          </div>
          <div className="p-2 rounded bg-accent/50">
            <span className="text-muted-foreground">2σ Range (95%): </span>
            <span className="font-mono font-semibold">{move.lowerBound2SD.toLocaleString("en-IN")} — {move.upperBound2SD.toLocaleString("en-IN")}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
