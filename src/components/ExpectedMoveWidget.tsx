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

export function ExpectedMoveWidget({ symbol = "NIFTY", spotPrice = 24250.75, iv, daysToExpiry = 4, compact = false }: Props) {
  const effectiveIV = iv || 0; // No mock VIX fallback
  const move = useMemo(() => calculateExpectedMove(spotPrice, effectiveIV, daysToExpiry), [spotPrice, effectiveIV, daysToExpiry]);

  if (compact) {
    return (
      <Card>
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Target className="h-3.5 w-3.5 text-primary" />
            <p className="text-[10px] text-muted-foreground">Expected Move ({daysToExpiry}D)</p>
          </div>
          <p className="text-lg font-bold font-mono text-primary">±{move.expectedMove.toFixed(0)}</p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {move.lowerBound1SD.toLocaleString("en-IN")} — {move.upperBound1SD.toLocaleString("en-IN")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const rangeWidth = move.upperBound2SD - move.lowerBound2SD;
  const spotPct = ((spotPrice - move.lowerBound2SD) / rangeWidth) * 100;
  const lower1Pct = ((move.lowerBound1SD - move.lowerBound2SD) / rangeWidth) * 100;
  const upper1Pct = ((move.upperBound1SD - move.lowerBound2SD) / rangeWidth) * 100;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-primary" />
          Expected Move — {symbol}
          <Badge variant="outline" className="text-[9px] ml-auto">{daysToExpiry}D to Expiry</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Main stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-accent/30">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">±1σ Move</p>
            <p className="text-xl font-bold font-mono text-primary">±{move.expectedMove.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground font-mono">({move.expectedMovePercent.toFixed(2)}%)</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-accent/30">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">ATM Straddle</p>
            <p className="text-xl font-bold font-mono">₹{move.straddlePrice.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground font-mono">Market implied</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-accent/30">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">IV Used</p>
            <p className="text-xl font-bold font-mono">{effectiveIV.toFixed(1)}%</p>
            <p className="text-[10px] text-muted-foreground font-mono">Annualized</p>
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
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-foreground text-background text-[8px] font-mono px-1 rounded whitespace-nowrap">
                {spotPrice.toLocaleString("en-IN")}
              </div>
            </div>
          </div>
          {/* Labels */}
          <div className="absolute bottom-0.5 left-1 text-[8px] font-mono text-bearish">{move.lowerBound2SD.toLocaleString("en-IN")}</div>
          <div className="absolute bottom-0.5 text-[8px] font-mono text-bearish" style={{ left: `${lower1Pct}%`, transform: "translateX(-50%)" }}>{move.lowerBound1SD.toLocaleString("en-IN")}</div>
          <div className="absolute bottom-0.5 text-[8px] font-mono text-bullish" style={{ left: `${upper1Pct}%`, transform: "translateX(-50%)" }}>{move.upperBound1SD.toLocaleString("en-IN")}</div>
          <div className="absolute bottom-0.5 right-1 text-[8px] font-mono text-bullish">{move.upperBound2SD.toLocaleString("en-IN")}</div>
        </div>

        {/* Range table */}
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="p-2 rounded bg-primary/5 border border-primary/10">
            <span className="text-muted-foreground">1σ Range (68%): </span>
            <span className="font-mono font-bold">{move.lowerBound1SD.toLocaleString("en-IN")} — {move.upperBound1SD.toLocaleString("en-IN")}</span>
          </div>
          <div className="p-2 rounded bg-accent/50">
            <span className="text-muted-foreground">2σ Range (95%): </span>
            <span className="font-mono font-bold">{move.lowerBound2SD.toLocaleString("en-IN")} — {move.upperBound2SD.toLocaleString("en-IN")}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
