import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, Target } from "lucide-react";
import { type OptionData } from "@/lib/mockData";

interface SupportResistanceProps {
  chain: OptionData[];
  spotPrice: number;
}

interface Level {
  strike: number;
  type: "support" | "resistance";
  strength: number; // 0-100
  oi: number;
  distance: number;
  distancePercent: number;
}

export function SupportResistance({ chain, spotPrice }: SupportResistanceProps) {
  const levels = useMemo(() => {
    const maxCEOI = Math.max(...chain.map(o => o.ce.oi));
    const maxPEOI = Math.max(...chain.map(o => o.pe.oi));

    const resistance: Level[] = chain
      .filter(o => o.strikePrice > spotPrice && o.ce.oi > maxCEOI * 0.3)
      .sort((a, b) => b.ce.oi - a.ce.oi)
      .slice(0, 5)
      .map(o => ({
        strike: o.strikePrice,
        type: "resistance" as const,
        strength: Math.round((o.ce.oi / maxCEOI) * 100),
        oi: o.ce.oi,
        distance: o.strikePrice - spotPrice,
        distancePercent: ((o.strikePrice - spotPrice) / spotPrice) * 100,
      }));

    const support: Level[] = chain
      .filter(o => o.strikePrice < spotPrice && o.pe.oi > maxPEOI * 0.3)
      .sort((a, b) => b.pe.oi - a.pe.oi)
      .slice(0, 5)
      .map(o => ({
        strike: o.strikePrice,
        type: "support" as const,
        strength: Math.round((o.pe.oi / maxPEOI) * 100),
        oi: o.pe.oi,
        distance: spotPrice - o.strikePrice,
        distancePercent: ((spotPrice - o.strikePrice) / spotPrice) * 100,
      }));

    return { resistance: resistance.sort((a, b) => a.strike - b.strike), support: support.sort((a, b) => b.strike - a.strike) };
  }, [chain, spotPrice]);

  const LevelRow = ({ level }: { level: Level }) => (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-xs font-mono font-bold w-[70px]">{level.strike.toLocaleString("en-IN")}</span>
      <Progress
        value={level.strength}
        className={`h-2 flex-1 ${level.type === "resistance" ? "[&>div]:bg-bearish" : "[&>div]:bg-bullish"}`}
      />
      <div className="text-right w-[60px]">
        <p className="text-[10px] font-mono">{(level.oi / 100000).toFixed(1)}L</p>
        <p className="text-[8px] text-muted-foreground">{level.distancePercent.toFixed(1)}%</p>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="h-4 w-4" /> Support & Resistance (from OI)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Badge variant="outline" className="text-[9px] h-4 text-bearish border-bearish/30">
              <Shield className="h-2.5 w-2.5 mr-0.5" /> Resistance
            </Badge>
          </div>
          {levels.resistance.map(l => <LevelRow key={l.strike} level={l} />)}
        </div>

        <div className="py-1.5 px-2 rounded bg-primary/10 text-center">
          <p className="text-[10px] text-muted-foreground">Spot Price</p>
          <p className="text-sm font-bold font-mono">{spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Badge variant="outline" className="text-[9px] h-4 text-bullish border-bullish/30">
              <Shield className="h-2.5 w-2.5 mr-0.5" /> Support
            </Badge>
          </div>
          {levels.support.map(l => <LevelRow key={l.strike} level={l} />)}
        </div>
      </CardContent>
    </Card>
  );
}
