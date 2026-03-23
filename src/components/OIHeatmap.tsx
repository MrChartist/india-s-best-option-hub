import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Flame } from "lucide-react";
import { type OptionData } from "@/lib/mockData";

interface OIHeatmapProps {
  chain: OptionData[];
  spotPrice: number;
}

export function OIHeatmap({ chain, spotPrice }: OIHeatmapProps) {
  const heatmapData = useMemo(() => {
    const filtered = chain.filter(o => o.ce.oi > 10000 || o.pe.oi > 10000);
    const maxOI = Math.max(...filtered.map(o => Math.max(o.ce.oi, o.pe.oi)));
    return filtered.map(o => ({
      strike: o.strikePrice,
      ceIntensity: o.ce.oi / maxOI,
      peIntensity: o.pe.oi / maxOI,
      ceOI: o.ce.oi,
      peOI: o.pe.oi,
      ceOIChg: o.ce.oiChange,
      peOIChg: o.pe.oiChange,
      isATM: Math.abs(o.strikePrice - spotPrice) < 50,
    }));
  }, [chain, spotPrice]);

  const getColor = (intensity: number, type: "call" | "put") => {
    const alpha = 0.1 + intensity * 0.85;
    return type === "call"
      ? `hsl(142 71% 45% / ${alpha})`
      : `hsl(0 84% 60% / ${alpha})`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flame className="h-4 w-4" /> OI Heatmap
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 mb-2 text-[10px] text-muted-foreground">
          <span>← Low OI</span>
          <div className="flex-1 h-3 rounded" style={{ background: "linear-gradient(90deg, hsl(142 71% 45% / 0.1), hsl(142 71% 45% / 0.9))" }} />
          <span>High OI →</span>
        </div>

        <div className="grid grid-cols-[1fr_60px_1fr] gap-0.5">
          {/* Header */}
          <div className="text-center text-[9px] font-medium text-bullish pb-1">CALL OI</div>
          <div className="text-center text-[9px] font-medium pb-1">STRIKE</div>
          <div className="text-center text-[9px] font-medium text-bearish pb-1">PUT OI</div>

          {heatmapData.map(d => (
            <>
              <Tooltip key={`ce-${d.strike}`}>
                <TooltipTrigger asChild>
                  <div
                    className="h-5 rounded-sm cursor-default flex items-center justify-end pr-1.5 transition-all hover:ring-1 hover:ring-foreground/20"
                    style={{ backgroundColor: getColor(d.ceIntensity, "call") }}
                  >
                    <span className="text-[9px] font-mono">{(d.ceOI / 1000).toFixed(0)}K</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-[10px]">
                  <p>CE OI: {(d.ceOI / 100000).toFixed(2)}L</p>
                  <p className={d.ceOIChg >= 0 ? "text-bullish" : "text-bearish"}>
                    Chg: {d.ceOIChg >= 0 ? "+" : ""}{(d.ceOIChg / 1000).toFixed(1)}K
                  </p>
                </TooltipContent>
              </Tooltip>

              <div
                key={`s-${d.strike}`}
                className={`h-5 flex items-center justify-center text-[9px] font-mono font-bold ${d.isATM ? "bg-primary/20 text-primary" : "text-muted-foreground"}`}
              >
                {d.strike}
              </div>

              <Tooltip key={`pe-${d.strike}`}>
                <TooltipTrigger asChild>
                  <div
                    className="h-5 rounded-sm cursor-default flex items-center pl-1.5 transition-all hover:ring-1 hover:ring-foreground/20"
                    style={{ backgroundColor: getColor(d.peIntensity, "put") }}
                  >
                    <span className="text-[9px] font-mono">{(d.peOI / 1000).toFixed(0)}K</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-[10px]">
                  <p>PE OI: {(d.peOI / 100000).toFixed(2)}L</p>
                  <p className={d.peOIChg >= 0 ? "text-bullish" : "text-bearish"}>
                    Chg: {d.peOIChg >= 0 ? "+" : ""}{(d.peOIChg / 1000).toFixed(1)}K
                  </p>
                </TooltipContent>
              </Tooltip>
            </>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
