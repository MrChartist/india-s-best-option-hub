import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  label: string;
  value: number;
  description: string;
  color: "bullish" | "bearish" | "neutral";
  tooltip: string;
}

const COLOR_MAP = {
  bullish: { bg: "bg-bullish/8", border: "border-bullish/20", text: "text-bullish", bar: "bg-bullish" },
  bearish: { bg: "bg-bearish/8", border: "border-bearish/20", text: "text-bearish", bar: "bg-bearish" },
  neutral: { bg: "bg-primary/5", border: "border-primary/15", text: "text-foreground", bar: "bg-primary" },
} as const;

/** One Greek tile in StrategyBuilder's Position Greeks dashboard — extracted
 * from StrategyBuilder.tsx to keep that page under the repo's 300-line law. */
export function GreekCard({ label, value, description, color, tooltip }: Props) {
  const c = COLOR_MAP[color];
  const barWidth = Math.min(Math.abs(value) * 5, 100);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`text-center p-3 rounded-lg ${c.bg} border ${c.border} transition-all duration-200 hover:shadow-sm group cursor-default relative`}>
            <div className="absolute top-2 right-2 opacity-30 group-hover:opacity-100 transition-opacity">
              <HelpCircle className="h-3 w-3" />
            </div>
            <p className="text-xs text-muted-foreground font-medium flex items-center justify-center gap-1">
              {label}
            </p>
            <p className={`text-xl font-semibold font-mono ${c.text} mt-0.5`}>{value}</p>
            {/* Intensity bar */}
            <div className="h-1 bg-muted/50 rounded-full mt-2 mb-1 overflow-hidden">
              <div className={`h-full rounded-full ${c.bar} transition-all duration-500`} style={{ width: `${barWidth}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-[200px] text-xs leading-relaxed" side="bottom">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
