import { Fragment, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Flame } from "lucide-react";
import { type OptionData } from "@/lib/mockData";
import { tokenColor } from "@/lib/chartTheme";
import { findATMStrike } from "@/lib/options";
import { significantStrikes, maxLegOI, SIGNIFICANT_OI_FRACTION } from "@/lib/oiUtils";
import { EmptyState, ModuleHeader } from "@/components/oi/shared";
import { fmtOI, fmtOIChange, fmtStrike } from "@/components/oi/format";
import { cn } from "@/lib/utils";

interface OIHeatmapProps {
  chain: OptionData[];
  spotPrice: number;
  /** Kept for API compatibility; the ATM strike is found from the chain. */
  stepSize?: number;
  /** Strike to outline (deep link). */
  highlightStrike?: number;
}

/**
 * Call and put OI per strike as two colour ramps: calls in the call (resistance) colour,
 * puts in the put (support) colour. Strikes under 5% of the largest leg OI are hidden.
 */
export function OIHeatmap({ chain, spotPrice, highlightStrike }: OIHeatmapProps) {
  const heatmapData = useMemo(() => {
    const filtered = significantStrikes(chain, SIGNIFICANT_OI_FRACTION);
    const maxOI = Math.max(maxLegOI(filtered), 1);
    const atm = filtered.length > 0 ? findATMStrike(filtered, spotPrice) : NaN;
    return filtered.map((o) => ({
      strike: o.strikePrice,
      ceIntensity: o.ce.oi / maxOI,
      peIntensity: o.pe.oi / maxOI,
      ceOI: o.ce.oi,
      peOI: o.pe.oi,
      ceOIChg: o.ce.oiChange,
      peOIChg: o.pe.oiChange,
      isATM: o.strikePrice === atm,
    }));
  }, [chain, spotPrice]);

  const fill = (intensity: number, token: "chart-call" | "chart-put") => tokenColor(token, 0.08 + Math.max(0, Math.min(1, intensity)) * 0.72);

  return (
    <Card className="overflow-hidden">
      <ModuleHeader icon={<Flame className="h-4 w-4 text-primary-ink" />} title="OI heatmap" hint="Darker cells hold more open interest. Strikes under 5% of the largest OI are hidden." />
      <CardContent className="p-4">
        {heatmapData.length === 0 ? (
          <EmptyState icon={<Flame className="h-5 w-5" />} title="No open interest to map" />
        ) : (
          <>
            <div className="mb-3 grid grid-cols-1 gap-2 text-[11px] text-muted-foreground sm:grid-cols-2" aria-hidden="true">
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-medium text-bearish">Call OI</span>
                <div className="h-2 flex-1 rounded-capsule" style={{ background: `linear-gradient(90deg, ${tokenColor("chart-call", 0.08)}, ${tokenColor("chart-call", 0.8)})` }} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-medium text-bullish">Put OI</span>
                <div className="h-2 flex-1 rounded-capsule" style={{ background: `linear-gradient(90deg, ${tokenColor("chart-put", 0.08)}, ${tokenColor("chart-put", 0.8)})` }} />
              </div>
              <div className="flex justify-between sm:col-span-2">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>

            <div className="grid grid-cols-[1fr_72px_1fr] gap-0.5">
              <div className="pb-1 text-center text-label uppercase text-bearish">Call OI</div>
              <div className="pb-1 text-center text-label uppercase text-muted-foreground">Strike</div>
              <div className="pb-1 text-center text-label uppercase text-bullish">Put OI</div>

              {heatmapData.map((d) => (
                <Fragment key={d.strike}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        tabIndex={0}
                        aria-label={`${fmtStrike(d.strike)} call OI ${fmtOI(d.ceOI)}, change ${fmtOIChange(d.ceOIChg)}`}
                        className="flex h-6 cursor-default items-center justify-end rounded-sm pr-1.5 hover:ring-1 hover:ring-foreground/20 focus-visible:shadow-ember focus-visible:outline-none"
                        style={{ backgroundColor: fill(d.ceIntensity, "chart-call") }}
                      >
                        <span className="font-num text-[11px]">{fmtOI(d.ceOI)}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      <p>Call OI: {fmtOI(d.ceOI)}</p>
                      <p>Change: {fmtOIChange(d.ceOIChg)}</p>
                    </TooltipContent>
                  </Tooltip>

                  <div
                    className={cn(
                      "flex h-6 items-center justify-center rounded-sm font-num text-[11px] font-semibold",
                      d.isATM ? "bg-wash-brand text-primary-ink ring-1 ring-inset ring-primary/45" : "text-muted-foreground",
                      highlightStrike === d.strike && "ring-2 ring-inset ring-primary",
                    )}
                  >
                    {fmtStrike(d.strike)}
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        tabIndex={0}
                        aria-label={`${fmtStrike(d.strike)} put OI ${fmtOI(d.peOI)}, change ${fmtOIChange(d.peOIChg)}`}
                        className="flex h-6 cursor-default items-center rounded-sm pl-1.5 hover:ring-1 hover:ring-foreground/20 focus-visible:shadow-ember focus-visible:outline-none"
                        style={{ backgroundColor: fill(d.peIntensity, "chart-put") }}
                      >
                        <span className="font-num text-[11px]">{fmtOI(d.peOI)}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      <p>Put OI: {fmtOI(d.peOI)}</p>
                      <p>Change: {fmtOIChange(d.peOIChg)}</p>
                    </TooltipContent>
                  </Tooltip>
                </Fragment>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
